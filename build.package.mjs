import packager from '@electron/packager';
import { chmodSync, existsSync } from 'fs';
import { join } from 'path';

const appPath = await packager({
  dir: '.',
  out: 'release',
  name: 'Blueprint',
  platform: 'darwin',
  arch: 'arm64',
  overwrite: true,
  asar: false,
  ignore: [
    /^\/release/,
    /^\/test/,
    /^\/blueprint/,
    /^\/src/,
    /^\/scripts/,
    /^\/cli/,
    /^\/\.git/,
    /^\/\.env/,
    /\.ts$/,
    /tsconfig\.json$/,
    /build\.mjs$/,
    /build\.package\.mjs$/,
    /blueprint\.md$/,
    /\.blueprintfiles$/,
  ],
});

console.log(`Packaged to: ${appPath}`);

// Fix executable bits on native binaries
const resourcesPath = join(String(appPath), 'Blueprint.app', 'Contents', 'Resources', 'app');

const spawnHelperGlob = join(resourcesPath, 'node_modules', 'node-pty', 'prebuilds', 'darwin-arm64', 'spawn-helper');
if (existsSync(spawnHelperGlob)) {
  chmodSync(spawnHelperGlob, 0o755);
  console.log('Fixed spawn-helper permissions');
}

const copilotBinary = join(resourcesPath, 'node_modules', '@github', 'copilot-darwin-arm64', 'copilot');
if (existsSync(copilotBinary)) {
  chmodSync(copilotBinary, 0o755);
  console.log('Fixed copilot binary permissions');
}
