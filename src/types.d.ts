/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export {};

interface DirEntry {
  name: string;
  isDirectory: boolean;
}

interface ApiResponse {
  status: number;
  body: string;
  error?: string;
}

interface ElectronAPI {
  // File system
  openFolder(): Promise<string | null>;
  readDir(dirPath: string): Promise<DirEntry[]>;
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<void>;
  deleteEntry(targetPath: string): Promise<void>;
  getWorkspaceFolder(): Promise<string | null>;
  showSaveDialog(defaultName: string): Promise<string | null>;

  // API proxy
  authDeviceCode(body: string): Promise<ApiResponse>;
  authToken(body: string): Promise<ApiResponse>;
  githubUser(token: string): Promise<ApiResponse>;
  copilotToken(ghToken: string): Promise<ApiResponse>;
  copilotModels(copilotToken: string): Promise<ApiResponse>;
  // Copilot SDK
  copilotInit(githubToken: string): Promise<{ ok: boolean; error?: string }>;
  copilotImplement(opts: { model: string; userPrompt: string }): Promise<{ ok: boolean; content?: string; error?: string }>;
  copilotStop(): Promise<void>;
  onCopilotChunk(callback: (delta: string) => void): void;
  removeCopilotChunkListeners(): void;
  onCopilotEvent(callback: (event: { type: string; message?: string; data?: any }) => void): void;
  removeCopilotEventListeners(): void;

  // Window events
  onFolderOpened(callback: (folder: string) => void): void;
  onMenuOpenFolder(callback: () => void): void;
  onAutoImplement(callback: (filePath: string | null) => void): void;
  gitStatus(): Promise<{ status: string; file: string }[]>;
  platform: string;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
