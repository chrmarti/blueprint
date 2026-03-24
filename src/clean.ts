// clean.ts — Workspace cleanup driven by .blueprintfiles

import * as fs from 'fs';
import * as path from 'path';

export interface CleanResult {
  ok: boolean;
  deleted: string[];
  error?: string;
}

function parseBlueprintFiles(content: string): Set<string> {
  const keep = new Set<string>();
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    // Strip trailing slash
    keep.add(trimmed.replace(/\/+$/, ''));
  }
  return keep;
}

export async function cleanWorkspace(
  workspaceFolder: string,
  options: { dryRun?: boolean } = {}
): Promise<CleanResult> {
  const bpFilePath = path.join(workspaceFolder, '.blueprintfiles');

  if (!fs.existsSync(bpFilePath)) {
    return { ok: false, deleted: [], error: 'No .blueprintfiles found in workspace root.' };
  }

  const content = fs.readFileSync(bpFilePath, 'utf-8');
  const keep = parseBlueprintFiles(content);

  // Always preserve these
  keep.add('.blueprintfiles');
  keep.add('.git');

  const entries = fs.readdirSync(workspaceFolder);
  const toDelete: string[] = [];

  for (const entry of entries) {
    if (keep.has(entry)) continue;
    toDelete.push(entry);
  }

  if (!options.dryRun) {
    for (const entry of toDelete) {
      const fullPath = path.join(workspaceFolder, entry);
      fs.rmSync(fullPath, { recursive: true, force: true });
    }
  }

  return { ok: true, deleted: toDelete };
}
