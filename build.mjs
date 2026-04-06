// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const distDir = 'dist';
const cliDir = 'cli';

// Ensure output directories exist
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}
if (!fs.existsSync(cliDir)) {
  fs.mkdirSync(cliDir, { recursive: true });
}

// Bundle the renderer (IIFE for browser)
await esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  outfile: 'dist/app.js',
  sourcemap: true,
  external: [],
});

console.log('✓ Built dist/app.js (renderer bundle)');

// Bundle the server (ESM for Node.js)
await esbuild.build({
  entryPoints: ['src/server.ts'],
  bundle: true,
  format: 'esm',
  target: 'node22',
  platform: 'node',
  outfile: 'dist/server.mjs',
  sourcemap: true,
  external: ['node-pty'],
  banner: {
    js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
  },
});

console.log('✓ Built dist/server.mjs (server bundle)');

// Bundle the CLI (ESM for Node.js)
// The CLI bundles @github/copilot-sdk inline to avoid ESM resolution issues
// It only depends on @github/copilot at runtime for the native binary
await esbuild.build({
  entryPoints: ['src/implement-cli.ts'],
  bundle: true,
  format: 'esm',
  target: 'node22',
  platform: 'node',
  outfile: 'cli/index.mjs',
  sourcemap: true,
  external: ['node-pty'],
  banner: {
    js: `#!/usr/bin/env node
import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
  },
});

console.log('✓ Built cli/index.mjs (CLI bundle)');

// Copy static files to dist
fs.copyFileSync('src/index.html', 'dist/index.html');
console.log('✓ Copied index.html to dist/');

// Copy xterm.css from node_modules
const xtermCssSrc = 'node_modules/@xterm/xterm/css/xterm.css';
if (fs.existsSync(xtermCssSrc)) {
  fs.copyFileSync(xtermCssSrc, 'dist/xterm.css');
  console.log('✓ Copied xterm.css to dist/');
} else {
  console.warn('⚠ xterm.css not found at', xtermCssSrc);
}

// Copy main.md from blueprint for reference
if (fs.existsSync('blueprint/main.md')) {
  fs.copyFileSync('blueprint/main.md', 'dist/main.md');
  console.log('✓ Copied main.md to dist/');
}

console.log('\nBuild complete!');
