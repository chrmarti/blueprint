// electron.ts - Electron main process for Blueprint Implementer
import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Import types only at compile time (SDK is ESM-only)
import type { CopilotClient, CopilotSession } from '@github/copilot-sdk';

let mainWindow: BrowserWindow | null = null;
let workspaceFolder: string | null = null;
let pty: import('node-pty').IPty | null = null;

// Copilot agent state
let copilotClient: CopilotClient | null = null;
let copilotSession: CopilotSession | null = null;
let agentInitOptions: { githubToken: string; appRoot: string; noSandbox?: boolean } | null = null;
let lastWorkspaceFolder: string | null = null;

// --- Token Resolution ---
async function resolveGitHubToken(): Promise<string | null> {
  // Check environment variable first
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN;
  }

  // Try gh auth token
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token']);
    const token = stdout.trim();
    if (token) return token;
  } catch {
    // gh CLI not available or not logged in
  }

  return null;
}

// --- HTTP Helpers ---
function httpRequest(url: string, options: https.RequestOptions, body?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// --- Copilot CLI Path Resolution ---
function resolveCLIPath(): string {
  const appRoot = app.getAppPath();
  const platform = process.platform;
  const arch = process.arch;

  // Try native binary first
  const platformMap: Record<string, string> = {
    darwin: 'darwin',
    linux: 'linux',
    win32: 'win32',
  };
  const archMap: Record<string, string> = {
    arm64: 'arm64',
    x64: 'x64',
  };

  const platformName = platformMap[platform];
  const archName = archMap[arch];

  if (platformName && archName) {
    const nativePath = path.join(appRoot, 'node_modules', '@github', `copilot-${platformName}-${archName}`, 'copilot');
    if (fs.existsSync(nativePath)) {
      return nativePath;
    }
  }

  // Fallback to JS entry point
  const jsPath = path.join(appRoot, 'node_modules', '@github', 'copilot', 'npm-loader.js');
  if (fs.existsSync(jsPath)) {
    return jsPath;
  }

  throw new Error('Could not find Copilot CLI binary');
}

// --- Window Management ---
function createWindow() {
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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Update title when workspace changes
  if (workspaceFolder) {
    mainWindow.setTitle(`Blueprint Implementer - ${path.basename(workspaceFolder)}`);
  }
}

function createMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Folder',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow!, {
              properties: ['openDirectory'],
            });
            if (!result.canceled && result.filePaths[0]) {
              workspaceFolder = result.filePaths[0];
              mainWindow?.setTitle(`Blueprint Implementer - ${path.basename(workspaceFolder)}`);
              mainWindow?.webContents.send('workspace:changed', workspaceFolder);
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
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// --- IPC Handlers ---
function setupIpcHandlers() {
  // Dialog handlers
  ipcMain.handle('dialog:openFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
    });
    if (!result.canceled && result.filePaths[0]) {
      workspaceFolder = result.filePaths[0];
      mainWindow?.setTitle(`Blueprint Implementer - ${path.basename(workspaceFolder)}`);
      return workspaceFolder;
    }
    return null;
  });

  ipcMain.handle('dialog:saveFile', async (_event, defaultName: string) => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: defaultName,
    });
    return result.filePath || null;
  });

  // Workspace handlers
  ipcMain.handle('workspace:getFolder', () => workspaceFolder);

  // File system handlers
  ipcMain.handle('fs:readDir', async (_event, dirPath: string) => {
    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      const filtered = entries
        .filter((e) => !e.name.startsWith('.'))
        .map((e) => ({ name: e.name, isDirectory: e.isDirectory() }))
        .sort((a, b) => {
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
          return a.name.localeCompare(b.name);
        });
      return filtered;
    } catch {
      return [];
    }
  });

  ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
    return fs.promises.readFile(filePath, 'utf-8');
  });

  ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, content, 'utf-8');
  });

  ipcMain.handle('fs:delete', async (_event, entryPath: string) => {
    const stat = await fs.promises.stat(entryPath);
    if (stat.isDirectory()) {
      await fs.promises.rm(entryPath, { recursive: true });
    } else {
      await fs.promises.unlink(entryPath);
    }
  });

  ipcMain.handle('fs:cleanWorkspace', async (_event, options?: { dryRun?: boolean }) => {
    if (!workspaceFolder) {
      return { ok: false, error: 'No workspace folder' };
    }

    const blueprintFilesPath = path.join(workspaceFolder, '.blueprintfiles');
    if (!fs.existsSync(blueprintFilesPath)) {
      return { ok: false, error: 'No .blueprintfiles found' };
    }

    try {
      const content = await fs.promises.readFile(blueprintFilesPath, 'utf-8');
      const keepSet = new Set<string>();
      keepSet.add('.blueprintfiles');
      keepSet.add('.git');

      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          // Remove trailing slash
          keepSet.add(trimmed.replace(/\/$/, ''));
        }
      }

      const entries = await fs.promises.readdir(workspaceFolder);
      const toDelete: string[] = [];

      for (const entry of entries) {
        if (!keepSet.has(entry)) {
          toDelete.push(entry);
        }
      }

      if (options?.dryRun) {
        return { ok: true, deleted: toDelete };
      }

      for (const entry of toDelete) {
        const entryPath = path.join(workspaceFolder, entry);
        const stat = await fs.promises.stat(entryPath);
        if (stat.isDirectory()) {
          await fs.promises.rm(entryPath, { recursive: true });
        } else {
          await fs.promises.unlink(entryPath);
        }
      }

      return { ok: true, deleted: toDelete };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Auth handlers
  ipcMain.handle('auth:getUser', async () => {
    const token = await resolveGitHubToken();
    if (!token) return null;

    try {
      const response = await httpRequest('https://api.github.com/user', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'Blueprint-Implementer',
          Accept: 'application/json',
        },
      });

      if (response.status === 200) {
        return JSON.parse(response.body);
      }
    } catch {
      // Auth failed
    }
    return null;
  });

  // Model listing via SDK
  ipcMain.handle('copilot:listModels', async () => {
    const token = await resolveGitHubToken();
    if (!token) {
      return { ok: false, models: [], error: 'No GitHub token' };
    }

    let tempClient: CopilotClient | null = null;
    try {
      const { CopilotClient: CopilotClientCtor } = await import('@github/copilot-sdk');
      const cliPath = resolveCLIPath();
      tempClient = new CopilotClientCtor({
        cliPath,
        cwd: process.cwd(),
        githubToken: token,
        logLevel: 'info',
      });
      await tempClient.start();
      const models = await tempClient.listModels();
      await tempClient.stop();
      return { ok: true, models: models.map((m: { id: string; name: string }) => ({ id: m.id, name: m.name })) };
    } catch (err) {
      if (tempClient) await tempClient.stop().catch(() => {});
      console.error('[copilot] listModels error:', err);
      return { ok: false, models: [], error: String(err) };
    }
  });

  // Copilot Agent handlers
  ipcMain.handle('copilot:init', async (_event, githubToken: string) => {
    try {
      // Stop existing client
      if (copilotClient) {
        await copilotClient.stop();
        copilotClient = null;
      }
      copilotSession = null;
      lastWorkspaceFolder = null;

      // Store init options for later client creation
      agentInitOptions = {
        githubToken,
        appRoot: app.getAppPath(),
      };

      console.log('[copilot] Agent initialized');
      return { ok: true };
    } catch (err) {
      console.error('[copilot] Init error:', err);
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle('copilot:implement', async (_event, options: { model: string; systemPrompt?: string; userPrompt: string }) => {
    if (!agentInitOptions) {
      return { ok: false, error: 'Agent not initialized' };
    }
    if (!workspaceFolder) {
      return { ok: false, error: 'No workspace folder' };
    }

    try {
      // Dynamic import of ESM-only SDK
      const { CopilotClient, defineTool } = await import('@github/copilot-sdk');
      const { z } = await import('zod');

      // Recreate client if workspace changed
      if (!copilotClient || lastWorkspaceFolder !== workspaceFolder) {
        if (copilotClient) {
          await copilotClient.stop();
        }

        const appRoot = agentInitOptions.appRoot;
        const safehousePath = path.join(appRoot, 'scripts', 'safehouse');
        const cliPath = resolveCLIPath();

        if (!fs.existsSync(safehousePath)) {
          throw new Error(`Safehouse not found at ${safehousePath}. Run: npm install`);
        }

        const electronCachePath = path.join(require('os').homedir(), 'Library', 'Caches', 'electron');
        const appSupportPath = path.join(require('os').homedir(), 'Library', 'Application Support', 'blueprint-implementer');
        const electronExtraProfilePath = path.join(appRoot, 'scripts', 'electron-safehouse-extra.sb');

        console.log('[copilot] Creating client with safehouse sandbox');
        console.log('[copilot] CLI path:', cliPath);
        console.log('[copilot] Workspace:', workspaceFolder);

        copilotClient = new CopilotClient({
          cwd: workspaceFolder,
          cliPath: safehousePath,
          cliArgs: [
            '--workdir', workspaceFolder,
            '--add-dirs-ro', appRoot,
            '--enable=electron',
            '--add-dirs', `${electronCachePath}:${appSupportPath}`,
            '--append-profile', electronExtraProfilePath,
            '--env-pass=COPILOT_SDK_AUTH_TOKEN',
            cliPath,
          ],
          githubToken: agentInitOptions.githubToken,
          autoRestart: true,
          logLevel: 'info',
        });

        lastWorkspaceFolder = workspaceFolder;
      }

      // Build system prompt
      let systemPrompt = options.systemPrompt || getDefaultSystemPrompt();

      // Append blueprint.md content if it exists
      const blueprintPath = path.join(workspaceFolder, 'blueprint.md');
      if (fs.existsSync(blueprintPath)) {
        const blueprintContent = await fs.promises.readFile(blueprintPath, 'utf-8');
        systemPrompt += '\n\n' + blueprintContent;
      }

      // Define custom tools
      const openPreviewTool = defineTool('open_in_preview_browser', {
        description: 'Opens a URL in the application\'s Preview panel (the embedded browser on the right side of the UI). Use this after starting a dev server to show the running application to the user.',
        parameters: z.object({
          url: z.string().describe('The URL to open (e.g., http://localhost:3000)'),
        }),
        handler: async ({ url }: { url: string }) => {
          mainWindow?.webContents.send('copilot:event', {
            type: 'preview_url',
            data: { url },
          });
          return `Opened ${url} in the Preview panel.`;
        },
      });

      // Create session
      console.log('[copilot] Creating session with model:', options.model);
      copilotSession = await copilotClient.createSession({
        model: options.model,
        streaming: true,
        workingDirectory: workspaceFolder,
        systemMessage: { mode: 'append', content: systemPrompt },
        tools: [openPreviewTool],
        onPermissionRequest: async () => ({ kind: 'approved' as const }),
      });

      // Subscribe to events
      const unsubscribe = copilotSession.on((event) => {
        const eventType = event.type;
        const eventData = event.data as Record<string, unknown>;

        // Log non-delta events
        if (eventType !== 'assistant.message_delta') {
          console.log(`[copilot] ${eventType}`, eventType.includes('usage') ? eventData : '');
        }

        // Send events to renderer
        switch (eventType) {
          case 'assistant.message_delta':
            mainWindow?.webContents.send('copilot:chunk', eventData.deltaContent || '');
            mainWindow?.webContents.send('copilot:event', { type: 'chunk', data: eventData });
            break;
          case 'tool.execution_start':
            mainWindow?.webContents.send('copilot:event', { type: 'tool_start', data: eventData });
            break;
          case 'tool.execution_complete':
            mainWindow?.webContents.send('copilot:event', { type: 'tool_complete', data: eventData });
            // Check for file changes
            const toolName = eventData.toolName as string;
            if (['create', 'edit', 'bash', 'write_file', 'create_file'].some(t => toolName?.includes(t))) {
              mainWindow?.webContents.send('copilot:event', { type: 'files_changed', data: {} });
            }
            break;
          case 'assistant.usage':
            mainWindow?.webContents.send('copilot:event', { type: 'usage', data: eventData });
            break;
          case 'session.error':
            mainWindow?.webContents.send('copilot:event', { type: 'error', data: eventData });
            break;
          case 'session.idle':
            mainWindow?.webContents.send('copilot:event', { type: 'done', data: {} });
            break;
          default:
            mainWindow?.webContents.send('copilot:event', { type: 'log', data: { message: eventType } });
        }
      });

      // Send the user prompt
      console.log('[copilot] Sending prompt...');
      try {
        await copilotSession.sendAndWait({ prompt: options.userPrompt }, 600000);
        console.log('[copilot] Implementation complete');
        unsubscribe();
        return { ok: true };
      } catch (err) {
        console.error('[copilot] Implementation error:', err);
        unsubscribe();
        return { ok: false, error: String(err) };
      }
    } catch (err) {
      console.error('[copilot] Implementation error:', err);
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle('copilot:stop', async () => {
    if (copilotSession) {
      // Session doesn't have a stop method, just clear reference
      copilotSession = null;
    }
    if (copilotClient) {
      await copilotClient.stop();
      copilotClient = null;
    }
    console.log('[copilot] Agent stopped');
  });

  // Git handlers
  ipcMain.handle('git:status', async () => {
    if (!workspaceFolder) return [];

    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
        cwd: workspaceFolder,
      });

      const entries: Array<{ status: string; file: string }> = [];
      for (const line of stdout.split('\n')) {
        if (line.length >= 3) {
          const status = line.substring(0, 2).trim();
          const file = line.substring(3);
          entries.push({ status, file });
        }
      }
      return entries;
    } catch {
      return [];
    }
  });

  // Terminal handlers
  ipcMain.handle('terminal:spawn', async () => {
    // Kill existing pty
    if (pty) {
      pty.kill();
      pty = null;
    }

    try {
      const nodePty = await import('node-pty');
      const shell = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/bash');
      const cwd = workspaceFolder || process.env.HOME || '/';

      pty = nodePty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd,
        env: { ...process.env, TERM: 'xterm-256color' },
      });

      pty.onData((data) => {
        mainWindow?.webContents.send('terminal:data', data);
      });

      pty.onExit(({ exitCode }) => {
        mainWindow?.webContents.send('terminal:exit', exitCode);
        pty = null;
      });

      return { ok: true };
    } catch (err) {
      console.error('Terminal spawn error:', err);
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.on('terminal:write', (_event, data: string) => {
    pty?.write(data);
  });

  ipcMain.on('terminal:resize', (_event, cols: number, rows: number) => {
    pty?.resize(cols, rows);
  });

  ipcMain.handle('terminal:kill', () => {
    if (pty) {
      pty.kill();
      pty = null;
    }
  });
}

function getDefaultSystemPrompt(): string {
  return `You are a code generator working in a project workspace. The workspace root contains a blueprint.md file that describes the application to build — its architecture, components, file structure, and behavior. The blueprint may be self-contained or it may reference other markdown documents in the workspace that together make up the full specification. Your job is to read the blueprint and turn it into working code.

Follow this workflow:

## Planning & Discovery
1. Start by reading blueprint.md in the workspace root. If it references other markdown files, read those too to get the complete picture.
2. Scan the existing project structure — list directories, check for existing source files, package.json, build scripts, and installed tools. Understand what already exists before writing anything.
3. Form a plan: identify which files need to be created or updated, in what order, and how you will verify the result.

## Implementation
4. Each section in the blueprint describes a module, component, or file to generate. Create or update the source files in the workspace using your file tools. Write complete, working code — not stubs or placeholders.
5. Use strong typing everywhere. Avoid the \`any\` type — use precise types, interfaces, or generics instead.
6. The blueprint defines the project's folder structure, naming conventions, build tools, and processes. Follow those conventions exactly when deciding where to place files and how to structure them.
7. If the project already has existing files, preserve them unless the blueprint explicitly describes replacing them. Merge new code with the existing codebase.

## Verification
8. The generated source must compile and type-check without errors. After writing files, install any needed dependencies (npm install, etc.) and verify both type-checking (e.g., \`npx tsc --noEmit\`) and the build step pass without errors.
9. When installing packages, always use the latest versions available. Do not pin to old versions you may have seen during training — use \`npm install <package>@latest\` or omit version specifiers to get the current release.
10. Write tests for any existing functionality you changed and for any new functionality you implemented. Run all tests and verify they pass. Don't just re-read your own code — execute it.
11. If compilation or tests fail, read the full error output, diagnose the root cause, and fix it. If you find yourself editing the same file repeatedly without progress, step back and reconsider your approach.
12. After the build passes, scan the blueprint documents for sections titled "Verification". For each one, write a test script that verifies the described behavior (e.g., using Playwright for Electron apps, or the project's test framework). Run all verification tests and fix any failures before considering the implementation complete.

## Delivery
13. If the project has a dev server, start it and use the open_in_preview_browser tool to show it in the Preview panel.

You have a custom tool available: open_in_preview_browser. Call it with a URL (e.g., http://localhost:3000) to open that URL in the application's embedded browser. Use this after starting a dev server so the user can see the running application.`;
}

// --- App Lifecycle ---
// Handle --no-sandbox flag before app ready
// process.argv: [electron-binary, main-script, ...user-args]
const userArgs = process.argv.slice(2);
if (userArgs.includes('--no-sandbox')) {
  app.commandLine.appendSwitch('no-sandbox');
}

app.whenReady().then(() => {
  // Parse command line arguments for workspace folder
  // Find the first non-flag argument that is a valid directory
  const folderArg = userArgs.find((arg) => !arg.startsWith('-') && fs.existsSync(arg) && fs.statSync(arg).isDirectory());
  if (folderArg) {
    workspaceFolder = path.resolve(folderArg);
    console.log('[electron] Workspace folder:', workspaceFolder);
  }

  setupIpcHandlers();
  createMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', async () => {
  if (pty) {
    pty.kill();
  }
  if (copilotClient) {
    await copilotClient.stop();
  }
});
