declare global {
  interface GitStatusEntry {
    status: string;
    file: string;
  }

  interface ImplementEvent {
    type: 'log' | 'chunk' | 'tool_start' | 'tool_complete' | 'usage' | 'error' | 'done' | 'files_changed' | 'preview_url';
    data: Record<string, unknown>;
  }

  interface HistoryEntry {
    id: string;
    timestamp: number;
    model: string;
    status: 'success' | 'error';
    output: string;
  }

  interface AppSettings {
    theme: 'light' | 'dark';
    fontSize: number;
    model: string;
    temperature: number;
    maxTokens: number;
  }

  interface ElectronAPI {
    // File system
    openFolder(): Promise<string | null>;
    getWorkspaceFolder(): Promise<string | null>;
    readDir(dirPath: string): Promise<{ name: string; isDirectory: boolean }[]>;
    readFile(filePath: string): Promise<string>;
    writeFile(filePath: string, content: string): Promise<void>;
    deleteEntry(entryPath: string): Promise<void>;
    cleanWorkspace(options?: { dryRun?: boolean }): Promise<{ ok: boolean; deleted: string[]; error?: string }>;
    saveFileDialog(defaultName: string, content: string): Promise<string | null>;

    // Auth
    getUser(): Promise<{ login: string; avatar_url: string } | null>;

    // Copilot
    listModels(): Promise<{ ok: boolean; models: { id: string; name: string }[]; error?: string }>;
    initCopilot(githubToken: string): Promise<{ ok: boolean; error?: string }>;
    implement(options: {
      model: string;
      systemPrompt?: string;
      userPrompt: string;
    }): Promise<{ ok: boolean; error?: string }>;
    stopCopilot(): Promise<void>;
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
    onTerminalExit(callback: () => void): void;
    removeTerminalDataListeners(): void;
    removeTerminalExitListeners(): void;
  }

  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
