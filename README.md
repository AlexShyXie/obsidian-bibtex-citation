# BibTeX Citations for Obsidian

基于 [hans/obsidian-citation-plugin](https://github.com/hans/obsidian-citation-plugin)（v0.4.5）改造，将 [AlexShyXie/typora-plugin-bibtex-citation](https://github.com/AlexShyXie/typora-plugin-bibtex-citation)（Typora 版 v1.0.x）的核心功能迁移至 Obsidian。两者共享同一份外部 BibTeX/CSL 数据源，Typora 与 Obsidian 两端行为一致。

## 功能

### 从 Typora 版迁移（v1.0.x）

| 功能 | 说明 |
|---|---|
| CSL 渲染 | 内置 Citation.js/citeproc 引擎；`渲染/更新引用`、`恢复引用块`、`更新插入参考文献区`、`删除参考文献区` 四个文档级动作，受控块格式与 Typora 版完全兼容（`<!-- bibtex-citation:* -->`），两端可互相还原 |
| `@` 呼出 | 编辑器内输入 `@词` 唤出检索建议：方括号内 `[@词` 只补全 `@key`；裸 `@词`（叙述式，Pandoc 边界规则）补全 `@key`。检索按 key 前缀优先 + 子串匹配，命中片段蛋黄色高亮 |
| 右侧栏 | 功能面板挂右侧栏（ribbon "book-marked" 图标或命令打开）：CSL 文件/条目数/当前文档引用统计 + 5 个动作按钮；按钮文案与命令面板命令名一致，无需焦点在正文即可作用于最近编辑的文档 |
| 检索弹窗 | `插入引用…` 命令：与 Typora 版同一套检索排序与高亮渲染，按光标前缀自动决定插入 `[@key]` 或 `@key` |
| 快捷键 | 全部命令不带默认快捷键，仅保留在命令面板 |

## 设置

| 设置项 | 说明 |
|---|---|
| Citation database path | bib 库文件路径（绝对路径或 vault 相对路径），支持 `.bib` 与 CSL-JSON |
| CSL style file | CSL 样式文件路径（绝对路径或 vault 相对路径），用于引注与参考文献排版 |
| Markdown citation templates | 原插件的模板式引注（保留，未改动） |

## 安装

1. 解压后将 `main.js`、`manifest.json`、`styles.css` 放入 `<vault>/.obsidian/plugins/bibtex-citation/`
2. 重启 Obsidian 并在第三方插件设置中启用 **BibTeX Citations**

## 已知边界（与 Typora 版一致）

- 桌面端专用（`isDesktopOnly: true`），移动端无文件系统能力
- 方括号引用的收集仅屏蔽 HTML 注释，代码块内的 `[@key]` 同样会被渲染（Typora 版既有行为）
- 叙述式引用与文档级渲染仅处理严格语法（`[@a; @b]` / `@key`）

## 构建与测试

```bash
npm install
npm run build   # rollup → main.js
node --test tests/v3-integration.test.mjs   # 渲染链集成测试
node tests/smoke-main.cjs                   # 产物加载冒烟
```
