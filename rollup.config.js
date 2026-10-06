import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import replace from '@rollup/plugin-replace';
import webWorkerLoader from 'rollup-plugin-web-worker-loader';

/**
 * Stub for `encoding` (an optional peer of node-fetch 1.x). It is not a Node
 * builtin and must never be loaded inside Obsidian; citation rendering is
 * fully offline, so replacing it with an empty module is safe.
 */
const encodingStub = {
  resolveId(source) {
    return source === 'encoding' ? '\0encoding-stub' : null;
  },
  load(id) {
    return id === '\0encoding-stub' ? 'module.exports = undefined;' : null;
  },
};

export default {
  input: 'src/main.ts',
  output: {
    dir: '.',
    sourcemap: false,
    format: 'cjs',
    exports: 'default',
  },
  external: [
    'obsidian',
    'path',
    'fs',
    'util',
    'events',
    'stream',
    'os',
    'child_process',
    'url',
    'http',
    'https',
    'zlib',
  ],
  plugins: [
    /**
     * Chokidar hacks to get working with platform-general Electron build.
     *
     * HACK: Manually replace fsevents import. This is only available on OS X,
     * and we need to make a platform-general build here.
     */
    replace({
      delimiters: ['', ''],
      include: "node_modules/chokidar/**/*.js",

      "require('fsevents')": "null",
      "require('fs')": "require('original-fs')",
    }),

    // node-fetch 1.x requires the optional `encoding` package at module top
    // level; it is not a Node builtin and would crash the plugin on load.
    // Citation rendering is fully offline, so stubbing is safe.
    replace({
      delimiters: ['', ''],
      include: 'node_modules/**',
      "require('encoding')": "undefined",
    }),

    typescript(),
    nodeResolve({ browser: true }),
    commonjs({ ignore: ['original-fs'] }),
    json(),
    webWorkerLoader({
      targetPlatform: 'browser',
      extensions: ['.ts'],
      preserveSource: true,
      sourcemap: true,
    }),
  ],
};
