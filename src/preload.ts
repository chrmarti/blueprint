// preload.ts - Electron preload script for Blueprint Implementer
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Dialog
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  saveFile: (defaultName: string) => ipcRenderer.invoke('dialog:saveFile', defaultName),

  // Workspace
  getWorkspaceFolder: () => ipcRenderer.invoke('workspace:getFolder'),

  // File system
  readDir: (dirPath: string) => ipcRenderer.invoke('fs:readDir', dirPath),
  readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:writeFile', filePath, content),
  deleteEntry: (entryPath: string) => ipcRenderer.invoke('fs:delete', entryPath),
  cleanWorkspace: (options?: { dryRun?: boolean }) => ipcRenderer.invoke('fs:cleanWorkspace', options),

  // Auth
  getUser: () => ipcRenderer.invoke('auth:getUser'),

  // API
  copilotListModels: () => ipcRenderer.invoke('copilot:listModels'),

  // Copilot Agent
  copilotInit: (githubToken: string) => ipcRenderer.invoke('copilot:init', githubToken),
  copilotImplement: (options: { model: string; systemPrompt?: string; userPrompt: string }) =>
    ipcRenderer.invoke('copilot:implement', options),
  copilotStop: () => ipcRenderer.invoke('copilot:stop'),
  onCopilotChunk: (callback: (chunk: string) => void) => {
    ipcRenderer.on('copilot:chunk', (_event, chunk) => callback(chunk));
  },
  onCopilotEvent: (callback: (event: ImplementEvent) => void) => {
    ipcRenderer.on('copilot:event', (_event, event) => callback(event));
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
  terminalResize: (cols: number, rows: number) => ipcRenderer.send('terminal:resize', cols, rows),
  terminalKill: () => ipcRenderer.invoke('terminal:kill'),
  onTerminalData: (callback: (data: string) => void) => {
    ipcRenderer.on('terminal:data', (_event, data) => callback(data));
  },
  onTerminalExit: (callback: (code: number) => void) => {
    ipcRenderer.on('terminal:exit', (_event, code) => callback(code));
  },
  removeTerminalDataListeners: () => {
    ipcRenderer.removeAllListeners('terminal:data');
  },
  removeTerminalExitListeners: () => {
    ipcRenderer.removeAllListeners('terminal:exit');
  },
});

// Listen for workspace changes from main process
ipcRenderer.on('workspace:changed', (_event, folder) => {
  window.dispatchEvent(new CustomEvent('workspace-changed', { detail: folder }));
});

interface ImplementEvent {
  type: string;
  data: Record<string, unknown>;
}
