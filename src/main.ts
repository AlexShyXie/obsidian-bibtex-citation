import {
  Editor,
  FileSystemAdapter,
  MarkdownView,
  normalizePath,
  Plugin,
  TFile,
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
    const content = this.getInitialContentForCitekey(citekey);
    this.editor.replaceRange(content, this.editor.getCursor());
  }
}
