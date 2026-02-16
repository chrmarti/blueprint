<!--
 Copyright (c) Microsoft Corporation. All rights reserved.
 Licensed under the MIT License. See License.txt in the project root for license information.
-->

# Copilot SDK Integration Notes

Learnings from integrating `@github/copilot-sdk` (v0.1.23) with `@github/copilot` (v0.0.405) CLI.

## Architecture

The SDK wraps the Copilot CLI binary via JSON-RPC. `CopilotClient` manages the CLI child process; `createSession()` creates an agent session within it. The agent has built-in tools (filesystem, shell, etc.) and executes them locally via the CLI process.

## Critical: `systemMessage` Mode

```ts
systemMessage: {
  mode: 'append',  // ✅ preserves SDK's built-in system prompt + tool instructions
  content: '...',
}
```

Using `mode: 'replace'` removes the SDK's entire built-in system prompt, including instructions for how the agent should use its built-in tools (filesystem, shell, etc.). This caused the agent to create a directory (simple operation) but go silent when trying to write files — it lost the tool-usage instructions.

**Always use `mode: 'append'`** unless you are providing a complete replacement system prompt that includes all tool instructions.

## Permission Handling

Without an `onPermissionRequest` handler, ALL tool permission requests return `"denied-no-approval-rule-and-could-not-request-from-user"` — tools are silently denied and the agent gets confused. This is equivalent to the CLI's behavior without `--allow-all-tools`.

```ts
onPermissionRequest: async (request) => {
  return { kind: 'approved' };
}
```

## `send()` vs `sendAndWait()`

- `sendAndWait(prompt, timeout)` — Simple but uses a single fixed timeout. Long-running compilations with active tool calls can exceed it.
- `send(prompt)` + manual idle tracking — Better for our use case. Subscribe to events, reset an activity timer on every event, and resolve on `session.idle` or `session.error`. This way, compilations that produce events stay alive indefinitely, while truly stuck sessions still time out.

```ts
const unsubscribe = session.on((event) => {
  resetTimer();  // any event = still alive
  if (event.type === 'session.idle') settle({ ok: true });
  if (event.type === 'session.error') settle({ ok: false });
});
session.send({ prompt });
```

## Client Options

```ts
new CopilotClient({
  cliPath,           // path to node_modules/.bin/copilot
  cwd,               // working directory for the CLI process
  githubToken,       // GitHub PAT with Copilot access
  autoRestart: true, // auto-recover if CLI process crashes
  logLevel: 'debug', // 'debug' | 'info' | 'warn' | 'error'
})
```

`autoRestart: true` is recommended — if the CLI process crashes, the SDK automatically restarts it.

## Session Options

```ts
client.createSession({
  model: 'claude-opus-4.6',
  streaming: true,
  workingDirectory: '/path/to/project',  // agent's file tools operate here
  systemMessage: { mode: 'append', content: '...' },
  onPermissionRequest: async (req) => ({ kind: 'approved' }),
})
```

`workingDirectory` controls where the agent's file tools (create, edit, bash) operate. Without it, they default to the CLI's `cwd`.

## Event System

Events arrive via `session.on(callback)`. Key events and their timing:

| Event | When | Notes |
|---|---|---|
| `session.start` | Session created | Contains `selectedModel`, `copilotVersion` |
| `assistant.turn_start` | Each turn begins | Contains `turnId` |
| `assistant.message_delta` | Streaming text chunks | Only for conversational text, **not** tool call arguments |
| `assistant.usage` | After each LLM API call | `inputTokens`, `outputTokens`, `duration` |
| `tool.execution_start` | Tool begins executing | `toolName`, `arguments` |
| `tool.execution_complete` | Tool finishes | `success`, `result` |
| `assistant.turn_end` | Turn completes | |
| `session.idle` | All turns done | Use this as the "finished" signal |
| `session.error` | Something broke | `errorType`, `message`, `statusCode` |

### No Streaming for Tool Arguments

When the model generates a large file as a tool call argument (e.g., `create` tool with file content), there are **no intermediate events**. The entire LLM API call completes, then `assistant.usage` + `tool.execution_start` + `tool.execution_complete` fire in rapid succession. A 6934-token file took 84 seconds of silence between `turn_start` and usage/tool events.

`tool.execution_progress` and `tool.execution_partial_result` events exist in the schema but only fire during tool *execution*, not during LLM generation of tool arguments.

## Connection Health

```ts
client.getState()  // 'disconnected' | 'connecting' | 'connected' | 'error'
client.ping(tag)   // verifies CLI process is responsive
```

Useful for heartbeat monitoring during long silent periods. The connection stays healthy even during extended inference — the silence is the model thinking, not a crash.

## Custom Tools (`defineTool`)

The SDK supports `defineTool()` with Zod schemas for parameter validation. We don't use this — we rely entirely on the CLI's built-in tools (filesystem, shell, etc.). Reference implementations (like `hoodini/copilot-sdk-terminal-agent`) use custom tools for specific functionality.

## ESM-Only

The SDK is ESM-only. In CJS contexts (like Electron main process), use dynamic `await import('@github/copilot-sdk')` and `import type` for compile-time types only.

## Reference Implementations

- **Official docs**: `github.com/github/copilot-sdk/blob/main/docs/getting-started.md`
- **Terminal agent**: `github.com/hoodini/copilot-sdk-terminal-agent` — Express server with custom tools, uses `mode: 'append'` and `defineTool()`
- **Comprehensive guide**: `github.com/awesome-copilot` instructions — covers `send()` + idle tracking pattern, multi-turn conversations

**OpenCode** (`anomalyco/opencode`) does **not** use `@github/copilot-sdk`. It has its own provider system built on `@ai-sdk/*` packages and accesses Copilot via direct OpenAI-compatible API calls.
