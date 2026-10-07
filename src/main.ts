import {
  Editor,
  FileSystemAdapter,
  MarkdownView,
  normalizePath,
  Notice,
  Plugin,
  TFile,
  ViewState,
  WorkspaceLeaf,
} from 'obsidian';
import * as path from 'path';
import * as chokidar from 'chokidar';

import { compile as compileTemplate, TemplateDelegate as Template } from 'handlebars';

import CitationEvents from './events';
import {
  OpenNoteModal,
  InsertNoteContentModal,
} from './modals';
import { VaultExt } from './obsidian-extensions.d';
import { CitationSettingTab, CitationsPluginSettings } from './settings';
import {
  Entry,
  EntryDataBibLaTeX,
  EntryBibLaTeXAdapter,
  IIndexable,
  Library,
} from './types';
import { BibCitationSuggest } from './suggest';
import { BibPanelView, VIEW_TYPE_BIBTEX_CITATION } from './panel';
import {
  insertCitationCommand,
  refreshCacheCommand,
  renderCitationsCommand,
  restoreCitationsCommand,
  upsertBibliographyCommand,
  removeBibliographyCommand,
} from './commands';
import { getBibCitationTexts, BibCitationTexts } from './v3/i18n';
import { InternalBibEntry, toInternalEntries } from './bib-entries';
import { CurrentDocumentState } from './v3/document/state';

import {
  DISALLOWED_FILENAME_CHARACTERS_RE,
  Notifier,
  WorkerManager,
  WorkerManagerBlocked,
} from './util';
import LoadWorker from 'web-worker:./worker';

/**
 * MarkdownView.getMode() 在部分 Obsidian 版本的类型定义中未必声明，统一做防御式访问。
 */
type MarkdownViewWithMode = MarkdownView & {
  getMode?: () => string;
};

/**
 * 一次文档级编辑的上下文：记录是否由阅读模式临时切换而来，
 * 便于改写结束后落盘并恢复原阅读模式。
 */
export interface EditingSession {
  view: MarkdownView | null;
  file: TFile | null;
  /** 本次是否由阅读模式临时切到了编辑模式 */
  switchedFromPreview: boolean;
  /** 结束编辑：落盘并在需要时切回阅读模式 */
  finish: () => Promise<void>;
}

/** 判断视图是否处于阅读模式；无法判定模式时以编辑器是否可用兜底 */
function isPreviewMode(view: MarkdownView): boolean {
  const getMode = (view as MarkdownViewWithMode).getMode;
  if (typeof getMode === 'function') {
    return getMode.call(view) === 'preview';
  }
  return !view.editor;
}

export default class CitationPlugin extends Plugin {
  settings: CitationsPluginSettings;
  library: Library;

  // Template compilation options
  private templateSettings = {
    noEscape: true,
  };

  private loadWorker = new WorkerManager(new LoadWorker(), {
    blockingChannel: true,
  });

  events = new CitationEvents();

  loadErrorNotifier = new Notifier(
    'Unable to load citations. Please update Citations plugin settings.',
  );
  literatureNoteErrorNotifier = new Notifier(
    'Unable to access literature note. Please check that the literature note folder exists, or update the Citations plugin settings.',
  );

  get editor(): Editor | null {
    return this.app.workspace.activeEditor?.editor ?? null;
  }

  // ---- BibTeX Citations（Typora 版迁移）派生状态 ----

  private internalEntriesCache: InternalBibEntry[] = [];
  private internalEntriesSource: Library | null = null;
  documentState = new CurrentDocumentState();

  get texts(): BibCitationTexts {
    // 与 Obsidian 界面语言对齐；运行时按 language 存储读取
    return getBibCitationTexts(
      String((window as unknown as { activeWindow?: { localStorage?: Storage } }).activeWindow?.localStorage?.getItem('language') ?? 'zh'),
    );
  }

  getInternalBibEntries(): InternalBibEntry[] {
    if (this.internalEntriesSource !== this.library) {
      this.refreshDerivedEntries();
    }
    return this.internalEntriesCache;
  }

  refreshDerivedEntries(): void {
    this.internalEntriesSource = this.library;
    this.internalEntriesCache = this.library
      ? toInternalEntries(Object.values(this.library.entries))
      : [];
  }

  activeEditorView(): MarkdownView | null {
    // 焦点在右侧栏/弹窗时 activeEditor 为 null，回退到最近活动的 Markdown 视图，
    // 保证右侧栏按钮无需先点回正文即可作用于文档。
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active) {
      this.lastMarkdownView = active;
      return active;
    }
    if (this.lastMarkdownView && this.lastMarkdownView.editor) {
      return this.lastMarkdownView;
    }
    return null;
  }

  private lastMarkdownView: MarkdownView | null = null;

  /**
   * 取当前可用的 Markdown 视图，并在其处于阅读模式时切到编辑（实时预览）模式。
   * 阅读模式下插件无法改写笔记，故所有写操作入口都应先调用本方法。
   * 已是源码/实时预览模式时原样返回，避免不必要的视图重建。
   */
  async ensureEditingView(): Promise<MarkdownView | null> {
    const view = this.activeEditorView();
    if (!view) return null;

    // 已是可编辑状态（源码/实时预览且编辑器可用）时原样返回，不做任何视图操作
    if (!isPreviewMode(view) && view.editor) return view;

    const leaf = view.leaf;
    if (!leaf) return view;

    try {
      // 与成熟的阅读模式切换实现保持一致：只 spread 原 viewState，
      // 不覆盖 view type、不额外设置 active、不调用内部 setMode，避免破坏 leaf 造成白屏。
      const viewState: ViewState = leaf.getViewState();
      const state = viewState.state ?? {};
      if (state.mode !== 'preview') return view;

      await leaf.setViewState({
        ...viewState,
        state: { ...state, mode: 'source', source: false },
      });

      // 切换后视图实例可能重建，重新取一次
      const newView = leaf.view;
      const result = newView instanceof MarkdownView ? newView : view;
      this.lastMarkdownView = result;
      return result;
    } catch (error) {
      console.error('[bibtex-citation] failed to switch to editing mode:', error);
      return view;
    }
  }

  /**
   * 开启一次文档级编辑：原本处于阅读模式时临时切到编辑模式，
   * 改写完成后调用 finish() 落盘并切回阅读模式；原本就是编辑模式时 finish() 为空操作。
   */
  async beginEditingSession(): Promise<EditingSession> {
    const origin = this.activeEditorView();
    if (!origin) {
      return {
        view: null,
        file: null,
        switchedFromPreview: false,
        finish: async () => undefined,
      };
    }

    const leaf = origin.leaf;
    const wasPreview = isPreviewMode(origin);
    const view = await this.ensureEditingView();
    const switchedFromPreview = wasPreview && view !== null;

    return {
      view,
      file: view?.file ?? null,
      switchedFromPreview,
      finish: async () => {
        if (!switchedFromPreview || !leaf) return;
        try {
          // 切回阅读模式前先把编辑器内容落盘，避免改写只停留在内存中
          const file = view?.file ?? null;
          if (file && view?.editor) {
            await this.app.vault.modify(file, view.editor.getValue());
          }

          // 同样只 spread 当前 viewState：不覆盖 view type、不额外设置 active
          const currentState: ViewState = leaf.getViewState();
          await leaf.setViewState({
            ...currentState,
            state: { ...(currentState.state ?? {}), mode: 'preview' },
          });

          const restored = leaf.view;
          if (restored instanceof MarkdownView) {
            this.lastMarkdownView = restored;
          }
        } catch (error) {
          // 恢复失败不影响已经完成的文档改写，仅记录日志
          console.error('[bibtex-citation] failed to restore reading mode:', error);
        }
      },
    };
  }

  getDocumentCitationState(markdown: string): {
    counts: { unique: number; total: number };
    error: { type: string; key?: string; blockText?: string } | null;
  } {
    const validKeys = new Set(
      this.getInternalBibEntries().map((entry) => entry.key),
    );
    return this.documentState.getCitationState(markdown, validKeys);
  }

  async loadSettings(): Promise<void> {
    this.settings = new CitationsPluginSettings();

    const loadedSettings = await this.loadData();
    if (!loadedSettings) return;

    const toLoad = [
      'citationExportPath',
      'literatureNoteTitleTemplate',
      'literatureNoteFolder',
      'literatureNoteContentTemplate',
      'cslFilePath',
    ];
    toLoad.forEach((setting) => {
      if (setting in loadedSettings) {
        (this.settings as IIndexable)[setting] = loadedSettings[setting];
      }
    });
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  onload(): void {
    this.loadSettings().then(() => this.init());
  }

  async init(): Promise<void> {
    if (this.settings.citationExportPath) {
      // Load library for the first time
      this.loadLibrary();

      // Set up a watcher to refresh whenever the export is updated
      try {
        // Wait until files are finished being written before going ahead with
        // the refresh -- here, we request that `change` events be accumulated
        // until nothing shows up for 500 ms
        // TODO magic number
        const watchOptions = {
          awaitWriteFinish: {
            stabilityThreshold: 500,
          },
        };

        chokidar
          .watch(
            this.resolveLibraryPath(this.settings.citationExportPath),
            watchOptions,
          )
          .on('change', () => {
            this.loadLibrary();
          });
      } catch {
        this.loadErrorNotifier.show();
      }
    } else {
      // TODO show warning?
    }

    // ---- BibTeX Citations（Typora 版迁移）----
    this.registerEditorSuggest(new BibCitationSuggest(this));

    this.registerView(
      VIEW_TYPE_BIBTEX_CITATION,
      (leaf: WorkspaceLeaf) => new BibPanelView(leaf, this),
    );

    this.registerEvent(
      this.events.on('library-load-complete', () => {
        this.refreshDerivedEntries();
      }),
    );

    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        const view = leaf?.view;
        if (view instanceof MarkdownView) {
          this.lastMarkdownView = view;
        }
      }),
    );

    this.addRibbonIcon('library', this.texts.sidebar.title, () => {
      this.activatePanel();
    });

    // 命令统一不带默认快捷键，仅保留在命令面板中
    this.addCommand({
      id: 'open-literature-note',
      name: 'Open literature note',
      callback: () => {
        const modal = new OpenNoteModal(this.app, this);
        modal.open();
      },
    });

    this.addCommand({
      id: 'insert-literature-note-content',
      name: 'Insert literature note content in the current pane',
      callback: () => {
        const modal = new InsertNoteContentModal(this.app, this);
        modal.open();
      },
    });

    this.addCommand({
      id: 'bibtex-insert-citation',
      name: this.texts.commands.insertCitation,
      callback: () => insertCitationCommand(this),
    });

    this.addCommand({
      id: 'bibtex-refresh-cache',
      name: this.texts.commands.refreshCache,
      callback: () => refreshCacheCommand(this),
    });

    this.addCommand({
      id: 'bibtex-render-citations',
      name: this.texts.commands.renderCitations,
      callback: () => renderCitationsCommand(this),
    });

    this.addCommand({
      id: 'bibtex-restore-citations',
      name: this.texts.commands.restoreCitations,
      callback: () => restoreCitationsCommand(this),
    });

    this.addCommand({
      id: 'bibtex-upsert-bibliography',
      name: this.texts.commands.upsertBibliography,
      callback: () => upsertBibliographyCommand(this),
    });

    this.addCommand({
      id: 'bibtex-remove-bibliography',
      name: this.texts.commands.removeBibliography,
      callback: () => removeBibliographyCommand(this),
    });

    this.addCommand({
      id: 'bibtex-toggle-panel',
      name: this.texts.sidebar.title,
      callback: () => this.activatePanel(),
    });

    this.addSettingTab(new CitationSettingTab(this.app, this));
  }

  activatePanel(): void {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_BIBTEX_CITATION);
    const leaf =
      existing[0] ??
      workspace.getRightLeaf(false) ??
      workspace.getLeaf(true);
    if (!leaf) return;
    leaf.setViewState({ type: VIEW_TYPE_BIBTEX_CITATION, active: true });
    workspace.revealLeaf(leaf);
  }

  /**
   * Resolve a provided library path, allowing for relative paths rooted at
   * the vault directory.
   */
  resolveLibraryPath(rawPath: string): string {
    const vaultRoot =
      this.app.vault.adapter instanceof FileSystemAdapter
        ? this.app.vault.adapter.getBasePath()
        : '/';
    return path.resolve(vaultRoot, rawPath);
  }

  async loadLibrary(): Promise<Library> {
    console.debug('Citation plugin: Reloading library');
    if (this.settings.citationExportPath) {
      const filePath = this.resolveLibraryPath(
        this.settings.citationExportPath,
      );

      // Unload current library.
      this.events.trigger('library-load-start');
      this.library = null;

      return FileSystemAdapter.readLocalFile(filePath)
        .then((buffer) => {
          // If there is a remaining error message, hide it
          this.loadErrorNotifier.hide();

          // Decode file as UTF-8.
          const dataView = new DataView(buffer);
          const decoder = new TextDecoder('utf8');
          const value = decoder.decode(dataView);

          return this.loadWorker.post({
            databaseRaw: value,
            // 仅支持 BibLaTeX（.bib）；不再支持 CSL-JSON 库
            databaseType: 'biblatex' as const,
          });
        })
        .then((entries: EntryDataBibLaTeX[]) => {
          this.library = new Library(
            Object.fromEntries(
              entries.map(
                (e) =>
                  [(e as IIndexable).key, new EntryBibLaTeXAdapter(e)] as const,
              ),
            ),
          );
          console.debug(
            `Citation plugin: successfully loaded library with ${this.library.size} entries.`,
          );

          this.events.trigger('library-load-complete');

          return this.library;
        })
        .catch((e) => {
          if (e instanceof WorkerManagerBlocked) {
            // Silently catch WorkerManager error, which will be thrown if the
            // library is already being loaded
            return;
          }

          console.error(e);
          this.loadErrorNotifier.show();

          return null;
        });
    } else {
      console.warn(
        'Citations plugin: citation export path is not set. Please update plugin settings.',
      );
    }
  }

  /**
   * Returns true iff the library is currently being loaded on the worker thread.
   */
  get isLibraryLoading(): boolean {
    return this.loadWorker.blocked;
  }

  get literatureNoteTitleTemplate(): Template {
    return compileTemplate(
      this.settings.literatureNoteTitleTemplate,
      this.templateSettings,
    );
  }

  get literatureNoteContentTemplate(): Template {
    return compileTemplate(
      this.settings.literatureNoteContentTemplate,
      this.templateSettings,
    );
  }

  getTitleForCitekey(citekey: string): string {
    const unsafeTitle = this.literatureNoteTitleTemplate(
      this.library.getTemplateVariablesForCitekey(citekey),
    );
    return unsafeTitle.replace(DISALLOWED_FILENAME_CHARACTERS_RE, '_');
  }

  getPathForCitekey(citekey: string): string {
    const title = this.getTitleForCitekey(citekey);
    // TODO escape note title
    return path.join(this.settings.literatureNoteFolder, `${title}.md`);
  }

  getInitialContentForCitekey(citekey: string): string {
    return this.literatureNoteContentTemplate(
      this.library.getTemplateVariablesForCitekey(citekey),
    );
  }

  /**
   * Run a case-insensitive search for the literature note file corresponding to
   * the given citekey. If no corresponding file is found, create one.
   */
  async getOrCreateLiteratureNoteFile(citekey: string): Promise<TFile> {
    const path = this.getPathForCitekey(citekey);
    const normalizedPath = normalizePath(path);

    let file = this.app.vault.getAbstractFileByPath(normalizedPath);
    if (file == null) {
      // First try a case-insensitive lookup.
      const matches = this.app.vault
        .getMarkdownFiles()
        .filter((f) => f.path.toLowerCase() == normalizedPath.toLowerCase());
      if (matches.length > 0) {
        file = matches[0];
      } else {
        try {
          file = await this.app.vault.create(
            path,
            this.getInitialContentForCitekey(citekey),
          );
        } catch (exc) {
          this.literatureNoteErrorNotifier.show();
          throw exc;
        }
      }
    }

    return file as TFile;
  }

  async openLiteratureNote(citekey: string, newPane: boolean): Promise<void> {
    this.getOrCreateLiteratureNoteFile(citekey)
      .then((file: TFile) => {
        this.app.workspace.getLeaf(newPane).openFile(file);
      })
      .catch(console.error);
  }

  /**
   * Format literature note content for a given reference and insert in the
   * currently active pane.
   */
  async insertLiteratureNoteContent(citekey: string): Promise<void> {
    const view = await this.ensureEditingView();
    if (!view?.editor) {
      new Notice(this.texts.commands.insertUnavailable);
      return;
    }
    const content = this.getInitialContentForCitekey(citekey);
    view.editor.replaceRange(content, view.editor.getCursor());
  }
}
