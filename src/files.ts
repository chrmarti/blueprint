// Files module - sidebar file browser with Files and Git tabs

let currentFolder: string | null = null;
let selectedDirectory: string | null = null;
let currentFile: string | null = null;
let expandedDirs = new Set<string>();
let onFileSelectCallback: ((filePath: string) => void) | null = null;

export function setOnFileSelect(callback: (filePath: string) => void): void {
  onFileSelectCallback = callback;
}

export function getCurrentFile(): string | null {
  return currentFile;
}

export function setCurrentFile(filePath: string | null): void {
  currentFile = filePath;
}

export function getCurrentFolder(): string | null {
  return currentFolder;
}

export async function initFilesPanel(): Promise<void> {
  const folder = await window.electronAPI.getWorkspaceFolder();
  if (folder) {
    await openFolder(folder);
  }

  // Set up tab switching
  const filesTab = document.getElementById('files-tab');
  const gitTab = document.getElementById('git-tab');
  const filesPanel = document.getElementById('files-panel');
  const gitPanel = document.getElementById('git-panel');

  filesTab?.addEventListener('click', () => {
    filesTab.classList.add('active');
    gitTab?.classList.remove('active');
    filesPanel?.classList.add('active');
    gitPanel?.classList.remove('active');
  });

  gitTab?.addEventListener('click', () => {
    gitTab.classList.add('active');
    filesTab?.classList.remove('active');
    gitPanel?.classList.add('active');
    filesPanel?.classList.remove('active');
    refreshGitStatus();
  });

  // Set up toolbar actions
  document.getElementById('new-file-btn')?.addEventListener('click', () => createNewFile());
  document.getElementById('new-folder-btn')?.addEventListener('click', () => createNewFolder());
  document.getElementById('refresh-btn')?.addEventListener('click', () => refreshFileTree());
  document.getElementById('delete-btn')?.addEventListener('click', () => deleteSelected());
}

export async function openFolder(folder: string): Promise<void> {
  currentFolder = folder;
  await window.electronAPI.setWorkspaceFolder(folder);
  expandedDirs.clear();
  expandedDirs.add(folder);
  await refreshFileTree();
  updateFolderDisplay();
}

function updateFolderDisplay(): void {
  const folderName = document.getElementById('folder-name');
  if (folderName && currentFolder) {
    const name = currentFolder.split('/').pop() || currentFolder;
    folderName.textContent = name;
    folderName.title = currentFolder;
  }
}

export async function refreshFileTree(): Promise<void> {
  if (!currentFolder) return;

  const fileTree = document.getElementById('file-tree');
  if (!fileTree) return;

  try {
    fileTree.innerHTML = '';
    await renderDirectory(fileTree, currentFolder, 0);
  } catch (error) {
    console.error('Failed to refresh file tree:', error);
    fileTree.innerHTML = '<div class="error">Failed to load files</div>';
  }
}

async function renderDirectory(container: HTMLElement, dirPath: string, depth: number): Promise<void> {
  const entries = await window.electronAPI.readDir(dirPath);
  
  // Sort: directories first, then alphabetically
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    const fullPath = `${dirPath}/${entry.name}`;
    const item = document.createElement('div');
    item.className = 'file-tree-item';
    item.dataset.path = fullPath;
    item.style.paddingLeft = `${depth * 16 + 8}px`;

    if (entry.isDirectory) {
      const isExpanded = expandedDirs.has(fullPath);
      const arrow = isExpanded ? '▾' : '▸';
      item.innerHTML = `<span class="arrow">${arrow}</span> <span class="icon">📁</span> <span class="name">${entry.name}</span>`;
      item.classList.add('directory');
      
      if (selectedDirectory === fullPath) {
        item.classList.add('selected');
      }

      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        
        // Toggle expansion
        if (expandedDirs.has(fullPath)) {
          expandedDirs.delete(fullPath);
        } else {
          expandedDirs.add(fullPath);
        }
        
        // Select directory
        selectedDirectory = fullPath;
        currentFile = null;
        
        await refreshFileTree();
      });

      container.appendChild(item);

      // Render children if expanded
      if (isExpanded) {
        const childContainer = document.createElement('div');
        childContainer.className = 'directory-children';
        await renderDirectory(childContainer, fullPath, depth + 1);
        container.appendChild(childContainer);
      }
    } else {
      const icon = getFileIcon(entry.name);
      item.innerHTML = `<span class="arrow"></span> <span class="icon">${icon}</span> <span class="name">${entry.name}</span>`;
      item.classList.add('file');
      
      if (currentFile === fullPath) {
        item.classList.add('active');
      }

      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        selectedDirectory = null;
        currentFile = fullPath;
        
        if (onFileSelectCallback) {
          onFileSelectCallback(fullPath);
        }
        
        await refreshFileTree();
      });

      container.appendChild(item);
    }
  }
}

function getFileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
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
    case 'mjs':
    case 'cjs':
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

async function createNewFile(): Promise<void> {
  if (!currentFolder) return;

  const targetDir = selectedDirectory || (currentFile ? currentFile.split('/').slice(0, -1).join('/') : currentFolder);
  
  const fileName = prompt('Enter file name:');
  if (!fileName) return;

  const fullPath = `${targetDir}/${fileName}`;
  
  try {
    await window.electronAPI.writeFile(fullPath, '');
    await refreshFileTree();
    
    // Select the new file
    currentFile = fullPath;
    if (onFileSelectCallback) {
      onFileSelectCallback(fullPath);
    }
  } catch (error) {
    console.error('Failed to create file:', error);
    alert('Failed to create file');
  }
}

async function createNewFolder(): Promise<void> {
  if (!currentFolder) return;

  const targetDir = selectedDirectory || currentFolder;
  
  const folderName = prompt('Enter folder name:');
  if (!folderName) return;

  const fullPath = `${targetDir}/${folderName}`;
  
  try {
    // Create folder by writing a .keep file
    await window.electronAPI.writeFile(`${fullPath}/.keep`, '');
    expandedDirs.add(fullPath);
    await refreshFileTree();
  } catch (error) {
    console.error('Failed to create folder:', error);
    alert('Failed to create folder');
  }
}

async function deleteSelected(): Promise<void> {
  const pathToDelete = selectedDirectory || currentFile;
  if (!pathToDelete) {
    alert('No file or folder selected');
    return;
  }

  const isDirectory = selectedDirectory !== null;
  const name = pathToDelete.split('/').pop();
  const message = isDirectory
    ? `Delete folder "${name}" and all its contents?`
    : `Delete file "${name}"?`;

  if (!confirm(message)) return;

  try {
    await window.electronAPI.deleteEntry(pathToDelete);
    
    if (currentFile === pathToDelete) {
      currentFile = null;
    }
    selectedDirectory = null;
    
    await refreshFileTree();
  } catch (error) {
    console.error('Failed to delete:', error);
    alert('Failed to delete');
  }
}

// Git status functionality
export async function refreshGitStatus(): Promise<void> {
  const gitPanel = document.getElementById('git-panel');
  const gitList = document.getElementById('git-list');
  if (!gitPanel || !gitList) return;

  try {
    const entries = await window.electronAPI.gitStatus();
    
    if (entries.length === 0) {
      gitList.innerHTML = '<div class="no-changes">No changes</div>';
      return;
    }

    gitList.innerHTML = '';
    for (const entry of entries) {
      const item = document.createElement('div');
      item.className = 'git-item';
      
      const badge = document.createElement('span');
      badge.className = `git-badge ${getStatusClass(entry.status)}`;
      badge.textContent = entry.status.trim().charAt(0) || '?';
      
      const file = document.createElement('span');
      file.className = 'git-file';
      file.textContent = entry.file;
      
      item.appendChild(badge);
      item.appendChild(file);
      gitList.appendChild(item);
    }
  } catch (error) {
    console.error('Failed to get git status:', error);
    gitList.innerHTML = '<div class="error">Failed to get git status</div>';
  }
}

function getStatusClass(status: string): string {
  const code = status.trim().charAt(0);
  switch (code) {
    case 'M':
      return 'modified';
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case '?':
      return 'untracked';
    default:
      return 'other';
  }
}
