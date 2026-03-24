// settings.ts — Settings modal, history drawer, theme, import/export

import { loadSettings, saveSettings, loadHistory } from './storage';
import { updateTerminalTheme } from './terminal';
import { updateOutputTheme } from './implementer';

let settingsModal: HTMLElement | null = null;

export function initSettings(): void {
  settingsModal = document.getElementById('settings-modal') as HTMLElement;
  const settingsBtn = document.getElementById('settings-btn') as HTMLElement;
  const closeBtn = document.getElementById('settings-close-btn') as HTMLElement;

  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => openSettings());
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => closeSettings());
  }

  // Close with Esc
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && settingsModal?.classList.contains('open')) {
      closeSettings();
    }
  });

  // Close when clicking backdrop
  if (settingsModal) {
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) {
        closeSettings();
      }
    });
  }

  // Apply saved theme on load
  const settings = loadSettings();
  applyTheme(settings.theme);
  applyFontSize(settings.fontSize);

  // Theme toggle
  const themeToggle = document.getElementById('theme-toggle') as HTMLSelectElement;
  if (themeToggle) {
    themeToggle.value = settings.theme;
    themeToggle.addEventListener('change', () => {
      const theme = themeToggle.value as 'light' | 'dark';
      const current = loadSettings();
      current.theme = theme;
      saveSettings(current);
      applyTheme(theme);
      updateTerminalTheme();
      updateOutputTheme();
    });
  }

  // Font size
  const fontSizeInput = document.getElementById('font-size-input') as HTMLInputElement;
  if (fontSizeInput) {
    fontSizeInput.value = String(settings.fontSize);
    fontSizeInput.addEventListener('change', () => {
      const size = parseInt(fontSizeInput.value, 10) || 14;
      const current = loadSettings();
      current.fontSize = size;
      saveSettings(current);
      applyFontSize(size);
    });
  }

  // Temperature
  const tempSlider = document.getElementById('temperature-slider') as HTMLInputElement;
  const tempValue = document.getElementById('temperature-value') as HTMLElement;
  if (tempSlider) {
    tempSlider.value = String(settings.temperature);
    if (tempValue) tempValue.textContent = String(settings.temperature);
    tempSlider.addEventListener('input', () => {
      const temp = parseFloat(tempSlider.value);
      if (tempValue) tempValue.textContent = String(temp);
      const current = loadSettings();
      current.temperature = temp;
      saveSettings(current);
    });
  }

  // Export
  const exportBtn = document.getElementById('export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', exportState);
  }

  // Import
  const importBtn = document.getElementById('import-btn');
  if (importBtn) {
    importBtn.addEventListener('click', importState);
  }

  // History drawer
  initHistoryDrawer();
}

function openSettings(): void {
  if (settingsModal) settingsModal.classList.add('open');
}

function closeSettings(): void {
  if (settingsModal) settingsModal.classList.remove('open');
}

function applyTheme(theme: 'light' | 'dark'): void {
  document.documentElement.dataset.theme = theme;
}

function applyFontSize(size: number): void {
  const editor = document.getElementById('editor-textarea') as HTMLTextAreaElement;
  if (editor) editor.style.fontSize = size + 'px';
}

export async function populateModels(): Promise<void> {
  const select = document.getElementById('model-select') as HTMLSelectElement;
  if (!select) return;

  select.innerHTML = '<option value="">Loading models...</option>';
  select.disabled = true;

  const result = await window.electronAPI.listModels();

  select.innerHTML = '';
  select.disabled = false;

  if (!result.ok || result.models.length === 0) {
    select.innerHTML = '<option value="">Models unavailable</option>';
    return;
  }

  const settings = loadSettings();
  for (const model of result.models) {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.name;
    if (model.id === settings.model) option.selected = true;
    select.appendChild(option);
  }

  // If none was selected, select first
  if (!select.value && result.models.length > 0) {
    select.value = result.models[0].id;
  }

  select.addEventListener('change', () => {
    const current = loadSettings();
    current.model = select.value;
    saveSettings(current);
  });
}

function initHistoryDrawer(): void {
  const drawer = document.getElementById('history-drawer') as HTMLElement;
  if (!drawer) return;

  const entries = loadHistory();
  const list = drawer.querySelector('.history-list') as HTMLElement;
  if (!list) return;

  list.innerHTML = '';
  for (const entry of entries) {
    const item = document.createElement('div');
    item.className = 'history-item';
    const date = new Date(entry.timestamp);
    item.innerHTML = `
      <span class="history-time">${date.toLocaleString()}</span>
      <span class="history-model">${entry.model}</span>
      <span class="history-status ${entry.status}">${entry.status}</span>
    `;
    list.appendChild(item);
  }
}

async function exportState(): Promise<void> {
  const settings = loadSettings();
  const history = loadHistory();
  const bundle = { settings, history, version: 1 };
  const json = JSON.stringify(bundle, null, 2);
  await window.electronAPI.saveFileDialog('blueprint-state.json', json);
}

async function importState(): Promise<void> {
  // Use a file input
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const bundle = JSON.parse(text);
      if (bundle.settings) {
        saveSettings(bundle.settings);
      }
      location.reload();
    } catch {
      alert('Invalid state file.');
    }
  };
  input.click();
}
