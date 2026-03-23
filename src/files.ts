// files.ts - Sidebar file browser (Files and Git tabs) for Blueprint Implementer

import { openFile, getCurrentFilePath, clearEditor } from './editor';

let workspaceFolder: string | null = null;
let selectedDirectory: string | null = null;
let expandedDirs: Set<string> = new Set();
let inlineInputEntry: { parentPath: string; type: 'file' | 'folder' } | null = null;

interface DirEntry {
  name: string;
  isDirectory: boolean;
}

export async function initFiles(): Promise<void> {
  // Setup sidebar tabs
  const tabs = document.querySelectorAll('.sidebar-tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const tabName = tab.getAttribute('data-tab');
      if (tabName) {
        switchSidebarTab(tabName);
        if (tabName === 'git') {
          refreshGitStatus();
        }
      }
    });
  });

  // Setup toolbar actions
  document.getElementById('new-file-btn')?.addEventListener('click', showNewFileInput);
  document.getElementById('new-folder-btn')?.addEventListener('click', showNewFolderInput);
  document.getElementById('refresh-btn')?.addEventListener('click', refreshFileTree);
  document.getElementById('delete-btn')?.addEventListener('click', deleteSelected);

  // Get initial workspace folder
  workspaceFolder = await window.electronAPI.getWorkspaceFolder();
  updateFolderDisplay();

  if (workspaceFolder) {
    await refreshFileTree();
    expandedDirs.add(workspaceFolder);
  }

  // Listen for workspace changes
  window.addEventListener('workspace-changed', async (e) => {
    const event = e as CustomEvent<string>;
    workspaceFolder = event.detail;
    expandedDirs.clear();
    if (workspaceFolder) {
      expandedDirs.add(workspaceFolder);
    }
    updateFolderDisplay();
    await refreshFileTree();
  });
}

export function switchSidebarTab(tabName: string): void {
  // Update tab buttons
  document.querySelectorAll('.sidebar-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.getAttribute('data-tab') === tabName);
  });

  // Update tab content
  document.querySelectorAll('.sidebar-content .tab-content').forEach((content) => {
    content.classList.toggle('active', content.getAttribute('data-tab') === tabName);
  });
}

function updateFolderDisplay(): void {
  const display = document.getElementById('folder-display');
  if (display) {
    if (workspaceFolder) {
      const folderName = workspaceFolder.split('/').pop() || workspaceFolder;
      display.innerHTML = `<span class="toolbar-folder-name">${folderName}</span>`;
    } else {
      display.innerHTML = '<span>No folder open</span>';
    }
  }
}

export async function refreshFileTree(): Promise<void> {
  const fileTree = document.getElementById('file-tree');
  if (!fileTree) return;

  if (!workspaceFolder) {
    fileTree.innerHTML = '<div class="empty-state">No folder open</div>';
    return;
  }

  try {
    const entries = await window.electronAPI.readDir(workspaceFolder);
    fileTree.innerHTML = '';
    await renderTree(fileTree, workspaceFolder, entries);
  } catch (err) {
    console.error('Failed to read directory:', err);
    fileTree.innerHTML = '<div class="empty-state">Failed to read folder</div>';
  }
}

async function renderTree(container: HTMLElement, dirPath: string, entries: DirEntry[]): Promise<void> {
  const currentFile = getCurrentFilePath();

  for (const entry of entries) {
    const fullPath = `${dirPath}/${entry.name}`;
    const entryEl = document.createElement('div');
    entryEl.className = 'file-entry';
    entryEl.setAttribute('data-path', fullPath);

    if (entry.isDirectory) {
      const isExpanded = expandedDirs.has(fullPath);
      const isSelected = selectedDirectory === fullPath;

      entryEl.innerHTML = `
        <span class="file-entry-arrow">${isExpanded ? '▾' : '▸'}</span>
        <span class="file-entry-icon">📁</span>
        <span class="file-entry-name">${entry.name}</span>
      `;

      if (isSelected) {
        entryEl.classList.add('directory-selected');
      }

      entryEl.addEventListener('click', async (e) => {
        e.stopPropagation();

        // Toggle expansion
        if (expandedDirs.has(fullPath)) {
          expandedDirs.delete(fullPath);
        } else {
          expandedDirs.add(fullPath);
        }

        // Select directory
        selectedDirectory = fullPath;

        await refreshFileTree();
      });

      container.appendChild(entryEl);

      // Render children if expanded
      if (isExpanded) {
        const childContainer = document.createElement('div');
        childContainer.className = 'file-children';
        try {
          const childEntries = await window.electronAPI.readDir(fullPath);
          await renderTree(childContainer, fullPath, childEntries);
        } catch {
          // Directory might be inaccessible
        }
        container.appendChild(childContainer);
      }
    } else {
      const icon = getFileIcon(entry.name);
      const isSelected = currentFile === fullPath;

      entryEl.innerHTML = `
        <span class="file-entry-arrow"></span>
        <span class="file-entry-icon">${icon}</span>
        <span class="file-entry-name">${entry.name}</span>
      `;

      if (isSelected) {
        entryEl.classList.add('selected');
      }

      entryEl.addEventListener('click', async (e) => {
        e.stopPropagation();
        selectedDirectory = null;
        await openFile(fullPath);
        await refreshFileTree();
      });

      container.appendChild(entryEl);
    }
  }

  // Render inline input if needed
  if (inlineInputEntry && inlineInputEntry.parentPath === dirPath) {
    const inputEl = document.createElement('div');
    inputEl.className = 'file-entry';
    inputEl.innerHTML = `
      <span class="file-entry-arrow"></span>
      <span class="file-entry-icon">${inlineInputEntry.type === 'folder' ? '📁' : '📄'}</span>
      <input type="text" class="inline-input" placeholder="${inlineInputEntry.type === 'folder' ? 'Folder name' : 'File name'}">
    `;

    const input = inputEl.querySelector('input') as HTMLInputElement;
    container.appendChild(inputEl);

    input.focus();
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        const name = input.value.trim();
        if (name) {
          await createEntry(dirPath, name, inlineInputEntry!.type);
        }
        inlineInputEntry = null;
        await refreshFileTree();
      } else if (e.key === 'Escape') {
        inlineInputEntry = null;
        await refreshFileTree();
      }
    });

    input.addEventListener('blur', async () => {
      if (inlineInputEntry) {
        inlineInputEntry = null;
        await refreshFileTree();
      }
    });
  }
}

function getFileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'md':
      return '📝';
    case 'html':
    case 'htm':
      return '🌐';
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
      return '📜';
    case 'json':
      return '📋';
    case 'css':
    case 'scss':
    case 'sass':
      return '🎨';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
      return '🖼️';
    default:
      return '📄';
  }
}

async function showNewFileInput(): Promise<void> {
  const parentPath = getTargetDirectory();
  if (!parentPath) return;

  // Ensure parent is expanded
  expandedDirs.add(parentPath);

  inlineInputEntry = { parentPath, type: 'file' };
  await refreshFileTree();
}

async function showNewFolderInput(): Promise<void> {
  const parentPath = getTargetDirectory();
  if (!parentPath) return;

  // Ensure parent is expanded
  expandedDirs.add(parentPath);

  inlineInputEntry = { parentPath, type: 'folder' };
  await refreshFileTree();
}

function getTargetDirectory(): string | null {
  if (selectedDirectory) {
    return selectedDirectory;
  }
  const currentFile = getCurrentFilePath();
  if (currentFile) {
    return currentFile.substring(0, currentFile.lastIndexOf('/'));
  }
  return workspaceFolder;
}

async function createEntry(parentPath: string, name: string, type: 'file' | 'folder'): Promise<void> {
  const fullPath = `${parentPath}/${name}`;

  try {
    if (type === 'folder') {
      // Create folder with a .keep file
      await window.electronAPI.writeFile(`${fullPath}/.keep`, '');
      expandedDirs.add(fullPath);
    } else {
      await window.electronAPI.writeFile(fullPath, '');
    }
  } catch (err) {
    console.error('Failed to create entry:', err);
  }
}

async function deleteSelected(): Promise<void> {
  let pathToDelete: string | null = null;
  let description = '';

  if (selectedDirectory) {
    pathToDelete = selectedDirectory;
    const name = selectedDirectory.split('/').pop();
    description = `Delete folder "${name}" and all its contents?`;
  } else {
    const currentFile = getCurrentFilePath();
    if (currentFile) {
      pathToDelete = currentFile;
      const name = currentFile.split('/').pop();
      description = `Delete file "${name}"?`;
    }
  }

  if (!pathToDelete) return;

  if (confirm(description)) {
    try {
      await window.electronAPI.deleteEntry(pathToDelete);

      // Clear selection and editor if needed
      if (selectedDirectory === pathToDelete) {
        selectedDirectory = null;
      }
      if (getCurrentFilePath() === pathToDelete) {
        clearEditor();
      }

      await refreshFileTree();
    } catch (err) {
      console.error('Failed to delete:', err);
    }
  }
}

export async function refreshGitStatus(): Promise<void> {
  const gitStatus = document.getElementById('git-status');
  if (!gitStatus) return;

  if (!workspaceFolder) {
    gitStatus.innerHTML = '<div class="empty-state">No folder open</div>';
    return;
  }

  try {
    const entries = await window.electronAPI.gitStatus();

    if (entries.length === 0) {
      gitStatus.innerHTML = '<div class="empty-state">No changes</div>';
      return;
    }

    gitStatus.innerHTML = entries
      .map((entry) => {
        const badge = getStatusBadge(entry.status);
        return `
          <div class="git-entry">
            <span class="git-status-badge ${badge.class}">${badge.label}</span>
            <span class="git-file-path">${entry.file}</span>
          </div>
        `;
      })
      .join('');
  } catch (err) {
    console.error('Failed to get git status:', err);
    gitStatus.innerHTML = '<div class="empty-state">Not a git repository</div>';
  }
}

function getStatusBadge(status: string): { label: string; class: string } {
  const first = status[0];
  const second = status[1];

  // Check working tree changes first
  if (second === 'M') return { label: 'M', class: 'modified' };
  if (second === 'D') return { label: 'D', class: 'deleted' };
  if (second === '?') return { label: '?', class: 'untracked' };

  // Check index changes
  if (first === 'M') return { label: 'M', class: 'modified' };
  if (first === 'A') return { label: 'A', class: 'added' };
  if (first === 'D') return { label: 'D', class: 'deleted' };
  if (first === 'R') return { label: 'R', class: 'renamed' };
  if (first === '?') return { label: '?', class: 'untracked' };

  return { label: status, class: 'modified' };
}

export function getWorkspaceFolder(): string | null {
  return workspaceFolder;
}

export async function setWorkspaceFolder(folder: string): Promise<void> {
  workspaceFolder = folder;
  expandedDirs.clear();
  expandedDirs.add(folder);
  updateFolderDisplay();
  await refreshFileTree();
}
