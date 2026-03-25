// Storage module - localStorage persistence layer

const STORAGE_KEYS = {
  SETTINGS: 'blueprint-settings',
  HISTORY: 'blueprint-history',
  LAST_FOLDER: 'blueprint-last-folder',
} as const;

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
  workspaceFolder: string;
  model: string;
  success: boolean;
  outputSize: number;
}

const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  fontSize: 14,
  model: 'claude-opus-4.6-1m',
  maxTokens: 16384,
  temperature: 0,
};

export function loadSettings(): Settings {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    }
  } catch {
    console.error('Failed to load settings from localStorage');
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  } catch {
    console.error('Failed to save settings to localStorage');
  }
}

export function loadHistory(): HistoryEntry[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.HISTORY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    console.error('Failed to load history from localStorage');
  }
  return [];
}

export function saveHistory(history: HistoryEntry[]): void {
  try {
    // Keep only the last 50 entries
    const trimmed = history.slice(-50);
    localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(trimmed));
  } catch {
    console.error('Failed to save history to localStorage');
  }
}

export function addHistoryEntry(entry: Omit<HistoryEntry, 'id' | 'timestamp'>): void {
  const history = loadHistory();
  history.push({
    ...entry,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
  });
  saveHistory(history);
}

export function getLastFolder(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.LAST_FOLDER);
  } catch {
    return null;
  }
}

export function setLastFolder(folder: string): void {
  try {
    localStorage.setItem(STORAGE_KEYS.LAST_FOLDER, folder);
  } catch {
    console.error('Failed to save last folder to localStorage');
  }
}

export function exportProjectState(): string {
  const settings = loadSettings();
  const history = loadHistory();
  return JSON.stringify({ settings, history, exportedAt: new Date().toISOString() }, null, 2);
}

export function importProjectState(json: string): void {
  try {
    const data = JSON.parse(json);
    if (data.settings) {
      saveSettings({ ...DEFAULT_SETTINGS, ...data.settings });
    }
    if (data.history && Array.isArray(data.history)) {
      saveHistory(data.history);
    }
  } catch (e) {
    throw new Error('Invalid project state JSON');
  }
}
