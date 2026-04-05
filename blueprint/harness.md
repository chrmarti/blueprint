<!--
 Copyright (c) Microsoft Corporation. All rights reserved.
 Licensed under the MIT License. See License.txt in the project root for license information.
-->

# Agent Harness

The Copilot SDK agent runs with a set of custom tools defined by the host application. These tools extend the agent's built-in capabilities (filesystem, shell, etc.) with application-specific actions.

## Custom Tools

### `open_in_preview_browser`

Opens a URL in the application's Preview panel — the embedded browser iframe in the UI.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `url` | string | yes | The URL to open (e.g., `http://localhost:3000`) |

**Behavior:**

- Sends a `preview_url` event to the browser via the `/ws/copilot` WebSocket.
- The browser sets the Preview panel's iframe `src` to the given URL.
- Reveals the Preview panel if it is collapsed.
- Returns a confirmation string to the agent (e.g., `Opened http://localhost:3000 in the Preview panel.`).

**Use case:** After the agent starts a dev server via the shell tool, it calls `open_in_preview_browser` to show the running application to the user without requiring manual navigation.

**Implementation:** Defined in `copilot-agent.ts` via the SDK's `defineTool()` helper with a raw JSON schema for parameters. The tool's handler emits a `preview_url` event through the `onEvent` callback, which the server relays to the browser via the `/ws/copilot` WebSocket. The browser's `implementer.ts` handles the event by calling `loadPreviewUrl()` from `preview.ts` and un-collapsing the preview panel.

## System Prompt

The system prompt is appended to the SDK's built-in prompt (using `mode: 'append'`) and includes:

1. The base role definition: code generator operating in the project workspace root, following `blueprint.md` conventions.
2. A structured workflow: Planning & Discovery → Implementation → Verification → Delivery.
3. A description of the `open_in_preview_browser` tool and when to use it.
4. The contents of `blueprint.md` from the workspace root (injected by `server.ts` at implement time, if the file exists).

```
You are a code generator working in a project workspace. The workspace root contains a blueprint.md file that describes the application to build — its architecture, components, file structure, and behavior. The blueprint may be self-contained or it may reference other markdown documents in the workspace that together make up the full specification. Your job is to read the blueprint and turn it into working code.

Follow this workflow:

## Planning & Discovery
1. Start by reading blueprint.md in the workspace root. If it references other markdown files, read those too to get the complete picture.
2. Scan the existing project structure — list directories, check for existing source files, package.json, build scripts, and installed tools. Understand what already exists before writing anything.
3. Form a plan: identify which files need to be created or updated, in what order, and how you will verify the result.

## Implementation
4. Each section in the blueprint describes a module, component, or file to generate. Create or update the source files in the workspace using your file tools. Write complete, working code — not stubs or placeholders.
5. Use strong typing everywhere. Avoid the `any` type — use precise types, interfaces, or generics instead.
6. The blueprint defines the project's folder structure, naming conventions, build tools, and processes. Follow those conventions exactly when deciding where to place files and how to structure them.
7. If the project already has existing files, preserve them unless the blueprint explicitly describes replacing them. Merge new code with the existing codebase.

## Verification
8. The generated source must compile and type-check without errors. After writing files, install any needed dependencies (npm install, etc.) and verify both type-checking (e.g., `npx tsc --noEmit`) and the build step pass without errors.
9. When installing packages, always use the latest versions available. Do not pin to old versions you may have seen during training — use `npm install <package>@latest` or omit version specifiers to get the current release.
10. Write tests for any existing functionality you changed and for any new functionality you implemented. Run all tests and verify they pass. Don't just re-read your own code — execute it.
11. If compilation or tests fail, read the full error output, diagnose the root cause, and fix it. If you find yourself editing the same file repeatedly without progress, step back and reconsider your approach.
12. After the build passes, scan the blueprint documents for sections titled "Verification". For each one, write a test script that verifies the described behavior (e.g., using Playwright). Run all verification tests and fix any failures before considering the implementation complete.

## Delivery
13. If the project has a dev server, start it and use the open_in_preview_browser tool to show it in the Preview panel.

You have a custom tool available: open_in_preview_browser. Call it with a URL (e.g., http://localhost:3000) to open that URL in the application's embedded browser. Use this after starting a dev server so the user can see the running application.
```

## Copilot Agent (Shared Module)

The `copilot-agent.ts` module is the shared implementation backend, used by both the server and the standalone CLI. It wraps the Copilot SDK:

- `initAgent({ githubToken, appRoot })` — Stores the init options and stops any existing client. Does **not** create the `CopilotClient` yet — client creation is deferred to `implementWithAgent()`, where the workspace folder is known. Safe to call multiple times.
- `implementWithAgent({ model, markdown, workspaceFolder, systemPrompt?, onEvent })` — Creates (or reuses) the `CopilotClient` for the given workspace folder. If the workspace folder differs from the previous run, the client is recreated so that `cwd` points at the correct directory. Then creates a streaming session with `workingDirectory: workspaceFolder` so the agent's file tools operate in the project folder. Attaches a wildcard event listener that emits typed `ImplementEvent`s (`log`, `chunk`, `tool_start`, `tool_complete`, `usage`, `error`, `done`, `files_changed`). Calls `sendAndWait()` with a 600-second timeout. Returns `{ ok, error? }`.
- `stopAgent()` — Destroys the active session and stops the client.

The module uses `import type` for compile-time SDK types (e.g., `import type { CopilotClient, CopilotClientOptions, CopilotSession, SessionEvent } from '@github/copilot-sdk'`) and `await import('@github/copilot-sdk')` at runtime. Always use the SDK's exported types rather than ad-hoc type annotations — use `CopilotClientOptions` for client construction, `SessionEvent` for event listener callbacks, `SessionConfig` for session creation, etc.

## Sandbox

The Copilot CLI runs inside the Codespace container, which provides process and filesystem isolation. No additional sandbox configuration is needed — the container itself is the security boundary.

### CLI Binary Resolution

`resolveCLIPath()` prefers the platform-specific native binary at `node_modules/@github/copilot-<platform>-<arch>/copilot` (e.g., `copilot-linux-x64/copilot`). This is a standalone executable that doesn't require Node.js. If the native binary isn't available, it falls back to the JS entry point at `node_modules/@github/copilot/npm-loader.js`.

### Integration

`implementWithAgent()` in `copilot-agent.ts` creates the `CopilotClient` on first use (or recreates it when the workspace folder changes) and configures it to run the CLI directly:

```ts
new CopilotClient({
  cwd: workspaceFolder,
  cliPath,              // the native copilot CLI binary
  ...
})
```

Key details:

- **`cwd`** sets the working directory for the CLI process so the agent can create and modify files in the workspace.
- **`cliPath`** points to the resolved Copilot CLI binary.
- Network access is available directly (no sandbox restrictions).

## Server API for Copilot

The server delegates to the shared agent module via REST and WebSocket:

- `POST /api/copilot/init` — Calls `initAgent()` with the server-side GitHub token. Returns `{ ok, error? }`.
- `POST /api/copilot/implement` — Body: `{ model, systemPrompt, userPrompt }`. Calls `implementWithAgent()` and relays events to the browser: streamed over the `/ws/copilot` WebSocket as JSON messages with `type` field (`chunk` for text deltas, `event` for structured agent events like tool calls, usage, errors, files_changed). Returns `{ ok, error? }` on completion.
- `POST /api/copilot/stop` — Calls `stopAgent()` to clean up the session and client.

## Logging

All Copilot SDK activity is logged to the server's stdout/stderr with a `[copilot]` prefix. A wildcard event listener on each session logs:

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
2. `server.ts` relays the event to the browser via the `/ws/copilot` WebSocket.
3. `implementer.ts` receives the event, calls `loadPreviewUrl(url)` and reveals the preview panel.
4. `preview.ts` sets the iframe's `src` attribute to the URL (adding `allow-same-origin` to the sandbox for proper origin access).
5. The tool handler returns a success string to the agent, which continues its turn.
