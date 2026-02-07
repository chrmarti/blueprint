/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const distDir = path.resolve('dist');
if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

// Bundle TypeScript
await esbuild.build({
  entryPoints: ['built/main.ts'],
  bundle: true,
  outfile: 'dist/app.js',
  format: 'iife',
  sourcemap: true,
  target: 'es2020',
  minify: false,
});

// Copy HTML
fs.copyFileSync('built/index.html', 'dist/index.html');

// Copy blueprint into dist so the app can load it
fs.copyFileSync('src/blueprint.md', 'dist/blueprint.md');

console.log('Build complete → dist/');
