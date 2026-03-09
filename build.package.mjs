/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { packager } from '@electron/packager';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'node:fs/promises';

const appPaths = await packager({
  dir: '.',
  name: 'Blueprint',
  platform: 'darwin',
  arch: 'arm64',
  out: 'release',
  overwrite: true,
  asar: false,
  ignore: [/^\/(src|test|cli|blueprint|tsconfig|build\.mjs|build\.package\.mjs|playwright)/],
});

// Fix executable bits lost during packaging
for (const appPath of appPaths) {
  const appBase = path.join(appPath, 'Blueprint.app', 'Contents', 'Resources', 'app');
  for await (const entry of glob(path.join(appBase, 'node_modules/node-pty/prebuilds/darwin-*/spawn-helper'))) {
    fs.chmodSync(entry, 0o755);
    console.log(`Fixed executable bit: ${path.relative('.', entry)}`);
  }
  const copilotBin = path.join(appBase, 'node_modules/@github/copilot-darwin-arm64/copilot');
  if (fs.existsSync(copilotBin)) {
    fs.chmodSync(copilotBin, 0o755);
    console.log(`Fixed executable bit: ${path.relative('.', copilotBin)}`);
  }
}

console.log(`Packaged → ${appPaths.join(', ')}`);
