// files.ts — Sidebar module (Files and Git tabs, tree view, open/save via IPC)

import { loadFile, getCurrentFilePath, clearEditor } from './editor';

let workspaceFolder: string | null = null;
let selectedDirectory: string | null = null;

const fileIcons: Record<string, string> = {
  '.md': '📝',
  '.html': '🌐',
  '.htm': '🌐',
  '.ts': '📜',
  '.js': '📜',
  '.mjs': '📜',
  '.cjs': '📜',
  '.json': '📋',
  '.css': '🎨',
  '.scss': '🎨',
  '.png': '🖼️',
  '.jpg': '🖼️',
  '.svg': '🖼️',
  '.txt': '📄',
};

function getFileIcon(name: string): string {
  const ext = name.substring(name.lastIndexOf('.'));
  return fileIcons[ext] || '📄';
}

export function initFiles(): void {
  const filesTab = document.querySelector('[data-sidebar-tab="files"]') as HTMLElement;
  const gitTab = document.querySelector('[data-sidebar-tab="git"]') as HTMLElement;
  const filesPane = document.getElementById('files-pane') as HTMLElement;
  const gitPane = document.getElementById('git-pane') as HTMLElement;

  if (filesTab) {
    filesTab.addEventListener('click', () => {
      filesTab.classList.add('active');
      gitTab?.classList.remove('active');
      filesPane.style.display = 'block';
      gitPane.style.display = 'none';
    });
  }

  if (gitTab) {
    gitTab.addEventListener('click', () => {
      gitTab.classList.add('active');
      filesTab?.classList.remove('active');
      gitPane.style.display = 'block';
      filesPane.style.display = 'none';
      refreshGitStatus();
    });
  }

  // Toolbar buttons
  const newFileBtn = document.getElementById('new-file-btn');
  const newFolderBtn = document.getElementById('new-folder-btn');
  const refreshBtn = document.getElementById('refresh-btn');
  const deleteBtn = document.getElementById('delete-btn');

  if (newFileBtn) newFileBtn.addEventListener('click', handleNewFile);
  if (newFolderBtn) newFolderBtn.addEventListener('click', handleNewFolder);
  if (refreshBtn) refreshBtn.addEventListener('click', () => refreshFileTree());
  if (deleteBtn) deleteBtn.addEventListener('click', handleDelete);

  // Listen for folder changes from menu
  window.addEventListener('folder-changed', ((e: CustomEvent<string>) => {
    setWorkspaceFolder(e.detail);
  }) as EventListener);
}

export async function setWorkspaceFolder(folder: string): Promise<void> {
  workspaceFolder = folder;
  selectedDirectory = null;

  // Update folder name in toolbar
  const folderLabel = document.getElementById('folder-name');
  if (folderLabel) {
    folderLabel.textContent = folder.split('/').pop() || folder;
  }

  await refreshFileTree();
}

export async function refreshFileTree(): Promise<void> {
  if (!workspaceFolder) return;

  const tree = document.getElementById('file-tree') as HTMLElement;
  if (!tree) return;

  tree.innerHTML = '';
  await renderDirectory(tree, workspaceFolder, 0);
}

async function renderDirectory(
  container: HTMLElement,
  dirPath: string,
  depth: number
): Promise<void> {
  const entries = await window.electronAPI.readDir(dirPath);

  for (const entry of entries) {
    const fullPath = dirPath + '/' + entry.name;
    const row = document.createElement('div');
    row.className = 'tree-entry';
    row.dataset.path = fullPath;
    row.style.paddingLeft = depth * 16 + 8 + 'px';

    if (entry.isDirectory) {
      row.innerHTML = `<span class="tree-arrow">▸</span> <span class="tree-icon">📁</span> <span class="tree-name">${entry.name}</span>`;
      row.classList.add('directory');

      const childContainer = document.createElement('div');
      childContainer.className = 'tree-children';
      childContainer.style.display = 'none';

      row.addEventListener('click', async (e) => {
        e.stopPropagation();
        const arrow = row.querySelector('.tree-arrow') as HTMLElement;
        const isExpanded = childContainer.style.display !== 'none';

        // Toggle expand/collapse
        if (isExpanded) {
          childContainer.style.display = 'none';
          arrow.textContent = '▸';
        } else {
          if (childContainer.children.length === 0) {
            await renderDirectory(childContainer, fullPath, depth + 1);
          }
          childContainer.style.display = 'block';
          arrow.textContent = '▾';
        }

        // Select directory
        clearDirectorySelection();
        row.classList.add('selected');
        selectedDirectory = fullPath;
      });

      container.appendChild(row);
      container.appendChild(childContainer);
    } else {
      row.innerHTML = `<span class="tree-icon">${getFileIcon(entry.name)}</span> <span class="tree-name">${entry.name}</span>`;
      row.classList.add('file');

      row.addEventListener('click', async (e) => {
        e.stopPropagation();
        clearDirectorySelection();
        clearFileSelection();
        row.classList.add('selected');

        const content = await window.electronAPI.readFile(fullPath);
        loadFile(fullPath, content);
      });

      container.appendChild(row);
    }
  }
}

function clearDirectorySelection(): void {
  document.querySelectorAll('.tree-entry.selected').forEach((el) => {
    el.classList.remove('selected');
  });
  selectedDirectory = null;
}

function clearFileSelection(): void {
  document.querySelectorAll('.tree-entry.file.selected').forEach((el) => {
    el.classList.remove('selected');
  });
}

async function handleNewFile(): Promise<void> {
  const parentDir = selectedDirectory || getActiveFileParent() || workspaceFolder;
  if (!parentDir) return;

  const name = await showInlineInput(parentDir);
  if (!name) return;

  const filePath = parentDir + '/' + name;
  await window.electronAPI.writeFile(filePath, '');
  await refreshFileTree();
  const content = await window.electronAPI.readFile(filePath);
  loadFile(filePath, content);
}

async function handleNewFolder(): Promise<void> {
  const parentDir = selectedDirectory || workspaceFolder;
  if (!parentDir) return;

  const name = await showInlineInput(parentDir);
  if (!name) return;

  const folderPath = parentDir + '/' + name;
  await window.electronAPI.writeFile(folderPath + '/.keep', '');
  await refreshFileTree();
}

async function handleDelete(): Promise<void> {
  const targetPath = selectedDirectory || getCurrentFilePath();
  if (!targetPath) return;

  const isDir = selectedDirectory !== null;
  const name = targetPath.split('/').pop() || targetPath;
  const message = isDir
    ? `Delete folder "${name}" and all its contents?`
    : `Delete file "${name}"?`;

  if (!confirm(message)) return;

  await window.electronAPI.deleteEntry(targetPath);

  if (!isDir && getCurrentFilePath() === targetPath) {
    clearEditor();
  }

  selectedDirectory = null;
  await refreshFileTree();
}

function getActiveFileParent(): string | null {
  const currentPath = getCurrentFilePath();
  if (!currentPath) return null;
  const parts = currentPath.split('/');
  parts.pop();
  return parts.join('/');
}

function showInlineInput(parentDir: string): Promise<string | null> {
  return new Promise((resolve) => {
    // Find the tree entry for the parent directory
    const parentEntry = document.querySelector(
      `.tree-entry[data-path="${parentDir}"]`
    ) as HTMLElement;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'inline-input';
    input.placeholder = 'name...';

    const commit = () => {
      const value = input.value.trim();
      input.remove();
      resolve(value || null);
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') {
        input.remove();
        resolve(null);
      }
    });
    input.addEventListener('blur', commit);

    if (parentEntry && parentEntry.nextElementSibling) {
      parentEntry.parentElement!.insertBefore(input, parentEntry.nextElementSibling);
    } else {
      const tree = document.getElementById('file-tree') as HTMLElement;
      tree.appendChild(input);
    }

    input.focus();
  });
}

// Git status
export async function refreshGitStatus(): Promise<void> {
  const gitList = document.getElementById('git-list') as HTMLElement;
  if (!gitList) return;

  const entries = await window.electronAPI.gitStatus();
  gitList.innerHTML = '';

  if (entries.length === 0) {
    gitList.innerHTML = '<div class="git-empty">No changes</div>';
    return;
  }

  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'git-entry';

    const badge = document.createElement('span');
    badge.className = 'git-badge';
    badge.textContent = entry.status.charAt(0) || '?';

    const statusChar = entry.status.charAt(0);
    switch (statusChar) {
      case 'M':
        badge.classList.add('git-modified');
        break;
      case 'A':
        badge.classList.add('git-added');
        break;
      case 'D':
        badge.classList.add('git-deleted');
        break;
      case '?':
        badge.classList.add('git-untracked');
        break;
      case 'R':
        badge.classList.add('git-renamed');
        break;
    }

    const fileName = document.createElement('span');
    fileName.className = 'git-file';
    fileName.textContent = entry.file;

    row.appendChild(badge);
    row.appendChild(fileName);
    gitList.appendChild(row);
  }
}

export function getWorkspaceFolder(): string | null {
  return workspaceFolder;
}
