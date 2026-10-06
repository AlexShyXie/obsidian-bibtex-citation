import { Editor, EditorPosition, Notice } from 'obsidian';
import * as fs from 'fs';

import CitationPlugin from './main';
import {
  renderCitationMarkdown,
  restoreCitationMarkdown,
} from './v3/csl/render';
import { upsertBibliographyMarkdown, removeBibliographyMarkdown } from './v3/csl/bibliography';
import { ensureCslTemplate } from './v3/csl/assets';
import { InternalBibEntry } from './bib-entries';
import { BibCitationTexts } from './v3/i18n';

/**
 * Typora 版 document-actions 的 Obsidian 移植：
 * 读取活动编辑器全文 → 复用 v3 纯文本改写 → 整体写回并尽量恢复光标。
 */

export interface DocumentActionResult {
  changed: boolean;
  message: string;
}

function getActiveEditor(plugin: CitationPlugin): Editor | null {
  return plugin.activeEditorView()?.editor ?? null;
}

function offsetOf(editor: Editor, pos: EditorPosition): number {
  try {
    return editor.posToOffset(pos);
  } catch {
    return 0;
  }
}

async function runDocumentAction(
  plugin: CitationPlugin,
  config: {
    act: (markdown: string, entries: InternalBibEntry[]) => {
      changed: boolean;
      markdown?: string;
    };
    formatNoChanges: (t: BibCitationTexts) => string;
    formatSuccess: (
      t: BibCitationTexts,
      result: { changed: boolean; renderedBlocks?: number; renderedKeys?: number; keyCount?: number },
    ) => string;
    formatErrorPrefix: (t: BibCitationTexts) => string;
  },
): Promise<void> {
  const t = plugin.texts;
  try {
    const editor = getActiveEditor(plugin);
    if (!editor) {
      new Notice(t.commands.insertUnavailable);
      return;
    }

    const entries = plugin.getInternalBibEntries();
    const result = config.act(editor.getValue(), entries);
    if (!result.changed || result.markdown == null) {
      new Notice(config.formatNoChanges(t));
      return;
    }

    const offset = offsetOf(editor, editor.getCursor());
    editor.setValue(result.markdown);
    // 尝试恢复光标：文档前缀通常不变，按原偏移近似还原。
    // 注意 Windows 文档为 CRLF 时，CM6 内部按 \n 计长，与 getValue() 的
    // 字符长度不一致，clamp 必须按规范化后的长度；兜底失败则退到文末。
    const normalizedLength = editor
      .getValue()
      .replace(/\r\n/g, '\n').length;
    try {
      editor.setCursor(editor.offsetToPos(Math.min(offset, normalizedLength)));
    } catch {
      try {
        const lastLine = editor.lastLine();
        const safeCh = Math.max(0, (editor.getLine(lastLine) || '').length - 1);
        editor.setCursor({ line: lastLine, ch: safeCh });
      } catch {
        // 光标恢复失败不影响文档改写结果
      }
    }

    new Notice(config.formatSuccess(t, result));
  } catch (error) {
    console.error('[bibtex-citation] document action failed:', error);
    new Notice(`${config.formatErrorPrefix(t)}${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 功能：渲染/更新当前文档的全部 citation（严格 [@key] 与受控块）。
 */
export function renderCurrentDocumentCitations(plugin: CitationPlugin): Promise<void> {
  return runDocumentAction(plugin, {
    act: (markdown, entries) => renderCitationMarkdown(markdown, entries, ensureCslTemplateCached(plugin)),
    formatNoChanges: (t) => t.sidebar.renderNoChanges,
    formatSuccess: (t, result) =>
      t.sidebar.renderSuccess
        .replace('{blocks}', String(result.renderedBlocks ?? 0))
        .replace('{keys}', String(result.renderedKeys ?? 0)),
    formatErrorPrefix: (t) => t.sidebar.renderErrorPrefix,
  });
}

/**
 * 功能：把当前文档的受控 citation 块恢复为原始 [@key]。
 */
export function restoreCurrentDocumentCitations(plugin: CitationPlugin): Promise<void> {
  return runDocumentAction(plugin, {
    act: (markdown) => restoreCitationMarkdown(markdown),
    formatNoChanges: (t) => t.sidebar.restoreNoChanges,
    formatSuccess: (t, result) =>
      t.sidebar.restoreSuccess
        .replace('{blocks}', String(result.renderedBlocks ?? 0))
        .replace('{keys}', String(result.renderedKeys ?? 0)),
    formatErrorPrefix: (t) => t.sidebar.restoreErrorPrefix,
  });
}

/**
 * 功能：为当前文档插入/更新受控参考文献块。
 */
export function upsertCurrentDocumentBibliography(plugin: CitationPlugin): Promise<void> {
  return runDocumentAction(plugin, {
    act: (markdown, entries) =>
      upsertBibliographyMarkdown(
        markdown,
        entries,
        ensureCslTemplateCached(plugin),
        plugin.texts.sidebar.bibliographyHeading,
      ),
    formatNoChanges: (t) => t.sidebar.insertBibliographyNoChanges,
    formatSuccess: (t, result) =>
      t.sidebar.insertBibliographySuccess.replace(
        '{keys}',
        String(result.keyCount ?? 0),
      ),
    formatErrorPrefix: (t) => t.sidebar.insertBibliographyErrorPrefix,
  });
}

/**
 * 功能：删除当前文档的受控参考文献块。
 */
export function removeCurrentDocumentBibliography(plugin: CitationPlugin): Promise<void> {
  return runDocumentAction(plugin, {
    act: (markdown) => removeBibliographyMarkdown(markdown),
    formatNoChanges: (t) => t.sidebar.removeBibliographyNoChanges,
    formatSuccess: (t) => t.sidebar.removeBibliographySuccess,
    formatErrorPrefix: (t) => t.sidebar.removeBibliographyErrorPrefix,
  });
}

let templateCache: { key: string; name: string } | null = null;

/**
 * 功能：带缓存的 CSL 模板解析（mtime 变化时重新注册）。
 */
export function ensureCslTemplateCached(plugin: CitationPlugin): string {
  const path = plugin.resolveLibraryPath(
    String(plugin.settings.cslFilePath || '').trim(),
  );
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(path).mtimeMs;
  } catch {
    // 让 ensureCslTemplate 统一抛出带文案的错误
    return ensureCslTemplate(plugin);
  }

  const key = `${path}:${mtimeMs}`;
  if (templateCache && templateCache.key === key) {
    return templateCache.name;
  }

  const name = ensureCslTemplate(plugin);
  templateCache = { key, name };
  return name;
}
