/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// File browser module for navigating a local workspace folder.

interface DirEntry {
  name: string;
  isDirectory: boolean;
}

let fileTreeEl: HTMLElement;
let outlineEl: HTMLElement;
let filesTabBtn: HTMLButtonElement;
let outlineTabBtn: HTMLButtonElement;

let workspaceFolder: string | null = null;
let currentFilePath: string | null = null;
let selectedDir: string | null = null;
const expandedDirs = new Set<string>();

let onFileOpen: (filePath: string, content: string) => void = () => {};

export function initFileBrowser(opts: {
  onFileOpen: (filePath: string, content: string) => void;
}): void {
  fileTreeEl = document.getElementById('file-tree') as HTMLElement;
  outlineEl = document.getElementById('outline') as HTMLElement;
  filesTabBtn = document.getElementById('sidebar-files') as HTMLButtonElement;
  outlineTabBtn = document.getElementById('sidebar-outline') as HTMLButtonElement;

  onFileOpen = opts.onFileOpen;

  filesTabBtn?.addEventListener('click', () => showSidebarTab('files'));
  outlineTabBtn?.addEventListener('click', () => showSidebarTab('outline'));

  document.getElementById('new-file-btn')?.addEventListener('click', () => createNewEntry('file'));
  document.getElementById('new-folder-btn')?.addEventListener('click', () => createNewEntry('folder'));
  document.getElementById('delete-btn')?.addEventListener('click', () => deleteSelectedEntry());

  if (window.electronAPI) {
    window.electronAPI.onFolderOpened((folder) => openFolder(folder));
    window.electronAPI.onMenuOpenFolder(() => promptOpenFolder());
  }
}

function showSidebarTab(tab: 'files' | 'outline'): void {
  if (tab === 'files') {
    fileTreeEl.style.display = '';
    outlineEl.style.display = 'none';
    filesTabBtn.classList.add('active');
    outlineTabBtn.classList.remove('active');
  } else {
    fileTreeEl.style.display = 'none';
    outlineEl.style.display = '';
    outlineTabBtn.classList.add('active');
    filesTabBtn.classList.remove('active');
  }
}

export async function promptOpenFolder(): Promise<void> {
  if (!window.electronAPI) return;
  const folder = await window.electronAPI.openFolder();
  if (folder) await openFolder(folder);
}

export async function openFolder(folder: string): Promise<void> {
  workspaceFolder = folder;
  expandedDirs.clear();
  expandedDirs.add(folder);
  await renderTree();

  const folderNameEl = document.getElementById('folder-name');
  if (folderNameEl) {
    const parts = folder.split('/');
    folderNameEl.textContent = parts[parts.length - 1] || folder;
    folderNameEl.title = folder;
  }
}

export async function refreshTree(): Promise<void> {
  if (workspaceFolder) await renderTree();
}

async function renderTree(): Promise<void> {
  if (!workspaceFolder || !window.electronAPI) return;
  fileTreeEl.innerHTML = '';
  await renderDir(workspaceFolder, 0);
}

async function renderDir(dirPath: string, depth: number): Promise<void> {
  const entries: DirEntry[] = await window.electronAPI!.readDir(dirPath);

  for (const entry of entries) {
    const fullPath = dirPath + '/' + entry.name;
    const div = document.createElement('div');
    div.className = 'file-entry' + (entry.isDirectory ? ' directory' : '');
    div.dataset.path = fullPath;
    if (fullPath === currentFilePath) div.classList.add('active');
    div.style.paddingLeft = `${8 + depth * 16}px`;

    const icon = document.createElement('span');
    icon.className = 'file-icon';
    if (entry.isDirectory) {
      icon.textContent = expandedDirs.has(fullPath) ? '▾' : '▸';
    } else {
      icon.textContent = fileIcon(entry.name);
    }

    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = entry.name;

    div.appendChild(icon);
    div.appendChild(name);

    if (entry.isDirectory) {
      if (fullPath === selectedDir) div.classList.add('active');
      div.addEventListener('click', async () => {
        selectedDir = fullPath;
        if (expandedDirs.has(fullPath)) {
          expandedDirs.delete(fullPath);
        } else {
          expandedDirs.add(fullPath);
        }
        await renderTree();
      });
    } else {
      div.addEventListener('click', () => {
        selectedDir = null; // clear folder selection when a file is clicked
        selectFile(fullPath);
      });
    }

    fileTreeEl.appendChild(div);

    if (entry.isDirectory && expandedDirs.has(fullPath)) {
      await renderDir(fullPath, depth + 1);
    }
  }
}

async function selectFile(filePath: string): Promise<void> {
  if (!window.electronAPI) return;
  try {
    const content = await window.electronAPI.readFile(filePath);
    currentFilePath = filePath;
    onFileOpen(filePath, content);
    await renderTree();
  } catch (err) {
    console.error('Failed to open file:', err);
  }
}

function fileIcon(name: string): string {
  if (name.endsWith('.md')) return '📝';
  if (name.endsWith('.html')) return '🌐';
  if (name.endsWith('.ts') || name.endsWith('.js')) return '📜';
  if (name.endsWith('.json')) return '⚙';
  if (name.endsWith('.css')) return '🎨';
  return '📄';
}

export function getCurrentFilePath(): string | null {
  return currentFilePath;
}

export function getWorkspaceFolder(): string | null {
  return workspaceFolder;
}

export async function saveCurrentFile(content: string): Promise<void> {
  if (!window.electronAPI || !currentFilePath) return;
  await window.electronAPI.writeFile(currentFilePath, content);
}

// ── Delete file / folder ────────────────────────────────────────────

async function deleteSelectedEntry(): Promise<void> {
  if (!window.electronAPI) return;

  // Determine what to delete: selected directory or current file
  const targetPath = selectedDir || currentFilePath;
  if (!targetPath || targetPath === workspaceFolder) return;

  const name = targetPath.split('/').pop() || targetPath;
  const isDir = selectedDir !== null;
  const label = isDir ? `folder "${name}" and all its contents` : `file "${name}"`;

  if (!confirm(`Delete ${label}?`)) return;

  try {
    await window.electronAPI.deleteEntry(targetPath);

    // If we deleted the current file, clear editor state
    if (currentFilePath && (currentFilePath === targetPath || currentFilePath.startsWith(targetPath + '/'))) {
      currentFilePath = null;
      onFileOpen('', '');
    }
    if (selectedDir === targetPath) selectedDir = null;
    expandedDirs.delete(targetPath);
    await renderTree();
  } catch (err) {
    console.error('Failed to delete:', err);
    alert('Failed to delete: ' + (err as Error).message);
  }
}

// ── Create new file / folder ────────────────────────────────────────

function getActiveDir(): string | null {
  // Prefer explicitly selected directory, then parent of current file, then workspace root
  if (selectedDir) return selectedDir;
  if (currentFilePath) {
    const parts = currentFilePath.split('/');
    parts.pop();
    return parts.join('/');
  }
  return workspaceFolder;
}

function createNewEntry(type: 'file' | 'folder'): void {
  if (!workspaceFolder) return;

  const parentDir = getActiveDir();
  if (!parentDir) return;

  // Ensure parent is expanded so the inline input is visible
  expandedDirs.add(parentDir);

  // Render tree, then append an inline input at the target location
  renderTree().then(() => {
    const div = document.createElement('div');
    div.className = 'file-entry';

    // Determine depth based on parentDir relative to workspaceFolder
    const relPath = parentDir.slice(workspaceFolder!.length);
    const depth = relPath ? relPath.split('/').filter(Boolean).length : 0;
    div.style.paddingLeft = `${8 + depth * 16}px`;

    const icon = document.createElement('span');
    icon.className = 'file-icon';
    icon.textContent = type === 'folder' ? '📁' : '📄';

    const input = document.createElement('input');
    input.className = 'inline-input';
    input.type = 'text';
    input.placeholder = type === 'folder' ? 'folder name' : 'filename.ext';

    div.appendChild(icon);
    div.appendChild(input);

    // Insert the input at the right position within parentDir's children
    const allEntries = Array.from(fileTreeEl.querySelectorAll('.file-entry'));
    // Find the parentDir entry itself, then skip past its children
    let insertionPoint: Element | null = null;
    let insideParent = parentDir === workspaceFolder; // root has no entry
    for (const entry of allEntries) {
      const entryPath = (entry as HTMLElement).dataset.path;
      if (entryPath === parentDir) {
        insideParent = true;
        insertionPoint = entry;
        continue;
      }
      if (insideParent && entryPath && entryPath.startsWith(parentDir + '/')) {
        insertionPoint = entry;
      } else if (insideParent && entryPath && !entryPath.startsWith(parentDir + '/')) {
        break;
      }
    }
    if (insertionPoint && insertionPoint.nextSibling) {
      fileTreeEl.insertBefore(div, insertionPoint.nextSibling);
    } else {
      fileTreeEl.appendChild(div);
    }

    input.focus();

    const commit = async () => {
      const name = input.value.trim();
      if (!name) {
        div.remove();
        return;
      }
      const fullPath = parentDir + '/' + name;
      try {
        if (type === 'folder') {
          // Create folder by writing a placeholder and ensuring dir exists
          await window.electronAPI!.writeFile(fullPath + '/.keep', '');
          expandedDirs.add(fullPath);
        } else {
          await window.electronAPI!.writeFile(fullPath, '');
        }
        await renderTree();
        if (type === 'file') {
          await selectFile(fullPath);
        }
      } catch (err) {
        console.error(`Failed to create ${type}:`, err);
        div.remove();
      }
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      }
      if (e.key === 'Escape') {
        div.remove();
      }
    });
    input.addEventListener('blur', commit);
  });
}
