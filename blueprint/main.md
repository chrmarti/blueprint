<!--
 Copyright (c) Microsoft Corporation. All rights reserved.
 Licensed under the MIT License. See License.txt in the project root for license information.
-->

# Blueprint Compiler

<!-- This document is the canonical definition of the application. The TypeScript
     implementation lives under /built, compiles to /dist, and runs as an
     Electron desktop application that opens on a local folder. Keep this file
     in /blueprint up to date whenever the implementation changes. -->

A desktop authoring environment for writing structured markdown blueprints and compiling them into executable applications using the Copilot SDK as an agent. The agent reads a `blueprint.md` file in the workspace root to understand the project's folder structure, tools, and processes, then generates code following those conventions. The output can be anything — an Electron app, a web app, a CLI tool, a library, or any other kind of software. Built with Electron, the app opens on a local folder and reads/writes files directly on disk.

## Overview

Blueprint Compiler transforms markdown documents into working software. A markdown document describes an application — its architecture, components, requirements, and behavior — and the compiler turns that description into code via the Copilot SDK agent. The agent reads `blueprint.md` from the workspace root to learn the project's folder structure and conventions, then generates code accordingly. The agent runs the Copilot CLI through the SDK's `CopilotClient`, which manages a JSON-RPC session. Within that session, the agent uses file-writing tools to create and update files directly in the workspace folder, rather than returning code as text output.

The long-term goal is **self-hosting**: this tool is itself defined by a markdown blueprint (this document), and will eventually be able to compile itself. To get there, we start with simpler samples (single-file HTML apps, small CLI tools) and progressively tackle more complex multi-file projects until the tool can produce its own runtime.

## Project Structure

```
/blueprint/main.md    ← this document (canonical definition)
/built/               ← TypeScript source
  electron.ts         ← Electron main process (window, menu, IPC, API proxy)
  preload.ts          ← preload script (contextBridge for IPC)
  main.ts             ← renderer entry point, boots all modules
  editor.ts           ← editor panel (textarea, outline, markdown preview)
  compiler.ts         ← compilation panel (agent events, streaming)
  copilot-agent.ts    ← shared Copilot agent module (used by Electron & CLI)
  preview.ts          ← preview panel (iframe sandbox, console forwarding)
  layout.ts           ← drag-handle resizable three-column layout
  settings.ts         ← settings modal, history drawer, theme, import/export
  storage.ts          ← localStorage persistence layer (settings, history)
  files.ts            ← file browser module (tree view, open/save via IPC)
  auth.ts             ← GitHub OAuth device flow + Copilot token management
  compile-cli.ts      ← standalone CLI compile tool (no Electron)
  types.d.ts          ← global type declarations (ElectronAPI)
  index.html          ← HTML shell with all CSS
/dist/                ← compiled output (esbuild bundle)
  index.html          ← copied from /built
  app.js              ← bundled renderer JS (IIFE)
  electron.cjs        ← bundled Electron main process (CJS)
  preload.cjs         ← bundled preload script (CJS)
  compile-cli.mjs     ← bundled CLI compile tool (ESM)
  main.md             ← copied from /blueprint for reference
package.json          ← dependencies: electron, esbuild, typescript, marked, @xterm/xterm, @github/copilot-sdk, @github/copilot
tsconfig.json         ← TypeScript config (target ES2020, bundler resolution)
build.mjs             ← build script: esbuild bundles + file copy
```

## Architecture

The application is an Electron desktop app composed of three primary regions in a single window:

1. **Editor Panel** — A markdown editor with a file browser sidebar, outline navigation, live preview, and direct disk I/O.
2. **Compilation Panel** — Controls for invoking the Copilot SDK to transform the markdown into source code, with streaming output, error display, and save-to-file.
3. **Preview Panel** — A live-rendered view of the compiled application running in a sandboxed iframe.

### Technology Stack

- **Desktop Runtime**: Electron (main process, preload, renderer).
- **Frontend**: TypeScript compiled via esbuild into a single IIFE bundle, no framework dependencies.
- **Markdown Engine**: `marked` (npm) for rendering and structural analysis.
- **Terminal Output**: `@xterm/xterm` (xterm.js) for rendering compilation output with full ANSI escape code support (colors, formatting from the Copilot CLI).
- **Compilation Backend**: GitHub Copilot SDK (`@github/copilot-sdk`), which communicates with the Copilot CLI (`@github/copilot`) via JSON-RPC. The SDK handles authentication, model selection, and agent tool execution. A shared module (`copilot-agent.ts`) encapsulates the SDK lifecycle and is used by both the Electron main process and the standalone CLI. The agent creates/updates files directly in the workspace folder via its built-in tools. Events (tool calls, progress, errors) are relayed to UIs via typed callbacks.
- **File System**: Electron IPC (`ipcMain.handle` / `ipcRenderer.invoke`) for reading directories, reading files, writing files, and showing native dialogs.
- **Runtime Sandbox**: An iframe with `srcdoc` and `sandbox="allow-scripts allow-modals"` for rendering and executing compiled output in isolation.
- **Build Tooling**: esbuild for bundling (renderer IIFE + main CJS + preload CJS), TypeScript for type checking.

## Electron Main Process

The Electron main process (`electron.ts`) handles:

### Window Management

- Creates a `BrowserWindow` (1400×900 default) loading `index.html` directly from disk via `loadFile()`.
- Supports a folder path argument on the command line: `electron . /path/to/folder`.
- Sets the window title to include the workspace folder name.
- Application menu with File → Open Folder (Cmd+Shift+O), standard Edit and View menus.

### IPC-Based API Proxy

Authentication API calls (GitHub OAuth device flow) are made from the main process via Node.js `https` module. Compilation is handled by the Copilot SDK. The renderer communicates with the main process through IPC:

- `api:authDeviceCode(body)` → `POST https://github.com/login/device/code` — returns `{ status, body }`
- `api:authToken(body)` → `POST https://github.com/login/oauth/access_token` — returns `{ status, body }`
- `api:githubUser(token)` → `GET https://api.github.com/user` — returns `{ status, body }`
- `api:copilotToken(ghToken)` → `GET https://api.github.com/copilot_internal/v2/token` — returns `{ status, body }`
- `api:copilotModels(copilotToken)` → `GET https://api.githubcopilot.com/models` — returns `{ status, body }`

### Copilot Agent (Shared Module)

The `copilot-agent.ts` module is the shared compilation backend, used by both the Electron main process and the standalone CLI. It wraps the Copilot SDK:

- `initAgent({ githubToken, appRoot })` — Dynamically imports `@github/copilot-sdk` (ESM-only, loaded via `await import()`), creates a `CopilotClient` pointing to the CLI binary, and starts it. Safe to call multiple times (restarts the client).
- `compileWithAgent({ model, markdown, workspaceFolder, systemPrompt?, onEvent })` — Creates a streaming session with `environment: { cwd: workspaceFolder }` so the agent's file tools operate in the project folder. Attaches a wildcard event listener that emits typed `CompileEvent`s (`log`, `chunk`, `tool_start`, `tool_complete`, `usage`, `error`, `done`, `files_changed`). Calls `sendAndWait()` with a 600-second timeout. Returns `{ ok, error? }`.
- `stopAgent()` — Destroys the active session and stops the client.

The module uses `import type` for compile-time SDK types and `await import('@github/copilot-sdk')` at runtime, since the SDK is ESM-only and the Electron main process is bundled as CJS.

### Copilot SDK IPC (Electron)

The Electron main process delegates to the shared agent module via IPC:

- `copilot:init(githubToken)` — Calls `initAgent()` with the GitHub token and `app.getAppPath()`. Returns `{ ok, error? }`.
- `copilot:compile({ model, systemPrompt, userPrompt })` — Calls `compileWithAgent()` and relays events to the renderer: `copilot:chunk` for text deltas (backward-compatible streaming) and `copilot:event` for structured agent events (tool calls, usage, errors, files_changed). Returns `{ ok, error? }` on completion.
- `copilot:stop` — Calls `stopAgent()` to clean up the session and client.

### Logging

All Copilot SDK activity is logged to the launch terminal (stdout/stderr) with a `[copilot]` prefix. A wildcard event listener on each session logs:

- Client lifecycle: init, start, stop
- Session events: `session.start`, `session.info`, `session.error`, `session.idle`, `session.model_change`, `session.shutdown`
- Turn progress: `assistant.turn_start`, `assistant.turn_end`, `assistant.intent`
- Tool calls: `tool.execution_start`, `tool.execution_complete`
- Token usage: `assistant.usage` (model, input/output tokens, duration)
- Final response size in characters

`assistant.message_delta` events are excluded from logging (too noisy).

### IPC Handlers

- `dialog:openFolder` — Opens a native folder picker, returns the selected path.
- `workspace:getFolder` — Returns the current workspace folder path.
- `fs:readDir` — Lists directory entries (name, isDirectory), sorted directories-first, excluding dotfiles.
- `fs:readFile` — Reads a file's UTF-8 content.
- `fs:writeFile` — Writes UTF-8 content to a file (creates parent directories as needed).
- `fs:delete` — Deletes a file or folder (recursive for directories).
- `dialog:saveFile` — Opens a native save dialog, returns the chosen path.

### Preload Script

The preload script (`preload.ts`) uses `contextBridge.exposeInMainWorld` to expose a safe `window.electronAPI` object with typed methods for all IPC operations, including file system access and API proxy calls.

## File Browser

The editor panel's sidebar has two tabs: **Files** and **Outline**.

### Files Tab

- Displays a tree view of the workspace folder, populated via `electronAPI.readDir`.
- Directories show expand/collapse arrows (▸/▾) and are sorted before files.
- Clicking a directory both toggles its expanded state and selects it as the active directory (highlighted).
- Files show type-appropriate icons (📝 .md, 🌐 .html, 📜 .ts/.js, etc.).
- Clicking a file loads its content into the editor via `electronAPI.readFile` and clears any directory selection.
- The active file or selected directory is highlighted with the accent color.
- Each tree entry stores its full path in a `data-path` attribute for positioning inline inputs.
- The tree is re-rendered after saving compilation output to reflect new files.

### Toolbar Actions

The sidebar tab bar includes action buttons for file management:

- **New File** (📄) — Creates a new file in the selected directory (or the current file's parent, or workspace root). Shows an inline text input in the tree at the correct position for entering the filename.
- **New Folder** (📁) — Creates a new folder in the selected directory. Shows an inline text input; on commit, creates the folder (via a `.keep` placeholder file) and expands it.
- **Delete** (🗑️) — Deletes the selected directory or the currently open file. Shows a `confirm()` dialog describing what will be deleted (including "and all its contents" for folders). On confirmation, removes the entry via `electronAPI.deleteEntry`, clears the editor if the deleted path was open, and refreshes the tree.

### Outline Tab

- Derived from heading structure (H1–H3) of the currently open markdown file.
- Click-to-navigate scrolls the editor to the corresponding heading.

### File Operations

- **Open Folder**: Toolbar button or File → Open Folder (Cmd+Shift+O) shows a native folder picker.
- **Autosave**: The editor autosaves to disk on every keystroke with a 500ms debounce via `electronAPI.writeFile`.
- **Save Output**: A save button (💾) in the compilation panel header opens a native save dialog to write compiled HTML to disk.
- **Delete**: The 🗑️ toolbar button deletes the selected folder or current file after confirmation.
- **Keyboard**: Cmd+S saves the current file to disk immediately.

## Editor Panel

The editor is a full-featured markdown authoring surface.

### Requirements

- Monospaced text input area.
- Live-rendered markdown preview in a tabbed view (Edit / Preview tabs).
- A document outline sidebar derived from heading structure, supporting click-to-navigate.
- Autosave to disk on every keystroke with debounce (500ms).
- Import and export of `.md` files via drag-and-drop and file picker.
- Keyboard shortcuts: `Cmd/Ctrl+S` to save, `Cmd/Ctrl+B` to compile, `Cmd/Ctrl+P` to toggle preview.

### Document Structure Conventions

Authored markdown follows a set of conventions the compiler understands:

- **Top-level heading (`#`)** defines the application name.
- **Second-level headings (`##`)** define major components or modules.
- **Third-level headings (`###`)** define requirements, behaviors, or sub-components.
- **Fenced code blocks** with a language tag are treated as inline source fragments to be preserved verbatim in output.
- **Bulleted lists** under a heading describe constraints, rules, or acceptance criteria.
- **Blockquotes (`>`)** provide additional context or rationale for the compiler but do not map to code.

## Compilation Panel

The compilation panel orchestrates transformation of the authored markdown into runnable source code.

### Requirements

- A **Compile** button that sends the current markdown content to the Copilot SDK agent.
- The SDK prompt is constructed by combining:
  - A system message defining the compiler's role: *"You are a code generator. Your working directory is the project workspace root. A blueprint.md file in the workspace root describes the project's folder structure, tools, and processes. Follow its conventions when generating code."*
  - The full markdown document as the user message.
- The agent writes files directly to the workspace folder via its tools; the output panel uses an xterm.js terminal to display agent output with full ANSI escape code rendering (colors, formatting from the Copilot CLI). All agent events (tool calls, usage, turns, errors) are interleaved with streamed text in the terminal.
- Structured agent events (tool starts with all arguments shown as key=value, completions, file changes) update both the terminal log and the status bar in real time.
- The file tree auto-refreshes when the agent signals `files_changed`.
- An **errors** section that surfaces any SDK invocation failures or malformed output.
- A **history** drawer listing previous compilations with timestamps, allowing rollback.
- A **save** button (💾) to write compiled output to a file on disk via a native save dialog.
- Compilation output is stored in `localStorage` for session persistence.

### Copilot SDK Integration

- Authentication via GitHub OAuth device flow (no API keys needed).
- Users sign in with their GitHub account; the GitHub token is passed to the shared `copilot-agent` module which handles Copilot authentication internally.
- Compilation uses the shared `copilot-agent.ts` module which wraps `@github/copilot-sdk`: it creates a `CopilotClient`, starts the Copilot CLI (`@github/copilot`), creates a streaming session with `environment: { cwd: workspaceFolder }`, and relays events to the renderer. The agent uses its built-in file tools to write output files directly to the workspace.
- Model selection dropdown, dynamically populated from the Copilot API's available models list (default: `claude-opus-4.6`).
- Max token limit is auto-filled from the selected model's `capabilities.limits.max_output_tokens` metadata.
- Temperature slider (default: 0) for controlling output determinism.

## Authentication

The application uses the GitHub OAuth device flow to authenticate users and access their Copilot subscription.

### Device Flow

1. User clicks "Sign in with GitHub" in the toolbar or settings.
2. The app requests a device code from GitHub via IPC (`api:authDeviceCode`).
3. A one-time code is displayed; the user copies it and opens GitHub's verification page.
4. The app polls for authorization (`api:authToken`) until the user completes sign-in.
5. On success, the GitHub access token is stored in `localStorage`.

### Copilot Token

- After GitHub sign-in, the app fetches a Copilot API token via IPC (`api:copilotToken`).
- The Copilot token is cached in `localStorage` and refreshed when it nears expiration.
- All compilation requests use this token to authenticate with the Copilot chat completions endpoint via IPC.

### How It Works

The renderer never makes network requests directly. Authentication API calls go through `window.electronAPI` IPC methods to the main process, which uses Node.js `https`. Compilation goes through the Copilot SDK agent: the renderer calls `window.electronAPI.copilotCompile()`, which triggers the main process to call `compileWithAgent()` from the shared module. The agent creates a session, writes files to the workspace folder via its tools, and streams events back. Text deltas are relayed via `copilot:chunk` and structured events via `copilot:event`. When the agent signals `files_changed`, the file tree refreshes automatically.

## Preview Panel

The preview panel renders compiled output as a live, interactive application. It is collapsed by default and can be expanded via a toggle button (▶) in the compilation panel header.

### Requirements

- Collapsed by default (zero width, hidden). A toggle button in the compilation panel header expands/collapses it.
- An iframe with `srcdoc` set to the compiled HTML output.
- Console forwarding script injected into `<head>`: intercepts `console.log`, `console.warn`, `console.error` and forwards via `parent.postMessage`.
- A **Refresh** button to re-inject the latest compiled output.
- A toggle to open the preview in a new browser tab.
- Console messages displayed in a collapsible log viewer below the preview, color-coded by level.
- A dimension control to simulate common viewport sizes (mobile 375px, tablet 768px, desktop 100%).

## Layout and Interaction

### Panel Arrangement

- Default layout: three-column, resizable via drag handles.
- Collapsible panels: each panel can be minimized to a labeled tab on the edge of the viewport.
- A top toolbar contains: application title, open-folder button, folder name, compile button, layout toggles, and a settings gear icon.

### Settings

Accessible via gear icon in the toolbar:

- GitHub account sign-in / sign-out.
- Theme toggle (light / dark).
- Font size adjustment for the editor.
- Model selection dropdown (populated from Copilot API), temperature, and max token configuration.
- Export full project state (markdown + compiled output + settings) as a JSON bundle.
- Import project state from a JSON bundle.

## Self-Hosting Workflow

The defining goal of this project is self-hosting. The path to get there is incremental:

1. **Samples Phase**: Start with simple, self-contained compilations — single-file HTML apps, small CLI tools — to validate the compilation pipeline and tune the system prompt.
2. **Multi-File Phase**: Graduate to projects that produce multiple output files (e.g., a TypeScript project with `package.json`, source files, and a build script).
3. **Bootstrap Phase**: Use the tool to compile this document into a working version of itself.
4. **Iteration**: The compiled version is used to edit this document and recompile, progressively improving fidelity.
5. **Convergence**: The tool reaches a fixed point where compiling this document produces output functionally identical to the previous compilation.

At convergence, the tool is fully self-hosting: it is both the product and the factory.

## Bootstrap Implementation

The initial bootstrap version is the TypeScript implementation under `/built`, compiled to `/dist` via `node build.mjs`.

### Bootstrap Requirements

- TypeScript source in `/built`, compiled with esbuild to a renderer IIFE bundle (`dist/app.js`), an Electron main process CJS bundle (`dist/electron.cjs`), a preload CJS bundle (`dist/preload.cjs`), and a CLI compile tool ESM bundle (`dist/compile-cli.mjs`).
- An `index.html` shell in `/built` with all CSS embedded, copied to `/dist` at build time.
- `main.md` copied from `/blueprint` to `/dist` for reference.
- Launched via `npm start` (runs `electron .`) which starts the Electron app.
- The Electron main process and CLI both use the shared `copilot-agent.ts` module for compilation, which wraps the Copilot SDK (`@github/copilot-sdk`) and manages the Copilot CLI (`@github/copilot`) process automatically. The agent writes files directly to the workspace folder. Authentication IPC still uses Node.js `https` directly.
- The renderer loads `index.html` directly from disk via `loadFile()`.
- A folder can be passed on the command line: `npm start -- /path/to/folder`.
- No build-time framework dependencies beyond electron, esbuild, typescript, marked, and @xterm/xterm.

### CLI Compile Tool

A standalone Node.js script (`compile-cli.ts` → `dist/compile-cli.mjs`) that compiles markdown blueprints from the command line without launching the Electron app. It uses the same shared `copilot-agent.ts` module as the Electron app.

```
npm run compile -- <input.md> [--model <model>]
```

- Requires `GITHUB_TOKEN` environment variable (GitHub personal access token with Copilot access).
- Uses the shared `copilot-agent` module — same `initAgent()`, `compileWithAgent()`, and system prompt as the Electron app.
- The agent writes output files directly to the workspace folder (the directory containing the input markdown file).
- Logs agent events (tool calls, progress, usage) to stdout with `[compile]` prefix and emoji markers.
- Default model: `claude-opus-4.6`, default timeout: 600,000ms (10 minutes).

This is sufficient to compile this document into the first real version of the tool.
