import packager from '@electron/packager';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const appName = 'Blueprint';
const outDir = 'release';

// Package the Electron app
const appPaths = await packager({
  dir: '.',
  name: appName,
  out: outDir,
  platform: 'darwin',
  arch: 'arm64',
  asar: false, // Keep files unpacked for executable permissions
  overwrite: true,
  ignore: [
    /^\/src$/,
    /^\/test$/,
    /^\/blueprint$/,
    /^\/\.git$/,
    /^\/\.gitignore$/,
    /^\/tsconfig\.json$/,
    /^\/build\.mjs$/,
    /^\/build\.package\.mjs$/,
    /^\/\.blueprintfiles$/,
    /^\/implement\.log$/,
  ],
});

console.log(`Packaged app to: ${appPaths.join(', ')}`);

// Fix executable permissions on native binaries
const appPath = appPaths[0];
const resourcesPath = path.join(appPath, `${appName}.app`, 'Contents', 'Resources', 'app');

// Fix node-pty spawn-helper
const spawnHelperGlob = path.join(resourcesPath, 'node_modules', 'node-pty', 'prebuilds', 'darwin-*', 'spawn-helper');
try {
  execSync(`chmod +x ${spawnHelperGlob}`, { shell: true });
  console.log('Fixed node-pty spawn-helper permissions');
} catch {
  console.log('No node-pty spawn-helper found to fix');
}

// Fix copilot native binary
const copilotBinaryGlob = path.join(resourcesPath, 'node_modules', '@github', 'copilot-darwin-*', 'copilot');
try {
  execSync(`chmod +x ${copilotBinaryGlob}`, { shell: true });
  console.log('Fixed copilot binary permissions');
} catch {
  console.log('No copilot binary found to fix');
}

// Fix safehouse script
const safehousePath = path.join(resourcesPath, 'scripts', 'safehouse');
if (fs.existsSync(safehousePath)) {
  fs.chmodSync(safehousePath, 0o755);
  console.log('Fixed safehouse script permissions');
}

console.log('Packaging complete!');
