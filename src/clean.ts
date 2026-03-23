// clean.ts - Workspace cleanup logic for Blueprint Implementer

import * as fs from 'fs';
import * as path from 'path';

export interface CleanResult {
  ok: boolean;
  deleted?: string[];
  error?: string;
}

export interface CleanOptions {
  dryRun?: boolean;
}

/**
 * Reads .blueprintfiles and returns the set of paths to preserve.
 * Always includes .blueprintfiles and .git.
 */
export async function getKeepSet(workspaceFolder: string): Promise<Set<string>> {
  const keepSet = new Set<string>();
  keepSet.add('.blueprintfiles');
  keepSet.add('.git');

  const blueprintFilesPath = path.join(workspaceFolder, '.blueprintfiles');
  if (!fs.existsSync(blueprintFilesPath)) {
    return keepSet;
  }

  const content = await fs.promises.readFile(blueprintFilesPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      // Remove trailing slash
      keepSet.add(trimmed.replace(/\/$/, ''));
    }
  }

  return keepSet;
}

/**
 * Cleans the workspace by removing all root-level entries not in .blueprintfiles.
 */
export async function cleanWorkspace(
  workspaceFolder: string,
  options?: CleanOptions
): Promise<CleanResult> {
  const blueprintFilesPath = path.join(workspaceFolder, '.blueprintfiles');
  if (!fs.existsSync(blueprintFilesPath)) {
    return { ok: false, error: 'No .blueprintfiles found' };
  }

  try {
    const keepSet = await getKeepSet(workspaceFolder);
    const entries = await fs.promises.readdir(workspaceFolder);
    const toDelete: string[] = [];

    for (const entry of entries) {
      if (!keepSet.has(entry)) {
        toDelete.push(entry);
      }
    }

    if (options?.dryRun) {
      return { ok: true, deleted: toDelete };
    }

    for (const entry of toDelete) {
      const entryPath = path.join(workspaceFolder, entry);
      const stat = await fs.promises.stat(entryPath);
      if (stat.isDirectory()) {
        await fs.promises.rm(entryPath, { recursive: true });
      } else {
        await fs.promises.unlink(entryPath);
      }
    }

    return { ok: true, deleted: toDelete };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
