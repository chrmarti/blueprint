// Preload script - exposes safe IPC methods to renderer

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Dialog
  openFolderDialog: () => ipcRenderer.invoke('dialog:openFolder'),
  saveFileDialog: (defaultPath?: string) => ipcRenderer.invoke('dialog:saveFile', defaultPath),

  // Workspace
  getWorkspaceFolder: () => ipcRenderer.invoke('workspace:getFolder'),
  setWorkspaceFolder: (folder: string) => ipcRenderer.invoke('workspace:setFolder', folder),

  // File system
  readDir: (dirPath: string) => ipcRenderer.invoke('fs:readDir', dirPath),
  readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:writeFile', filePath, content),
  deleteEntry: (entryPath: string) => ipcRenderer.invoke('fs:delete', entryPath),
  cleanWorkspace: (options?: { dryRun?: boolean }) => ipcRenderer.invoke('fs:cleanWorkspace', options),

  // Authentication
  getUser: () => ipcRenderer.invoke('auth:getUser'),

  // Copilot
  initCopilot: (githubToken: string) => ipcRenderer.invoke('copilot:init', githubToken),
  implement: (options: { model: string; systemPrompt?: string; userPrompt: string }) =>
    ipcRenderer.invoke('copilot:implement', options),
  stopImplement: () => ipcRenderer.invoke('copilot:stop'),
  listModels: () => ipcRenderer.invoke('copilot:listModels'),
  onCopilotChunk: (callback: (chunk: string) => void) => {
    ipcRenderer.on('copilot:chunk', (_event, chunk) => callback(chunk));
  },
  onCopilotEvent: (callback: (event: unknown) => void) => {
    ipcRenderer.on('copilot:event', (_event, data) => callback(data));
  },
  removeCopilotListeners: () => {
    ipcRenderer.removeAllListeners('copilot:chunk');
    ipcRenderer.removeAllListeners('copilot:event');
  },

  // Chat
  chat: (options: { model: string; systemPrompt: string; userPrompt: string; conversationHistory: Array<{ role: string; content: string }> }) =>
    ipcRenderer.invoke('copilot:chat', options),
  stopChat: () => ipcRenderer.invoke('copilot:stopChat'),
  onChatChunk: (callback: (chunk: string) => void) => {
    ipcRenderer.on('chat:chunk', (_event, chunk) => callback(chunk));
  },
  onChatEvent: (callback: (event: unknown) => void) => {
    ipcRenderer.on('chat:event', (_event, data) => callback(data));
  },
  removeChatListeners: () => {
    ipcRenderer.removeAllListeners('chat:chunk');
    ipcRenderer.removeAllListeners('chat:event');
  },

  // Git
  gitStatus: () => ipcRenderer.invoke('git:status'),

  // Terminal
  terminalSpawn: () => ipcRenderer.invoke('terminal:spawn'),
  terminalWrite: (data: string) => ipcRenderer.send('terminal:write', data),
  terminalResize: (cols: number, rows: number) => ipcRenderer.send('terminal:resize', cols, rows),
  terminalKill: () => ipcRenderer.send('terminal:kill'),
  onTerminalData: (callback: (data: string) => void) => {
    ipcRenderer.on('terminal:data', (_event, data) => callback(data));
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
