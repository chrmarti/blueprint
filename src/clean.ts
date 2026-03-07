/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface CleanResult {
  ok: boolean;
  error?: string;
  toDelete?: string[];
  deleted?: string[];
}

/**
 * Clean a workspace by removing everything except entries listed in .blueprintfiles and .git.
 * The .blueprintfiles file uses one relative path per line, with # comments and blank lines ignored.
 */
export function cleanWorkspace(workspaceFolder: string, opts?: { dryRun?: boolean }): CleanResult {
  const bpFilePath = path.join(workspaceFolder, '.blueprintfiles');
  if (!fs.existsSync(bpFilePath)) {
    return { ok: false, error: 'No .blueprintfiles found in workspace root' };
  }

  // Parse .blueprintfiles: one relative path per line, # comments, blank lines ignored
  const raw = fs.readFileSync(bpFilePath, 'utf-8');
  const keepSet = new Set<string>();
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    keepSet.add(trimmed.replace(/\/$/, '')); // normalise: strip trailing slash
  }
  // Always keep .blueprintfiles itself and .git
  keepSet.add('.blueprintfiles');
  keepSet.add('.git');

  // Collect root entries to delete
  const entries = fs.readdirSync(workspaceFolder);
  const toDelete: string[] = [];
  for (const name of entries) {
    if (keepSet.has(name)) continue;
    toDelete.push(name);
  }

  if (opts?.dryRun) return { ok: true, toDelete };

  if (toDelete.length === 0) return { ok: true, deleted: [] };

  for (const name of toDelete) {
    const full = path.join(workspaceFolder, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      fs.rmSync(full, { recursive: true, force: true });
    } else {
      fs.unlinkSync(full);
    }
  }
  return { ok: true, deleted: toDelete };
}
