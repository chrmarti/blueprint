// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

import { serverAPI } from './api-client.js';

let currentFilePath: string | null = null;
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
let editorTextarea: HTMLTextAreaElement | null = null;

export function initEditor(): void {
  editorTextarea = document.getElementById('editor-textarea') as HTMLTextAreaElement;
  
  if (editorTextarea) {
    // Autosave on input with debounce
    editorTextarea.addEventListener('input', () => {
      if (currentFilePath) {
        debounceSave();
      }
    });

    // Keyboard shortcuts
    editorTextarea.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        saveCurrentFile();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        // Trigger implement
        const implementBtn = document.getElementById('implement-btn');
        if (implementBtn) {
          implementBtn.click();
        }
      }
    });
  }

  // Setup tab switching
  setupEditorTabs();
}

function setupEditorTabs(): void {
  const editTab = document.getElementById('edit-tab');
  const browserTab = document.getElementById('browser-tab');
  const editPanel = document.getElementById('edit-panel');
  const browserPanel = document.getElementById('browser-panel');

  if (editTab && browserTab && editPanel && browserPanel) {
    editTab.addEventListener('click', () => {
      editTab.classList.add('active');
      browserTab.classList.remove('active');
      editPanel.style.display = 'flex';
      browserPanel.style.display = 'none';
    });

    browserTab.addEventListener('click', () => {
      browserTab.classList.add('active');
      editTab.classList.remove('active');
      browserPanel.style.display = 'flex';
      editPanel.style.display = 'none';
    });
  }
}

function debounceSave(): void {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(() => {
    saveCurrentFile();
  }, 500);
}

async function saveCurrentFile(): Promise<void> {
  if (!currentFilePath || !editorTextarea) return;
  
  try {
    await serverAPI.writeFile(currentFilePath, editorTextarea.value);
  } catch (err) {
    console.error('Failed to save file:', err);
  }
}

export async function openFile(relativePath: string): Promise<void> {
  try {
    const content = await serverAPI.readFile(relativePath);
    if (editorTextarea) {
      editorTextarea.value = content;
    }
    currentFilePath = relativePath;
    
    // Update the title to show current file
    const fileTitle = document.getElementById('current-file-title');
    if (fileTitle) {
      fileTitle.textContent = relativePath.split('/').pop() || relativePath;
    }

    // Switch to Edit tab
    const editTab = document.getElementById('edit-tab');
    if (editTab) {
      editTab.click();
    }
  } catch (err) {
    console.error('Failed to open file:', err);
  }
}

export function getCurrentFilePath(): string | null {
  return currentFilePath;
}

export function clearEditor(): void {
  if (editorTextarea) {
    editorTextarea.value = '';
  }
  currentFilePath = null;
  const fileTitle = document.getElementById('current-file-title');
  if (fileTitle) {
    fileTitle.textContent = 'No file open';
  }
}

export function getEditorContent(): string {
  return editorTextarea?.value || '';
}
