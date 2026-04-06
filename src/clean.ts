// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

import * as fs from 'fs';
import * as path from 'path';

interface CleanResult {
  ok: boolean;
  deleted: string[];
  error?: string;
}

/**
 * Parse a .blueprintfiles file and return the list of paths to keep.
 * - One path per line
 * - Lines starting with # are comments
 * - Blank lines are ignored
 * - Trailing / on directories is stripped
 */
function parseBlueprintFiles(content: string): string[] {
  const paths: string[] = [];
  
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    
    // Strip trailing slash
    const cleanPath = trimmed.replace(/\/+$/, '');
    paths.push(cleanPath);
  }
  
  return paths;
}

/**
 * Clean a workspace by removing all root-level entries not listed in .blueprintfiles.
 * Always preserves .blueprintfiles itself and .git.
 */
export async function cleanWorkspace(
  workspaceFolder: string,
  dryRun: boolean = false
): Promise<CleanResult> {
  const blueprintFilesPath = path.join(workspaceFolder, '.blueprintfiles');
  
  // Check if .blueprintfiles exists
  if (!fs.existsSync(blueprintFilesPath)) {
    return {
      ok: false,
      deleted: [],
      error: 'No .blueprintfiles found in workspace root. Create one to specify which files to keep.',
    };
  }
  
  // Parse the file
  const content = fs.readFileSync(blueprintFilesPath, 'utf-8');
  const keepPaths = new Set(parseBlueprintFiles(content));
  
  // Always keep these
  keepPaths.add('.blueprintfiles');
  keepPaths.add('.git');
  
  // List root entries
  const entries = fs.readdirSync(workspaceFolder);
  const toDelete: string[] = [];
  
  for (const entry of entries) {
    if (!keepPaths.has(entry)) {
      toDelete.push(entry);
    }
  }
  
  // Delete if not dry run
  if (!dryRun) {
    for (const entry of toDelete) {
      const fullPath = path.join(workspaceFolder, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          fs.rmSync(fullPath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(fullPath);
        }
      } catch (err) {
        console.error(`Failed to delete ${entry}:`, err);
      }
    }
  }
  
  return {
    ok: true,
    deleted: toDelete,
  };
}
