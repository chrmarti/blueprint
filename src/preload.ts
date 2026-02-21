/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // File system
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  readDir: (dirPath: string) => ipcRenderer.invoke('fs:readDir', dirPath),
  readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath: string, content: string) =>
    ipcRenderer.invoke('fs:writeFile', filePath, content),
  deleteEntry: (targetPath: string) => ipcRenderer.invoke('fs:delete', targetPath),
  cleanWorkspace: (opts?: { dryRun?: boolean }) => ipcRenderer.invoke('fs:cleanWorkspace', opts),
  getWorkspaceFolder: () => ipcRenderer.invoke('workspace:getFolder'),
  showSaveDialog: (defaultName: string) =>
    ipcRenderer.invoke('dialog:saveFile', defaultName),

  // API proxy (main process makes HTTPS calls)
  authDeviceCode: (body: string) => ipcRenderer.invoke('api:authDeviceCode', body),
  authToken: (body: string) => ipcRenderer.invoke('api:authToken', body),
  githubUser: (token: string) => ipcRenderer.invoke('api:githubUser', token),
  copilotToken: (ghToken: string) => ipcRenderer.invoke('api:copilotToken', ghToken),
  copilotModels: (copilotToken: string) => ipcRenderer.invoke('api:copilotModels', copilotToken),
  // Copilot SDK
  copilotInit: (githubToken: string) => ipcRenderer.invoke('copilot:init', githubToken),
  copilotImplement: (opts: { model: string; userPrompt: string }) =>
    ipcRenderer.invoke('copilot:implement', opts),
  copilotStop: () => ipcRenderer.invoke('copilot:stop'),
  onCopilotChunk: (callback: (delta: string) => void) => {
    ipcRenderer.on('copilot:chunk', (_event, delta: string) => callback(delta));
  },
  removeCopilotChunkListeners: () => {
    ipcRenderer.removeAllListeners('copilot:chunk');
  },
  onCopilotEvent: (callback: (event: { type: string; message?: string; data?: any }) => void) => {
    ipcRenderer.on('copilot:event', (_event, agentEvent) => callback(agentEvent));
  },
  removeCopilotEventListeners: () => {
    ipcRenderer.removeAllListeners('copilot:event');
  },

  // Window events
  onFolderOpened: (callback: (folder: string) => void) => {
    ipcRenderer.on('workspace:folderOpened', (_event, folder: string) =>
      callback(folder),
    );
  },
  onMenuOpenFolder: (callback: () => void) => {
    ipcRenderer.on('menu:openFolder', () => callback());
  },
  onAutoImplement: (callback: (filePath: string | null) => void) => {
    ipcRenderer.on('command:implement', (_event, filePath: string | null) => callback(filePath));
  },
  gitStatus: () => ipcRenderer.invoke('git:status'),

  // Terminal
  terminalSpawn: () => ipcRenderer.invoke('terminal:spawn'),
  terminalWrite: (data: string) => ipcRenderer.invoke('terminal:write', data),
  terminalResize: (cols: number, rows: number) => ipcRenderer.invoke('terminal:resize', cols, rows),
  terminalKill: () => ipcRenderer.invoke('terminal:kill'),
  onTerminalData: (callback: (data: string) => void) => {
    ipcRenderer.on('terminal:data', (_event, data: string) => callback(data));
  },
  removeTerminalDataListeners: () => {
    ipcRenderer.removeAllListeners('terminal:data');
  },
  onTerminalExit: (callback: () => void) => {
    ipcRenderer.on('terminal:exit', () => callback());
  },
  removeTerminalExitListeners: () => {
    ipcRenderer.removeAllListeners('terminal:exit');
  },

  platform: process.platform,
});
