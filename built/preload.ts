/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  readDir: (dirPath: string) => ipcRenderer.invoke('fs:readDir', dirPath),
  readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath: string, content: string) =>
    ipcRenderer.invoke('fs:writeFile', filePath, content),
  getWorkspaceFolder: () => ipcRenderer.invoke('workspace:getFolder'),
  showSaveDialog: (defaultName: string) =>
    ipcRenderer.invoke('dialog:saveFile', defaultName),
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
