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
  entryPoints: ['built/main.ts'],
  bundle: true,
  outfile: 'dist/app.js',
  format: 'iife',
  sourcemap: true,
  target: 'es2020',
  minify: false,
});

// Bundle Electron main process
await esbuild.build({
  entryPoints: ['built/electron.ts'],
  bundle: true,
  outfile: 'dist/electron.cjs',
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  minify: false,
  external: ['electron', '@github/copilot-sdk'],
});

// Bundle preload script
await esbuild.build({
  entryPoints: ['built/preload.ts'],
  bundle: true,
  outfile: 'dist/preload.cjs',
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  minify: false,
  external: ['electron'],
});

// Bundle CLI compile tool
await esbuild.build({
  entryPoints: ['built/compile-cli.ts'],
  bundle: true,
  outfile: 'dist/compile-cli.mjs',
  format: 'esm',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  minify: false,
  external: ['@github/copilot-sdk'],
});

// Copy HTML
fs.copyFileSync('built/index.html', 'dist/index.html');

// Copy blueprint into dist so the app can load it
fs.copyFileSync('src/main.md', 'dist/main.md');

console.log('Build complete → dist/');
