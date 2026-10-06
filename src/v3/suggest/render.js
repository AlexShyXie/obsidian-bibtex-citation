import { escapeHtml } from "../utils/html.js";
import { formatAuthorDateAuthors } from "../utils/authors.js";

const HIT_MARK_CLASS = "bibtex-cite-hit";

/**
 * 功能：转义正则元字符，保证查询词按字面量参与切分。
 * 输入：任意字符串。
 * 输出：可安全嵌入 RegExp 的字符串。
 */
function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 功能：把文本按命中片段切分、逐段转义后拼回，命中片段包上高亮标记。
 * 输入：原始文本、检索查询（大小写不敏感的子串）。
 * 输出：带高亮标记的已转义 HTML 片段；查询为空时仅返回转义文本。
 */
export function highlightQueryText(text, query) {
  const raw = String(text ?? "");
  const normalizedQuery = String(query ?? "").trim().toLowerCase();
  if (!normalizedQuery) {
    return escapeHtml(raw);
  }

  const parts = raw.split(new RegExp(`(${escapeRegExp(normalizedQuery)})`, "i"));
  return parts
    .map((part, index) =>
      index % 2 === 1
        ? `<mark class="${HIT_MARK_CLASS}">${escapeHtml(part)}</mark>`
        : escapeHtml(part),
    )
    .join("");
}

/**
 * 功能：把单个 BibTeX 条目渲染成 Typora 建议列表使用的 HTML 字符串，
 *       显示 citation key 并对查询命中的片段做高亮。
 * 输入：包含标题、作者、年份与 key 的文献条目对象；可选的检索查询。
 * 输出：候选项 HTML 字符串。
 */
export function renderBibSuggestion(item, query = "") {
  const title = item.title || `@${item.key}`;
  const year = String(item.year || "");
  const authors = formatAuthorDateAuthors(item.authors);
  const journal = String(item.journal || "");
  const doi = String(item.doi || "");
  const key = escapeHtml(item.key || "");

  return `
    <div class="bibtex-cite-item" data-bibtex-key="${key}">
      <div class="bibtex-cite-title">${highlightQueryText(title, query)}</div>
      ${
        year || authors || journal || doi
          ? `
        <div class="bibtex-cite-meta">
          <div class="bibtex-cite-meta-left">
            ${year ? `<span class="bibtex-cite-year">${highlightQueryText(year, query)}</span>` : ""}
            ${authors ? `<span class="bibtex-cite-authors">${highlightQueryText(authors, query)}</span>` : ""}
          </div>
          <div class="bibtex-cite-meta-right">
            ${doi ? `<span class="bibtex-cite-doi">${highlightQueryText(doi, query)}</span>` : ""}
          </div>
        </div>
        ${journal ? `<div class="bibtex-cite-journal">${highlightQueryText(journal, query)}</div>` : ""}
      `
          : ""
      }
      <div class="bibtex-cite-key">@${highlightQueryText(item.key || "", query)}</div>
    </div>
  `.trim();
}
