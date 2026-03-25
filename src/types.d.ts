// Type declarations for the Electron API exposed via preload

interface GitStatusEntry {
  status: string;
  file: string;
}

interface ImplementEvent {
  type: 'log' | 'chunk' | 'tool_start' | 'tool_complete' | 'usage' | 'error' | 'done' | 'files_changed' | 'preview_url' | 'session_start' | 'turn_start' | 'turn_end';
  data?: Record<string, unknown>;
}

interface ModelInfo {
  id: string;
  name: string;
}

interface ListModelsResult {
  ok: boolean;
  models?: ModelInfo[];
  error?: string;
}

interface ElectronAPI {
  // Dialog
  openFolderDialog: () => Promise<string | null>;
  saveFileDialog: (defaultPath?: string) => Promise<string | null>;

  // Workspace
  getWorkspaceFolder: () => Promise<string | null>;
  setWorkspaceFolder: (folder: string) => Promise<void>;

  // File system
  readDir: (dirPath: string) => Promise<Array<{ name: string; isDirectory: boolean }>>;
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, content: string) => Promise<void>;
  deleteEntry: (entryPath: string) => Promise<void>;
  cleanWorkspace: (options?: { dryRun?: boolean }) => Promise<{ ok: boolean; deleted: string[]; error?: string }>;

  // Authentication
  getUser: () => Promise<{ login: string; avatar_url: string } | null>;

  // Copilot
  initCopilot: (githubToken: string) => Promise<{ ok: boolean; error?: string }>;
  implement: (options: { model: string; systemPrompt?: string; userPrompt: string }) => Promise<{ ok: boolean; error?: string }>;
  stopImplement: () => Promise<void>;
  listModels: () => Promise<ListModelsResult>;
  onCopilotChunk: (callback: (chunk: string) => void) => void;
  onCopilotEvent: (callback: (event: ImplementEvent) => void) => void;
  removeCopilotListeners: () => void;

  // Chat
  chat: (options: { model: string; systemPrompt: string; userPrompt: string; conversationHistory: Array<{ role: string; content: string }> }) => Promise<{ ok: boolean; response?: string; error?: string }>;
  stopChat: () => Promise<void>;
  onChatChunk: (callback: (chunk: string) => void) => void;
  onChatEvent: (callback: (event: ImplementEvent) => void) => void;
  removeChatListeners: () => void;

  // Git
  gitStatus: () => Promise<GitStatusEntry[]>;

  // Terminal
  terminalSpawn: () => Promise<{ ok: boolean }>;
  terminalWrite: (data: string) => void;
  terminalResize: (cols: number, rows: number) => void;
  terminalKill: () => void;
  onTerminalData: (callback: (data: string) => void) => void;
  onTerminalExit: (callback: () => void) => void;
  removeTerminalDataListeners: () => void;
  removeTerminalExitListeners: () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
