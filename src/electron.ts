// electron.ts — Electron main process

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  MenuItemConstructorOptions,
} from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { resolveGitHubToken, fetchGitHubUser } from './auth';
import { cleanWorkspace } from './clean';
import { initAgent, implementWithAgent, stopAgent, listModels } from './copilot-agent';

let mainWindow: BrowserWindow | null = null;
let workspaceFolder: string | null = null;
let ptyProcess: ReturnType<typeof import('node-pty').spawn> | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Blueprint Implementer',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Handle command-line folder argument
  const args = process.argv.slice(app.isPackaged ? 1 : 2);
  const folderArg = args.find((a) => !a.startsWith('-') && !a.startsWith('.'));
  if (folderArg) {
    const resolved = path.resolve(folderArg);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      workspaceFolder = resolved;
      mainWindow.setTitle(`Blueprint Implementer — ${path.basename(resolved)}`);
    }
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Folder',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: async () => {
            if (!mainWindow) return;
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ['openDirectory'],
            });
            if (!result.canceled && result.filePaths.length > 0) {
              workspaceFolder = result.filePaths[0];
              mainWindow.setTitle(
                `Blueprint Implementer — ${path.basename(workspaceFolder)}`
              );
              mainWindow.webContents.send('folder:changed', workspaceFolder);
            }
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// IPC Handlers
function registerIpcHandlers(): void {
  // Dialog
  ipcMain.handle('dialog:openFolder', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    });
    if (!result.canceled && result.filePaths.length > 0) {
      workspaceFolder = result.filePaths[0];
      mainWindow.setTitle(
        `Blueprint Implementer — ${path.basename(workspaceFolder)}`
      );
      return workspaceFolder;
    }
    return null;
  });

  ipcMain.handle('dialog:saveFile', async (_event, defaultName: string, content: string) => {
    if (!mainWindow) return null;
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName,
    });
    if (!result.canceled && result.filePath) {
      fs.writeFileSync(result.filePath, content, 'utf-8');
      return result.filePath;
    }
    return null;
  });

  // Workspace
  ipcMain.handle('workspace:getFolder', () => workspaceFolder);

  // File system
  ipcMain.handle('fs:readDir', async (_event, dirPath: string) => {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      return entries
        .filter((e) => e.name !== '.git')
        .map((e) => ({ name: e.name, isDirectory: e.isDirectory() }))
        .sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
    } catch {
      return [];
    }
  });

  ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
    return fs.readFileSync(filePath, 'utf-8');
  });

  ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
  });

  ipcMain.handle('fs:delete', async (_event, entryPath: string) => {
    fs.rmSync(entryPath, { recursive: true, force: true });
  });

  ipcMain.handle('fs:cleanWorkspace', async (_event, options?: { dryRun?: boolean }) => {
    if (!workspaceFolder) {
      return { ok: false, deleted: [], error: 'No workspace folder open.' };
    }
    return cleanWorkspace(workspaceFolder, options);
  });

  // Auth
  ipcMain.handle('auth:getUser', async () => {
    const token = await resolveGitHubToken();
    if (!token) return null;
    return fetchGitHubUser(token);
  });

  // Copilot
  ipcMain.handle('copilot:listModels', async () => {
    const token = await resolveGitHubToken();
    if (!token) {
      return { ok: false, models: [], error: 'No GitHub token available.' };
    }
    return listModels(token, app.getAppPath());
  });

  ipcMain.handle('copilot:init', async (_event, githubToken: string) => {
    try {
      initAgent({ githubToken, appRoot: app.getAppPath() });
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle(
    'copilot:implement',
    async (
      _event,
      options: { model: string; systemPrompt?: string; userPrompt: string }
    ) => {
      if (!workspaceFolder) {
        return { ok: false, error: 'No workspace folder open.' };
      }

      // Auto-initialize agent if needed
      const token = await resolveGitHubToken();
      if (!token) {
        return { ok: false, error: 'No GitHub token available.' };
      }
      initAgent({ githubToken: token, appRoot: app.getAppPath() });

      // Read blueprint.md to append to system prompt
      let blueprintContent = '';
      const bpPath = path.join(workspaceFolder, 'blueprint.md');
      if (fs.existsSync(bpPath)) {
        blueprintContent = fs.readFileSync(bpPath, 'utf-8');
      }

      const systemPrompt = options.systemPrompt
        ? options.systemPrompt + '\n\n' + blueprintContent
        : undefined;

      const result = await implementWithAgent({
        model: options.model,
        markdown: options.userPrompt || blueprintContent,
        workspaceFolder,
        systemPrompt: systemPrompt,
        onEvent: (event) => {
          if (mainWindow) {
            if (event.type === 'chunk') {
              mainWindow.webContents.send('copilot:chunk', event.data.content);
            }
            mainWindow.webContents.send('copilot:event', event);
          }
        },
      });

      return result;
    }
  );

  ipcMain.handle('copilot:stop', async () => {
    stopAgent();
  });

  // Git
  ipcMain.handle('git:status', async () => {
    if (!workspaceFolder) return [];
    return new Promise<{ status: string; file: string }[]>((resolve) => {
      execFile(
        'git',
        ['status', '--porcelain'],
        { cwd: workspaceFolder! },
        (err, stdout) => {
          if (err) {
            resolve([]);
            return;
          }
          const entries = stdout
            .split('\n')
            .filter((line) => line.length > 0)
            .map((line) => ({
              status: line.substring(0, 2).trim(),
              file: line.substring(3),
            }));
          resolve(entries);
        }
      );
    });
  });

  // Terminal
  ipcMain.handle('terminal:spawn', async () => {
    try {
      const nodePty = require('node-pty') as typeof import('node-pty');

      if (ptyProcess) {
        ptyProcess.kill();
        ptyProcess = null;
      }

      const shell = process.env.SHELL || '/bin/zsh';
      const cwd = workspaceFolder || process.env.HOME || '/';

      ptyProcess = nodePty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd,
        env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
      });

      const thisPty = ptyProcess;

      ptyProcess.onData((data: string) => {
        if (mainWindow) {
          mainWindow.webContents.send('terminal:data', data);
        }
      });

      ptyProcess.onExit(() => {
        if (mainWindow) {
          mainWindow.webContents.send('terminal:exit');
        }
        // Only null out if this pty is still the current one
        // (a new spawn may have already replaced it)
        if (ptyProcess === thisPty) {
          ptyProcess = null;
        }
      });

      return { ok: true };
    } catch (err) {
      console.error('Failed to spawn terminal:', err);
      return { ok: false };
    }
  });

  ipcMain.on('terminal:write', (_event, data: string) => {
    if (ptyProcess) {
      ptyProcess.write(data);
    }
  });

  ipcMain.on('terminal:resize', (_event, cols: number, rows: number) => {
    if (ptyProcess) {
      ptyProcess.resize(cols, rows);
    }
  });

  ipcMain.on('terminal:kill', () => {
    if (ptyProcess) {
      ptyProcess.kill();
      ptyProcess = null;
    }
  });
}

// Folder changed listener — respawn terminal
function handleFolderChange(folder: string): void {
  workspaceFolder = folder;
  if (mainWindow) {
    mainWindow.setTitle(`Blueprint Implementer — ${path.basename(folder)}`);
  }
}

app.whenReady().then(() => {
  buildMenu();
  registerIpcHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  if (ptyProcess) {
    ptyProcess.kill();
    ptyProcess = null;
  }
  stopAgent();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
