// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

import type { CopilotClient, CopilotSession, SessionEvent, SessionConfig } from '@github/copilot-sdk';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';

export interface ImplementEvent {
  type: 'log' | 'chunk' | 'tool_start' | 'tool_complete' | 'usage' | 'error' | 'done' | 'files_changed' | 'preview_url' | 'session_start' | 'turn_start' | 'turn_end';
  data?: Record<string, unknown>;
}

interface InitOptions {
  githubToken: string;
  appRoot: string;
}

interface ImplementOptions {
  model: string;
  markdown?: string;
  workspaceFolder: string;
  systemPrompt?: string;
  onEvent: (event: ImplementEvent) => void;
}

let initOptions: InitOptions | null = null;
let client: CopilotClient | null = null;
let session: CopilotSession | null = null;
let currentWorkspaceFolder: string | null = null;

const SYSTEM_PROMPT = `You are a code generator working in a project workspace. The workspace root contains a blueprint.md file that describes the application to build — its architecture, components, file structure, and behavior. The blueprint may be self-contained or it may reference other markdown documents in the workspace that together make up the full specification. Your job is to read the blueprint and turn it into working code.

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
`;

export function initAgent(options: InitOptions): void {
  if (client) {
    stopAgent();
  }
  initOptions = options;
  console.log('[copilot] Agent initialized');
}

export async function implementWithAgent(options: ImplementOptions): Promise<{ ok: boolean; error?: string }> {
  if (!initOptions) {
    return { ok: false, error: 'Agent not initialized. Call initAgent first.' };
  }

  const { model, workspaceFolder, onEvent } = options;

  try {
    // Import SDK dynamically
    const sdk = await import('@github/copilot-sdk');

    // Resolve CLI path
    const cliPath = resolveCLIPath(initOptions.appRoot);
    console.log('[copilot] Using CLI at:', cliPath);

    // Create or reuse client
    if (!client || currentWorkspaceFolder !== workspaceFolder) {
      if (client) {
        await client.stop();
      }
      
      client = new sdk.CopilotClient({
        cliPath,
        cwd: workspaceFolder,
        githubToken: initOptions.githubToken,
        autoRestart: true,
        logLevel: 'info',
      });

      currentWorkspaceFolder = workspaceFolder;
      console.log('[copilot] Created new client for workspace:', workspaceFolder);
    }

    // Build system prompt with blueprint content
    let fullSystemPrompt = SYSTEM_PROMPT;
    if (options.systemPrompt) {
      fullSystemPrompt = options.systemPrompt;
    }
    
    // Append blueprint.md content if it exists
    const blueprintPath = path.join(workspaceFolder, 'blueprint.md');
    if (fs.existsSync(blueprintPath)) {
      const blueprintContent = fs.readFileSync(blueprintPath, 'utf-8');
      fullSystemPrompt += `\n\n## Current Blueprint\n\n${blueprintContent}`;
    }

    // Create session with tools
    const sessionConfig: SessionConfig = {
      model,
      streaming: true,
      workingDirectory: workspaceFolder,
      systemMessage: {
        mode: 'append',
        content: fullSystemPrompt,
      },
      onPermissionRequest: async () => {
        return { kind: 'approved' };
      },
      tools: [
        sdk.defineTool('open_in_preview_browser', {
          description: "Opens a URL in the application's Preview panel (the embedded browser on the right side of the UI). Use this after starting a dev server to show the running application to the user.",
          parameters: z.object({
            url: z.string().describe('The URL to open (e.g., http://localhost:3000)'),
          }),
          handler: async ({ url }: { url: string }) => {
            onEvent({ type: 'preview_url', data: { url } });
            return `Opened ${url} in the Preview panel.`;
          },
        }),
      ],
    };

    session = await client.createSession(sessionConfig);
    console.log('[copilot] Session created with model:', model);

    // Subscribe to events
    const unsubscribe = session.on((event: SessionEvent) => {
      handleSessionEvent(event, onEvent);
    });

    // Build user prompt
    const userPrompt = options.markdown || 'Implement the blueprint.';
    const prefixedPrompt = `Implement the following blueprint now. Do not ask for confirmation — start immediately.\n\n${userPrompt}`;

    // Send and wait
    try {
      await session.sendAndWait({ prompt: prefixedPrompt }, 600000); // 10 minute timeout
      onEvent({ type: 'done', data: { ok: true } });
      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      onEvent({ type: 'error', data: { message: error } });
      onEvent({ type: 'done', data: { ok: false, error } });
      return { ok: false, error };
    } finally {
      unsubscribe();
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[copilot] Implementation error:', error);
    onEvent({ type: 'error', data: { message: error } });
    return { ok: false, error };
  }
}

function handleSessionEvent(event: SessionEvent, onEvent: (e: ImplementEvent) => void): void {
  const eventType = event.type;
  
  switch (eventType) {
    case 'session.start':
      console.log('[copilot] Session started:', event.data);
      onEvent({ type: 'session_start', data: event.data as Record<string, unknown> });
      break;

    case 'assistant.turn_start':
      console.log('[copilot] Turn started:', event.data);
      onEvent({ type: 'turn_start', data: event.data as Record<string, unknown> });
      break;

    case 'assistant.message_delta':
      // Stream text content (don't log, too noisy)
      const delta = (event.data as { deltaContent?: string })?.deltaContent;
      if (delta) {
        onEvent({ type: 'chunk', data: { content: delta } });
      }
      break;

    case 'tool.execution_start':
      console.log('[copilot] Tool start:', event.data);
      onEvent({
        type: 'tool_start',
        data: event.data as Record<string, unknown>,
      });
      break;

    case 'tool.execution_complete':
      console.log('[copilot] Tool complete:', (event.data as { toolName?: string })?.toolName);
      onEvent({
        type: 'tool_complete',
        data: event.data as Record<string, unknown>,
      });
      // Check if files may have changed
      const toolName = (event.data as { toolName?: string })?.toolName;
      if (toolName && ['create', 'edit', 'bash', 'write'].some(t => toolName.includes(t))) {
        onEvent({ type: 'files_changed' });
      }
      break;

    case 'assistant.usage':
      console.log('[copilot] Usage:', event.data);
      onEvent({
        type: 'usage',
        data: event.data as Record<string, unknown>,
      });
      break;

    case 'assistant.turn_end':
      console.log('[copilot] Turn ended');
      onEvent({ type: 'turn_end', data: event.data as Record<string, unknown> });
      break;

    case 'session.error':
      console.error('[copilot] Session error:', event.data);
      onEvent({
        type: 'error',
        data: event.data as Record<string, unknown>,
      });
      break;

    case 'session.idle':
      console.log('[copilot] Session idle');
      break;

    default:
      // Log other events for debugging
      console.log(`[copilot] Event: ${eventType}`, event.data);
  }
}

export async function stopAgent(): Promise<void> {
  if (session) {
    try {
      await session.destroy();
    } catch {
      // Ignore stop errors
    }
    session = null;
  }
  if (client) {
    try {
      await client.stop();
    } catch {
      // Ignore stop errors
    }
    client = null;
  }
  currentWorkspaceFolder = null;
  console.log('[copilot] Agent stopped');
}

export async function listModels(): Promise<Array<{ id: string; name: string }>> {
  if (!initOptions) {
    throw new Error('Agent not initialized');
  }

  const sdk = await import('@github/copilot-sdk');
  const cliPath = resolveCLIPath(initOptions.appRoot);

  const tempClient = new sdk.CopilotClient({
    cliPath,
    cwd: process.cwd(),
    githubToken: initOptions.githubToken,
    autoRestart: false,
    logLevel: 'warning',
  });

  try {
    await tempClient.start();

    const models = await tempClient.listModels();
    return models.map((m: { id: string; name?: string }) => ({
      id: m.id,
      name: m.name || m.id,
    }));
  } finally {
    await tempClient.stop();
  }
}

function resolveCLIPath(appRoot: string): string {
  // Try platform-specific native binary first
  const platform = process.platform;
  const arch = process.arch;
  
  const platformMap: Record<string, string> = {
    'darwin': 'darwin',
    'linux': 'linux',
    'win32': 'win32',
  };
  
  const archMap: Record<string, string> = {
    'x64': 'x64',
    'arm64': 'arm64',
  };

  const platformName = platformMap[platform];
  const archName = archMap[arch];

  if (platformName && archName) {
    const nativePath = path.join(
      appRoot,
      'node_modules',
      `@github/copilot-${platformName}-${archName}`,
      'copilot'
    );
    if (fs.existsSync(nativePath)) {
      return nativePath;
    }
  }

  // Fall back to JS entry point
  const jsPath = path.join(appRoot, 'node_modules', '@github', 'copilot', 'npm-loader.js');
  if (fs.existsSync(jsPath)) {
    return jsPath;
  }

  throw new Error('Copilot CLI not found. Run npm install first.');
}
