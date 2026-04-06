// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

export interface Settings {
  theme: 'light' | 'dark';
  fontSize: number;
  model: string;
  maxTokens: number;
  temperature: number;
}

export interface HistoryEntry {
  id: string;
  timestamp: number;
  model: string;
  prompt: string;
  result: 'success' | 'error';
}

const SETTINGS_KEY = 'blueprint-settings';
const HISTORY_KEY = 'blueprint-history';
const OUTPUT_KEY = 'blueprint-output';

const defaultSettings: Settings = {
  theme: 'dark',
  fontSize: 14,
  model: 'claude-opus-4.6-1m',
  maxTokens: 16000,
  temperature: 0,
};

export function loadSettings(): Settings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      return { ...defaultSettings, ...JSON.parse(stored) };
    }
  } catch {
    // Ignore parse errors
  }
  return { ...defaultSettings };
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadHistory(): HistoryEntry[] {
  try {
    const stored = localStorage.getItem(HISTORY_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore parse errors
  }
  return [];
}

export function saveHistory(history: HistoryEntry[]): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

export function addHistoryEntry(entry: Omit<HistoryEntry, 'id' | 'timestamp'>): HistoryEntry {
  const history = loadHistory();
  const newEntry: HistoryEntry = {
    ...entry,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
  };
  history.unshift(newEntry);
  // Keep only the last 50 entries
  if (history.length > 50) {
    history.length = 50;
  }
  saveHistory(history);
  return newEntry;
}

export function loadOutput(): string {
  return localStorage.getItem(OUTPUT_KEY) || '';
}

export function saveOutput(output: string): void {
  localStorage.setItem(OUTPUT_KEY, output);
}

export function clearOutput(): void {
  localStorage.removeItem(OUTPUT_KEY);
}

export interface ProjectState {
  settings: Settings;
  history: HistoryEntry[];
  output: string;
}

export function exportProjectState(): ProjectState {
  return {
    settings: loadSettings(),
    history: loadHistory(),
    output: loadOutput(),
  };
}

export function importProjectState(state: ProjectState): void {
  if (state.settings) {
    saveSettings(state.settings);
  }
  if (state.history) {
    saveHistory(state.history);
  }
  if (state.output) {
    saveOutput(state.output);
  }
}
