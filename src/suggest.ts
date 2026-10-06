import { Editor, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, TFile } from 'obsidian';

import CitationPlugin from './main';
import { findNarrativeCitationQuery } from './v3/csl/narrative-citations';
import { searchInternalEntries } from './v3/search-core';
import { renderBibSuggestion } from './v3/suggest/render';
import { InternalBibEntry } from './bib-entries';

/**
 * Typora 版 BibCitationSuggest 的 Obsidian 原生 EditorSuggest 移植：
 * - 方括号内 `[@query`：只补全 `@key`（方括号已存在）。
 * - 裸 `@query`（叙述式，带 Pandoc 边界规则）：补全 `@key`。
 * - 检索/排序/渲染与 Typora 版一致（key 前缀优先 + 子串匹配 + 高亮）。
 */
export class BibCitationSuggest extends EditorSuggest<InternalBibEntry> {
  plugin: CitationPlugin;

  constructor(plugin: CitationPlugin) {
    super(plugin.app);
    this.plugin = plugin;
  }

  getSuggestions(context: EditorSuggestContext): InternalBibEntry[] {
    return searchInternalEntries(
      this.plugin.getInternalBibEntries(),
      context.query ?? '',
    );
  }

  onTrigger(
    cursor: { line: number; ch: number },
    editor: Editor,
    _file: TFile,
  ): EditorSuggestTriggerInfo | null {
    const lineText = editor.getLine(cursor.line).slice(0, cursor.ch);
    const lastOpenBracket = lineText.lastIndexOf('[');
    const lastCloseBracket = lineText.lastIndexOf(']');

    // 与 Typora 版 findQuery 一致：方括号内只走方括号分支，不回退叙述式。
    let query: string | null;
    if (lastOpenBracket > lastCloseBracket) {
      const bracketContent = lineText.slice(lastOpenBracket + 1);
      const match = bracketContent.match(/(?:^|;\s*)@([^@\]\s;]*)$/);
      query = match ? match[1] : null;
    } else {
      query = findNarrativeCitationQuery(lineText);
    }
    if (query === null) return null;

    return {
      start: { line: cursor.line, ch: cursor.ch - query.length },
      end: { line: cursor.line, ch: cursor.ch },
      query,
    };
  }

  renderSuggestion(item: InternalBibEntry, el: HTMLElement): void {
    el.innerHTML = renderBibSuggestion(item, this.context?.query ?? '');
  }

  selectSuggestion(item: InternalBibEntry): void {
    const context: EditorSuggestContext | null = this.context;
    if (!context) return;

    const { editor } = context;
    // 与 Typora 版 beforeApply 一致：整体替换为 `@key`。
    // context.start 指向查询首字符（@ 之后），替换范围向前多含一位，
    // 把触发用的 `@` 一并吃掉，避免产生 `@@key`。
    const from = {
      line: context.start.line,
      ch: Math.max(0, context.start.ch - 1),
    };
    editor.replaceRange(`@${item.key}`, from, context.end);
    editor.setCursor(context.start.line, from.ch + item.key.length + 1);
  }
}

/**
 * 功能：与 Typora 版 findQuery 的方括号分支一致，仅处理光标所在行的前缀文本。
 * 输入：光标前文本。
 * 输出：处于未闭合方括号内且匹配引用查询时返回查询串；方括号外返回 null。
 */
function findBracketQuery(text: string): string | null {
  const lastOpenBracket = text.lastIndexOf('[');
  const lastCloseBracket = text.lastIndexOf(']');
  if (lastOpenBracket <= lastCloseBracket) {
    return null;
  }

  const bracketContent = text.slice(lastOpenBracket + 1);
  const match = bracketContent.match(/(?:^|;\s*)@([^@\]\s;]*)$/);
  return match ? match[1] : null;
}
