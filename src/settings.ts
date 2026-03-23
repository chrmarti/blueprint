/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { loadSettings, saveSettings, loadHistory, exportProject, importProject } from './storage';
import type { ImplementationEntry } from './storage';
import { setOutput } from './implementer';
import { loadPreview } from './preview';
import { isSignedIn, getUser, getCopilotToken, type GitHubUser } from './auth';

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
  const modelSelect = document.getElementById('setting-model') as HTMLSelectElement;
  // Set current value; if models are loaded, it'll match; otherwise keep as-is
  if (modelSelect.querySelector(`option[value="${s.model}"]`)) {
    modelSelect.value = s.model;
  }
  (document.getElementById('setting-temp') as HTMLInputElement).value = String(s.temperature);
  (document.getElementById('temp-display') as HTMLSpanElement).textContent = String(s.temperature);
  (document.getElementById('setting-max-tokens') as HTMLInputElement).value = String(s.maxTokens);
  (document.getElementById('setting-font-size') as HTMLInputElement).value = String(s.fontSize);
  updateAuthUI(getUser());

  // Fetch models if signed in
  if (isSignedIn()) {
    loadModels();
  }
}

interface ModelInfo {
  id: string;
  name?: string;
  version?: string;
  model_picker_enabled?: boolean;
  capabilities?: {
    type?: string;
    family?: string;
    limits?: {
      max_prompt_tokens?: number;
      max_output_tokens?: number;
      max_context_window_tokens?: number;
    };
    supports?: {
      streaming?: boolean;
      tool_calls?: boolean;
      vision?: boolean;
      thinking?: boolean;
    };
  };
  [key: string]: unknown;
}

let modelMetadata: ModelInfo[] = [];

async function loadModels(): Promise<void> {
  const modelSelect = document.getElementById('setting-model') as HTMLSelectElement;
  const maxTokensInput = document.getElementById('setting-max-tokens') as HTMLInputElement;
  const currentModel = loadSettings().model;

  if (!window.electronAPI) return;

  try {
    const token = await getCopilotToken();
    const res = await window.electronAPI.copilotModels(token);
    if (res.status >= 400) return;

    const data = JSON.parse(res.body);
    const models: ModelInfo[] = data.data || data.models || data || [];
    if (!Array.isArray(models) || models.length === 0) return;

    modelMetadata = models;

    modelSelect.innerHTML = '';
    for (const m of models) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name || m.id;
      if (m.id === currentModel) opt.selected = true;
      modelSelect.appendChild(opt);
    }

    // If saved model wasn't in list, keep first selected
    if (!modelSelect.value) {
      modelSelect.value = models[0].id;
    }

    // Set max tokens from selected model metadata
    applyModelMaxTokens(modelSelect.value, maxTokensInput);

    // Update max tokens when model selection changes
    modelSelect.addEventListener('change', () => {
      applyModelMaxTokens(modelSelect.value, maxTokensInput);
    });
  } catch {
    // silently keep existing options
  }
}

function applyModelMaxTokens(modelId: string, maxTokensInput: HTMLInputElement): void {
  const meta = modelMetadata.find(m => m.id === modelId);
  const limit = meta?.capabilities?.limits?.max_output_tokens;
  if (limit && limit > 0) {
    maxTokensInput.value = String(limit);
    maxTokensInput.max = String(limit);
  } else {
    // Fallback: no metadata available, leave current value
    console.log(`[Blueprint Implementer] No max_output_tokens in metadata for ${modelId}`, meta?.capabilities);
  }
}

function saveAndClose(): void {
  const s = loadSettings();
  s.model = (document.getElementById('setting-model') as HTMLSelectElement).value;
  s.temperature = parseFloat((document.getElementById('setting-temp') as HTMLInputElement).value);
  s.maxTokens = parseInt((document.getElementById('setting-max-tokens') as HTMLInputElement).value, 10);
  s.fontSize = parseInt((document.getElementById('setting-font-size') as HTMLInputElement).value, 10);
  saveSettings(s);
  closeModal();

  // Apply font size immediately
  const editor = document.getElementById('editor-area') as HTMLTextAreaElement;
  editor.style.fontSize = `${s.fontSize}px`;
}

export function updateAuthUI(user: GitHubUser | null): void {
  const authSection = document.querySelector('.auth-section') as HTMLElement;
  const toolbarAvatar = document.getElementById('toolbar-avatar') as HTMLImageElement;
  const toolbarUser = document.getElementById('toolbar-user') as HTMLElement;

  if (user) {
    if (authSection) {
      authSection.innerHTML = `
        <h3>GitHub Account</h3>
        <div class="auth-user">
          <img src="${user.avatar_url}" alt="avatar" style="width:32px;height:32px;border-radius:50%;">
          <span style="font-weight:600;">${user.login}</span>
        </div>
        <p style="font-size:12px;color:var(--text-muted);">Using Copilot subscription for LLM access.</p>
      `;
    }
    toolbarAvatar.src = user.avatar_url;
    toolbarAvatar.style.display = 'block';
    toolbarUser.textContent = user.login;
    toolbarUser.style.display = 'block';
  } else {
    if (authSection) {
      authSection.innerHTML = `
        <h3>GitHub Account</h3>
        <p style="font-size:13px;color:var(--text-muted);">Not signed in. Set <code>GITHUB_TOKEN</code> or install the <a href="https://cli.github.com" target="_blank">GitHub CLI</a> and run <code>gh auth login</code>.</p>
      `;
    }
    toolbarAvatar.style.display = 'none';
    toolbarUser.style.display = 'none';
  }
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
    historyListEl.innerHTML = '<div style="padding: 12px; color: var(--text-muted);">No implementation history yet.</div>';
    return;
  }

  entries.forEach((entry: ImplementationEntry) => {
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
