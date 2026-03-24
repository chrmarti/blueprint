// storage.ts — localStorage persistence layer

const SETTINGS_KEY = 'blueprint-settings';
const HISTORY_KEY = 'blueprint-history';
const OUTPUT_KEY = 'blueprint-output';

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  fontSize: 14,
  model: 'claude-opus-4.6-1m',
  temperature: 0,
  maxTokens: 16384,
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    }
  } catch {
    // ignore parse errors
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // ignore
  }
  return [];
}

export function saveHistory(entries: HistoryEntry[]): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
}

export function addHistoryEntry(entry: HistoryEntry): void {
  const entries = loadHistory();
  entries.unshift(entry);
  if (entries.length > 50) entries.length = 50;
  saveHistory(entries);
}

export function loadOutput(): string {
  return localStorage.getItem(OUTPUT_KEY) || '';
}

export function saveOutput(output: string): void {
  localStorage.setItem(OUTPUT_KEY, output);
}
