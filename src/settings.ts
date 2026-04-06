// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

import { loadSettings, saveSettings, loadHistory, exportProjectState, importProjectState, type Settings, type HistoryEntry } from './storage.js';
import { setTheme } from './layout.js';
import { loadModels } from './auth.js';

let settingsModal: HTMLElement | null = null;
let historyDrawer: HTMLElement | null = null;
let currentSettings: Settings;

export function initSettings(): void {
  currentSettings = loadSettings();
  settingsModal = document.getElementById('settings-modal');
  historyDrawer = document.getElementById('history-drawer');

  // Settings button
  const settingsBtn = document.getElementById('settings-btn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', openSettings);
  }

  // History button
  const historyBtn = document.getElementById('history-btn');
  if (historyBtn) {
    historyBtn.addEventListener('click', toggleHistory);
  }

  // Close settings
  const closeSettingsBtn = document.getElementById('close-settings-btn');
  if (closeSettingsBtn) {
    closeSettingsBtn.addEventListener('click', closeSettings);
  }

  // ESC to close settings
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeSettings();
    }
  });

  // Click outside to close settings
  if (settingsModal) {
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) {
        closeSettings();
      }
    });
  }

  // Theme toggle
  const themeToggle = document.getElementById('theme-toggle') as HTMLSelectElement;
  if (themeToggle) {
    themeToggle.value = currentSettings.theme;
    themeToggle.addEventListener('change', () => {
      const theme = themeToggle.value as 'light' | 'dark';
      currentSettings.theme = theme;
      saveSettings(currentSettings);
      setTheme(theme);
    });
  }

  // Font size
  const fontSizeInput = document.getElementById('font-size') as HTMLInputElement;
  if (fontSizeInput) {
    fontSizeInput.value = String(currentSettings.fontSize);
    fontSizeInput.addEventListener('change', () => {
      currentSettings.fontSize = parseInt(fontSizeInput.value, 10);
      saveSettings(currentSettings);
      document.documentElement.style.setProperty('--editor-font-size', `${currentSettings.fontSize}px`);
    });
  }

  // Temperature
  const tempSlider = document.getElementById('temperature') as HTMLInputElement;
  const tempValue = document.getElementById('temperature-value');
  if (tempSlider && tempValue) {
    tempSlider.value = String(currentSettings.temperature);
    tempValue.textContent = String(currentSettings.temperature);
    tempSlider.addEventListener('input', () => {
      const temp = parseFloat(tempSlider.value);
      currentSettings.temperature = temp;
      tempValue.textContent = String(temp);
      saveSettings(currentSettings);
    });
  }

  // Export
  const exportBtn = document.getElementById('export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', exportProject);
  }

  // Import
  const importBtn = document.getElementById('import-btn');
  const importInput = document.getElementById('import-input') as HTMLInputElement;
  if (importBtn && importInput) {
    importBtn.addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', () => {
      const file = importInput.files?.[0];
      if (file) {
        importProject(file);
      }
    });
  }
}

function openSettings(): void {
  if (settingsModal) {
    settingsModal.classList.add('visible');
  }
}

function closeSettings(): void {
  if (settingsModal) {
    settingsModal.classList.remove('visible');
  }
}

function toggleHistory(): void {
  if (historyDrawer) {
    historyDrawer.classList.toggle('visible');
    if (historyDrawer.classList.contains('visible')) {
      renderHistory();
    }
  }
}

function renderHistory(): void {
  const list = document.getElementById('history-list');
  if (!list) return;

  const history = loadHistory();
  list.innerHTML = '';

  if (history.length === 0) {
    list.innerHTML = '<div class="no-history">No implementation history</div>';
    return;
  }

  for (const entry of history) {
    const item = document.createElement('div');
    item.className = `history-item ${entry.result}`;
    
    const time = document.createElement('span');
    time.className = 'history-time';
    time.textContent = new Date(entry.timestamp).toLocaleString();
    item.appendChild(time);
    
    const model = document.createElement('span');
    model.className = 'history-model';
    model.textContent = entry.model;
    item.appendChild(model);
    
    const status = document.createElement('span');
    status.className = 'history-status';
    status.textContent = entry.result === 'success' ? '✓' : '✗';
    item.appendChild(status);
    
    list.appendChild(item);
  }
}

function exportProject(): void {
  const state = exportProjectState();
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'blueprint-project.json';
  a.click();
  URL.revokeObjectURL(url);
}

async function importProject(file: File): Promise<void> {
  try {
    const text = await file.text();
    const state = JSON.parse(text);
    importProjectState(state);
    // Reload settings
    currentSettings = loadSettings();
    // Apply theme
    setTheme(currentSettings.theme);
    // Close modal
    closeSettings();
    alert('Project imported successfully');
  } catch (err) {
    alert(`Failed to import project: ${err}`);
  }
}

export function getSelectedModel(): string {
  const modelSelect = document.getElementById('model-select') as HTMLSelectElement;
  return modelSelect?.value || 'claude-opus-4.5';
}

export function getTemperature(): number {
  return currentSettings.temperature;
}
