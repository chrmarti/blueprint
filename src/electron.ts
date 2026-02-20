/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { execFile } from 'node:child_process';
import https from 'node:https';
import { initAgent, implementWithAgent, stopAgent, SYSTEM_PROMPT } from './copilot-agent';

let mainWindow: BrowserWindow | null = null;
let workspaceFolder: string | null = null;
let lastGithubToken: string | null = null;

// ── Persist last workspace folder ───────────────────────────────────

function getStatePath(): string {
  return path.join(app.getPath('userData'), 'state.json');
}

function saveLastFolder(): void {
  if (!workspaceFolder) return;
  try {
    fs.writeFileSync(getStatePath(), JSON.stringify({ lastFolder: workspaceFolder }), 'utf-8');
  } catch {}
}

function loadLastFolder(): string | null {
  try {
    const data = JSON.parse(fs.readFileSync(getStatePath(), 'utf-8'));
    if (data.lastFolder && fs.existsSync(data.lastFolder) && fs.statSync(data.lastFolder).isDirectory()) {
      return data.lastFolder;
    }
  } catch {}
  return null;
}

// ── HTTPS request helper ────────────────────────────────────────────

function httpsRequest(
  method: string,
  targetUrl: string,
  headers: Record<string, string>,
  body: string | null,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const reqHeaders: Record<string, string> = { ...headers };
    if (body) reqHeaders['Content-Length'] = Buffer.byteLength(body).toString();

    const req = https.request(
      {
        hostname: parsed.hostname,
        port: 443,
        path: parsed.pathname + parsed.search,
        method,
        headers: reqHeaders,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 200,
            body: Buffer.concat(chunks).toString(),
          });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const COPILOT_HEADERS = {
  'Editor-Version': 'Blueprint-Implementer/0.1.0',
  'Editor-Plugin-Version': 'blueprint-implementer/0.1.0',
  'User-Agent': 'Blueprint-Implementer/0.1.0',
  'Openai-Organization': 'github-copilot',
  'Copilot-Integration-Id': 'vscode-chat',
};

// ── IPC handlers ────────────────────────────────────────────────────

function setupIPC(): void {
  // ── File system ─────────────────────────────────────────────────

  ipcMain.handle('dialog:openFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: 'Open Folder',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    workspaceFolder = result.filePaths[0];
    saveLastFolder();
    mainWindow?.setTitle(`Blueprint Implementer — ${path.basename(workspaceFolder)}`);
    // Reinitialize agent with new workspace folder so its cwd is correct
    if (lastGithubToken) {
      initAgent({
        githubToken: lastGithubToken,
        appRoot: app.getAppPath(),
        workspaceFolder,
      }).catch(err => console.error('[copilot] Reinit on folder change failed:', err));
    }
    return workspaceFolder;
  });

  ipcMain.handle('workspace:getFolder', () => workspaceFolder);

  ipcMain.handle('fs:readDir', async (_event, dirPath: string) => {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      return entries
        .filter(e => !e.name.startsWith('.'))
        .map(e => ({ name: e.name, isDirectory: e.isDirectory() }))
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
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
  });

  ipcMain.handle('fs:delete', async (_event, targetPath: string) => {
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(targetPath);
    }
  });

  ipcMain.handle('fs:cleanWorkspace', async (_event, opts?: { dryRun?: boolean }) => {
    if (!workspaceFolder) return { ok: false, error: 'No workspace folder open' };
    const bpFilePath = path.join(workspaceFolder, '.blueprintfiles');
    if (!fs.existsSync(bpFilePath)) return { ok: false, error: 'No .blueprintfiles found in workspace root' };

    // Parse .blueprintfiles: one relative path per line, # comments, blank lines ignored
    const raw = fs.readFileSync(bpFilePath, 'utf-8');
    const keepSet = new Set<string>();
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      keepSet.add(trimmed.replace(/\/$/, '')); // normalise: strip trailing slash
    }
    // Always keep .blueprintfiles itself and .git
    keepSet.add('.blueprintfiles');
    keepSet.add('.git');

    // Collect root entries to delete
    const entries = fs.readdirSync(workspaceFolder);
    const toDelete: string[] = [];
    for (const name of entries) {
      if (keepSet.has(name)) continue;
      toDelete.push(name);
    }

    if (opts?.dryRun) return { ok: true, toDelete };

    if (toDelete.length === 0) return { ok: true, deleted: [] };

    // Disable asar handling so .asar files inside node_modules etc. are
    // deleted as plain files rather than being treated as directories.
    const prevAsar = process.noAsar;
    process.noAsar = true;
    try {
      for (const name of toDelete) {
        const full = path.join(workspaceFolder, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          fs.rmSync(full, { recursive: true, force: true });
        } else {
          fs.unlinkSync(full);
        }
      }
    } finally {
      process.noAsar = prevAsar;
    }
    return { ok: true, deleted: toDelete };
  });

  ipcMain.handle('dialog:saveFile', async (_event, defaultName: string) => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: workspaceFolder
        ? path.join(workspaceFolder, defaultName)
        : defaultName,
      filters: [
        { name: 'HTML', extensions: ['html'] },
        { name: 'Markdown', extensions: ['md'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    return result.canceled ? null : result.filePath;
  });

  // ── API proxy (replaces the HTTP server) ────────────────────────

  ipcMain.handle('api:authDeviceCode', async (_event, body: string) => {
    return httpsRequest('POST', 'https://github.com/login/device/code', {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    }, body);
  });

  ipcMain.handle('api:authToken', async (_event, body: string) => {
    return httpsRequest('POST', 'https://github.com/login/oauth/access_token', {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    }, body);
  });

  ipcMain.handle('api:githubUser', async (_event, token: string) => {
    return httpsRequest('GET', 'https://api.github.com/user', {
      'Authorization': `token ${token}`,
      'Accept': 'application/json',
      'User-Agent': 'Blueprint-Implementer/0.1.0',
    }, null);
  });

  ipcMain.handle('api:copilotToken', async (_event, ghToken: string) => {
    return httpsRequest('GET', 'https://api.github.com/copilot_internal/v2/token', {
      'Authorization': `token ${ghToken}`,
      'Accept': 'application/json',
      'User-Agent': 'Blueprint-Implementer/0.1.0',
    }, null);
  });

  ipcMain.handle('api:copilotModels', async (_event, copilotToken: string) => {
    return httpsRequest('GET', 'https://api.githubcopilot.com/models', {
      'Authorization': `Bearer ${copilotToken}`,
      'Accept': 'application/json',
      ...COPILOT_HEADERS,
    }, null);
  });

  // ── Copilot Agent ────────────────────────────────────────────────

  ipcMain.handle('copilot:init', async (_event, githubToken: string) => {
    lastGithubToken = githubToken;
    return initAgent({
      githubToken,
      appRoot: app.getAppPath(),
      workspaceFolder: workspaceFolder || undefined,
    });
  });

  ipcMain.handle('copilot:implement', async (_event, opts: {
    model: string;
    userPrompt: string;
  }) => {
    const folder = workspaceFolder || process.cwd();
    console.log(`[copilot] Implement request — model: ${opts.model}, workspace: ${folder}`);

    // Include blueprint.md content in the system prompt so the agent has
    // project context without needing a tool call first (matches CLI behavior).
    // The default SYSTEM_PROMPT from copilot-agent.ts is used as the base;
    // we only build a custom one here to append blueprint.md content.
    let systemPrompt: string | undefined;
    const blueprintPath = path.join(folder, 'blueprint.md');
    if (fs.existsSync(blueprintPath)) {
      try {
        const blueprintContent = fs.readFileSync(blueprintPath, 'utf-8');
        systemPrompt = SYSTEM_PROMPT + `\n\nBelow is the project\'s blueprint.md from the workspace root:\n\n${blueprintContent}`;
      } catch {}
    }

    return implementWithAgent({
      model: opts.model,
      markdown: opts.userPrompt,
      workspaceFolder: folder,
      systemPrompt,
      onEvent: (event) => {
        // Relay all events to the renderer
        mainWindow?.webContents.send('copilot:event', event);
        // Also relay chunks for backward-compat streaming
        if (event.type === 'chunk') {
          mainWindow?.webContents.send('copilot:chunk', event.message);
        }
        // Log to terminal
        if (event.type !== 'chunk') {
          const prefix = `[copilot] ${event.type}`;
          if (event.type === 'error') {
            console.error(`${prefix}: ${event.message}`);
          } else {
            console.log(`${prefix}: ${event.message}`);
          }
        }
      },
    });
  });

  ipcMain.handle('copilot:stop', async () => {
    await stopAgent();
  });

  // ── Git ──────────────────────────────────────────────────────────

  ipcMain.handle('git:status', async () => {
    if (!workspaceFolder) return [];
    return new Promise<{ status: string; file: string }[]>((resolve) => {
      execFile('git', ['status', '--porcelain'], { cwd: workspaceFolder! }, (err, stdout) => {
        if (err) { resolve([]); return; }
        const entries = stdout.split('\n').filter(Boolean).map(line => ({
          status: line.slice(0, 2),
          file: line.slice(3),
        }));
        resolve(entries);
      });
    });
  });
}

// ── Application menu ────────────────────────────────────────────────

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' as const },
            { type: 'separator' as const },
            { role: 'services' as const },
            { type: 'separator' as const },
            { role: 'hide' as const },
            { role: 'hideOthers' as const },
            { role: 'unhide' as const },
            { type: 'separator' as const },
            { role: 'quit' as const },
          ],
        }]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Folder…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => mainWindow?.webContents.send('menu:openFolder'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
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
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Window creation ─────────────────────────────────────────────────

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: workspaceFolder
      ? `Blueprint Implementer — ${path.basename(workspaceFolder)}`
      : 'Blueprint Implementer',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.webContents.on('did-finish-load', () => {
    if (workspaceFolder) {
      mainWindow?.webContents.send('workspace:folderOpened', workspaceFolder);
    }
  });
}

// ── App lifecycle ───────────────────────────────────────────────────

async function main(): Promise<void> {
  await app.whenReady();

  // Check for folder argument and implement command on command line
  const args = process.argv.slice(app.isPackaged ? 1 : 2);
  let autoImplementFile: string | null = null;
  let implementMode = false;

  for (const arg of args) {
    if (arg === 'implement') {
      implementMode = true;
      continue;
    }
    if (arg.startsWith('-')) continue;
    const resolved = path.resolve(arg);
    if (!fs.existsSync(resolved)) continue;
    if (fs.statSync(resolved).isDirectory()) {
      workspaceFolder = resolved;
    } else if (fs.statSync(resolved).isFile()) {
      autoImplementFile = resolved;
      // Infer workspace folder from file's directory if not set
      if (!workspaceFolder) workspaceFolder = path.dirname(resolved);
    }
  }

  // Default workspace folder: restore last opened
  if (!workspaceFolder) {
    workspaceFolder = loadLastFolder();
  }
  if (workspaceFolder) {
    saveLastFolder();
  }

  if (implementMode) {
    console.log(`[main] Implement mode enabled${autoImplementFile ? ` — file: ${autoImplementFile}` : ''}`);
  }

  setupIPC();
  buildMenu();
  createWindow();

  // Send auto-implement command after the renderer is ready
  if (implementMode) {
    mainWindow?.webContents.on('did-finish-load', () => {
      // Give the renderer time to init auth and restore session
      setTimeout(() => {
        mainWindow?.webContents.send('command:implement', autoImplementFile);
      }, 2000);
    });
  }

  app.on('activate', () => {
    if (!mainWindow) createWindow();
  });
}

app.on('window-all-closed', () => {
  stopAgent().catch(() => {});
  if (process.platform !== 'darwin') app.quit();
});

main();
