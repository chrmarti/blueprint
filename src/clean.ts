// Clean module - workspace cleanup based on .blueprintfiles

import * as fs from 'fs';
import * as path from 'path';

export interface CleanResult {
  ok: boolean;
  deleted: string[];
  error?: string;
}

export interface CleanOptions {
  dryRun?: boolean;
}

/**
 * Parse .blueprintfiles content and return a Set of paths to keep.
 * Always includes .blueprintfiles and .git implicitly.
 */
export function parseBlueprintFiles(content: string): Set<string> {
  const keep = new Set<string>(['.blueprintfiles', '.git']);
  
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    // Remove trailing slash from directories
    const normalized = trimmed.replace(/\/$/, '');
    keep.add(normalized);
  }
  
  return keep;
}

/**
 * Clean the workspace by removing all root-level entries not listed in .blueprintfiles.
 */
export async function cleanWorkspace(
  workspaceFolder: string,
  options: CleanOptions = {}
): Promise<CleanResult> {
  const { dryRun = false } = options;
  const deleted: string[] = [];

  try {
    // Read .blueprintfiles
    const blueprintFilesPath = path.join(workspaceFolder, '.blueprintfiles');
    
    if (!fs.existsSync(blueprintFilesPath)) {
      return {
        ok: false,
        deleted: [],
        error: 'No .blueprintfiles found. Create one to define which files to keep.',
      };
    }

    const content = fs.readFileSync(blueprintFilesPath, 'utf-8');
    const keep = parseBlueprintFiles(content);

    // Read root directory entries
    const entries = fs.readdirSync(workspaceFolder, { withFileTypes: true });

    for (const entry of entries) {
      const name = entry.name;
      
      // Skip hidden files except those explicitly listed
      if (name.startsWith('.') && !keep.has(name)) {
        // Always keep .git
        if (name === '.git') continue;
        // Always keep .blueprintfiles
        if (name === '.blueprintfiles') continue;
      }

      // Check if this entry should be kept
      if (keep.has(name)) {
        continue;
      }

      // Delete this entry
      const fullPath = path.join(workspaceFolder, name);
      
      if (!dryRun) {
        if (entry.isDirectory()) {
          fs.rmSync(fullPath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(fullPath);
        }
      }
      
      deleted.push(name);
    }

    return { ok: true, deleted };
  } catch (error) {
    return {
      ok: false,
      deleted,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Get the list of entries that would be deleted (for preview).
 */
export async function previewClean(workspaceFolder: string): Promise<CleanResult> {
  return cleanWorkspace(workspaceFolder, { dryRun: true });
}
