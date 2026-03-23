// storage.ts - localStorage persistence layer for Blueprint Implementer

const STORAGE_KEYS = {
  THEME: 'blueprint-theme',
  FONT_SIZE: 'blueprint-font-size',
  MODEL: 'blueprint-model',
  HISTORY: 'blueprint-history',
} as const;

export interface HistoryEntry {
  timestamp: number;
  model: string;
  prompt: string;
  output: string;
}

export function getTheme(): 'light' | 'dark' {
  return (localStorage.getItem(STORAGE_KEYS.THEME) as 'light' | 'dark') || 'light';
}

export function setTheme(theme: 'light' | 'dark'): void {
  localStorage.setItem(STORAGE_KEYS.THEME, theme);
  document.documentElement.setAttribute('data-theme', theme);
}

export function getFontSize(): number {
  const size = localStorage.getItem(STORAGE_KEYS.FONT_SIZE);
  return size ? parseInt(size, 10) : 14;
}

export function setFontSize(size: number): void {
  localStorage.setItem(STORAGE_KEYS.FONT_SIZE, String(size));
}

export function getSelectedModel(): string {
  return localStorage.getItem(STORAGE_KEYS.MODEL) || 'claude-opus-4.6-1m';
}

export function setSelectedModel(model: string): void {
  localStorage.setItem(STORAGE_KEYS.MODEL, model);
}

export function getHistory(): HistoryEntry[] {
  const data = localStorage.getItem(STORAGE_KEYS.HISTORY);
  return data ? JSON.parse(data) : [];
}

export function addToHistory(entry: HistoryEntry): void {
  const history = getHistory();
  history.unshift(entry);
  // Keep only last 50 entries
  if (history.length > 50) {
    history.length = 50;
  }
  localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history));
}

export function clearHistory(): void {
  localStorage.removeItem(STORAGE_KEYS.HISTORY);
}

export interface ExportedState {
  theme: 'light' | 'dark';
  fontSize: number;
  model: string;
  history: HistoryEntry[];
}

export function exportState(): ExportedState {
  return {
    theme: getTheme(),
    fontSize: getFontSize(),
    model: getSelectedModel(),
    history: getHistory(),
  };
}

export function importState(state: ExportedState): void {
  if (state.theme) setTheme(state.theme);
  if (state.fontSize) setFontSize(state.fontSize);
  if (state.model) setSelectedModel(state.model);
  if (state.history) {
    localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(state.history));
  }
}
