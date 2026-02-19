<!--
 Copyright (c) Microsoft Corporation. All rights reserved.
 Licensed under the MIT License. See License.txt in the project root for license information.
-->

# Agent Harness

The Copilot SDK agent runs with a set of custom tools defined by the host application. These tools extend the agent's built-in capabilities (filesystem, shell, etc.) with application-specific actions.

## Custom Tools

### `open_in_preview_browser`

Opens a URL in the application's Preview panel — the embedded browser on the right side of the UI.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `url` | string | yes | The URL to open (e.g., `http://localhost:3000`) |

**Behavior:**

- Sets the Preview panel's iframe `src` to the given URL.
- Reveals the Preview panel if it is collapsed.
- Returns a confirmation string to the agent (e.g., `Opened http://localhost:3000 in the Preview panel.`).

**Use case:** After the agent starts a dev server via the shell tool, it calls `open_in_preview_browser` to show the running application to the user without requiring manual navigation.

**Implementation:** Defined in `copilot-agent.ts` via the SDK's `defineTool()` helper with a raw JSON schema for parameters. The tool's handler emits a `preview_url` event through the `onEvent` callback, which the Electron main process relays to the renderer via IPC (`copilot:event`). The renderer's `implementer.ts` handles the event by calling `loadPreviewUrl()` from `preview.ts` and un-collapsing the preview panel.

## System Prompt

The system prompt is appended to the SDK's built-in prompt (using `mode: 'append'`) and includes:

1. The base role definition: code generator operating in the project workspace root, following `blueprint.md` conventions.
2. A description of the `open_in_preview_browser` tool and when to use it.
3. The contents of `blueprint.md` from the workspace root (injected by `electron.ts` at implement time, if the file exists).

```
You are a code generator working in a project workspace. The workspace root contains a blueprint.md file that describes the application to build — its architecture, components, file structure, and behavior. The blueprint may be self-contained or it may reference other markdown documents in the workspace that together make up the full specification. Your job is to read the blueprint and turn it into working code:

1. Start by reading blueprint.md in the workspace root. If it references other markdown files, read those too to get the complete picture.
2. Each section in the blueprint describes a module, component, or file to generate. Create or update the source files in the workspace using your file tools. Write complete, working code — not stubs or placeholders.
3. The blueprint defines the project's folder structure, naming conventions, build tools, and processes. Follow those conventions exactly when deciding where to place files and how to structure them.
4. If the project already has existing files, preserve them unless the blueprint explicitly describes replacing them. Merge new code with the existing codebase.
5. The generated source must compile without errors. After writing files, install any needed dependencies (npm install, etc.) and verify the project builds successfully if a build step is defined.
6. If the project has a dev server, start it and use the open_in_preview_browser tool to show it in the Preview panel.

You have a custom tool available: open_in_preview_browser. Call it with a URL (e.g., http://localhost:3000) to open that URL in the application's embedded browser. Use this after starting a dev server so the user can see the running application.
```

## Copilot Agent (Shared Module)

The `copilot-agent.ts` module is the shared implementation backend, used by both the Electron main process and the standalone CLI. It wraps the Copilot SDK:

- `initAgent({ githubToken, appRoot })` — Dynamically imports `@github/copilot-sdk` (ESM-only, loaded via `await import()`), creates a `CopilotClient` pointing to the CLI binary, and starts it. Safe to call multiple times (restarts the client).
- `implementWithAgent({ model, markdown, workspaceFolder, systemPrompt?, onEvent })` — Creates a streaming session with `environment: { cwd: workspaceFolder }` so the agent's file tools operate in the project folder. Attaches a wildcard event listener that emits typed `ImplementEvent`s (`log`, `chunk`, `tool_start`, `tool_complete`, `usage`, `error`, `done`, `files_changed`). Calls `sendAndWait()` with a 600-second timeout. Returns `{ ok, error? }`.
- `stopAgent()` — Destroys the active session and stops the client.

The module uses `import type` for compile-time SDK types and `await import('@github/copilot-sdk')` at runtime, since the SDK is ESM-only and the Electron main process is bundled as CJS.

## Copilot SDK IPC (Electron)

The Electron main process delegates to the shared agent module via IPC:

- `copilot:init(githubToken)` — Calls `initAgent()` with the GitHub token and `app.getAppPath()`. Returns `{ ok, error? }`.
- `copilot:implement({ model, systemPrompt, userPrompt })` — Calls `implementWithAgent()` and relays events to the renderer: `copilot:chunk` for text deltas (backward-compatible streaming) and `copilot:event` for structured agent events (tool calls, usage, errors, files_changed). Returns `{ ok, error? }` on completion.
- `copilot:stop` — Calls `stopAgent()` to clean up the session and client.

## Logging

All Copilot SDK activity is logged to the launch terminal (stdout/stderr) with a `[copilot]` prefix. A wildcard event listener on each session logs:

- Client lifecycle: init, start, stop
- Session events: `session.start`, `session.info`, `session.error`, `session.idle`, `session.model_change`, `session.shutdown`
- Turn progress: `assistant.turn_start`, `assistant.turn_end`, `assistant.intent`
- Tool calls: `tool.execution_start`, `tool.execution_complete`
- Token usage: `assistant.usage` (model, input/output tokens, duration)
- Final response size in characters

`assistant.message_delta` events are excluded from logging (too noisy).

## Event Flow

When the agent calls `open_in_preview_browser`:

1. The tool handler in `copilot-agent.ts` emits a `preview_url` event with `{ url }` data.
2. `electron.ts` relays the event to the renderer via `mainWindow.webContents.send('copilot:event', event)`.
3. `implementer.ts` receives the event, calls `loadPreviewUrl(url)` and reveals the preview panel.
4. `preview.ts` sets the iframe's `src` attribute to the URL (adding `allow-same-origin` to the sandbox for proper origin access).
5. The tool handler returns a success string to the agent, which continues its turn.
