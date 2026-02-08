/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import https from 'node:https';
import type { CopilotClient as CopilotClientType, AssistantMessageEvent } from '@github/copilot-sdk';

let mainWindow: BrowserWindow | null = null;
let workspaceFolder: string | null = null;
let copilotClient: CopilotClientType | null = null;

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
  'Editor-Version': 'Blueprint-Compiler/0.1.0',
  'Editor-Plugin-Version': 'blueprint-compiler/0.1.0',
  'User-Agent': 'Blueprint-Compiler/0.1.0',
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

  ipcMain.handle('fs:delete', async (_event, targetPath: string) => {
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(targetPath);
    }
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
      'User-Agent': 'Blueprint-Compiler/0.1.0',
    }, null);
  });

  ipcMain.handle('api:copilotToken', async (_event, ghToken: string) => {
    return httpsRequest('GET', 'https://api.github.com/copilot_internal/v2/token', {
      'Authorization': `token ${ghToken}`,
      'Accept': 'application/json',
      'User-Agent': 'Blueprint-Compiler/0.1.0',
    }, null);
  });

  ipcMain.handle('api:copilotModels', async (_event, copilotToken: string) => {
    return httpsRequest('GET', 'https://api.githubcopilot.com/models', {
      'Authorization': `Bearer ${copilotToken}`,
      'Accept': 'application/json',
      ...COPILOT_HEADERS,
    }, null);
  });

  // ── Copilot SDK ─────────────────────────────────────────────────

  ipcMain.handle('copilot:init', async (_event, githubToken: string) => {
    try {
      if (copilotClient) {
        console.log('[copilot] Stopping previous client...');
        await copilotClient.stop().catch(() => {});
        copilotClient = null;
      }
      const { CopilotClient } = await import('@github/copilot-sdk');
      const cliPath = path.join(app.getAppPath(), 'node_modules', '.bin', 'copilot');
      console.log('[copilot] Starting CLI from:', cliPath);
      copilotClient = new CopilotClient({
        cliPath,
        githubToken,
        useLoggedInUser: false,
      });
      await copilotClient.start();
      console.log('[copilot] Client started successfully');
      return { ok: true };
    } catch (err) {
      console.error('[copilot] Init error:', (err as Error).message);
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('copilot:compile', async (_event, opts: {
    model: string;
    systemPrompt: string;
    userPrompt: string;
  }) => {
    if (!copilotClient) {
      return { ok: false, error: 'Copilot SDK not initialized. Please sign in.' };
    }
    try {
      console.log(`[copilot] Creating session with model: ${opts.model}`);
      const session = await copilotClient.createSession({
        model: opts.model,
        streaming: true,
        systemMessage: {
          mode: 'replace',
          content: opts.systemPrompt,
        },
      });

      // Log all session events (except deltas, which are too noisy)
      session.on((event: { type: string; data?: any }) => {
        switch (event.type) {
          case 'session.start':
            console.log(`[copilot] Session started (model: ${event.data?.selectedModel}, copilot: ${event.data?.copilotVersion})`);
            break;
          case 'session.info':
            console.log(`[copilot] Info: ${event.data?.message}`);
            break;
          case 'session.error':
            console.error(`[copilot] Session error: ${event.data?.message}`);
            break;
          case 'session.idle':
            console.log('[copilot] Session idle');
            break;
          case 'assistant.turn_start':
            console.log(`[copilot] Turn started: ${event.data?.turnId}`);
            break;
          case 'assistant.turn_end':
            console.log(`[copilot] Turn ended: ${event.data?.turnId}`);
            break;
          case 'assistant.usage':
            console.log(`[copilot] Usage — model: ${event.data?.model}, input: ${event.data?.inputTokens}, output: ${event.data?.outputTokens}, duration: ${event.data?.duration}ms`);
            break;
          case 'assistant.intent':
            console.log(`[copilot] Intent: ${event.data?.intent}`);
            break;
          case 'tool.execution_start':
            console.log(`[copilot] Tool start: ${event.data?.toolName} (${event.data?.toolCallId})`);
            break;
          case 'tool.execution_complete':
            console.log(`[copilot] Tool complete: ${event.data?.toolCallId} (success: ${event.data?.success})`);
            break;
          case 'session.model_change':
            console.log(`[copilot] Model change: ${event.data?.previousModel} → ${event.data?.newModel}`);
            break;
          case 'session.shutdown':
            console.log(`[copilot] Shutdown — requests: ${event.data?.totalPremiumRequests}, api time: ${event.data?.totalApiDurationMs}ms`);
            break;
          case 'assistant.message_delta':
            // too noisy to log
            break;
          default:
            console.log(`[copilot] Event: ${event.type}`);
        }
      });

      session.on('assistant.message_delta', (event: { data: { deltaContent: string } }) => {
        mainWindow?.webContents.send('copilot:chunk', event.data.deltaContent);
      });
      // Use a 10-minute timeout — large blueprints can take a while to compile
      console.log('[copilot] Sending prompt, waiting for response (timeout: 600s)...');
      const response = await session.sendAndWait({ prompt: opts.userPrompt }, 600_000);
      console.log(`[copilot] Response received (${response?.data?.content?.length || 0} chars)`);
      await session.destroy();
      return { ok: true, content: response?.data?.content || '' };
    } catch (err) {
      console.error('[copilot] Compile error:', (err as Error).message);
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('copilot:stop', async () => {
    if (copilotClient) {
      await copilotClient.stop().catch(() => {});
      copilotClient = null;
    }
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

  // Check for folder argument on command line
  const args = process.argv.slice(app.isPackaged ? 1 : 2);
  const folderArg = args.find(a => !a.startsWith('-'));
  if (folderArg) {
    const resolved = path.resolve(folderArg);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      workspaceFolder = resolved;
    }
  }

  // Default workspace folder for development
  if (!workspaceFolder) {
    const defaultFolder = '/Users/chrmarti/Development/repos/pacman';
    if (fs.existsSync(defaultFolder) && fs.statSync(defaultFolder).isDirectory()) {
      workspaceFolder = defaultFolder;
    }
  }

  setupIPC();
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (!mainWindow) createWindow();
  });
}

app.on('window-all-closed', () => {
  if (copilotClient) copilotClient.stop().catch(() => {});
  if (process.platform !== 'darwin') app.quit();
});

main();
