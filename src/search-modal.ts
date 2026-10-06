import { Notice, SuggestModal } from 'obsidian';

import CitationPlugin from './main';
import { searchInternalEntries } from './v3/search-core';
import { getCitationInsertText } from './v3/insert-text';
import { renderBibSuggestion } from './v3/suggest/render';
import { InternalBibEntry } from './bib-entries';

/**
 * Typora 版"插入引用"检索弹窗的 Obsidian 移植：同一套检索排序与高亮渲染，
 * 插入时按光标前缀判断是否补方括号（方括号内补 `@key`，其余补 `[@key]`）。
 */
export class BibSearchModal extends SuggestModal<InternalBibEntry> {
  plugin: CitationPlugin;

  constructor(plugin: CitationPlugin) {
    super(plugin.app);
    this.plugin = plugin;
    this.setPlaceholder(plugin.texts.commands.searchPlaceholder);
    this.setInstructions([
      { command: '↑↓', purpose: 'select' },
      { command: '↵', purpose: 'insert' },
      { command: 'esc', purpose: 'dismiss' },
    ]);
  }

  getSuggestions(query: string): InternalBibEntry[] {
    return searchInternalEntries(this.plugin.getInternalBibEntries(), query);
  }

  renderSuggestion(item: InternalBibEntry, el: HTMLElement): void {
    el.innerHTML = renderBibSuggestion(item, this.inputEl.value.trim());
  }

  onNoSuggestion(): void {
    super.onNoSuggestion();
    this.resultContainerEl
      .createDiv({ cls: 'bibtex-search-empty' })
      .setText(this.plugin.texts.commands.searchEmpty);
  }

  onChooseSuggestion(item: InternalBibEntry, _evt: MouseEvent | KeyboardEvent): void {
    const view = this.plugin.activeEditorView();
    if (!view) {
      new Notice(this.plugin.texts.commands.insertUnavailable);
      return;
    }

    try {
      const editor = view.editor;
      const cursor = editor.getCursor();
      const prefixText = editor.getRange(
        { line: cursor.line, ch: 0 },
        cursor,
      );
      const insertText = getCitationInsertText(prefixText, item.key);
      editor.replaceSelection(insertText);
      new Notice(
        this.plugin.texts.commands.insertDone.replace('{key}', item.key),
      );
    } catch (error) {
      new Notice(
        `${this.plugin.texts.commands.insertErrorPrefix}${String(error)}`,
      );
    }
  }
}
