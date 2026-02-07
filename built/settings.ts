/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { loadSettings, saveSettings, loadHistory, exportProject, importProject } from './storage';
import type { CompilationEntry } from './storage';
import { setOutput } from './compiler';
import { loadPreview } from './preview';

let modalEl: HTMLElement;
let historyDrawerEl: HTMLElement;
let historyListEl: HTMLElement;

export function initSettings(): void {
  modalEl = document.getElementById('settings-modal') as HTMLElement;
  historyDrawerEl = document.getElementById('history-drawer') as HTMLElement;
  historyListEl = document.getElementById('history-list') as HTMLElement;

  document.getElementById('settings-btn')?.addEventListener('click', openModal);
  document.getElementById('settings-save')?.addEventListener('click', saveAndClose);
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) closeModal();
  });

  document.getElementById('history-btn')?.addEventListener('click', toggleHistory);
  document.getElementById('history-close')?.addEventListener('click', () => {
    historyDrawerEl.classList.remove('open');
  });

  // Temperature display
  const tempSlider = document.getElementById('setting-temp') as HTMLInputElement;
  const tempDisplay = document.getElementById('temp-display') as HTMLSpanElement;
  tempSlider?.addEventListener('input', () => {
    tempDisplay.textContent = tempSlider.value;
  });

  // Export / Import project
  document.getElementById('export-project')?.addEventListener('click', () => {
    const state = exportProject();
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'blueprint-project.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('import-project')?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (file) {
        const text = await file.text();
        try {
          const state = JSON.parse(text);
          importProject(state);
          location.reload();
        } catch {
          alert('Invalid project file');
        }
      }
    });
    input.click();
  });

  // Load current settings into form
  populateForm();
}

function openModal(): void {
  populateForm();
  modalEl.classList.add('open');
}

function closeModal(): void {
  modalEl.classList.remove('open');
}

function populateForm(): void {
  const s = loadSettings();
  (document.getElementById('setting-api-key') as HTMLInputElement).value = s.apiKey;
  (document.getElementById('setting-endpoint') as HTMLInputElement).value = s.endpoint;
  (document.getElementById('setting-model') as HTMLInputElement).value = s.model;
  (document.getElementById('setting-temp') as HTMLInputElement).value = String(s.temperature);
  (document.getElementById('temp-display') as HTMLSpanElement).textContent = String(s.temperature);
  (document.getElementById('setting-max-tokens') as HTMLInputElement).value = String(s.maxTokens);
  (document.getElementById('setting-font-size') as HTMLInputElement).value = String(s.fontSize);
}

function saveAndClose(): void {
  const s = loadSettings();
  s.apiKey = (document.getElementById('setting-api-key') as HTMLInputElement).value;
  s.endpoint = (document.getElementById('setting-endpoint') as HTMLInputElement).value;
  s.model = (document.getElementById('setting-model') as HTMLInputElement).value;
  s.temperature = parseFloat((document.getElementById('setting-temp') as HTMLInputElement).value);
  s.maxTokens = parseInt((document.getElementById('setting-max-tokens') as HTMLInputElement).value, 10);
  s.fontSize = parseInt((document.getElementById('setting-font-size') as HTMLInputElement).value, 10);
  saveSettings(s);
  closeModal();

  // Apply font size immediately
  const editor = document.getElementById('editor-area') as HTMLTextAreaElement;
  editor.style.fontSize = `${s.fontSize}px`;
}

function toggleHistory(): void {
  historyDrawerEl.classList.toggle('open');
  if (historyDrawerEl.classList.contains('open')) {
    renderHistory();
  }
}

function renderHistory(): void {
  const entries = loadHistory();
  historyListEl.innerHTML = '';

  if (entries.length === 0) {
    historyListEl.innerHTML = '<div style="padding: 12px; color: var(--text-muted);">No compilation history yet.</div>';
    return;
  }

  entries.forEach((entry: CompilationEntry) => {
    const div = document.createElement('div');
    div.className = 'history-item';
    const date = new Date(entry.timestamp);
    div.innerHTML = `
      <div class="timestamp">${date.toLocaleString()}</div>
      <div>${entry.output.length} bytes</div>
    `;
    div.addEventListener('click', () => {
      setOutput(entry.output);
      loadPreview(entry.output);
      historyDrawerEl.classList.remove('open');
    });
    historyListEl.appendChild(div);
  });
}

export function applyTheme(theme: 'dark' | 'light'): void {
  document.documentElement.classList.toggle('light', theme === 'light');
}
