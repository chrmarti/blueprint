// editor.ts - Editor panel (Edit and Browser tabs) for Blueprint Implementer

import { getFontSize } from './storage';

let currentFilePath: string | null = null;
let editorTextarea: HTMLTextAreaElement | null = null;
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
let isDirty = false;

export function initEditor(): void {
  editorTextarea = document.getElementById('editor-textarea') as HTMLTextAreaElement;

  // Setup tabs
  const tabs = document.querySelectorAll('.editor-tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const tabName = tab.getAttribute('data-tab');
      if (tabName) {
        switchEditorTab(tabName);
      }
    });
  });

  // Setup autosave
  if (editorTextarea) {
    editorTextarea.addEventListener('input', () => {
      isDirty = true;
      scheduleAutosave();
    });

    // Apply font size
    editorTextarea.style.fontSize = `${getFontSize()}px`;
  }

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      saveCurrentFile();
    }
  });
}

export function switchEditorTab(tabName: string): void {
  // Update tab buttons
  document.querySelectorAll('.editor-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.getAttribute('data-tab') === tabName);
  });

  // Update tab content
  document.querySelectorAll('.editor-content .tab-content').forEach((content) => {
    content.classList.toggle('active', content.getAttribute('data-tab') === tabName);
  });
}

export async function openFile(filePath: string): Promise<void> {
  // Save current file first
  if (isDirty && currentFilePath) {
    await saveCurrentFile();
  }

  try {
    const content = await window.electronAPI.readFile(filePath);
    currentFilePath = filePath;
    if (editorTextarea) {
      editorTextarea.value = content;
    }
    isDirty = false;

    // Switch to Edit tab
    switchEditorTab('edit');
  } catch (err) {
    console.error('Failed to open file:', err);
  }
}

export function getCurrentFilePath(): string | null {
  return currentFilePath;
}

export function getEditorContent(): string {
  return editorTextarea?.value || '';
}

export function setEditorContent(content: string): void {
  if (editorTextarea) {
    editorTextarea.value = content;
    isDirty = true;
  }
}

export function clearEditor(): void {
  currentFilePath = null;
  if (editorTextarea) {
    editorTextarea.value = '';
  }
  isDirty = false;
}

export function updateEditorFontSize(size: number): void {
  if (editorTextarea) {
    editorTextarea.style.fontSize = `${size}px`;
  }
}

function scheduleAutosave(): void {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(() => {
    saveCurrentFile();
  }, 500);
}

async function saveCurrentFile(): Promise<void> {
  if (!currentFilePath || !editorTextarea || !isDirty) return;

  try {
    await window.electronAPI.writeFile(currentFilePath, editorTextarea.value);
    isDirty = false;
  } catch (err) {
    console.error('Failed to save file:', err);
  }
}
