// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

export interface DirEntry {
  name: string;
  isDirectory: boolean;
}

export interface GitStatusEntry {
  status: string;
  file: string;
}

export interface ServerAPI {
  readDir(relativePath?: string): Promise<DirEntry[]>;
  readFile(relativePath: string): Promise<string>;
  writeFile(relativePath: string, content: string): Promise<void>;
  deleteEntry(relativePath: string): Promise<void>;
  cleanWorkspace(dryRun?: boolean): Promise<{ ok: boolean; deleted: string[]; error?: string }>;
  getWorkspaceFolder(): Promise<string>;
  getUser(): Promise<{ login: string; avatar_url: string } | null>;
  listModels(): Promise<{ ok: boolean; models: Array<{ id: string; name: string }>; error?: string }>;
  initCopilot(): Promise<{ ok: boolean; error?: string }>;
  implement(options: { model: string; systemPrompt?: string; userPrompt: string }): Promise<{ ok: boolean; error?: string }>;
  stopCopilot(): Promise<{ ok: boolean }>;
  gitStatus(): Promise<GitStatusEntry[]>;
  connectTerminal(): TerminalConnection;
  connectChat(): ChatConnection;
  connectCopilot(): CopilotConnection;
}

export interface TerminalConnection {
  send(message: { type: string; data?: string; cols?: number; rows?: number }): void;
  onData(callback: (data: string) => void): void;
  onExit(callback: () => void): void;
  close(): void;
}

export interface ChatConnection {
  send(content: string): void;
  onChunk(callback: (content: string) => void): void;
  onEvent(callback: (data: unknown) => void): void;
  onDone(callback: () => void): void;
  close(): void;
}

export interface CopilotConnection {
  onChunk(callback: (content: string) => void): void;
  onEvent(callback: (data: unknown) => void): void;
  onDone(callback: (ok: boolean, error?: string) => void): void;
  close(): void;
}

export interface ImplementEvent {
  type: 'log' | 'chunk' | 'tool_start' | 'tool_complete' | 'usage' | 'error' | 'done' | 'files_changed' | 'preview_url' | 'session_start' | 'turn_start' | 'turn_end';
  data?: unknown;
}

declare global {
  interface Window {
    serverAPI: ServerAPI;
  }
}
