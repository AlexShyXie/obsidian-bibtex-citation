/**
 * 功能：提供与 Typora 版本对齐的双语文案（en / zh-CN），按 Obsidian 界面语言自动选择。
 * 约定：右侧栏按钮文案与命令面板命令名使用同一组 key（commands.*），避免两端不一致。
 * 输入：无。
 * 输出：文案字典与取文案函数。
 */

const en = {
  fileNotFound: "BibTeX file not found: ",
  loadError: "Failed to load BibTeX files: ",
  cslFileNotFound: "CSL file not found: ",
  cslPathRequired: "Please configure a CSL file path first.",
  emptyPathWarning: "Please enter a BibTeX file path first.",
  sidebar: {
    title: "BibTeX Citations",
    heading: "BibTeX Citations",
    description: "Check the current library status and quick actions.",
    cslFileLabel: "CSL File",
    configuredFilesLabel: "Configured Files",
    indexedEntriesLabel: "Indexed Entries",
    citedEntriesLabel: "Cited In Current Doc",
    empty: "No BibTeX file configured yet.",
    unavailable: "Pending refresh",
    loadErrorPrefix: "Index refresh failed: ",
    invalidCitationPrefix: "Current doc has citation keys missing from the library: ",
    invalidCitationBlockPrefix: "Current doc has an invalid citation block: ",
    renderErrorPrefix: "Citation rendering failed: ",
    restoreErrorPrefix: "Citation restore failed: ",
    insertBibliographyErrorPrefix: "Bibliography update failed: ",
    removeBibliographyErrorPrefix: "Bibliography removal failed: ",
    renderNoChanges:
      "No citation sources found for rendering. Both visible strict [@key] blocks and controlled citation blocks are processed.",
    renderSuccess: "Rendered or updated {blocks} citation blocks with {keys} keys.",
    restoreNoChanges: "No controlled citation blocks to restore.",
    restoreSuccess: "Restored {blocks} citation blocks with {keys} keys.",
    insertBibliographyNoChanges:
      "No citation sources found for the bibliography. Both visible [@key] blocks and controlled citation blocks are read.",
    insertBibliographySuccess: "Updated bibliography for {keys} citation keys.",
    removeBibliographyNoChanges: "No controlled bibliography block to remove.",
    removeBibliographySuccess: "Removed the controlled bibliography block.",
    bibliographyHeading: "References",
    citationCountFormat: "{unique} entries / {total} citations",
    filesTitle: "BibTeX Files",
  },
  commands: {
    insertCitation: "Insert citation…",
    refreshCache: "Refresh BibTeX cache",
    renderCitations: "Render / update citations",
    restoreCitations: "Restore citation blocks",
    upsertBibliography: "Update / insert bibliography section",
    removeBibliography: "Remove bibliography section",
    refreshDone: "BibTeX library reloaded: {n} entries.",
    refreshErrorPrefix: "Cache refresh failed: ",
    insertDone: "Inserted citation: {key}.",
    insertUnavailable: "No editable editor cursor found.",
    insertErrorPrefix: "Citation insertion failed: ",
    searchPlaceholder: "Search by key / title / author / year / journal…",
    searchEmpty: "No matching BibTeX entries.",
    searchHint: "↑↓ select · Enter insert · Esc close",
  },
};

const zhCn = {
  fileNotFound: "未找到 BibTeX 文件：",
  loadError: "加载 BibTeX 文件失败：",
  cslFileNotFound: "未找到 CSL 文件：",
  cslPathRequired: "请先配置一个 CSL 文件路径。",
  emptyPathWarning: "请先输入 BibTeX 文件路径。",
  sidebar: {
    title: "BibTeX 引用",
    heading: "BibTeX 引用",
    description: "查看当前文献库状态与快捷操作。",
    cslFileLabel: "CSL 文件",
    configuredFilesLabel: "已配置文件数",
    indexedEntriesLabel: "已索引条目数",
    citedEntriesLabel: "当前文档引用统计",
    empty: "暂未配置任何 BibTeX 文件。",
    unavailable: "待刷新",
    loadErrorPrefix: "刷新索引失败：",
    invalidCitationPrefix: "当前文档包含未收录于文献库的 citation key：",
    invalidCitationBlockPrefix: "当前文档包含非法的 citation block：",
    renderErrorPrefix: "渲染引用失败：",
    restoreErrorPrefix: "恢复引用失败：",
    insertBibliographyErrorPrefix: "更新插入参考文献区失败：",
    removeBibliographyErrorPrefix: "删除参考文献区失败：",
    renderNoChanges:
      "没有发现可用于渲染或更新的引用源。当前会同时处理正文里可见的严格 [@key] 和受控 citation 块。",
    renderSuccess: "已渲染或更新 {blocks} 个引用块，共 {keys} 个 key。",
    restoreNoChanges: "当前没有可恢复的受控 citation 块。",
    restoreSuccess: "已恢复 {blocks} 个引用块，共 {keys} 个 key。",
    insertBibliographyNoChanges:
      "没有发现可用于生成参考文献的引用源。当前更新插入参考文献区会同时读取正文里可见的 [@key] 和受控 citation 块。",
    insertBibliographySuccess: "已为 {keys} 个引用 key 更新参考文献区。",
    removeBibliographyNoChanges: "当前没有可删除的受控参考文献区。",
    removeBibliographySuccess: "已删除受控参考文献区。",
    bibliographyHeading: "参考文献",
    citationCountFormat: "共 {unique} 条 / {total} 次",
    filesTitle: "BibTeX 文件",
  },
  commands: {
    insertCitation: "插入引用…",
    refreshCache: "刷新 BibTeX 缓存",
    renderCitations: "渲染/更新引用",
    restoreCitations: "恢复引用块",
    upsertBibliography: "更新插入参考文献区",
    removeBibliography: "删除参考文献区",
    refreshDone: "BibTeX 文献库已重载，共 {n} 条。",
    refreshErrorPrefix: "刷新缓存失败：",
    insertDone: "已插入引用：{key}。",
    insertUnavailable: "文档中没有可插入的编辑器光标。",
    insertErrorPrefix: "插入引用失败：",
    searchPlaceholder: "按 key / 标题 / 作者 / 年份 / 期刊检索…",
    searchEmpty: "没有匹配的文献条目。",
    searchHint: "↑↓ 选择 · Enter 插入 · Esc 关闭",
  },
};

export type BibCitationTexts = typeof en;

export function getBibCitationTexts(language: string): BibCitationTexts {
  const normalized = String(language || "").toLowerCase();
  return normalized.startsWith("zh") ? (zhCn as BibCitationTexts) : en;
}
