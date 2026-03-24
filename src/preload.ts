// preload.ts — Preload script for Electron contextBridge

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // File system
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  getWorkspaceFolder: () => ipcRenderer.invoke('workspace:getFolder'),
  readDir: (dirPath: string) => ipcRenderer.invoke('fs:readDir', dirPath),
  readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath: string, content: string) =>
    ipcRenderer.invoke('fs:writeFile', filePath, content),
  deleteEntry: (entryPath: string) => ipcRenderer.invoke('fs:delete', entryPath),
  cleanWorkspace: (options?: { dryRun?: boolean }) =>
    ipcRenderer.invoke('fs:cleanWorkspace', options),
  saveFileDialog: (defaultName: string, content: string) =>
    ipcRenderer.invoke('dialog:saveFile', defaultName, content),

  // Auth
  getUser: () => ipcRenderer.invoke('auth:getUser'),

  // Copilot
  listModels: () => ipcRenderer.invoke('copilot:listModels'),
  initCopilot: (githubToken: string) => ipcRenderer.invoke('copilot:init', githubToken),
  implement: (options: { model: string; systemPrompt?: string; userPrompt: string }) =>
    ipcRenderer.invoke('copilot:implement', options),
  stopCopilot: () => ipcRenderer.invoke('copilot:stop'),
  onCopilotChunk: (callback: (chunk: string) => void) => {
    ipcRenderer.on('copilot:chunk', (_event, chunk: string) => callback(chunk));
  },
  onCopilotEvent: (callback: (event: ImplementEvent) => void) => {
    ipcRenderer.on('copilot:event', (_event, data: ImplementEvent) => callback(data));
  },
  removeCopilotListeners: () => {
    ipcRenderer.removeAllListeners('copilot:chunk');
    ipcRenderer.removeAllListeners('copilot:event');
  },

  // Git
  gitStatus: () => ipcRenderer.invoke('git:status'),

  // Terminal
  terminalSpawn: () => ipcRenderer.invoke('terminal:spawn'),
  terminalWrite: (data: string) => ipcRenderer.send('terminal:write', data),
  terminalResize: (cols: number, rows: number) =>
    ipcRenderer.send('terminal:resize', cols, rows),
  terminalKill: () => ipcRenderer.send('terminal:kill'),
  onTerminalData: (callback: (data: string) => void) => {
    ipcRenderer.on('terminal:data', (_event, data: string) => callback(data));
  },
  onTerminalExit: (callback: () => void) => {
    ipcRenderer.on('terminal:exit', () => callback());
  },
  removeTerminalDataListeners: () => {
    ipcRenderer.removeAllListeners('terminal:data');
  },
  removeTerminalExitListeners: () => {
    ipcRenderer.removeAllListeners('terminal:exit');
  },
});

// Listen for folder changes from the main process
ipcRenderer.on('folder:changed', (_event, folder: string) => {
  window.dispatchEvent(new CustomEvent('folder-changed', { detail: folder }));
});
