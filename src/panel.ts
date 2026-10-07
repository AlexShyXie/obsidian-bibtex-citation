import { ItemView, WorkspaceLeaf } from 'obsidian';

import CitationPlugin from './main';
import { renderCitationsCommand, restoreCitationsCommand, upsertBibliographyCommand, removeBibliographyCommand, refreshCacheCommand } from './commands';

export const VIEW_TYPE_BIBTEX_CITATION = 'bibtex-citation-panel';

/**
 * Typora 版 BibCitationSidebarPanel 的 Obsidian 右侧栏移植：
 * 概览网格（CSL 文件 / 条目数 / 当前文档引用统计）+ 5 个动作按钮 + 错误显示。
 */
export class BibPanelView extends ItemView {
  plugin: CitationPlugin;

  private summaryEls: Record<string, HTMLElement> = {};
  private errorEl!: HTMLElement;
  private pathListEl!: HTMLElement;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: CitationPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = false;
  }

  getViewType(): string {
    return VIEW_TYPE_BIBTEX_CITATION;
  }

  getDisplayText(): string {
    return this.plugin.texts.sidebar.title;
  }

  getIcon(): string {
    return 'book-marked';
  }

  async onOpen(): Promise<void> {
    const t = this.plugin.texts;

    this.contentEl.addClass('bibtex-sidebar-panel');
    this.contentEl.empty();

    this.contentEl.createEl('h4', { text: t.sidebar.heading });
    this.contentEl
      .createEl('p', { cls: 'bibtex-sidebar-description', text: t.sidebar.description });

    const summary = this.contentEl.createEl('dl', { cls: 'bibtex-sidebar-summary' });
    this.summaryEls.cslFile = this.addSummaryRow(summary, t.sidebar.cslFileLabel);
    this.summaryEls.entries = this.addSummaryRow(summary, t.sidebar.indexedEntriesLabel);
    this.summaryEls.citations = this.addSummaryRow(summary, t.sidebar.citedEntriesLabel);

    const actions = this.contentEl.createDiv({ cls: 'bibtex-sidebar-actions' });
    // 按钮文案 = 命令面板命令名（同一组 i18n key）
    this.addActionButton(actions, t.commands.refreshCache, 'bibtex-sidebar-button', () =>
      refreshCacheCommand(this.plugin),
    );
    this.addActionButton(actions, t.commands.renderCitations, 'bibtex-sidebar-button', () =>
      renderCitationsCommand(this.plugin),
    );
    this.addActionButton(actions, t.commands.restoreCitations, 'bibtex-sidebar-button', () =>
      restoreCitationsCommand(this.plugin),
    );
    this.addActionButton(actions, t.commands.upsertBibliography, 'bibtex-sidebar-button', () =>
      upsertBibliographyCommand(this.plugin),
    );
    this.addActionButton(actions, t.commands.removeBibliography, 'bibtex-sidebar-button', () =>
      removeBibliographyCommand(this.plugin),
    );

    this.errorEl = this.contentEl.createEl('p', { cls: 'bibtex-sidebar-error' });
    this.errorEl.hide();

    this.contentEl.createEl('p', { cls: 'bibtex-sidebar-title', text: t.sidebar.filesTitle });
    this.pathListEl = this.contentEl.createDiv({ cls: 'bibtex-sidebar-path-list' });

    this.registerEvents();
    this.refreshSummary();
  }

  async onClose(): Promise<void> {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
  }

  /**
   * 读取当前文档内容用于概览统计：
   * 优先编辑器（含未保存改动），阅读模式下编辑器不可用时回退读文件（只读，不切换模式）。
   */
  private async readCurrentMarkdown(): Promise<string> {
    const fromEditor = this.plugin.activeEditorView()?.editor?.getValue();
    if (fromEditor != null) return fromEditor;

    const file = this.app.workspace.getActiveFile();
    if (!file) return '';
    try {
      return await this.app.vault.cachedRead(file);
    } catch (error) {
      console.error('[bibtex-citation] failed to read current file:', error);
      return '';
    }
  }

  private addSummaryRow(summary: HTMLElement, label: string): HTMLElement {
    const row = summary.createDiv({ cls: 'bibtex-sidebar-summary-row' });
    row.createEl('dt', { text: label });
    const value = row.createEl('dd', { text: '—' });
    return value;
  }

  private addActionButton(
    parent: HTMLElement,
    label: string,
    cls: string,
    onClick: () => void,
  ): void {
    const button = parent.createEl('button', { cls, text: label });
    button.addEventListener('click', onClick);
  }

  private registerEvents(): void {
    // 切换笔记 / 库重载后刷新概览；编辑中做节流刷新。
    this.registerEvent(this.plugin.events.on('library-load-complete', () => this.refreshSummary()));
    this.registerEvent(this.app.workspace.on('file-open', () => this.refreshSummary()));
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => this.refreshSummary()),
    );
    this.registerEvent(
      this.plugin.events.on('bibtex-citation-refresh', () =>
        this.refreshSummary(),
      ),
    );
  }

  refreshSummary(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.doRefresh(), 300);
  }

  private async doRefresh(): Promise<void> {
    const t = this.plugin.texts;

    const cslPath = String(this.plugin.settings.cslFilePath || '').trim();
    this.summaryEls.cslFile.setText(cslPath || t.sidebar.unavailable);

    const entries = this.plugin.getInternalBibEntries();
    this.summaryEls.entries.setText(
      entries.length ? String(entries.length) : t.sidebar.unavailable,
    );

    const markdown = await this.readCurrentMarkdown();
    const state = this.plugin.getDocumentCitationState(markdown);
    if (state.error) {
      this.errorEl.setText(
        state.error.type === 'unknown-key'
          ? t.sidebar.invalidCitationPrefix + state.error.key
          : t.sidebar.invalidCitationBlockPrefix +
              (state.error.blockText ?? ''),
      );
      this.errorEl.show();
      this.summaryEls.citations.setText('—');
    } else {
      this.errorEl.hide();
      this.summaryEls.citations.setText(
        t.sidebar.citationCountFormat
          .replace('{unique}', String(state.counts.unique))
          .replace('{total}', String(state.counts.total)),
      );
    }

    this.pathListEl.empty();
    const bibPath = String(this.plugin.settings.citationExportPath || '').trim();
    if (!bibPath) {
      this.pathListEl.createEl('p', { cls: 'bibtex-sidebar-empty', text: t.sidebar.empty });
      return;
    }
    // "BibTeX 文件"区只列 bib 库文件；CSL 已单独显示在上方概览行
    const list = this.pathListEl.createEl('ul');
    list.createEl('li', { text: bibPath });
  }
}
