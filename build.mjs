/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const distDir = path.resolve('dist');
if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

// Bundle client (renderer) TypeScript
await esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'dist/app.js',
  format: 'iife',
  sourcemap: true,
  target: 'es2020',
  minify: false,
});

// Bundle Electron main process
await esbuild.build({
  entryPoints: ['src/electron.ts'],
  bundle: true,
  outfile: 'dist/electron.cjs',
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  minify: false,
  external: ['electron', 'node-pty'],
});

// Bundle preload script
await esbuild.build({
  entryPoints: ['src/preload.ts'],
  bundle: true,
  outfile: 'dist/preload.cjs',
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  minify: false,
  external: ['electron'],
});

// When bundling CJS dependencies (like vscode-jsonrpc) into ESM, esbuild
// emits `require()` calls for Node builtins. Inject a shim via banner.
const esmRequireShim = `
import { createRequire as __createRequire } from 'node:module';
const require = __createRequire(import.meta.url);
`;

// Bundle CLI implement tool
await esbuild.build({
  entryPoints: ['src/implement-cli.ts'],
  bundle: true,
  outfile: 'dist/implement-cli.mjs',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  minify: false,
  banner: { js: esmRequireShim },
});

// Bundle CLI for npm package (with shebang)
await esbuild.build({
  entryPoints: ['src/implement-cli.ts'],
  bundle: true,
  outfile: 'cli/implement-cli.mjs',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: false,
  minify: false,
  banner: { js: '#!/usr/bin/env node\n' + esmRequireShim },
});

// Copy HTML
fs.copyFileSync('src/index.html', 'dist/index.html');

// Copy LICENSE to CLI package
fs.copyFileSync('LICENSE.txt', 'cli/LICENSE.txt');

// Copy safehouse to CLI package
fs.mkdirSync('cli/scripts', { recursive: true });
fs.copyFileSync('scripts/safehouse', 'cli/scripts/safehouse');
fs.chmodSync('cli/scripts/safehouse', 0o755);

// Copy xterm.js CSS
fs.copyFileSync('node_modules/@xterm/xterm/css/xterm.css', 'dist/xterm.css');

// Copy blueprint into dist so the app can load it
fs.copyFileSync('blueprint/main.md', 'dist/main.md');

console.log('Build complete → dist/');
