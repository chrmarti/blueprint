// Electron main process - window management, IPC handlers, API proxy

import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import type { IPty } from 'node-pty';
import { initAgent, implementWithAgent, chatWithAgent, stopAgent, listModels, ImplementEvent } from './copilot-agent.js';
import { cleanWorkspace, CleanResult } from './clean.js';

const execFileAsync = promisify(execFile);

let mainWindow: BrowserWindow | null = null;
let workspaceFolder: string | null = null;
let ptyProcess: IPty | null = null;
let githubToken: string | null = null;

// Parse command line arguments
const args = process.argv.slice(2);
const folderArg = args.find(arg => !arg.startsWith('-'));
if (folderArg && fs.existsSync(folderArg)) {
  workspaceFolder = path.resolve(folderArg);
}

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

  // Update title with workspace folder
  if (workspaceFolder) {
    const folderName = path.basename(workspaceFolder);
    mainWindow.setTitle(`Blueprint Implementer - ${folderName}`);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Folder',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: async () => {
            const result = await dialog.showOpenDialog({
              properties: ['openDirectory'],
            });
            if (!result.canceled && result.filePaths.length > 0) {
              workspaceFolder = result.filePaths[0];
              mainWindow?.webContents.send('folder-changed', workspaceFolder);
              const folderName = path.basename(workspaceFolder);
              mainWindow?.setTitle(`Blueprint Implementer - ${folderName}`);
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
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// GitHub token resolution
async function resolveGitHubToken(): Promise<string | null> {
  // Check environment variable first
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN;
  }

  // Fall back to gh auth token
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token']);
    return stdout.trim();
  } catch {
    return null;
  }
}

// Fetch GitHub user
async function fetchGitHubUser(token: string): Promise<{ login: string; avatar_url: string } | null> {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.github.com',
        path: '/user',
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'User-Agent': 'Blueprint-Implementer',
          'Accept': 'application/json',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const user = JSON.parse(data);
            resolve({ login: user.login, avatar_url: user.avatar_url });
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.end();
  });
}

// IPC Handlers
function setupIpcHandlers(): void {
  // Dialog handlers
  ipcMain.handle('dialog:openFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
    if (!result.canceled && result.filePaths.length > 0) {
      workspaceFolder = result.filePaths[0];
      const folderName = path.basename(workspaceFolder);
      mainWindow?.setTitle(`Blueprint Implementer - ${folderName}`);
      return workspaceFolder;
    }
    return null;
  });

  ipcMain.handle('dialog:saveFile', async (_event, defaultPath?: string) => {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultPath || 'output.html',
    });
    return result.canceled ? null : result.filePath;
  });

  // Workspace handlers
  ipcMain.handle('workspace:getFolder', () => workspaceFolder);
  ipcMain.handle('workspace:setFolder', (_event, folder: string) => {
    workspaceFolder = folder;
    const folderName = path.basename(workspaceFolder);
    mainWindow?.setTitle(`Blueprint Implementer - ${folderName}`);
  });

  // File system handlers
  ipcMain.handle('fs:readDir', async (_event, dirPath: string) => {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      return entries
        .filter((e) => e.name !== '.git') // Exclude .git
        .map((e) => ({
          name: e.name,
          isDirectory: e.isDirectory(),
        }));
    } catch (error) {
      console.error('Failed to read directory:', error);
      return [];
    }
  });

  ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
    return fs.readFileSync(filePath, 'utf-8');
  });

  ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
    // Create parent directories if needed
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
  });

  ipcMain.handle('fs:delete', async (_event, entryPath: string) => {
    const stat = fs.statSync(entryPath);
    if (stat.isDirectory()) {
      fs.rmSync(entryPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(entryPath);
    }
  });

  ipcMain.handle('fs:cleanWorkspace', async (_event, options?: { dryRun?: boolean }): Promise<CleanResult> => {
    if (!workspaceFolder) {
      return { ok: false, deleted: [], error: 'No workspace folder open' };
    }
    return cleanWorkspace(workspaceFolder, options);
  });

  // Authentication handlers
  ipcMain.handle('auth:getUser', async () => {
    githubToken = await resolveGitHubToken();
    if (!githubToken) {
      return null;
    }
    return fetchGitHubUser(githubToken);
  });

  // Copilot handlers
  ipcMain.handle('copilot:init', async (_event, token: string) => {
    try {
      await initAgent({
        githubToken: token,
        appRoot: app.getAppPath(),
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('copilot:implement', async (_event, options: { model: string; systemPrompt?: string; userPrompt: string }) => {
    if (!workspaceFolder) {
      return { ok: false, error: 'No workspace folder open' };
    }

    // Ensure we have a token
    if (!githubToken) {
      githubToken = await resolveGitHubToken();
    }
    if (!githubToken) {
      return { ok: false, error: 'Not authenticated' };
    }

    // Initialize agent
    await initAgent({
      githubToken,
      appRoot: app.getAppPath(),
    });

    // Read blueprint.md for system prompt context
    let blueprintContent = '';
    try {
      blueprintContent = fs.readFileSync(path.join(workspaceFolder, 'blueprint.md'), 'utf-8');
    } catch {
      // Blueprint not found
    }

    const systemPrompt = blueprintContent
      ? `${options.systemPrompt || ''}\n\nblueprint.md contents:\n\`\`\`markdown\n${blueprintContent}\n\`\`\``
      : options.systemPrompt;

    const onEvent = (event: ImplementEvent) => {
      if (event.type === 'chunk') {
        mainWindow?.webContents.send('copilot:chunk', event.data?.content || '');
      } else {
        mainWindow?.webContents.send('copilot:event', event);
      }
    };

    const result = await implementWithAgent({
      model: options.model,
      markdown: options.userPrompt,
      workspaceFolder,
      systemPrompt,
      onEvent,
    });

    return result;
  });

  ipcMain.handle('copilot:stop', async () => {
    await stopAgent();
  });

  ipcMain.handle('copilot:listModels', async () => {
    if (!githubToken) {
      githubToken = await resolveGitHubToken();
    }
    if (!githubToken) {
      return { ok: false, error: 'Not authenticated', models: [] };
    }

    try {
      const models = await listModels(githubToken, app.getAppPath());
      return { ok: true, models };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error), models: [] };
    }
  });

  // Chat handlers
  ipcMain.handle('copilot:chat', async (_event, options: { model: string; systemPrompt: string; userPrompt: string; conversationHistory: Array<{ role: string; content: string }> }) => {
    if (!workspaceFolder) {
      return { ok: false, error: 'No workspace folder open' };
    }

    if (!githubToken) {
      githubToken = await resolveGitHubToken();
    }
    if (!githubToken) {
      return { ok: false, error: 'Not authenticated' };
    }

    await initAgent({
      githubToken,
      appRoot: app.getAppPath(),
    });

    const onEvent = (event: ImplementEvent) => {
      if (event.type === 'chunk') {
        mainWindow?.webContents.send('chat:chunk', event.data?.content || '');
      } else {
        mainWindow?.webContents.send('chat:event', event);
      }
    };

    const result = await chatWithAgent({
      model: options.model,
      systemPrompt: options.systemPrompt,
      userPrompt: options.userPrompt,
      workspaceFolder,
      conversationHistory: options.conversationHistory,
      onEvent,
    });

    return result;
  });

  ipcMain.handle('copilot:stopChat', async () => {
    await stopAgent();
  });

  // Git handlers
  ipcMain.handle('git:status', async () => {
    if (!workspaceFolder) return [];

    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
        cwd: workspaceFolder,
      });

      return stdout
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => ({
          status: line.substring(0, 2),
          file: line.substring(3),
        }));
    } catch {
      return [];
    }
  });

  // Terminal handlers
  ipcMain.handle('terminal:spawn', async () => {
    // Kill existing pty
    if (ptyProcess) {
      ptyProcess.kill();
      ptyProcess = null;
    }

    try {
      // Dynamic import for node-pty (native module)
      const pty = await import('node-pty');
      
      const shell = process.env.SHELL || '/bin/zsh';
      const cwd = workspaceFolder || process.env.HOME || '/';

      ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
        },
      });

      ptyProcess.onData((data) => {
        mainWindow?.webContents.send('terminal:data', data);
      });

      ptyProcess.onExit(() => {
        mainWindow?.webContents.send('terminal:exit');
        ptyProcess = null;
      });

      return { ok: true };
    } catch (error) {
      console.error('Failed to spawn terminal:', error);
      return { ok: false };
    }
  });

  ipcMain.on('terminal:write', (_event, data: string) => {
    ptyProcess?.write(data);
  });

  ipcMain.on('terminal:resize', (_event, cols: number, rows: number) => {
    ptyProcess?.resize(cols, rows);
  });

  ipcMain.on('terminal:kill', () => {
    ptyProcess?.kill();
    ptyProcess = null;
  });
}

// App lifecycle
app.whenReady().then(() => {
  createMenu();
  createWindow();
  setupIpcHandlers();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Clean up pty
  if (ptyProcess) {
    ptyProcess.kill();
    ptyProcess = null;
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  await stopAgent();
});
