import { Entry, EntryDataBibLaTeX, IIndexable } from './types';

/**
 * 与 Typora 版 bibtex-citation 的 parser.js 输出对齐的内部条目格式。
 * biblatex 来源按字段数组取首值；csl-json 来源保留原始 CSL-JSON 供 Citation.js 直接消费。
 */
export interface InternalBibEntry {
  key: string;
  type: string;
  title: string;
  authors: string;
  editors: string;
  year: string;
  journal: string;
  booktitle: string;
  volume: string;
  issue: string;
  pages: string;
  doi: string;
  publisher: string;
  institution: string;
  cslJson?: Record<string, unknown>;
  searchText: string;
}

function firstField(fields: Record<string, unknown> | undefined, name: string): string {
  const value = fields?.[name];
  if (Array.isArray(value)) {
    return String(value[0] ?? '');
  }
  return value == null ? '' : String(value);
}

function toInternalBibLaTeX(data: EntryDataBibLaTeX): InternalBibEntry {
  const fields = (data.fields ?? {}) as Record<string, unknown>;
  const entry = {
    key: String(data.key ?? ''),
    type: String(data.type ?? ''),
    title: firstField(fields, 'title'),
    authors: firstField(fields, 'author'),
    editors: firstField(fields, 'editor'),
    year: firstField(fields, 'year') || firstField(fields, 'date'),
    journal: firstField(fields, 'journal') || firstField(fields, 'journaltitle'),
    booktitle: firstField(fields, 'booktitle'),
    volume: firstField(fields, 'volume'),
    issue: firstField(fields, 'issue') || firstField(fields, 'number'),
    pages: firstField(fields, 'pages'),
    doi: firstField(fields, 'doi'),
    publisher: firstField(fields, 'publisher'),
    institution:
      firstField(fields, 'institution') ||
      firstField(fields, 'school') ||
      firstField(fields, 'organization'),
  };

  return {
    ...entry,
    searchText: [
      entry.key,
      entry.title,
      entry.authors,
      entry.editors,
      entry.year,
      entry.journal,
      entry.booktitle,
      entry.volume,
      entry.issue,
      entry.pages,
      entry.doi,
      entry.publisher,
      entry.institution,
    ]
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase(),
  };
}

/**
 * 功能：把 Obsidian citation 插件的 Entry 适配为内部条目。
 * 输入：单条 Entry（仅 BibLaTeX；库加载已固定为 biblatex 格式）。
 * 输出：内部条目；无法识别时返回 null。
 */
export function toInternalEntry(entry: Entry): InternalBibEntry | null {
  // 适配器的 data 字段为 private，运行时始终存在
  const data = (entry as unknown as IIndexable)['data'];
  if (!data) return null;

  if (typeof (data as EntryDataBibLaTeX).key === 'string') {
    return toInternalBibLaTeX(data as EntryDataBibLaTeX);
  }
  return null;
}

/**
 * 功能：批量转换并按 citation key 去重（后出现者优先级更低）。
 * 输入：Entry 数组。
 * 输出：内部条目数组。
 */
export function toInternalEntries(entries: Entry[]): InternalBibEntry[] {
  const seen = new Set<string>();
  const result: InternalBibEntry[] = [];
  for (const entry of entries) {
    const internal = toInternalEntry(entry);
    if (!internal || seen.has(internal.key)) continue;
    seen.add(internal.key);
    result.push(internal);
  }
  return result;
}
