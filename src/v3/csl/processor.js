import { plugins, util } from "@citation-js/core";
import "@citation-js/plugin-csl";

const NO_PRINTED_FORM = "[NO_PRINTED_FORM]";

/**
 * 功能：把 citation cluster 列表转换为 citeproc rebuildProcessorState 输入。
 * 输入：citation cluster 列表。
 * 输出：citeproc citation 对象数组。
 */
function buildCitations(citationClusters) {
  return citationClusters.map((cluster, index) => ({
    citationID: `bibtex-citation-${index}`,
    citationItems: cluster.keys.map((id) => ({ id })),
    properties: {
      noteIndex: 0,
      ...(cluster.citationMode === "narrative" ? { mode: "composite" } : {}),
    },
  }));
}

/**
 * 功能：使用单个 citeproc 实例批量渲染整篇文档的 citation cluster。
 * 输入：CSL-JSON 条目、按文档顺序排列的 citation cluster、CSL 模板名。
 * 输出：与 citation cluster 一一对应的 HTML citation 字符串数组。
 * 说明：数字型样式没有叙述式形态，citeproc composite 模式下
 *       author-only 半段会渲染为空并输出 [NO_PRINTED_FORM]。检测到该
 *       占位符时，把对应叙述式 cluster 回退为 normal 模式整体重渲，
 *       与 Pandoc 在数字样式下 @key 等同 [@key] 的行为保持一致。
 */
export function renderCitationClusters(cslItems, citationClusters, templateName) {
  if (!citationClusters.length) {
    return [];
  }

  const config = plugins.config.get("@csl");
  const engine = config.engine(
    util.downgradeCsl(cslItems),
    templateName,
    undefined,
    "html",
  );
  const citations = buildCitations(citationClusters);
  const rendered = engine
    .rebuildProcessorState(citations, "html", [])
    .map((citation) => citation[2]);

  const needsNumericFallback = rendered.some(
    (html, index) =>
      typeof html === "string" &&
      html.includes(NO_PRINTED_FORM) &&
      citationClusters[index].citationMode === "narrative",
  );
  if (!needsNumericFallback) {
    return rendered;
  }

  const normalRendered = engine
    .rebuildProcessorState(
      buildCitations(
        citationClusters.map((cluster) =>
          cluster.citationMode === "narrative"
            ? { ...cluster, citationMode: "normal" }
            : cluster,
        ),
      ),
      "html",
      [],
    )
    .map((citation) => citation[2]);

  return rendered.map((html, index) => {
    if (typeof html === "string" && html.includes(NO_PRINTED_FORM)) {
      const fallback = normalRendered[index];
      if (typeof fallback === "string" && !fallback.includes(NO_PRINTED_FORM)) {
        return fallback;
      }
    }
    return html;
  });
}
