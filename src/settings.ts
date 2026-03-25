// Settings module - settings modal, theme, history drawer

import { loadSettings, saveSettings, loadHistory, exportProjectState, importProjectState, Settings } from './storage.js';
import { updateTerminalTheme } from './terminal.js';
import { updateOutputTheme } from './implementer.js';

let currentSettings: Settings;

export async function initSettingsPanel(): Promise<void> {
  currentSettings = loadSettings();
  applyTheme(currentSettings.theme);

  // Settings button
  document.getElementById('settings-btn')?.addEventListener('click', () => {
    openSettingsModal();
  });

  // Clean button
  document.getElementById('clean-btn')?.addEventListener('click', () => {
    cleanWorkspace();
  });

  // Load models into dropdown
  await loadModels();
}

async function loadModels(): Promise<void> {
  const modelSelect = document.getElementById('model-select') as HTMLSelectElement;
  if (!modelSelect) return;

  try {
    const result = await window.electronAPI.listModels();
    
    if (result.ok && result.models && result.models.length > 0) {
      modelSelect.innerHTML = '';
      for (const model of result.models) {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = model.name;
        if (model.id === currentSettings.model) {
          option.selected = true;
        }
        modelSelect.appendChild(option);
      }
    } else {
      // Show unavailable state
      modelSelect.innerHTML = '<option value="">Models unavailable</option>';
    }
  } catch (error) {
    console.error('Failed to load models:', error);
    modelSelect.innerHTML = '<option value="">Failed to load models</option>';
  }

  // Update settings when model changes
  modelSelect.addEventListener('change', () => {
    currentSettings.model = modelSelect.value;
    saveSettings(currentSettings);
  });
}

function openSettingsModal(): void {
  const modal = document.getElementById('settings-modal');
  if (!modal) return;

  // Populate current settings
  const themeSelect = document.getElementById('theme-select') as HTMLSelectElement;
  const fontSizeInput = document.getElementById('font-size-input') as HTMLInputElement;
  const temperatureInput = document.getElementById('temperature-input') as HTMLInputElement;

  if (themeSelect) themeSelect.value = currentSettings.theme;
  if (fontSizeInput) fontSizeInput.value = String(currentSettings.fontSize);
  if (temperatureInput) temperatureInput.value = String(currentSettings.temperature);

  // Show modal
  modal.classList.add('visible');

  // Set up event handlers
  const closeBtn = modal.querySelector('.close-btn');
  closeBtn?.addEventListener('click', () => closeSettingsModal());

  // Close on Esc
  const handleEsc = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeSettingsModal();
      document.removeEventListener('keydown', handleEsc);
    }
  };
  document.addEventListener('keydown', handleEsc);

  // Theme change
  themeSelect?.addEventListener('change', () => {
    currentSettings.theme = themeSelect.value as 'light' | 'dark';
    saveSettings(currentSettings);
    applyTheme(currentSettings.theme);
  });

  // Font size change
  fontSizeInput?.addEventListener('change', () => {
    currentSettings.fontSize = parseInt(fontSizeInput.value, 10) || 14;
    saveSettings(currentSettings);
    applyFontSize(currentSettings.fontSize);
  });

  // Temperature change
  temperatureInput?.addEventListener('change', () => {
    currentSettings.temperature = parseFloat(temperatureInput.value) || 0;
    saveSettings(currentSettings);
  });

  // Export button
  document.getElementById('export-btn')?.addEventListener('click', () => {
    exportState();
  });

  // Import button
  document.getElementById('import-btn')?.addEventListener('click', () => {
    importState();
  });

  // History button
  document.getElementById('history-btn')?.addEventListener('click', () => {
    openHistoryDrawer();
  });
}

function closeSettingsModal(): void {
  const modal = document.getElementById('settings-modal');
  modal?.classList.remove('visible');
}

function applyTheme(theme: 'light' | 'dark'): void {
  document.documentElement.setAttribute('data-theme', theme);
  updateTerminalTheme();
  updateOutputTheme();
}

function applyFontSize(size: number): void {
  const editor = document.getElementById('editor-textarea') as HTMLTextAreaElement;
  if (editor) {
    editor.style.fontSize = `${size}px`;
  }
}

async function cleanWorkspace(): Promise<void> {
  // Preview what would be deleted
  const result = await window.electronAPI.cleanWorkspace({ dryRun: true });
  
  if (!result.ok) {
    alert(result.error || 'Failed to clean workspace');
    return;
  }

  if (result.deleted.length === 0) {
    alert('No files to clean');
    return;
  }

  // Show confirmation dialog
  const message = `The following files will be deleted:\n\n${result.deleted.join('\n')}\n\nProceed?`;
  if (!confirm(message)) return;

  // Perform actual clean
  const cleanResult = await window.electronAPI.cleanWorkspace({ dryRun: false });
  
  if (cleanResult.ok) {
    alert(`Deleted ${cleanResult.deleted.length} items`);
    // Refresh file tree
    const event = new CustomEvent('files-changed');
    document.dispatchEvent(event);
  } else {
    alert(cleanResult.error || 'Failed to clean workspace');
  }
}

function exportState(): void {
  const json = exportProjectState();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = 'blueprint-state.json';
  a.click();
  
  URL.revokeObjectURL(url);
}

async function importState(): Promise<void> {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    
    try {
      const json = await file.text();
      importProjectState(json);
      alert('State imported successfully');
      // Reload settings
      currentSettings = loadSettings();
      applyTheme(currentSettings.theme);
      applyFontSize(currentSettings.fontSize);
    } catch (error) {
      alert(`Failed to import: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  input.click();
}

function openHistoryDrawer(): void {
  const history = loadHistory();
  
  if (history.length === 0) {
    alert('No history');
    return;
  }

  const drawer = document.getElementById('history-drawer');
  const list = document.getElementById('history-list');
  if (!drawer || !list) return;

  list.innerHTML = '';
  
  for (const entry of history.slice().reverse()) {
    const item = document.createElement('div');
    item.className = 'history-item';
    
    const date = new Date(entry.timestamp);
    const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    
    item.innerHTML = `
      <div class="history-date">${dateStr}</div>
      <div class="history-folder">${entry.workspaceFolder.split('/').pop()}</div>
      <div class="history-status ${entry.success ? 'success' : 'error'}">${entry.success ? '✓' : '✗'}</div>
    `;
    
    list.appendChild(item);
  }

  drawer.classList.add('visible');

  // Close button
  drawer.querySelector('.close-btn')?.addEventListener('click', () => {
    drawer.classList.remove('visible');
  });
}

export function getSettings(): Settings {
  return currentSettings;
}
