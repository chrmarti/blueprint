// build.mjs - esbuild bundler for Blueprint Implementer
import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const distDir = 'dist';
const cliDir = 'cli';

// Ensure output directories exist
if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
if (!fs.existsSync(cliDir)) fs.mkdirSync(cliDir, { recursive: true });

// Bundle renderer (IIFE for browser)
await esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  outfile: 'dist/app.js',
  platform: 'browser',
  sourcemap: true,
  external: [],
});

// Bundle Electron main process (CJS)
await esbuild.build({
  entryPoints: ['src/electron.ts'],
  bundle: true,
  format: 'cjs',
  target: 'node22',
  outfile: 'dist/electron.cjs',
  platform: 'node',
  sourcemap: true,
  external: ['electron', 'node-pty'],
});

// Bundle preload script (CJS)
await esbuild.build({
  entryPoints: ['src/preload.ts'],
  bundle: true,
  format: 'cjs',
  target: 'node22',
  outfile: 'dist/preload.cjs',
  platform: 'node',
  sourcemap: true,
  external: ['electron'],
});

// Bundle CLI implement tool (ESM with createRequire shim)
await esbuild.build({
  entryPoints: ['src/implement-cli.ts'],
  bundle: true,
  format: 'esm',
  target: 'node22',
  outfile: 'cli/blueprint.mjs',
  platform: 'node',
  sourcemap: true,
  external: ['node-pty'],
  banner: {
    js: `import { createRequire as __banner_createRequire } from 'module'; const require = __banner_createRequire(import.meta.url);`,
  },
});

// Copy index.html to dist
fs.copyFileSync('src/index.html', 'dist/index.html');

// Copy xterm.css to dist
const xtermCssPath = 'node_modules/@xterm/xterm/css/xterm.css';
if (fs.existsSync(xtermCssPath)) {
  fs.copyFileSync(xtermCssPath, 'dist/xterm.css');
}

// Copy blueprint/main.md to dist for reference
if (fs.existsSync('blueprint/main.md')) {
  fs.copyFileSync('blueprint/main.md', 'dist/main.md');
}

// Copy safehouse script to cli
const safehousePath = 'scripts/safehouse';
if (fs.existsSync(safehousePath)) {
  const cliScriptsDir = path.join(cliDir, 'scripts');
  if (!fs.existsSync(cliScriptsDir)) fs.mkdirSync(cliScriptsDir, { recursive: true });
  fs.copyFileSync(safehousePath, path.join(cliScriptsDir, 'safehouse'));
  fs.chmodSync(path.join(cliScriptsDir, 'safehouse'), 0o755);
}

// Copy electron-safehouse-extra.sb to cli
const extraProfilePath = 'scripts/electron-safehouse-extra.sb';
if (fs.existsSync(extraProfilePath)) {
  const cliScriptsDir = path.join(cliDir, 'scripts');
  if (!fs.existsSync(cliScriptsDir)) fs.mkdirSync(cliScriptsDir, { recursive: true });
  fs.copyFileSync(extraProfilePath, path.join(cliScriptsDir, 'electron-safehouse-extra.sb'));
}

console.log('Build complete.');
