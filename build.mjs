import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const distDir = 'dist';
const cliDir = 'cli';

// Ensure output directories exist
fs.mkdirSync(distDir, { recursive: true });
fs.mkdirSync(cliDir, { recursive: true });
fs.mkdirSync(path.join(cliDir, 'scripts'), { recursive: true });

// Bundle renderer (IIFE for browser)
await esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'iife',
  outfile: path.join(distDir, 'app.js'),
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  external: [],
});

// Bundle Electron main process (CJS)
await esbuild.build({
  entryPoints: ['src/electron.ts'],
  bundle: true,
  format: 'cjs',
  outfile: path.join(distDir, 'electron.cjs'),
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  external: ['electron', 'node-pty'],
});

// Bundle preload script (CJS)
await esbuild.build({
  entryPoints: ['src/preload.ts'],
  bundle: true,
  format: 'cjs',
  outfile: path.join(distDir, 'preload.cjs'),
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  external: ['electron'],
});

// Bundle CLI tool (ESM) with createRequire shim
const createRequireShim = `
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
`;

await esbuild.build({
  entryPoints: ['src/implement-cli.ts'],
  bundle: true,
  format: 'esm',
  outfile: path.join(cliDir, 'index.mjs'),
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  banner: {
    js: createRequireShim,
  },
  external: ['@github/copilot'], // Keep copilot external for runtime binary
});

// Copy static files to dist
fs.copyFileSync('src/index.html', path.join(distDir, 'index.html'));

// Copy xterm.css from node_modules
const xtermCssPath = 'node_modules/@xterm/xterm/css/xterm.css';
if (fs.existsSync(xtermCssPath)) {
  fs.copyFileSync(xtermCssPath, path.join(distDir, 'xterm.css'));
}

// Copy blueprint main.md to dist for reference
if (fs.existsSync('blueprint/main.md')) {
  fs.copyFileSync('blueprint/main.md', path.join(distDir, 'main.md'));
}

// Copy safehouse script to CLI
const safehousePath = 'scripts/safehouse';
if (fs.existsSync(safehousePath)) {
  fs.copyFileSync(safehousePath, path.join(cliDir, 'scripts', 'safehouse'));
  fs.chmodSync(path.join(cliDir, 'scripts', 'safehouse'), 0o755);
}

// Copy electron-safehouse-extra.sb to CLI
const extraProfilePath = 'scripts/electron-safehouse-extra.sb';
if (fs.existsSync(extraProfilePath)) {
  fs.copyFileSync(extraProfilePath, path.join(cliDir, 'scripts', 'electron-safehouse-extra.sb'));
}

console.log('Build complete!');
