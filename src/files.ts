// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

import { serverAPI } from './api-client.js';
import { openFile, getCurrentFilePath, clearEditor } from './editor.js';
import type { DirEntry, GitStatusEntry } from './types.js';

let selectedDirectory: string | null = null;
let expandedDirectories: Set<string> = new Set();

export function initFiles(): void {
  setupFileTabs();
  setupToolbarActions();
  refreshFileTree();
}

function setupFileTabs(): void {
  const filesTab = document.getElementById('files-tab');
  const gitTab = document.getElementById('git-tab');
  const filesPanel = document.getElementById('files-panel');
  const gitPanel = document.getElementById('git-panel');

  if (filesTab && gitTab && filesPanel && gitPanel) {
    filesTab.addEventListener('click', () => {
      filesTab.classList.add('active');
      gitTab.classList.remove('active');
      filesPanel.style.display = 'block';
      gitPanel.style.display = 'none';
    });

    gitTab.addEventListener('click', () => {
      gitTab.classList.add('active');
      filesTab.classList.remove('active');
      gitPanel.style.display = 'block';
      filesPanel.style.display = 'none';
      refreshGitStatus();
    });
  }
}

function setupToolbarActions(): void {
  const newFileBtn = document.getElementById('new-file-btn');
  const newFolderBtn = document.getElementById('new-folder-btn');
  const refreshBtn = document.getElementById('refresh-btn');
  const deleteBtn = document.getElementById('delete-btn');

  if (newFileBtn) {
    newFileBtn.addEventListener('click', () => createNewFile());
  }
  if (newFolderBtn) {
    newFolderBtn.addEventListener('click', () => createNewFolder());
  }
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => refreshFileTree());
  }
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => deleteSelected());
  }
}

export async function refreshFileTree(): Promise<void> {
  const container = document.getElementById('file-tree');
  if (!container) return;

  try {
    const entries = await serverAPI.readDir();
    container.innerHTML = '';
    renderTree(container, entries, '');
  } catch (err) {
    console.error('Failed to load file tree:', err);
    container.innerHTML = '<div class="error">Failed to load files</div>';
  }
}

function renderTree(container: HTMLElement, entries: DirEntry[], basePath: string): void {
  // Sort: directories first, then alphabetically
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    const fullPath = basePath ? `${basePath}/${entry.name}` : entry.name;
    const item = document.createElement('div');
    item.className = 'tree-item';
    item.dataset.path = fullPath;
    
    const row = document.createElement('div');
    row.className = 'tree-row';
    
    if (entry.isDirectory) {
      const isExpanded = expandedDirectories.has(fullPath);
      const arrow = document.createElement('span');
      arrow.className = 'tree-arrow';
      arrow.textContent = isExpanded ? '▾' : '▸';
      row.appendChild(arrow);
      
      const icon = document.createElement('span');
      icon.className = 'tree-icon';
      icon.textContent = '📁';
      row.appendChild(icon);
      
      const name = document.createElement('span');
      name.className = 'tree-name';
      name.textContent = entry.name;
      row.appendChild(name);
      
      item.appendChild(row);
      
      // Create children container
      const children = document.createElement('div');
      children.className = 'tree-children';
      children.style.display = isExpanded ? 'block' : 'none';
      item.appendChild(children);
      
      row.addEventListener('click', async (e) => {
        e.stopPropagation();
        // Toggle expansion
        if (expandedDirectories.has(fullPath)) {
          expandedDirectories.delete(fullPath);
          arrow.textContent = '▸';
          children.style.display = 'none';
        } else {
          expandedDirectories.add(fullPath);
          arrow.textContent = '▾';
          children.style.display = 'block';
          // Load children if not already loaded
          if (children.children.length === 0) {
            try {
              const childEntries = await serverAPI.readDir(fullPath);
              renderTree(children, childEntries, fullPath);
            } catch (err) {
              console.error('Failed to load directory:', err);
            }
          }
        }
        // Select this directory
        selectDirectory(fullPath, row);
      });
      
      // Load children if expanded
      if (isExpanded) {
        serverAPI.readDir(fullPath).then((childEntries) => {
          renderTree(children, childEntries, fullPath);
        }).catch(console.error);
      }
    } else {
      const indent = document.createElement('span');
      indent.className = 'tree-indent';
      row.appendChild(indent);
      
      const icon = document.createElement('span');
      icon.className = 'tree-icon';
      icon.textContent = getFileIcon(entry.name);
      row.appendChild(icon);
      
      const name = document.createElement('span');
      name.className = 'tree-name';
      name.textContent = entry.name;
      row.appendChild(name);
      
      item.appendChild(row);
      
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        clearDirectorySelection();
        selectFile(fullPath, row);
        openFile(fullPath);
      });
    }
    
    container.appendChild(item);
  }
}

function getFileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'md': return '📝';
    case 'html': return '🌐';
    case 'ts':
    case 'js':
    case 'mjs':
      return '📜';
    case 'json': return '📋';
    case 'css': return '🎨';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
      return '🖼️';
    default: return '📄';
  }
}

function selectDirectory(path: string, row: HTMLElement): void {
  clearSelection();
  selectedDirectory = path;
  row.classList.add('selected');
}

function clearDirectorySelection(): void {
  selectedDirectory = null;
  document.querySelectorAll('.tree-row.selected').forEach((el) => {
    el.classList.remove('selected');
  });
}

function selectFile(path: string, row: HTMLElement): void {
  document.querySelectorAll('.tree-row.active').forEach((el) => {
    el.classList.remove('active');
  });
  row.classList.add('active');
}

function clearSelection(): void {
  document.querySelectorAll('.tree-row.selected, .tree-row.active').forEach((el) => {
    el.classList.remove('selected', 'active');
  });
}

async function createNewFile(): Promise<void> {
  const targetDir = selectedDirectory || '';
  const name = prompt('Enter file name:');
  if (!name) return;
  
  const path = targetDir ? `${targetDir}/${name}` : name;
  try {
    await serverAPI.writeFile(path, '');
    await refreshFileTree();
    openFile(path);
  } catch (err) {
    alert(`Failed to create file: ${err}`);
  }
}

async function createNewFolder(): Promise<void> {
  const targetDir = selectedDirectory || '';
  const name = prompt('Enter folder name:');
  if (!name) return;
  
  const path = targetDir ? `${targetDir}/${name}/.keep` : `${name}/.keep`;
  try {
    await serverAPI.writeFile(path, '');
    await refreshFileTree();
    // Expand the new folder
    const folderPath = path.replace('/.keep', '');
    expandedDirectories.add(folderPath);
    await refreshFileTree();
  } catch (err) {
    alert(`Failed to create folder: ${err}`);
  }
}

async function deleteSelected(): Promise<void> {
  let pathToDelete: string | null = null;
  let isDirectory = false;
  
  if (selectedDirectory) {
    pathToDelete = selectedDirectory;
    isDirectory = true;
  } else {
    pathToDelete = getCurrentFilePath();
  }
  
  if (!pathToDelete) {
    alert('No file or folder selected');
    return;
  }
  
  const message = isDirectory
    ? `Delete folder "${pathToDelete}" and all its contents?`
    : `Delete file "${pathToDelete}"?`;
  
  if (!confirm(message)) return;
  
  try {
    await serverAPI.deleteEntry(pathToDelete);
    if (pathToDelete === getCurrentFilePath()) {
      clearEditor();
    }
    selectedDirectory = null;
    await refreshFileTree();
  } catch (err) {
    alert(`Failed to delete: ${err}`);
  }
}

export async function refreshGitStatus(): Promise<void> {
  const container = document.getElementById('git-list');
  if (!container) return;

  try {
    const entries = await serverAPI.gitStatus();
    container.innerHTML = '';
    
    if (entries.length === 0) {
      container.innerHTML = '<div class="no-changes">No changes</div>';
      return;
    }
    
    for (const entry of entries) {
      const item = document.createElement('div');
      item.className = 'git-item';
      
      const badge = document.createElement('span');
      badge.className = `git-badge ${getStatusClass(entry.status)}`;
      badge.textContent = entry.status.charAt(0).toUpperCase();
      item.appendChild(badge);
      
      const path = document.createElement('span');
      path.className = 'git-path';
      path.textContent = entry.file;
      item.appendChild(path);
      
      container.appendChild(item);
    }
  } catch (err) {
    console.error('Failed to load git status:', err);
    container.innerHTML = '<div class="error">Failed to load git status</div>';
  }
}

function getStatusClass(status: string): string {
  const first = status.charAt(0);
  switch (first) {
    case 'M': return 'modified';
    case 'A': return 'added';
    case 'D': return 'deleted';
    case '?': return 'untracked';
    case 'R': return 'renamed';
    default: return 'other';
  }
}
