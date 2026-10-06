import * as fs from 'fs';
import { plugins } from '@citation-js/core';
import '@citation-js/plugin-csl';

let customTemplateCacheKey = '';
let customTemplateName = '';

/**
 * 功能：确保用户配置的 CSL 模板已注册到 Citation.js（带 mtime 缓存）。
 * 输入：插件实例（读取 settings.cslFilePath 与 resolveLibraryPath）。
 * 输出：返回可直接用于 Citation.js 的模板名。
 */
export function ensureCslTemplate(plugin) {
  const configuredPath = plugin.resolveLibraryPath(
    String(plugin.settings.cslFilePath || '').trim(),
  );
  if (!configuredPath || configuredPath === plugin.resolveLibraryPath('')) {
    throw new Error(plugin.texts.cslPathRequired);
  }

  if (!fs.existsSync(configuredPath)) {
    throw new Error(`${plugin.texts.cslFileNotFound}${configuredPath}`);
  }

  const stat = fs.statSync(configuredPath);
  const templateCacheKey = `${configuredPath}:${stat.mtimeMs}`;
  if (customTemplateCacheKey === templateCacheKey) {
    return customTemplateName;
  }

  customTemplateName = `bibtex-citation-custom-${configuredPath
    .split(/[\\/]/)
    .pop()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase()}-${Math.round(stat.mtimeMs)}`;
  plugins.config.get('@csl').templates.add(
    customTemplateName,
    fs.readFileSync(configuredPath, 'utf8'),
  );
  customTemplateCacheKey = templateCacheKey;
  return customTemplateName;
}
