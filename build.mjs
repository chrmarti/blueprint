import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

mkdirSync('dist', { recursive: true });
mkdirSync('cli/scripts', { recursive: true });

// Renderer bundle (IIFE)
await esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'iife',
  outfile: 'dist/app.js',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  define: {
    'process.env.NODE_ENV': '"production"',
  },
});

// Electron main process (CJS)
await esbuild.build({
  entryPoints: ['src/electron.ts'],
  bundle: true,
  format: 'cjs',
  outfile: 'dist/electron.cjs',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  external: ['electron', 'node-pty'],
});

// Preload script (CJS)
await esbuild.build({
  entryPoints: ['src/preload.ts'],
  bundle: true,
  format: 'cjs',
  outfile: 'dist/preload.cjs',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  external: ['electron'],
});

// CLI implement tool (ESM)
await esbuild.build({
  entryPoints: ['src/implement-cli.ts'],
  bundle: true,
  format: 'esm',
  outfile: 'dist/implement-cli.mjs',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  external: ['node-pty'],
  banner: {
    js: 'import { createRequire as _createRequire } from "module"; const require = _createRequire(import.meta.url);',
  },
});

// CLI package bundle (ESM) — bundles copilot-sdk inline
await esbuild.build({
  entryPoints: ['src/implement-cli.ts'],
  bundle: true,
  format: 'esm',
  outfile: 'cli/index.mjs',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  external: ['node-pty'],
  banner: {
    js: 'import { createRequire as _createRequire } from "module"; const require = _createRequire(import.meta.url);',
  },
});

// Copy static assets
cpSync('src/index.html', 'dist/index.html');

const xtermCssPath = join('node_modules', '@xterm', 'xterm', 'css', 'xterm.css');
if (existsSync(xtermCssPath)) {
  cpSync(xtermCssPath, 'dist/xterm.css');
}

if (existsSync('blueprint/main.md')) {
  cpSync('blueprint/main.md', 'dist/main.md');
}

// Copy safehouse to CLI package
if (existsSync('scripts/safehouse')) {
  cpSync('scripts/safehouse', 'cli/scripts/safehouse');
}

// Copy electron-safehouse-extra.sb to CLI package
if (existsSync('scripts/electron-safehouse-extra.sb')) {
  cpSync('scripts/electron-safehouse-extra.sb', 'cli/scripts/electron-safehouse-extra.sb');
}

console.log('Build complete.');
