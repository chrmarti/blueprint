/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const STORAGE_PREFIX = 'blueprint-implementer:';

export interface ProjectState {
  markdown: string;
  implementedOutput: string;
  settings: AppSettings;
  history: ImplementationEntry[];
}

export interface AppSettings {
  model: string;
  temperature: number;
  maxTokens: number;
  fontSize: number;
  theme: 'dark' | 'light';
}

export interface ImplementationEntry {
  timestamp: number;
  markdown: string;
  output: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  model: 'claude-opus-4.6',
  temperature: 0,
  maxTokens: 16000,
  fontSize: 14,
  theme: 'dark',
};

function get<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function set(key: string, value: unknown): void {
  localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
}

export function loadMarkdown(): string {
  return get<string>('markdown', '');
}

export function saveMarkdown(md: string): void {
  set('markdown', md);
}

export function loadOutput(): string {
  return get<string>('implementedOutput', '');
}

export function saveOutput(output: string): void {
  set('implementedOutput', output);
}

export function loadSettings(): AppSettings {
  return { ...DEFAULT_SETTINGS, ...get<Partial<AppSettings>>('settings', {}) };
}

export function saveSettings(s: AppSettings): void {
  set('settings', s);
}

export function loadHistory(): ImplementationEntry[] {
  return get<ImplementationEntry[]>('history', []);
}

export function pushHistory(entry: ImplementationEntry): void {
  const history = loadHistory();
  history.unshift(entry);
  if (history.length > 50) history.length = 50; // cap at 50
  set('history', history);
}

export function exportProject(): ProjectState {
  return {
    markdown: loadMarkdown(),
    implementedOutput: loadOutput(),
    settings: loadSettings(),
    history: loadHistory(),
  };
}

export function importProject(state: ProjectState): void {
  saveMarkdown(state.markdown);
  saveOutput(state.implementedOutput);
  saveSettings(state.settings);
  set('history', state.history);
}
