// Global type declarations for Blueprint Implementer

interface GitStatusEntry {
  status: string;
  file: string;
}

interface CopilotListModelsResponse {
  ok: boolean;
  models: Array<{
    id: string;
    name: string;
  }>;
  error?: string;
}

interface GitHubUser {
  login: string;
  avatar_url: string;
  name?: string;
}

interface ImplementResult {
  ok: boolean;
  error?: string;
}

interface CleanResult {
  ok: boolean;
  deleted?: string[];
  error?: string;
}

interface DirEntry {
  name: string;
  isDirectory: boolean;
}

interface ElectronAPI {
  // Dialog
  openFolder(): Promise<string | null>;
  saveFile(defaultName: string): Promise<string | null>;

  // Workspace
  getWorkspaceFolder(): Promise<string | null>;

  // File system
  readDir(dirPath: string): Promise<DirEntry[]>;
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<void>;
  deleteEntry(entryPath: string): Promise<void>;
  cleanWorkspace(options?: { dryRun?: boolean }): Promise<CleanResult>;

  // Auth
  getUser(): Promise<GitHubUser | null>;

  // API
  copilotListModels(): Promise<CopilotListModelsResponse>;

  // Copilot Agent
  copilotInit(githubToken: string): Promise<{ ok: boolean; error?: string }>;
  copilotImplement(options: {
    model: string;
    systemPrompt?: string;
    userPrompt: string;
  }): Promise<ImplementResult>;
  copilotStop(): Promise<void>;
  onCopilotChunk(callback: (chunk: string) => void): void;
  onCopilotEvent(callback: (event: ImplementEvent) => void): void;
  removeCopilotListeners(): void;

  // Git
  gitStatus(): Promise<GitStatusEntry[]>;

  // Terminal
  terminalSpawn(): Promise<{ ok: boolean }>;
  terminalWrite(data: string): void;
  terminalResize(cols: number, rows: number): void;
  terminalKill(): void;
  onTerminalData(callback: (data: string) => void): void;
  onTerminalExit(callback: (code: number) => void): void;
  removeTerminalDataListeners(): void;
  removeTerminalExitListeners(): void;
}

interface ImplementEvent {
  type: 'log' | 'chunk' | 'tool_start' | 'tool_complete' | 'usage' | 'error' | 'done' | 'files_changed' | 'preview_url';
  data: Record<string, unknown>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
