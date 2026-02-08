/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';

let mainWindow: BrowserWindow | null = null;
let workspaceFolder: string | null = null;
let serverPort = 0;

const DIST = __dirname;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.map': 'application/json',
  '.ico': 'image/x-icon',
};

// ── HTTP helpers ────────────────────────────────────────────────────

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function proxyRequest(
  method: string,
  targetUrl: string,
  headers: Record<string, string>,
  body: string | null,
  res: http.ServerResponse,
  stream = false,
): void {
  const parsed = new URL(targetUrl);
  const reqHeaders: Record<string, string> = { ...headers };
  if (body) reqHeaders['Content-Length'] = Buffer.byteLength(body).toString();

  const proxyReq = https.request(
    {
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method,
      headers: reqHeaders,
    },
    (proxyRes) => {
      if (stream) {
        res.writeHead(proxyRes.statusCode || 200, {
          'Content-Type': proxyRes.headers['content-type'] || 'text/event-stream',
          'Cache-Control': 'no-cache',
        });
        proxyRes.pipe(res);
      } else {
        const chunks: Buffer[] = [];
        proxyRes.on('data', (c: Buffer) => chunks.push(c));
        proxyRes.on('end', () => {
          res.writeHead(proxyRes.statusCode || 200, {
            'Content-Type': 'application/json',
          });
          res.end(Buffer.concat(chunks).toString());
        });
      }
    },
  );

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
    }
    res.end(JSON.stringify({ error: err.message }));
  });

  if (body) proxyReq.write(body);
  proxyReq.end();
}

// ── Embedded HTTP server (static files + API proxy) ─────────────────

function startServer(): Promise<number> {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', 'http://localhost');

      // ── API proxy routes ────────────────────────────────────────
      if (url.pathname.startsWith('/api/')) {
        const body = req.method === 'POST' ? await readBody(req) : null;

        if (url.pathname === '/api/auth/device-code' && req.method === 'POST') {
          proxyRequest('POST', 'https://github.com/login/device/code', {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          }, body, res);
          return;
        }

        if (url.pathname === '/api/auth/token' && req.method === 'POST') {
          proxyRequest('POST', 'https://github.com/login/oauth/access_token', {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          }, body, res);
          return;
        }

        if (url.pathname === '/api/github/user' && req.method === 'GET') {
          proxyRequest('GET', 'https://api.github.com/user', {
            'Authorization': req.headers['authorization'] || '',
            'Accept': 'application/json',
            'User-Agent': 'Blueprint-Compiler/0.1.0',
          }, null, res);
          return;
        }

        if (url.pathname === '/api/copilot/token' && req.method === 'GET') {
          proxyRequest('GET', 'https://api.github.com/copilot_internal/v2/token', {
            'Authorization': req.headers['authorization'] || '',
            'Accept': 'application/json',
            'User-Agent': 'Blueprint-Compiler/0.1.0',
          }, null, res);
          return;
        }

        if (url.pathname === '/api/copilot/models' && req.method === 'GET') {
          proxyRequest('GET', 'https://api.githubcopilot.com/models', {
            'Authorization': req.headers['authorization'] || '',
            'Accept': 'application/json',
            'Editor-Version': 'Blueprint-Compiler/0.1.0',
            'Editor-Plugin-Version': 'blueprint-compiler/0.1.0',
            'User-Agent': 'Blueprint-Compiler/0.1.0',
            'Openai-Organization': 'github-copilot',
            'Copilot-Integration-Id': 'vscode-chat',
          }, null, res);
          return;
        }

        if (url.pathname === '/api/copilot/chat' && req.method === 'POST') {
          proxyRequest('POST', 'https://api.githubcopilot.com/chat/completions', {
            'Authorization': req.headers['authorization'] || '',
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
            'Editor-Version': 'Blueprint-Compiler/0.1.0',
            'Editor-Plugin-Version': 'blueprint-compiler/0.1.0',
            'User-Agent': 'Blueprint-Compiler/0.1.0',
            'Openai-Organization': 'github-copilot',
            'Copilot-Integration-Id': 'vscode-chat',
          }, body, res, true);
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unknown API route' }));
        return;
      }

      // ── Static files ────────────────────────────────────────────
      const filePath = path.join(DIST, url.pathname === '/' ? 'index.html' : url.pathname);
      const ext = path.extname(filePath);

      try {
        const content = fs.readFileSync(filePath);
        res.writeHead(200, {
          'Content-Type': MIME[ext] || 'application/octet-stream',
          'Cache-Control': 'no-cache',
        });
        res.end(content);
      } catch {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      console.log(`Embedded server on port ${addr.port}`);
      resolve(addr.port);
    });
  });
}

// ── IPC handlers ────────────────────────────────────────────────────

function setupIPC(): void {
  ipcMain.handle('dialog:openFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: 'Open Folder',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    workspaceFolder = result.filePaths[0];
    mainWindow?.setTitle(`Blueprint Compiler — ${path.basename(workspaceFolder)}`);
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
      ? `Blueprint Compiler — ${path.basename(workspaceFolder)}`
      : 'Blueprint Compiler',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);
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

  // Check for folder argument on command line
  const args = process.argv.slice(app.isPackaged ? 1 : 2);
  const folderArg = args.find(a => !a.startsWith('-'));
  if (folderArg) {
    const resolved = path.resolve(folderArg);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      workspaceFolder = resolved;
    }
  }

  serverPort = await startServer();
  setupIPC();
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (!mainWindow) createWindow();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

main();
