import { Notice } from 'obsidian';

import CitationPlugin from './main';
import { BibSearchModal } from './search-modal';
import {
  renderCurrentDocumentCitations,
  restoreCurrentDocumentCitations,
  upsertCurrentDocumentBibliography,
  removeCurrentDocumentBibliography,
} from './document-io';

/**
 * 命令与右侧栏按钮共用的动作包装（对齐 Typora 版 command-runtime.js 的反馈文案）。
 */

export function insertCitationCommand(plugin: CitationPlugin): void {
  new BibSearchModal(plugin).open();
}

/** 文档级动作完成后刷新右侧栏概览 */
function notifyPanel(plugin: CitationPlugin): void {
  plugin.events.trigger('bibtex-citation-refresh');
}

export async function refreshCacheCommand(plugin: CitationPlugin): Promise<void> {
  try {
    await plugin.loadLibrary();
    plugin.refreshDerivedEntries();
    new Notice(
      plugin.texts.commands.refreshDone.replace(
        '{n}',
        String(plugin.getInternalBibEntries().length),
      ),
    );
  } catch (error) {
    console.error('[bibtex-citation] refresh failed:', error);
    new Notice(`${plugin.texts.commands.refreshErrorPrefix}${String(error)}`);
  }
}

export function renderCitationsCommand(plugin: CitationPlugin): Promise<void> {
  return renderCurrentDocumentCitations(plugin).finally(() =>
    notifyPanel(plugin),
  );
}

export function restoreCitationsCommand(plugin: CitationPlugin): Promise<void> {
  return restoreCurrentDocumentCitations(plugin).finally(() =>
    notifyPanel(plugin),
  );
}

export function upsertBibliographyCommand(plugin: CitationPlugin): Promise<void> {
  return upsertCurrentDocumentBibliography(plugin).finally(() =>
    notifyPanel(plugin),
  );
}

export function removeBibliographyCommand(plugin: CitationPlugin): Promise<void> {
  return removeCurrentDocumentBibliography(plugin).finally(() =>
    notifyPanel(plugin),
  );
}
