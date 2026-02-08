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
  getWorkspaceFolder: () => ipcRenderer.invoke('workspace:getFolder'),
  showSaveDialog: (defaultName: string) =>
    ipcRenderer.invoke('dialog:saveFile', defaultName),

  // API proxy (main process makes HTTPS calls)
  authDeviceCode: (body: string) => ipcRenderer.invoke('api:authDeviceCode', body),
  authToken: (body: string) => ipcRenderer.invoke('api:authToken', body),
  githubUser: (token: string) => ipcRenderer.invoke('api:githubUser', token),
  copilotToken: (ghToken: string) => ipcRenderer.invoke('api:copilotToken', ghToken),
  copilotModels: (copilotToken: string) => ipcRenderer.invoke('api:copilotModels', copilotToken),
  chatStream: (copilotToken: string, body: string) =>
    ipcRenderer.invoke('api:chatStream', copilotToken, body),
  onChatChunk: (callback: (chunk: string) => void) => {
    ipcRenderer.on('api:chatChunk', (_event, chunk: string) => callback(chunk));
  },
  removeChatChunkListeners: () => {
    ipcRenderer.removeAllListeners('api:chatChunk');
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
  platform: process.platform,
});
