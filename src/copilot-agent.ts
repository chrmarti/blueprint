// copilot-agent.ts — Shared Copilot agent module (Electron & CLI)

import type {
  CopilotClient as CopilotClientType,
  CopilotSession as CopilotSessionType,
  SessionEvent,
} from '@github/copilot-sdk';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export interface InitOptions {
  githubToken: string;
  appRoot: string;
  noSandbox?: boolean;
}

export interface ImplementOptions {
  model: string;
  markdown: string;
  workspaceFolder: string;
  systemPrompt?: string;
  onEvent: (event: ImplementEvent) => void;
}

let initOpts: InitOptions | null = null;
let client: CopilotClientType | null = null;
let session: CopilotSessionType | null = null;
let currentWorkspaceFolder: string | null = null;

function resolveCLIPath(appRoot: string): string {
  const platform = process.platform === 'darwin' ? 'darwin' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const nativePath = path.join(
    appRoot,
    'node_modules',
    '@github',
    `copilot-${platform}-${arch}`,
    'copilot'
  );
  if (fs.existsSync(nativePath)) {
    return nativePath;
  }
  return path.join(appRoot, 'node_modules', '@github', 'copilot', 'npm-loader.js');
}

function resolveSafehousePath(appRoot: string): string | null {
  const paths = [
    path.join(appRoot, 'scripts', 'safehouse'),
    path.join(appRoot, 'cli', 'scripts', 'safehouse'),
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function initAgent(opts: InitOptions): void {
  if (client) {
    client.stop();
    client = null;
    session = null;
    currentWorkspaceFolder = null;
  }
  initOpts = opts;
  console.log('[copilot] Agent initialized');
}

export async function implementWithAgent(opts: ImplementOptions): Promise<{ ok: boolean; error?: string }> {
  if (!initOpts) {
    return { ok: false, error: 'Agent not initialized. Call initAgent() first.' };
  }

  const { CopilotClient, defineTool } = await import('@github/copilot-sdk');
  const { z } = await import('zod');

  const cliPath = resolveCLIPath(initOpts.appRoot);
  const safehousePath = initOpts.noSandbox ? null : resolveSafehousePath(initOpts.appRoot);
  const electronExtraProfilePath = path.join(initOpts.appRoot, 'scripts', 'electron-safehouse-extra.sb');

  // Recreate client if workspace changed
  if (client && currentWorkspaceFolder !== opts.workspaceFolder) {
    console.log('[copilot] Workspace changed, recreating client');
    client.stop();
    client = null;
    session = null;
  }

  if (!client) {
    const electronCachePath = path.join(os.homedir(), 'Library', 'Caches', 'electron');
    const appSupportPath = path.join(os.homedir(), 'Library', 'Application Support', 'blueprint-implementer');

    interface ClientOpts {
      cwd: string;
      cliPath: string;
      cliArgs?: string[];
      githubToken: string;
      autoRestart: boolean;
      logLevel: 'debug' | 'info' | 'warn' | 'error';
    }

    const clientOpts: ClientOpts = {
      cwd: opts.workspaceFolder,
      cliPath: safehousePath || cliPath,
      githubToken: initOpts.githubToken,
      autoRestart: true,
      logLevel: 'debug',
    };

    if (safehousePath) {
      clientOpts.cliArgs = [
        '--workdir', opts.workspaceFolder,
        '--add-dirs-ro', initOpts.appRoot,
        '--enable=electron',
        '--add-dirs', electronCachePath + ':' + appSupportPath,
        '--append-profile', electronExtraProfilePath,
        '--env-pass=COPILOT_SDK_AUTH_TOKEN',
        cliPath,
      ];
    }

    client = new CopilotClient(clientOpts as ConstructorParameters<typeof CopilotClient>[0]);
    currentWorkspaceFolder = opts.workspaceFolder;
    console.log('[copilot] Client created for workspace:', opts.workspaceFolder);
  }

  const systemPrompt = opts.systemPrompt || buildSystemPrompt(opts.markdown);

  // Define the open_in_preview_browser tool
  const previewTool = defineTool('open_in_preview_browser', {
    description: 'Opens a URL in the application\'s Preview panel (the embedded browser on the right side of the UI). Use this after starting a dev server to show the running application to the user.',
    parameters: z.object({
      url: z.string().describe('The URL to open (e.g., http://localhost:3000)'),
    }),
    handler: async ({ url }: { url: string }) => {
      opts.onEvent({ type: 'preview_url', data: { url } });
      return `Opened ${url} in the Preview panel.`;
    },
  });

  try {
    session = await client.createSession({
      model: opts.model,
      streaming: true,
      workingDirectory: opts.workspaceFolder,
      systemMessage: {
        mode: 'append' as const,
        content: systemPrompt,
      },
      onPermissionRequest: async () => ({ kind: 'approved' as const }),
      tools: [previewTool],
    });

    console.log('[copilot] Session created');

    // Subscribe to events
    const unsubscribe = session.on((event: SessionEvent) => {
      handleEvent(event, opts.onEvent);
    });

    try {
      await session.sendAndWait({ prompt: opts.markdown }, 600000);
      opts.onEvent({ type: 'done', data: {} });
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      opts.onEvent({ type: 'error', data: { message } });
      return { ok: false, error: message };
    } finally {
      unsubscribe();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[copilot] Session error:', message);
    return { ok: false, error: message };
  }
}

function handleEvent(event: SessionEvent, onEvent: (e: ImplementEvent) => void): void {
  const type = event.type;
  const data = 'data' in event ? (event as { data: Record<string, unknown> }).data : {};

  switch (type) {
    case 'session.start':
      console.log('[copilot] Session started');
      onEvent({ type: 'log', data: { message: 'session started' } });
      break;
    case 'assistant.turn_start':
      console.log('[copilot] Turn started:', data.turnId);
      onEvent({ type: 'log', data: { message: 'turn started' } });
      break;
    case 'assistant.message_delta':
      // Stream text to output
      onEvent({ type: 'chunk', data: { content: data.deltaContent || '' } });
      break;
    case 'assistant.usage':
      console.log(
        `[copilot] Usage: ${data.model} — ${data.inputTokens} in / ${data.outputTokens} out (${data.duration}ms)`
      );
      onEvent({
        type: 'usage',
        data: {
          inputTokens: data.inputTokens,
          outputTokens: data.outputTokens,
          duration: data.duration,
          model: data.model,
        },
      });
      break;
    case 'tool.execution_start':
      console.log(`[copilot] Tool: ${data.toolName} — ${JSON.stringify(data.arguments).slice(0, 120)}`);
      onEvent({
        type: 'tool_start',
        data: {
          toolName: data.toolName,
          arguments: data.arguments,
        },
      });
      break;
    case 'tool.execution_complete':
      console.log(`[copilot] Tool complete: ${data.success ? 'ok' : 'failed'}`);
      onEvent({
        type: 'tool_complete',
        data: {
          success: data.success,
          toolName: data.toolName || '',
        },
      });
      // Signal files changed after file-writing tools
      onEvent({ type: 'files_changed', data: {} });
      break;
    case 'assistant.turn_end':
      console.log('[copilot] Turn ended:', data.turnId);
      onEvent({ type: 'log', data: { message: 'turn ended' } });
      break;
    case 'session.idle':
      console.log('[copilot] Session idle');
      break;
    case 'session.error': {
      const errMsg = data.message || 'Unknown error';
      console.error('[copilot] Session error:', errMsg);
      onEvent({ type: 'error', data: { message: errMsg } });
      break;
    }
    default:
      // Other events logged but not forwarded
      console.log(`[copilot] Event: ${type}`);
      break;
  }
}

export async function listModels(githubToken: string, appRoot: string): Promise<{ ok: boolean; models: { id: string; name: string }[]; error?: string }> {
  const { CopilotClient } = await import('@github/copilot-sdk');

  const cliPath = resolveCLIPath(appRoot);
  const tmpClient = new CopilotClient({
    cliPath,
    githubToken,
    autoRestart: false,
    logLevel: 'warning',
  } as ConstructorParameters<typeof CopilotClient>[0]);

  try {
    await tmpClient.start();
    const models = await tmpClient.listModels();
    const result = models.map((m: { id: string; name?: string }) => ({
      id: m.id,
      name: m.name || m.id,
    }));
    return { ok: true, models: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, models: [], error: message };
  } finally {
    tmpClient.stop();
  }
}

export function stopAgent(): void {
  if (session) {
    session = null;
  }
  if (client) {
    client.stop();
    client = null;
    currentWorkspaceFolder = null;
  }
  console.log('[copilot] Agent stopped');
}

function buildSystemPrompt(blueprintContent: string): string {
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

You have a custom tool available: open_in_preview_browser. Call it with a URL (e.g., http://localhost:3000) to open that URL in the application's embedded browser. Use this after starting a dev server so the user can see the running application.

${blueprintContent}`;
}
