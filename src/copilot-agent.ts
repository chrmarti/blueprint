// copilot-agent.ts - Shared Copilot SDK module for Blueprint Implementer
// Used by both Electron main process and CLI

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Import types only at compile time (SDK is ESM-only)
import type { CopilotClient, CopilotSession, SessionEvent, SessionConfig } from '@github/copilot-sdk';

export interface AgentInitOptions {
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

export interface ImplementEvent {
  type: 'log' | 'chunk' | 'tool_start' | 'tool_complete' | 'usage' | 'error' | 'done' | 'files_changed' | 'preview_url';
  data: Record<string, unknown>;
}

export interface ImplementResult {
  ok: boolean;
  error?: string;
}

let client: CopilotClient | null = null;
let session: CopilotSession | null = null;
let initOptions: AgentInitOptions | null = null;
let lastWorkspaceFolder: string | null = null;

/**
 * Resolves the path to the Copilot CLI native binary.
 */
export function resolveCLIPath(appRoot: string): string {
  const platform = process.platform;
  const arch = process.arch;

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

/**
 * Initializes the agent with credentials and configuration.
 * Does not create the client yet — that happens in implementWithAgent().
 */
export async function initAgent(options: AgentInitOptions): Promise<{ ok: boolean; error?: string }> {
  try {
    // Stop existing client
    if (client) {
      await client.stop();
      client = null;
    }
    session = null;
    lastWorkspaceFolder = null;

    initOptions = options;
    console.log('[copilot] Agent initialized');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * List available models from the Copilot API.
 * Creates a temporary client, queries models, and stops it.
 */
export async function listModels(): Promise<{ id: string; name: string }[]> {
  if (!initOptions) throw new Error('Agent not initialized');

  const sdk = await import('@github/copilot-sdk');
  const { CopilotClient: CopilotClientCtor } = sdk;
  const cliPath = resolveCLIPath(initOptions.appRoot);

  const tempClient = new CopilotClientCtor({
    cliPath,
    cwd: process.cwd(),
    githubToken: initOptions.githubToken,
    logLevel: 'info',
  });
  try {
    await tempClient.start();
    const models = await tempClient.listModels();
    await tempClient.stop();
    return models.map((m: { id: string; name: string }) => ({ id: m.id, name: m.name }));
  } catch (err) {
    await tempClient.stop().catch(() => {});
    throw err;
  }
}

/**
 * Runs implementation using the Copilot SDK agent.
 */
export async function implementWithAgent(options: ImplementOptions): Promise<ImplementResult> {
  if (!initOptions) {
    return { ok: false, error: 'Agent not initialized' };
  }

  const { model, markdown, workspaceFolder, systemPrompt, onEvent } = options;

  try {
    // Dynamic import of ESM-only SDK
    const { CopilotClient: CC, defineTool } = await import('@github/copilot-sdk');
    const { z } = await import('zod');

    // Recreate client if workspace changed
    if (!client || lastWorkspaceFolder !== workspaceFolder) {
      if (client) {
        await client.stop();
      }

      const appRoot = initOptions.appRoot;
      const cliPath = resolveCLIPath(appRoot);

      if (initOptions.noSandbox) {
        // No sandbox - run CLI directly
        console.log('[copilot] Creating client without sandbox');
        client = new CC({
          cwd: workspaceFolder,
          cliPath,
          githubToken: initOptions.githubToken,
          autoRestart: true,
          logLevel: 'info',
        });
      } else {
        // Use safehouse sandbox
        const safehousePath = path.join(appRoot, 'scripts', 'safehouse');
        if (!fs.existsSync(safehousePath)) {
          throw new Error(`Safehouse not found at ${safehousePath}. Run: npm install`);
        }

        const electronCachePath = path.join(os.homedir(), 'Library', 'Caches', 'electron');
        const appSupportPath = path.join(os.homedir(), 'Library', 'Application Support', 'blueprint-implementer');
        const electronExtraProfilePath = path.join(appRoot, 'scripts', 'electron-safehouse-extra.sb');

        console.log('[copilot] Creating client with safehouse sandbox');
        console.log('[copilot] CLI path:', cliPath);
        console.log('[copilot] Workspace:', workspaceFolder);

        client = new CC({
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
          githubToken: initOptions.githubToken,
          autoRestart: true,
          logLevel: 'info',
        });
      }

      lastWorkspaceFolder = workspaceFolder;
    }

    // Build full system prompt
    let fullSystemPrompt = systemPrompt || getDefaultSystemPrompt();
    fullSystemPrompt += '\n\n' + markdown;

    // Define custom tools
    const openPreviewTool = defineTool('open_in_preview_browser', {
      description: "Opens a URL in the application's Preview panel (the embedded browser on the right side of the UI). Use this after starting a dev server to show the running application to the user.",
      parameters: z.object({
        url: z.string().describe('The URL to open (e.g., http://localhost:3000)'),
      }),
      handler: async ({ url }: { url: string }) => {
        onEvent({ type: 'preview_url', data: { url } });
        return `Opened ${url} in the Preview panel.`;
      },
    });

    // Create session
    console.log('[copilot] Creating session with model:', model);
    const sessionConfig: SessionConfig = {
      model,
      streaming: true,
      workingDirectory: workspaceFolder,
      systemMessage: { mode: 'append', content: fullSystemPrompt },
      tools: [openPreviewTool],
      onPermissionRequest: async () => ({ kind: 'approved' as const }),
    };

    session = await client.createSession(sessionConfig);

    // Subscribe to events
    const unsubscribe = session.on((event: SessionEvent) => {
      const eventType = event.type;
      const eventData = (event as { data?: Record<string, unknown> }).data || {};

      // Log non-delta events
      if (eventType !== 'assistant.message_delta') {
        console.log(`[copilot] ${eventType}`, eventType.includes('usage') ? eventData : '');
      }

      // Emit typed events
      switch (eventType) {
        case 'assistant.message_delta':
          onEvent({ type: 'chunk', data: { content: eventData.deltaContent || '' } });
          break;
        case 'tool.execution_start':
          onEvent({ type: 'tool_start', data: eventData });
          break;
        case 'tool.execution_complete':
          onEvent({ type: 'tool_complete', data: eventData });
          // Check for file changes
          const toolName = eventData.toolName as string;
          if (['create', 'edit', 'bash', 'write_file', 'create_file'].some((t) => toolName?.includes(t))) {
            onEvent({ type: 'files_changed', data: {} });
          }
          break;
        case 'assistant.usage':
          onEvent({ type: 'usage', data: eventData });
          break;
        case 'session.error':
          onEvent({ type: 'error', data: eventData });
          break;
        case 'session.idle':
          onEvent({ type: 'done', data: {} });
          break;
        default:
          onEvent({ type: 'log', data: { message: eventType } });
      }
    });

    // Send the user prompt with implementation directive
    const userPrompt = `Implement the following blueprint now. Do not ask for confirmation — start immediately.\n\n${markdown}`;

    console.log('[copilot] Sending prompt...');
    try {
      await session.sendAndWait({ prompt: userPrompt }, 600000);
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
}

/**
 * Stops the active session and client.
 */
export async function stopAgent(): Promise<void> {
  session = null;
  if (client) {
    await client.stop();
    client = null;
  }
  console.log('[copilot] Agent stopped');
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
