import { MAX_SUGGESTIONS } from './constants.js';

/**
 * 功能：与 Typora 版 suggest.js getSuggestions 一致的检索与排序核心（纯函数）。
 * 输入：内部条目数组、检索词。
 * 输出：排序截断后的条目数组；检索词与某条 key 完全一致时返回空数组（关闭建议）。
 */
export function searchInternalEntries(entries, query) {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  if (entries.some((item) => item.key.toLowerCase() === normalizedQuery)) {
    return [];
  }

  return entries
    .filter((item) => item.searchText.includes(normalizedQuery))
    .sort((a, b) => {
      const aStarts = a.key.toLowerCase().startsWith(normalizedQuery) ? 0 : 1;
      const bStarts = b.key.toLowerCase().startsWith(normalizedQuery) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return a.key.localeCompare(b.key);
    })
    .slice(0, MAX_SUGGESTIONS);
}
