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
      div.addEventListener('click', async () => {
        if (expandedDirs.has(fullPath)) {
          expandedDirs.delete(fullPath);
        } else {
          expandedDirs.add(fullPath);
        }
        await renderTree();
      });
    } else {
      div.addEventListener('click', () => selectFile(fullPath));
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
