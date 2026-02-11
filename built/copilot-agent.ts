/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Shared Copilot agent module — used by both Electron and CLI.
// Uses the Copilot SDK to run the CLI as an agent that creates/updates
// files in the workspace folder.

import * as path from 'node:path';
import * as fs from 'node:fs';

// We import types only at compile time; the SDK is loaded dynamically at runtime (ESM-only).
import type { CopilotClient as CopilotClientType } from '@github/copilot-sdk';

const SYSTEM_PROMPT = `You are a code generator. Your working directory is the project workspace root. The user message contains the contents of the markdown blueprints from the src/ folder. Produce a complete, self-contained implementation and write the output files into the built/ folder (relative to the working directory) using your tools. Do not wrap code in markdown fences — write actual files.

Workspace convention (paths relative to working directory):
- src/   — markdown blueprints (input, already provided in the user message)
- built/ — generated source code (output, written by you)

Write all output files under built/. Create the built/ directory if it does not exist.`;

export interface CompileEvent {
  type: 'log' | 'chunk' | 'tool_start' | 'tool_complete' | 'usage' | 'error' | 'done' | 'files_changed' | 'turn_start' | 'turn_end';
  message?: string;
  data?: any;
}

export type CompileEventHandler = (event: CompileEvent) => void;

let copilotClient: CopilotClientType | null = null;
let activeSessionDestroy: (() => Promise<void>) | null = null;

/**
 * Resolve the path to the copilot CLI binary.
 * When running in Electron, appRoot is app.getAppPath().
 * When running as CLI, appRoot is the project root.
 */
function resolveCLIPath(appRoot: string): string {
  return path.join(appRoot, 'node_modules', '.bin', 'copilot');
}

/**
 * Initialize the Copilot agent client.
 * Must be called before compile(). Safe to call multiple times (restarts the client).
 */
export async function initAgent(opts: {
  githubToken: string;
  appRoot: string;
  workspaceFolder?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    if (copilotClient) {
      await copilotClient.stop().catch(() => {});
      copilotClient = null;
    }

    const { CopilotClient } = await import('@github/copilot-sdk');
    const cliPath = resolveCLIPath(opts.appRoot);
    const cwd = opts.workspaceFolder || process.cwd();
    console.log(`[copilot] Starting CLI from: ${cliPath}`);
    console.log(`[copilot] CLI cwd: ${cwd}`);

    copilotClient = new CopilotClient({
      cliPath,
      cwd,
      githubToken: opts.githubToken,
      useLoggedInUser: false,
      logLevel: 'debug',
      autoRestart: true,
    });
    await copilotClient.start();
    console.log('[copilot] Client started successfully');
    return { ok: true };
  } catch (err) {
    console.error('[copilot] Init error:', (err as Error).message);
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Run the Copilot agent to compile a markdown blueprint.
 * The agent writes files to the workspace folder using its tools.
 * Events are emitted via the handler for streaming progress to UIs.
 */
export async function compileWithAgent(opts: {
  model: string;
  markdown: string;
  workspaceFolder: string;
  systemPrompt?: string;
  onEvent: CompileEventHandler;
}): Promise<{ ok: boolean; error?: string }> {
  if (!copilotClient) {
    return { ok: false, error: 'Copilot agent not initialized. Please sign in.' };
  }

  const systemPrompt = opts.systemPrompt || SYSTEM_PROMPT;
  const userPrompt = opts.markdown;

  try {
    opts.onEvent({ type: 'log', message: `Creating session with model: ${opts.model}, cwd: ${opts.workspaceFolder}` });

    const session = await copilotClient.createSession({
      model: opts.model,
      streaming: true,
      workingDirectory: opts.workspaceFolder,
      systemMessage: {
        mode: 'append' as const,
        content: systemPrompt,
      },
      onPermissionRequest: async (request) => {
        opts.onEvent({ type: 'log', message: `Permission request: ${request.kind} — auto-approving` });
        return { kind: 'approved' as const };
      },
    });

    activeSessionDestroy = () => session.destroy();

    // Track files changed by the agent
    const filesChanged: string[] = [];

    // Listen for all session events
    session.on((event: { type: string; data?: any }) => {
      try {
        switch (event.type) {
          case 'session.start':
            opts.onEvent({
              type: 'log',
              message: `Session started (model: ${event.data?.selectedModel}, copilot: ${event.data?.copilotVersion})`,
            });
            break;

          case 'session.info':
            opts.onEvent({ type: 'log', message: `Info: ${event.data?.message}` });
            break;

          case 'session.error': {
            const code = event.data?.statusCode ? ` [${event.data.statusCode}]` : '';
            const errType = event.data?.errorType ? ` (${event.data.errorType})` : '';
            opts.onEvent({ type: 'error', message: `${event.data?.message}${errType}${code}`, data: event.data });
            break;
          }

          case 'session.idle':
            opts.onEvent({ type: 'log', message: 'Session idle' });
            break;

          case 'session.usage_info':
            opts.onEvent({
              type: 'log',
              message: `Context: ${event.data?.currentTokens}/${event.data?.tokenLimit} tokens, ${event.data?.messagesLength} messages`,
            });
            break;

          case 'session.truncation':
            opts.onEvent({
              type: 'log',
              message: `Truncation: removed ${event.data?.messagesRemovedDuringTruncation} messages (${event.data?.tokensRemovedDuringTruncation} tokens)`,
            });
            break;

          case 'session.compaction_start':
            opts.onEvent({ type: 'log', message: 'Compaction started...' });
            break;

          case 'session.compaction_complete':
            opts.onEvent({
              type: 'log',
              message: `Compaction ${event.data?.success ? 'done' : 'failed'}: ${event.data?.preCompactionTokens} → ${event.data?.postCompactionTokens} tokens`,
            });
            break;

          case 'assistant.turn_start':
            opts.onEvent({ type: 'turn_start', message: `Turn ${event.data?.turnId} started`, data: { turnId: event.data?.turnId } });
            break;

          case 'assistant.turn_end':
            opts.onEvent({ type: 'turn_end', message: `Turn ${event.data?.turnId} ended`, data: { turnId: event.data?.turnId } });
            break;

          case 'assistant.message_delta':
            opts.onEvent({ type: 'chunk', message: event.data?.deltaContent || '' });
            break;

          case 'assistant.reasoning_delta':
            // Reasoning tokens — show as log to indicate the model is thinking
            opts.onEvent({ type: 'log', message: `Thinking...` });
            break;

          case 'assistant.intent':
            opts.onEvent({ type: 'log', message: `Intent: ${event.data?.intent}` });
            break;

          case 'assistant.usage':
            opts.onEvent({
              type: 'usage',
              message: `model: ${event.data?.model}, input: ${event.data?.inputTokens}, output: ${event.data?.outputTokens}, duration: ${event.data?.duration}ms`,
              data: event.data,
            });
            break;

          case 'tool.execution_start': {
            // Summarize arguments for visibility
            let argSummary = '';
            if (event.data?.arguments) {
              try {
                const args = typeof event.data.arguments === 'string'
                  ? JSON.parse(event.data.arguments)
                  : event.data.arguments;
                // Show first key=value or path-like argument
                const keys = Object.keys(args);
                if (keys.length > 0) {
                  const first = String(args[keys[0]]);
                  argSummary = ` → ${first.length > 80 ? first.slice(0, 80) + '…' : first}`;
                }
              } catch {}
            }
            opts.onEvent({
              type: 'tool_start',
              message: `${event.data?.toolName}${argSummary}`,
              data: event.data,
            });
            break;
          }

          case 'tool.execution_progress':
            opts.onEvent({
              type: 'log',
              message: `Tool progress: ${event.data?.progressMessage}`,
            });
            break;

          case 'tool.execution_partial_result':
            opts.onEvent({
              type: 'log',
              message: `Tool partial: ${(event.data?.partialOutput || '').slice(0, 120)}`,
            });
            break;

          case 'tool.execution_complete': {
            opts.onEvent({
              type: 'tool_complete',
              message: `${event.data?.toolName || event.data?.toolCallId} ${event.data?.success ? '✓' : '✗'}`,
              data: event.data,
            });
            break;
          }

          case 'subagent.started':
            opts.onEvent({
              type: 'log',
              message: `Subagent started: ${event.data?.agentDisplayName || event.data?.agentName}`,
            });
            break;

          case 'subagent.completed':
            opts.onEvent({ type: 'log', message: `Subagent completed: ${event.data?.agentName}` });
            break;

          case 'subagent.failed':
            opts.onEvent({ type: 'error', message: `Subagent failed: ${event.data?.agentName}: ${event.data?.error}` });
            break;

          case 'session.model_change':
            opts.onEvent({
              type: 'log',
              message: `Model change: ${event.data?.previousModel} → ${event.data?.newModel}`,
            });
            break;

          case 'session.shutdown':
            opts.onEvent({
              type: 'log',
              message: `Shutdown — requests: ${event.data?.totalPremiumRequests}, api time: ${event.data?.totalApiDurationMs}ms`,
              data: event.data,
            });
            break;

          case 'pending_messages.modified':
            opts.onEvent({ type: 'log', message: `Pending messages modified` });
            break;

          case 'user.message':
            opts.onEvent({ type: 'log', message: `User message sent (${(event.data?.content || '').length} chars)` });
            break;

          case 'assistant.message':
            opts.onEvent({ type: 'log', message: `Assistant message (${(event.data?.content || '').length} chars)` });
            break;

          case 'assistant.reasoning':
            opts.onEvent({ type: 'log', message: `Reasoning complete (${(event.data?.content || '').length} chars)` });
            break;

          default:
            opts.onEvent({ type: 'log', message: `Event: ${event.type}` });
            break;
        }
      } catch (handlerErr) {
        console.error(`[copilot] Event handler error for ${event.type}:`, handlerErr);
      }
    });

    const IDLE_TIMEOUT_MS = 120_000; // timeout if no events for 120s
    opts.onEvent({ type: 'log', message: `Sending prompt (activity timeout: ${IDLE_TIMEOUT_MS / 1000}s)...` });

    // Use send() + manual idle tracking with an activity-based timeout.
    // Instead of a single total timeout, we reset the timer on every event
    // so long-running but active compilations don't get killed.
    const result = await new Promise<{ ok: boolean; error?: string; content?: string }>((resolve) => {
      let activityTimer: ReturnType<typeof setTimeout>;
      let lastResponse: any;
      let settled = false;

      function settle(value: { ok: boolean; error?: string; content?: string }) {
        if (settled) return;
        settled = true;
        clearTimeout(activityTimer);
        unsubActivity();
        resolve(value);
      }

      function resetTimer() {
        clearTimeout(activityTimer);
        activityTimer = setTimeout(() => {
          opts.onEvent({ type: 'error', message: `No activity for ${IDLE_TIMEOUT_MS / 1000}s — timing out` });
          settle({ ok: false, error: `Activity timeout: no events for ${IDLE_TIMEOUT_MS / 1000}s` });
        }, IDLE_TIMEOUT_MS);
      }

      // Subscribe to idle/error for completion, and reset timer on every event
      const unsubActivity = session.on((event: { type: string; data?: any }) => {
        resetTimer(); // any event = still alive
        if (event.type === 'assistant.message') {
          lastResponse = event;
        } else if (event.type === 'session.idle') {
          const content = lastResponse?.data?.content || '';
          settle({ ok: true, content });
        } else if (event.type === 'session.error') {
          settle({ ok: false, error: event.data?.message || 'Session error' });
        }
      });

      resetTimer();

      session.send({ prompt: userPrompt }).catch((err: Error) => {
        settle({ ok: false, error: `send() failed: ${err.message}` });
      });
    });

    if (!result.ok) {
      opts.onEvent({ type: 'error', message: result.error || 'Unknown error' });
      try { await session.destroy(); } catch {}
      activeSessionDestroy = null;
      return { ok: false, error: result.error };
    }

    if (result.content) {
      opts.onEvent({ type: 'log', message: `Final message: ${result.content.length} chars` });
    }

    await session.destroy();
    activeSessionDestroy = null;

    // Check what files were modified in the workspace
    opts.onEvent({ type: 'files_changed', data: { workspaceFolder: opts.workspaceFolder } });
    opts.onEvent({ type: 'done', message: 'Compilation complete' });

    return { ok: true };
  } catch (err) {
    activeSessionDestroy = null;
    const message = (err as Error).message;
    opts.onEvent({ type: 'error', message: `Unexpected error: ${message}` });
    return { ok: false, error: message };
  }
}

/**
 * Stop the Copilot agent client and any active session.
 */
export async function stopAgent(): Promise<void> {
  if (activeSessionDestroy) {
    await activeSessionDestroy().catch(() => {});
    activeSessionDestroy = null;
  }
  if (copilotClient) {
    await copilotClient.stop().catch(() => {});
    copilotClient = null;
  }
}

/**
 * Check if the Copilot client connection is still healthy.
 * Returns state info or null if no client.
 */
export async function checkHealth(): Promise<{ state: string; pingMs?: number; error?: string } | null> {
  if (!copilotClient) return null;
  const state = copilotClient.getState();
  if (state !== 'connected') {
    return { state };
  }
  try {
    const start = Date.now();
    await copilotClient.ping('health');
    return { state, pingMs: Date.now() - start };
  } catch (err) {
    return { state, error: (err as Error).message };
  }
}

/** The default system prompt. Exported for use by callers. */
export { SYSTEM_PROMPT };
