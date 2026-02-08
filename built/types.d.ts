/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export {};

interface DirEntry {
  name: string;
  isDirectory: boolean;
}

interface ElectronAPI {
  openFolder(): Promise<string | null>;
  readDir(dirPath: string): Promise<DirEntry[]>;
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<void>;
  getWorkspaceFolder(): Promise<string | null>;
  showSaveDialog(defaultName: string): Promise<string | null>;
  onFolderOpened(callback: (folder: string) => void): void;
  onMenuOpenFolder(callback: () => void): void;
  platform: string;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
