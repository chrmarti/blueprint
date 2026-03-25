// Editor module - editor panel with Edit and Browser tabs

import { refreshFileTree, getCurrentFile, setCurrentFile } from './files.js';

let editorContent = '';
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

export function initEditorPanel(): void {
  const textarea = document.getElementById('editor-textarea') as HTMLTextAreaElement;
  if (!textarea) return;

  // Handle input with autosave
  textarea.addEventListener('input', () => {
    editorContent = textarea.value;
    scheduleAutosave();
  });

  // Tab switching
  const editTab = document.getElementById('edit-tab');
  const browserTab = document.getElementById('browser-tab');
  const editPanel = document.getElementById('edit-panel');
  const browserPanel = document.getElementById('browser-panel');

  editTab?.addEventListener('click', () => {
    editTab.classList.add('active');
    browserTab?.classList.remove('active');
    editPanel?.classList.add('active');
    browserPanel?.classList.remove('active');
  });

  browserTab?.addEventListener('click', () => {
    browserTab.classList.add('active');
    editTab?.classList.remove('active');
    browserPanel?.classList.add('active');
    editPanel?.classList.remove('active');
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      saveCurrentFile();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
      e.preventDefault();
      document.getElementById('implement-btn')?.click();
    }
  });
}

export async function loadFile(filePath: string): Promise<void> {
  try {
    const content = await window.electronAPI.readFile(filePath);
    editorContent = content;
    
    const textarea = document.getElementById('editor-textarea') as HTMLTextAreaElement;
    if (textarea) {
      textarea.value = content;
    }
    
    setCurrentFile(filePath);
    
    // Update file info display
    const fileInfo = document.getElementById('file-info');
    if (fileInfo) {
      const name = filePath.split('/').pop() || filePath;
      fileInfo.textContent = name;
    }
  } catch (error) {
    console.error('Failed to load file:', error);
    alert('Failed to load file');
  }
}

export function getEditorContent(): string {
  return editorContent;
}

export function setEditorContent(content: string): void {
  editorContent = content;
  const textarea = document.getElementById('editor-textarea') as HTMLTextAreaElement;
  if (textarea) {
    textarea.value = content;
  }
}

function scheduleAutosave(): void {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(saveCurrentFile, 500);
}

async function saveCurrentFile(): Promise<void> {
  const filePath = getCurrentFile();
  if (!filePath) return;

  try {
    await window.electronAPI.writeFile(filePath, editorContent);
    
    // Update status
    const status = document.getElementById('editor-status');
    if (status) {
      status.textContent = 'Saved';
      setTimeout(() => {
        status.textContent = '';
      }, 2000);
    }
  } catch (error) {
    console.error('Failed to save file:', error);
  }
}

export async function clearEditor(): Promise<void> {
  editorContent = '';
  const textarea = document.getElementById('editor-textarea') as HTMLTextAreaElement;
  if (textarea) {
    textarea.value = '';
  }
  setCurrentFile(null);
  
  const fileInfo = document.getElementById('file-info');
  if (fileInfo) {
    fileInfo.textContent = '';
  }
}
