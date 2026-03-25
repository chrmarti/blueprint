// Copilot Agent module - shared implementation backend for Electron and CLI
// Uses @github/copilot-sdk to manage the Copilot CLI process

import type { CopilotClient, CopilotSession, SessionEvent, Tool, CopilotClientOptions } from '@github/copilot-sdk';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { z } from 'zod';

export interface ImplementEvent {
  type: 'log' | 'chunk' | 'tool_start' | 'tool_complete' | 'usage' | 'error' | 'done' | 'files_changed' | 'preview_url' | 'session_start' | 'turn_start' | 'turn_end';
  data?: Record<string, unknown>;
}

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

export interface ImplementResult {
  ok: boolean;
  error?: string;
}

export interface ChatOptions {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  workspaceFolder: string;
  conversationHistory: Array<{ role: string; content: string }>;
  onEvent: (event: ImplementEvent) => void;
}

let initOptions: AgentInitOptions | null = null;
let client: CopilotClient | null = null;
let session: CopilotSession | null = null;
let currentWorkspaceFolder: string | null = null;

// System prompt for implementation
const IMPLEMENTATION_SYSTEM_PROMPT = `You are a code generator working in a project workspace. The workspace root contains a blueprint.md file that describes the application to build — its architecture, components, file structure, and behavior. The blueprint may be self-contained or it may reference other markdown documents in the workspace that together make up the full specification. Your job is to read the blueprint and turn it into working code.

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

// System prompt for chat (blueprint editing)
const CHAT_SYSTEM_PROMPT = `You are a helpful assistant for editing and refining markdown blueprints. Your role is to help the user update, restructure, and extend the blueprint.md file and any related markdown files in the workspace.

You have access to file tools to read and write files in the workspace. Focus primarily on:
- blueprint.md (the main blueprint)
- Files under the blueprint/ directory (supporting documentation)

When the user asks to make changes to the blueprint, make the actual file changes using your file tools. Do not just describe what to change - make the changes directly.

Keep your explanations concise. Focus on taking action rather than lengthy explanations.`;

/**
 * Resolve the path to the Copilot CLI binary.
 * Prefers the native binary at @github/copilot-<platform>-<arch>/copilot.
 */
function resolveCLIPath(appRoot: string): string {
  const platform = process.platform;
  const arch = process.arch;
  
  // Map to npm package naming
  let platformName: string;
  let archName: string;
  
  if (platform === 'darwin') {
    platformName = 'darwin';
    archName = arch === 'arm64' ? 'arm64' : 'x64';
  } else if (platform === 'linux') {
    platformName = 'linux';
    archName = arch === 'arm64' ? 'arm64' : 'x64';
  } else if (platform === 'win32') {
    platformName = 'win32';
    archName = arch === 'arm64' ? 'arm64' : 'x64';
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  // Try native binary first
  const nativeBinaryPath = path.join(
    appRoot,
    'node_modules',
    '@github',
    `copilot-${platformName}-${archName}`,
    platform === 'win32' ? 'copilot.exe' : 'copilot'
  );

  if (fs.existsSync(nativeBinaryPath)) {
    return nativeBinaryPath;
  }

  // Fall back to JS entry point
  const jsEntryPath = path.join(appRoot, 'node_modules', '@github', 'copilot', 'npm-loader.js');
  if (fs.existsSync(jsEntryPath)) {
    return jsEntryPath;
  }

  throw new Error('Copilot CLI not found. Run npm install to install @github/copilot.');
}

/**
 * Initialize the agent with GitHub credentials.
 * Does not create the client yet - that's deferred to implement/chat time.
 */
export async function initAgent(options: AgentInitOptions): Promise<void> {
  // Stop existing client if any
  await stopAgent();
  
  initOptions = options;
  console.log('[copilot] Agent initialized');
}

/**
 * Create or reuse the Copilot client for the given workspace folder.
 */
async function ensureClient(workspaceFolder: string): Promise<CopilotClient> {
  if (!initOptions) {
    throw new Error('Agent not initialized. Call initAgent() first.');
  }

  // Recreate client if workspace folder changed
  if (client && currentWorkspaceFolder !== workspaceFolder) {
    console.log('[copilot] Workspace folder changed, recreating client');
    await stopAgent();
  }

  if (!client) {
    const { CopilotClient } = await import('@github/copilot-sdk');
    
    const cliPath = resolveCLIPath(initOptions.appRoot);
    const safehousePath = path.join(initOptions.appRoot, 'scripts', 'safehouse');
    
    let clientConfig: CopilotClientOptions;

    if (initOptions.noSandbox || !fs.existsSync(safehousePath)) {
      // Run without sandbox
      if (!initOptions.noSandbox) {
        console.warn('[copilot] Safehouse not found, running without sandbox');
      }
      clientConfig = {
        cwd: workspaceFolder,
        cliPath,
        githubToken: initOptions.githubToken,
        logLevel: 'info',
      };
    } else {
      // Run with safehouse sandbox
      const electronCachePath = path.join(os.homedir(), 'Library', 'Caches', 'electron');
      const appSupportPath = path.join(os.homedir(), 'Library', 'Application Support', 'blueprint-implementer');
      const extraProfilePath = path.join(initOptions.appRoot, 'scripts', 'electron-safehouse-extra.sb');
      
      clientConfig = {
        cwd: workspaceFolder,
        cliPath: safehousePath,
        cliArgs: [
          '--workdir', workspaceFolder,
          '--add-dirs-ro', initOptions.appRoot,
          '--enable=electron',
          '--add-dirs', `${electronCachePath}:${appSupportPath}`,
          ...(fs.existsSync(extraProfilePath) ? ['--append-profile', extraProfilePath] : []),
          '--env-pass=COPILOT_SDK_AUTH_TOKEN',
          cliPath,
        ],
        githubToken: initOptions.githubToken,
        logLevel: 'info',
      };
    }

    client = new CopilotClient(clientConfig);
    currentWorkspaceFolder = workspaceFolder;
    console.log('[copilot] Client created for workspace:', workspaceFolder);
  }

  return client;
}

/**
 * Run implementation with the Copilot agent.
 */
export async function implementWithAgent(options: ImplementOptions): Promise<ImplementResult> {
  const { model, markdown, workspaceFolder, systemPrompt, onEvent } = options;

  try {
    const copilotClient = await ensureClient(workspaceFolder);
    const { defineTool } = await import('@github/copilot-sdk');

    // Define the open_in_preview_browser tool
    const openPreviewTool = defineTool<{ url: string }>('open_in_preview_browser', {
      description: "Opens a URL in the application's Preview panel (the embedded browser on the right side of the UI). Use this after starting a dev server to show the running application to the user.",
      parameters: z.object({
        url: z.string().describe('The URL to open (e.g., http://localhost:3000)'),
      }),
      handler: async ({ url }) => {
        onEvent({ type: 'preview_url', data: { url } });
        return `Opened ${url} in the Preview panel.`;
      },
    });

    // Combine system prompts
    const fullSystemPrompt = systemPrompt 
      ? `${IMPLEMENTATION_SYSTEM_PROMPT}\n\n${systemPrompt}`
      : IMPLEMENTATION_SYSTEM_PROMPT;

    // Create session
    session = await copilotClient.createSession({
      model,
      streaming: true,
      workingDirectory: workspaceFolder,
      systemMessage: {
        mode: 'append',
        content: fullSystemPrompt,
      },
      tools: [openPreviewTool],
      onPermissionRequest: async () => ({ kind: 'approved' }),
    });

    onEvent({ type: 'session_start', data: { model } });

    // Subscribe to events
    let lastFileChange = 0;
    let lastToolName: string | undefined;
    const unsubscribe = session.on((event: SessionEvent) => {
      switch (event.type) {
        case 'assistant.turn_start':
          onEvent({ type: 'turn_start', data: { turnId: event.data.turnId } });
          break;
        case 'assistant.message_delta':
          onEvent({ type: 'chunk', data: { content: event.data.deltaContent } });
          break;
        case 'assistant.usage':
          onEvent({
            type: 'usage',
            data: {
              inputTokens: event.data.inputTokens,
              outputTokens: event.data.outputTokens,
              duration: event.data.duration,
              model: event.data.model,
            },
          });
          break;
        case 'tool.execution_start':
          lastToolName = event.data.toolName;
          onEvent({
            type: 'tool_start',
            data: {
              toolName: event.data.toolName,
              arguments: event.data.arguments,
            },
          });
          // Signal files changed for file-writing tools
          if (['create', 'edit', 'write_file', 'create_file'].includes(event.data.toolName)) {
            const now = Date.now();
            if (now - lastFileChange > 500) {
              lastFileChange = now;
              onEvent({ type: 'files_changed' });
            }
          }
          break;
        case 'tool.execution_complete':
          onEvent({
            type: 'tool_complete',
            data: {
              toolName: lastToolName,
              success: event.data.success,
            },
          });
          break;
        case 'assistant.turn_end':
          onEvent({ type: 'turn_end', data: { turnId: event.data.turnId } });
          break;
        case 'session.error':
          onEvent({
            type: 'error',
            data: {
              errorType: event.data.errorType,
              message: event.data.message,
            },
          });
          break;
      }
    });

    // Send the implementation request
    const userPrompt = `Implement the following blueprint now. Do not ask for confirmation — start immediately.\n\n${markdown}`;
    
    try {
      await session.sendAndWait({ prompt: userPrompt }, 600000); // 10 minute timeout
      onEvent({ type: 'done', data: { success: true } });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onEvent({ type: 'error', data: { message } });
      return { ok: false, error: message };
    } finally {
      unsubscribe();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[copilot] Implementation failed:', message);
    onEvent({ type: 'error', data: { message } });
    return { ok: false, error: message };
  }
}

/**
 * Run chat with the Copilot agent.
 */
export async function chatWithAgent(options: ChatOptions): Promise<ImplementResult> {
  const { model, systemPrompt, userPrompt, workspaceFolder, conversationHistory, onEvent } = options;

  try {
    const copilotClient = await ensureClient(workspaceFolder);

    // Combine system prompts
    const fullSystemPrompt = systemPrompt || CHAT_SYSTEM_PROMPT;

    // Create session
    const chatSession = await copilotClient.createSession({
      model,
      streaming: true,
      workingDirectory: workspaceFolder,
      systemMessage: {
        mode: 'append',
        content: fullSystemPrompt,
      },
      onPermissionRequest: async () => ({ kind: 'approved' }),
    });

    onEvent({ type: 'session_start', data: { model } });

    let response = '';
    let lastToolName: string | undefined;

    // Subscribe to events
    const unsubscribe = chatSession.on((event: SessionEvent) => {
      switch (event.type) {
        case 'assistant.message_delta':
          response += event.data.deltaContent;
          onEvent({ type: 'chunk', data: { content: event.data.deltaContent } });
          break;
        case 'tool.execution_start':
          lastToolName = event.data.toolName;
          onEvent({
            type: 'tool_start',
            data: {
              toolName: event.data.toolName,
              arguments: event.data.arguments,
            },
          });
          if (['create', 'edit', 'write_file', 'create_file'].includes(event.data.toolName)) {
            onEvent({ type: 'files_changed' });
          }
          break;
        case 'tool.execution_complete':
          onEvent({
            type: 'tool_complete',
            data: {
              toolName: lastToolName,
              success: event.data.success,
            },
          });
          break;
        case 'session.error':
          onEvent({
            type: 'error',
            data: {
              errorType: event.data.errorType,
              message: event.data.message,
            },
          });
          break;
      }
    });

    // Build context message with conversation history
    let contextMessage = '';
    if (conversationHistory.length > 0) {
      contextMessage = 'Previous conversation:\n';
      for (const msg of conversationHistory) {
        contextMessage += `${msg.role}: ${msg.content}\n\n`;
      }
      contextMessage += '\n';
    }

    const fullPrompt = contextMessage + userPrompt;

    try {
      await chatSession.sendAndWait({ prompt: fullPrompt }, 300000); // 5 minute timeout
      onEvent({ type: 'done', data: { success: true, response } });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onEvent({ type: 'error', data: { message } });
      return { ok: false, error: message };
    } finally {
      unsubscribe();
      await chatSession.abort?.();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[copilot] Chat failed:', message);
    onEvent({ type: 'error', data: { message } });
    return { ok: false, error: message };
  }
}

/**
 * Stop the agent and clean up resources.
 */
export async function stopAgent(): Promise<void> {
  if (session) {
    try {
      await session.abort?.();
    } catch {
      // Ignore errors during cleanup
    }
    session = null;
  }

  if (client) {
    try {
      await client.stop?.();
    } catch {
      // Ignore errors during cleanup
    }
    client = null;
  }

  currentWorkspaceFolder = null;
  console.log('[copilot] Agent stopped');
}

/**
 * List available models via the Copilot SDK.
 */
export async function listModels(githubToken: string, appRoot: string): Promise<{ id: string; name: string }[]> {
  const { CopilotClient } = await import('@github/copilot-sdk');
  
  const cliPath = resolveCLIPath(appRoot);
  
  const tempClient = new CopilotClient({
    cwd: process.cwd(),
    cliPath,
    githubToken,
    logLevel: 'error',
  });

  try {
    const models = await tempClient.listModels();
    return models.map((m: { id: string; name?: string }) => ({
      id: m.id,
      name: m.name || m.id,
    }));
  } finally {
    await tempClient.stop?.();
  }
}
