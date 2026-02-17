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

**Implementation:** Defined in `copilot-agent.ts` via the SDK's `defineTool()` helper with a raw JSON schema for parameters. The tool's handler emits a `preview_url` event through the `onEvent` callback, which the Electron main process relays to the renderer via IPC (`copilot:event`). The renderer's `compiler.ts` handles the event by calling `loadPreviewUrl()` from `preview.ts` and un-collapsing the preview panel.

## System Prompt

The system prompt is appended to the SDK's built-in prompt (using `mode: 'append'`) and includes:

1. The base role definition: code generator operating in the project workspace root, following `blueprint.md` conventions.
2. A description of the `open_in_preview_browser` tool and when to use it.
3. The contents of `blueprint.md` from the workspace root (injected by `electron.ts` at compile time, if the file exists).

```
You are a code generator working in a project workspace. The workspace root contains a blueprint.md file that describes the application to build — its architecture, components, file structure, and behavior. The blueprint may be self-contained or it may reference other markdown documents in the workspace that together make up the full specification. Your job is to read the blueprint and turn it into working code:

1. Start by reading blueprint.md in the workspace root. If it references other markdown files, read those too to get the complete picture.
2. Each section in the blueprint describes a module, component, or file to generate. Create or update the source files in the workspace using your file tools. Write complete, working code — not stubs or placeholders.
3. The blueprint defines the project's folder structure, naming conventions, build tools, and processes. Follow those conventions exactly when deciding where to place files and how to structure them.
4. If the project already has existing files, preserve them unless the blueprint explicitly describes replacing them. Merge new code with the existing codebase.
5. After writing files, install any needed dependencies (npm install, etc.) and verify the project builds if a build step is defined.
6. If the project has a dev server, start it and use the open_in_preview_browser tool to show it in the Preview panel.

You have a custom tool available: open_in_preview_browser. Call it with a URL (e.g., http://localhost:3000) to open that URL in the application's embedded browser. Use this after starting a dev server so the user can see the running application.
```

## Event Flow

When the agent calls `open_in_preview_browser`:

1. The tool handler in `copilot-agent.ts` emits a `preview_url` event with `{ url }` data.
2. `electron.ts` relays the event to the renderer via `mainWindow.webContents.send('copilot:event', event)`.
3. `compiler.ts` receives the event, calls `loadPreviewUrl(url)` and reveals the preview panel.
4. `preview.ts` sets the iframe's `src` attribute to the URL (adding `allow-same-origin` to the sandbox for proper origin access).
5. The tool handler returns a success string to the agent, which continues its turn.
