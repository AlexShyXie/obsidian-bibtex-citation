import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const { renderCitationMarkdown, restoreCitationMarkdown } = await import(
  '../src/v3/csl/render.js'
);
const { upsertBibliographyMarkdown, removeBibliographyMarkdown } = await import(
  '../src/v3/csl/bibliography.js'
);
const { toCslItem } = await import('../src/v3/csl/item.js');
const {
  parseStrictCitationKeys,
  collectCitationSourcesFromMarkdown,
  findFirstInvalidCitationProblem,
} = await import('../src/v3/csl/citation-blocks.js');
const {
  escapeControlledCitationPayload,
  unescapeControlledCitationPayload,
  createControlledCitationPattern,
} = await import('../src/v3/csl/controlled-citations.js');
const { findNarrativeCitationQuery } = await import(
  '../src/v3/csl/narrative-citations.js'
);
const { searchInternalEntries } = await import('../src/v3/search-core.js');
const { toInternalEntry } = await import('../src/bib-entries.mjs-stub')
  .catch(() => ({ toInternalEntry: null }));

const styleRoot = path.join(here, 'fixtures', 'csl', 'styles');
const loadStyle = (name) => fs.readFileSync(path.join(styleRoot, name), 'utf8');

/** 注册真实 CSL 模板（模拟 assets.js 的注册逻辑，避免 Typora/OB 依赖） */
const { plugins } = await import('@citation-js/core');
await import('@citation-js/plugin-csl');

function registerTemplate(name, xml) {
  plugins.config.get('@csl').templates.add(name, xml);
  return name;
}

const ENTRIES = [
  {
    key: 'doe2020background',
    type: 'article',
    title: 'Background Theory',
    authors: 'Doe, Jane and Roe, Richard',
    editors: '',
    year: '2020',
    journal: 'Journal of Backgrounds',
    booktitle: '',
    volume: '12',
    issue: '3',
    pages: '10--20',
    doi: '10.1234/doe2020',
    publisher: '',
    institution: '',
    searchText:
      'doe2020background background theory doe, jane and roe, richard 2020 journal of backgrounds 12 3 10--20 10.1234/doe2020',
  },
  {
    key: 'smith2024forecast',
    type: 'inproceedings',
    title: 'Forecast Skill',
    authors: 'Smith, John',
    editors: '',
    year: '2024',
    journal: '',
    booktitle: 'Proceedings of Forecasting',
    volume: '',
    issue: '',
    pages: '5--9',
    doi: '',
    publisher: 'PubCo',
    institution: '',
    searchText:
      'smith2024forecast forecast skill smith, john 2024 proceedings of forecasting 5--9 pubco',
  },
];

const TEMPLATE = registerTemplate('test-apa', loadStyle('apa.csl'));
const NUMERIC_TEMPLATE = registerTemplate('test-ieee', loadStyle('ieee.csl'));

test('renderCitationMarkdown: 渲染严格 [@key] 为受控块（APA）', () => {
  const markdown = '前文 [@doe2020background] 后文。';
  const result = renderCitationMarkdown(markdown, ENTRIES, TEMPLATE);

  assert.ok(result.changed);
  assert.equal(result.renderedBlocks, 1);
  assert.equal(result.renderedKeys, 1);
  assert.ok(result.markdown.includes('<!-- bibtex-citation:citation:start'));
  assert.ok(result.markdown.includes('[@doe2020background] -->'));
  assert.ok(result.markdown.includes('Doe')); // APA 作者名出现
  assert.ok(!result.markdown.includes('NO_PRINTED_FORM'));
});

test('renderCitationMarkdown: 复合引用 [@a; @b] 一次渲染', () => {
  const markdown = '见 [@doe2020background; @smith2024forecast]。';
  const result = renderCitationMarkdown(markdown, ENTRIES, TEMPLATE);
  assert.equal(result.renderedBlocks, 1);
  assert.equal(result.renderedKeys, 2);
});

test('renderCitationMarkdown: 叙述式引用（Doe2020 [@key]）', () => {
  const markdown = '如 Doe [@doe2020background] 所述。';
  const result = renderCitationMarkdown(markdown, ENTRIES, TEMPLATE);
  assert.equal(result.renderedBlocks, 1);
  assert.ok(!result.markdown.includes('NO_PRINTED_FORM'));
});

test('renderCitationMarkdown: 数字样式叙述式回退为 normal（NO_PRINTED_FORM 处理）', () => {
  const markdown = '如 Doe [@doe2020background] 所述。';
  const result = renderCitationMarkdown(markdown, ENTRIES, NUMERIC_TEMPLATE);
  assert.equal(result.renderedBlocks, 1);
  // ieee 下叙述式若不可打印必须回退为普通引用而不是输出占位符
  assert.ok(!result.markdown.includes('NO_PRINTED_FORM'));
});

test('renderCitationMarkdown: 未收录 key 不渲染', () => {
  const markdown = '见 [@unknownkey2020]。';
  const result = renderCitationMarkdown(markdown, ENTRIES, TEMPLATE);
  assert.equal(result.changed, false);
  assert.equal(result.renderedBlocks, 0);
});

test('restoreCitationMarkdown: 受控块还原为 [@key]', () => {
  const rendered = renderCitationMarkdown(
    '前 [@doe2020background; @smith2024forecast] 后。',
    ENTRIES,
    TEMPLATE,
  );
  assert.ok(rendered.changed);

  const restored = restoreCitationMarkdown(rendered.markdown, ENTRIES);
  assert.ok(restored.changed);
  assert.equal(restored.renderedBlocks, 1);
  assert.equal(restored.renderedKeys, 2);
  assert.ok(restored.markdown.includes('[@doe2020background; @smith2024forecast]'));
  assert.ok(!restored.markdown.includes('bibtex-citation:citation:start'));
});

test('upsertBibliographyMarkdown / removeBibliographyMarkdown: 参考文献 upsert 与删除', () => {
  const source = '正文 [@doe2020background]。\n\n## 其它\n\n尾段。';
  const upserted = upsertBibliographyMarkdown(
    source,
    ENTRIES,
    TEMPLATE,
    '参考文献',
  );
  assert.ok(upserted.changed);
  assert.equal(upserted.keyCount, 1);
  assert.ok(upserted.markdown.includes('<!-- bibtex-citation:bibliography:start -->'));
  assert.ok(upserted.markdown.includes('## 参考文献'));
  assert.ok(upserted.markdown.includes('Doe'));

  // 幂等：再跑一次 changed 应为 false（内容一致）
  const again = upsertBibliographyMarkdown(
    upserted.markdown,
    ENTRIES,
    TEMPLATE,
    '参考文献',
  );
  assert.equal(again.changed, false);

  const removed = removeBibliographyMarkdown(upserted.markdown);
  assert.ok(removed.changed);
  assert.ok(!removed.markdown.includes('bibtex-citation:bibliography:start'));
});

test('parseStrictCitationKeys: 严格语法判定', () => {
  assert.deepEqual(parseStrictCitationKeys('[@doe2020background]'), [
    'doe2020background',
  ]);
  assert.deepEqual(
    parseStrictCitationKeys('[@doe2020background; @smith2024forecast]'),
    ['doe2020background', 'smith2024forecast'],
  );
  assert.equal(parseStrictCitationKeys('[见 doe2020]'), null);
  assert.equal(parseStrictCitationKeys('[@doe2020 见]'), null);
  assert.equal(parseStrictCitationKeys('doe2020'), null);
});

test('collectCitationSourcesFromMarkdown: 代码块边界（v3 既有行为）', () => {
  const markdown = [
    '正文 [@doe2020background]。',
    '',
    '```',
    '代码里的 [@doe2020background]',
    '```',
  ].join('\n');
  const sources = collectCitationSourcesFromMarkdown(
    markdown,
    (key) => !!ENTRIES.find((entry) => entry.key === key),
  );
  // v3 既有边界：extractClosedBracketRanges 仅 mask HTML 注释，代码块内的
  // 方括号引用同样会被收集（Typora 版行为一致，字面迁移不收紧）。
  assert.equal(sources.length, 2);
});

test('findFirstInvalidCitationProblem: 未收录 key 报告', () => {
  const problem = findFirstInvalidCitationProblem(
    '见 [@ghost2024]。',
    (key) => key === 'doe2020background',
  );
  assert.ok(problem);
  assert.equal(problem.type, 'unknown-key');
  assert.equal(problem.key, 'ghost2024');
});

test('narrative-citations: findNarrativeCitationQuery 边界规则', () => {
  // 查询是光标前缀语义（PANDOC_PARTIAL_KEY_PATTERN 行尾锚定）：
  // 句子中段（后跟非 key 字符）不匹配，前缀结尾才匹配。
  assert.equal(findNarrativeCitationQuery('如 Doe @doe2020bac 所述'), null);
  assert.equal(findNarrativeCitationQuery('如 Doe @doe2020bac'), 'doe2020bac');
  // `(` 不属于内部标点与排除字符，属合法前导边界
  assert.equal(findNarrativeCitationQuery('(@doe2020bac'), 'doe2020bac');
  assert.equal(findNarrativeCitationQuery('邮箱 test@doe2020'), null);
  assert.equal(findNarrativeCitationQuery('纯文本无引用'), null);
});

test('controlled-citations: escape/unescape 往返', () => {
  const payload = '[@doe] 注释不能提前闭合 --> 保留';
  const escaped = escapeControlledCitationPayload(payload);
  assert.ok(!escaped.includes('-->'));
  assert.equal(unescapeControlledCitationPayload(escaped), payload);
});

test('toCslItem: BibTeX 条目 → CSL-JSON 映射', () => {
  const csl = toCslItem(ENTRIES[0]);
  assert.equal(csl.id, 'doe2020background');
  assert.equal(csl.type, 'article-journal');
  assert.equal(csl.title, 'Background Theory');
  assert.deepEqual(csl.issued, { 'date-parts': [[2020]] });
  assert.equal(csl['container-title'], 'Journal of Backgrounds');
  assert.equal(csl.author.length, 2);
  assert.deepEqual(csl.author[0], { family: 'Doe', given: 'Jane' });

  const inproc = toCslItem(ENTRIES[1]);
  assert.equal(inproc.type, 'paper-conference');
  assert.equal(inproc['container-title'], 'Proceedings of Forecasting');
});

test('searchInternalEntries: 排序与关闭建议语义', () => {
  const result = searchInternalEntries(ENTRIES, 'fore');
  // key 前缀命中优先
  assert.equal(result[0].key, 'smith2024forecast');

  const byPrefix = searchInternalEntries(ENTRIES, 'doe');
  assert.equal(byPrefix[0].key, 'doe2020background');

  // 完整输入 key → 关闭建议
  assert.deepEqual(searchInternalEntries(ENTRIES, 'doe2020background'), []);

  // 空查询 → 无建议
  assert.deepEqual(searchInternalEntries(ENTRIES, ''), []);

  // 搜索文本子串命中（标题/作者/年份）
  assert.equal(
    searchInternalEntries(ENTRIES, '2020').some(
      (item) => item.key === 'doe2020background',
    ),
    true,
  );
});
