// build.package.mjs - Package Electron app for macOS
import packager from '@electron/packager';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const appName = 'Blueprint';
const outDir = 'release';

async function packageApp() {
  console.log('Packaging Electron app...');

  const appPaths = await packager({
    dir: '.',
    name: appName,
    out: outDir,
    platform: 'darwin',
    arch: 'arm64',
    overwrite: true,
    asar: false, // Keep files on disk for executable permissions
    ignore: [
      /^\/src/,
      /^\/test/,
      /^\/blueprint/,
      /^\/\.git/,
      /^\/\.gitignore/,
      /^\/tsconfig\.json/,
      /^\/build\.mjs/,
      /^\/build\.package\.mjs/,
      /^\/\.blueprintfiles/,
      /^\/LICENSE\.txt/,
      /^\/release/,
    ],
  });

  console.log(`App packaged to: ${appPaths.join(', ')}`);

  // Fix executable permissions on native binaries
  const appPath = appPaths[0];
  const resourcesPath = path.join(appPath, `${appName}.app`, 'Contents', 'Resources', 'app');

  // Fix node-pty spawn-helper
  const spawnHelperGlob = path.join(resourcesPath, 'node_modules', 'node-pty', 'prebuilds', 'darwin-*', 'spawn-helper');
  try {
    execSync(`chmod +x ${spawnHelperGlob}`, { stdio: 'inherit' });
    console.log('Fixed node-pty spawn-helper permissions');
  } catch {
    console.log('node-pty spawn-helper not found or already executable');
  }

  // Fix copilot native binary
  const copilotBinaryGlob = path.join(resourcesPath, 'node_modules', '@github', 'copilot-darwin-*', 'copilot');
  try {
    execSync(`chmod +x ${copilotBinaryGlob}`, { stdio: 'inherit' });
    console.log('Fixed copilot binary permissions');
  } catch {
    console.log('copilot binary not found or already executable');
  }

  console.log('Packaging complete.');
}

packageApp().catch(console.error);
