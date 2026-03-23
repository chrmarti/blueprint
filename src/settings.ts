// settings.ts - Settings modal for Blueprint Implementer

import { getTheme, setTheme, getFontSize, setFontSize, exportState, importState } from './storage';
import { updateEditorFontSize } from './editor';
import { updateTerminalTheme } from './terminal';
import { updateOutputTerminalTheme } from './implementer';

let modalOverlay: HTMLElement | null = null;

export function initSettings(): void {
  modalOverlay = document.getElementById('settings-modal');
  const settingsBtn = document.getElementById('settings-btn');
  const closeBtn = document.getElementById('settings-close');
  const themeSelect = document.getElementById('theme-select') as HTMLSelectElement;
  const fontSizeInput = document.getElementById('font-size-input') as HTMLInputElement;
  const exportBtn = document.getElementById('export-btn');
  const importBtn = document.getElementById('import-btn');

  // Load initial values
  if (themeSelect) {
    themeSelect.value = getTheme();
  }
  if (fontSizeInput) {
    fontSizeInput.value = String(getFontSize());
  }

  // Apply initial theme
  document.documentElement.setAttribute('data-theme', getTheme());

  // Open settings
  settingsBtn?.addEventListener('click', () => {
    modalOverlay?.classList.remove('hidden');
  });

  // Close settings
  closeBtn?.addEventListener('click', closeSettings);
  modalOverlay?.addEventListener('click', (e) => {
    if (e.target === modalOverlay) {
      closeSettings();
    }
  });

  // Escape key closes modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modalOverlay?.classList.contains('hidden')) {
      closeSettings();
    }
  });

  // Theme change
  themeSelect?.addEventListener('change', () => {
    setTheme(themeSelect.value as 'light' | 'dark');
    updateTerminalTheme();
    updateOutputTerminalTheme();
  });

  // Font size change
  fontSizeInput?.addEventListener('change', () => {
    const size = parseInt(fontSizeInput.value, 10);
    if (size >= 10 && size <= 24) {
      setFontSize(size);
      updateEditorFontSize(size);
    }
  });

  // Export state
  exportBtn?.addEventListener('click', async () => {
    const state = exportState();
    const json = JSON.stringify(state, null, 2);
    const path = await window.electronAPI.saveFile('blueprint-state.json');
    if (path) {
      await window.electronAPI.writeFile(path, json);
    }
  });

  // Import state
  importBtn?.addEventListener('click', async () => {
    // Create a file input element
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        try {
          const state = JSON.parse(reader.result as string);
          importState(state);

          // Update UI
          if (themeSelect) themeSelect.value = getTheme();
          if (fontSizeInput) fontSizeInput.value = String(getFontSize());
          updateEditorFontSize(getFontSize());
          updateTerminalTheme();
          updateOutputTerminalTheme();

          alert('State imported successfully');
        } catch (err) {
          alert('Failed to import state: ' + err);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  });
}

function closeSettings(): void {
  modalOverlay?.classList.add('hidden');
}

export function openSettings(): void {
  modalOverlay?.classList.remove('hidden');
}
