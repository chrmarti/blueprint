// editor.ts — Editor panel (Edit and Browser tabs)

let currentFilePath: string | null = null;
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
const editorTextarea = () => document.getElementById('editor-textarea') as HTMLTextAreaElement;

export function initEditor(): void {
  const textarea = editorTextarea();
  const editTab = document.querySelector('[data-tab="edit"]') as HTMLElement;
  const browserTab = document.querySelector('[data-tab="browser"]') as HTMLElement;
  const editPane = document.getElementById('edit-pane') as HTMLElement;
  const browserPane = document.getElementById('browser-pane') as HTMLElement;

  // Tab switching
  if (editTab) {
    editTab.addEventListener('click', () => {
      editTab.classList.add('active');
      browserTab?.classList.remove('active');
      editPane.style.display = 'flex';
      browserPane.style.display = 'none';
    });
  }

  if (browserTab) {
    browserTab.addEventListener('click', () => {
      browserTab.classList.add('active');
      editTab?.classList.remove('active');
      browserPane.style.display = 'flex';
      editPane.style.display = 'none';
    });
  }

  // Autosave on keystrokes
  if (textarea) {
    textarea.addEventListener('input', () => {
      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => {
        if (currentFilePath) {
          window.electronAPI.writeFile(currentFilePath, textarea.value);
        }
      }, 500);
    });
  }

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      if (currentFilePath && textarea) {
        window.electronAPI.writeFile(currentFilePath, textarea.value);
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
      e.preventDefault();
      const implementBtn = document.getElementById('implement-btn') as HTMLButtonElement;
      if (implementBtn) implementBtn.click();
    }
  });
}

export function loadFile(filePath: string, content: string): void {
  currentFilePath = filePath;
  const textarea = editorTextarea();
  if (textarea) {
    textarea.value = content;
  }
  // Update the filename display
  const fileLabel = document.getElementById('current-file-label');
  if (fileLabel) {
    const parts = filePath.split('/');
    fileLabel.textContent = parts[parts.length - 1];
  }
}

export function getCurrentFilePath(): string | null {
  return currentFilePath;
}

export function clearEditor(): void {
  currentFilePath = null;
  const textarea = editorTextarea();
  if (textarea) textarea.value = '';
  const fileLabel = document.getElementById('current-file-label');
  if (fileLabel) fileLabel.textContent = '';
}
