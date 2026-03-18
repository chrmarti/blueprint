<!--
 Copyright (c) Microsoft Corporation. All rights reserved.
 Licensed under the MIT License. See License.txt in the project root for license information.
-->

# Blueprint Implementer

<!-- This document is the canonical definition of the application. The TypeScript
     implementation lives under /src, compiles to /dist, and runs as an
     Electron desktop application that opens on a local folder. Keep this file
     in /blueprint up to date whenever the implementation changes. -->

A desktop authoring environment for writing structured markdown blueprints and implementing them into executable applications using the Copilot SDK as an agent. The agent reads a `blueprint.md` file in the workspace root to understand the project's folder structure, tools, and processes, then generates code following those conventions. The output can be anything — an Electron app, a web app, a CLI tool, a library, or any other kind of software. Built with Electron, the app opens on a local folder and reads/writes files directly on disk.

## Overview

Blueprint Implementer transforms markdown documents into working software. A markdown document describes an application — its architecture, components, requirements, and behavior — and the implementer turns that description into code via the Copilot SDK agent. The agent reads `blueprint.md` from the workspace root to learn the project's folder structure and conventions, then generates code accordingly. The agent runs the Copilot CLI through the SDK's `CopilotClient`, which manages a JSON-RPC session. Within that session, the agent uses file-writing tools to create and update files directly in the workspace folder, rather than returning code as text output.

The long-term goal is **self-hosting**: this tool is itself defined by a markdown blueprint (this document), and will eventually be able to implement itself. To get there, we start with simpler samples (single-file HTML apps, small CLI tools) and progressively tackle more complex multi-file projects until the tool can produce its own runtime.

## Project Structure

```
/blueprint/main.md    ← this document (canonical definition)
/src/                 ← TypeScript source
  electron.ts         ← Electron main process (window, menu, IPC, API proxy)
  preload.ts          ← preload script (contextBridge for IPC)
  main.ts             ← renderer entry point, boots all modules
  editor.ts           ← editor panel (Edit and Browser tabs)
  implementer.ts         ← output panel (agent events, streaming)
  copilot-agent.ts    ← shared Copilot agent module (used by Electron & CLI)
  preview.ts          ← browser tab (iframe, address bar, URL navigation)
  layout.ts           ← drag-handle resizable three-column layout
  settings.ts         ← settings modal, history drawer, theme, import/export
  storage.ts          ← localStorage persistence layer (settings, history)
  files.ts            ← sidebar module (Files and Git tabs, tree view, open/save via IPC)
  terminal.ts         ← integrated terminal panel (xterm.js + node-pty IPC)
  auth.ts             ← GitHub OAuth device flow + Copilot token management
  implement-cli.ts      ← standalone CLI implement tool (no Electron)
  types.d.ts          ← global type declarations (ElectronAPI)
  index.html          ← HTML shell with all CSS
/dist/                ← compiled output (esbuild bundle)
  index.html          ← copied from /src
  xterm.css           ← copied from node_modules/@xterm/xterm/css/xterm.css
  app.js              ← bundled renderer JS (IIFE)
  electron.cjs        ← bundled Electron main process (CJS)
  preload.cjs         ← bundled preload script (CJS)
  implement-cli.mjs     ← bundled CLI implement tool (ESM)
  main.md             ← copied from /blueprint for reference
/scripts/
  safehouse           ← agent-safehouse sandbox script (downloaded at npm install)
package.json          ← project config (see Dependencies below)
tsconfig.json         ← TypeScript config (target ES2020, bundler resolution)
build.mjs             ← build script: esbuild bundles + file copy
build.package.mjs     ← packaging script: electron-packager + chmod fixes
```

## Architecture

The application is an Electron desktop app composed of three primary regions in a single window:

1. **Sidebar** (left) — A file browser with **Files** and **Git** tabs, plus toolbar actions for creating/deleting files and folders.
2. **Editor Panel** (center) — A tabbed view with **Edit** (markdown textarea) and **Browser** (embedded iframe with address bar) tabs, with an integrated terminal panel at the bottom. Direct disk I/O with autosave.
3. **Output Panel** (right) — Controls for invoking the Copilot SDK agent, with streaming terminal output (xterm.js), error display, and save-to-file.

### Technology Stack

- **Desktop Runtime**: Electron (main process, preload, renderer).
- **Frontend**: TypeScript compiled via esbuild into a single IIFE bundle, no framework dependencies.
- **Markdown Engine**: `marked` (npm) for rendering and structural analysis.
- **Terminal Output**: `@xterm/xterm` (xterm.js) for rendering implementation output with full ANSI escape code support (colors, formatting from the Copilot CLI).
- **Implementation Backend**: GitHub Copilot SDK (`@github/copilot-sdk`), which communicates with the Copilot CLI (`@github/copilot`) via JSON-RPC. The SDK handles authentication, model selection, and agent tool execution. A shared module (`copilot-agent.ts`) encapsulates the SDK lifecycle and is used by both the Electron main process and the standalone CLI. The agent creates/updates files directly in the workspace folder via its built-in tools. Events (tool calls, progress, errors) are relayed to UIs via typed callbacks.
- **Terminal Emulation**: `node-pty` for pseudo-terminal in the main process, `@xterm/xterm` for rendering in the renderer.
- **File System**: Electron IPC (`ipcMain.handle` / `ipcRenderer.invoke`) for reading directories, reading files, writing files, and showing native dialogs.
- **Runtime Sandbox**: An iframe with `srcdoc` and `sandbox="allow-scripts allow-modals"` for rendering and executing implemented output in isolation.
- **Build Tooling**: esbuild for bundling (renderer IIFE + main CJS + preload CJS), TypeScript for type checking. Only `electron` and `node-pty` are externalized in the Electron main process bundle — all other dependencies including `@github/copilot-sdk` are bundled into `electron.cjs`. This avoids ESM resolution issues at runtime (e.g., `vscode-jsonrpc/node` missing `.js` extension) since esbuild resolves all imports at build time. The CLI bundle similarly bundles everything except native modules.

## Electron Main Process

The Electron main process (`electron.ts`) handles:

### Window Management

- Creates a `BrowserWindow` (1400×900 default) loading `index.html` directly from disk via `loadFile()`.
- Supports a folder path argument on the command line: `electron . /path/to/folder`.
- Sets the window title to include the workspace folder name.
- Application menu with File → Open Folder (Cmd+Shift+O), standard Edit and View menus.

### IPC-Based API Proxy

See [auth.md](auth.md) for the authentication API proxy endpoints. The renderer communicates with the main process through IPC for all network requests.

### Copilot Agent Harness

See [harness.md](harness.md) for the shared Copilot agent module, SDK IPC, logging, and system prompt details.

### Integrated Terminal

See [terminal.md](terminal.md) for the integrated terminal panel, node-pty IPC, and lifecycle details.

### IPC Handlers

- `dialog:openFolder` — Opens a native folder picker, returns the selected path.
- `workspace:getFolder` — Returns the current workspace folder path.
- `fs:readDir` — Lists directory entries (name, isDirectory), sorted directories-first, excluding dotfiles.
- `fs:readFile` — Reads a file's UTF-8 content.
- `fs:writeFile` — Writes UTF-8 content to a file (creates parent directories as needed).
- `fs:delete` — Deletes a file or folder (recursive for directories).
- `fs:cleanWorkspace` — Reads `.blueprintfiles` from the workspace root, parses the list of files/folders to keep, and deletes all other root-level entries. Always preserves `.blueprintfiles` itself and `.git`. Returns `{ ok, deleted[], error }`. Supports `{ dryRun: true }` to preview deletions without executing them.
- `dialog:saveFile` — Opens a native save dialog, returns the chosen path.

### Preload Script

The preload script (`preload.ts`) uses `contextBridge.exposeInMainWorld` to expose a safe `window.electronAPI` object with typed methods for all IPC operations, including file system access and API proxy calls.

## File Browser

The sidebar has two tabs: **Files** and **Git**.

### Files Tab

- Displays a tree view of the workspace folder, populated via `electronAPI.readDir`.
- Directories show expand/collapse arrows (▸/▾) and are sorted before files.
- Clicking a directory both toggles its expanded state and selects it as the active directory (highlighted).
- Files show type-appropriate icons (📝 .md, 🌐 .html, 📜 .ts/.js, etc.).
- Clicking a file loads its content into the editor via `electronAPI.readFile` and clears any directory selection.
- The active file or selected directory is highlighted with the accent color.
- Each tree entry stores its full path in a `data-path` attribute for positioning inline inputs.
- The tree is re-rendered after saving implementation output to reflect new files.

### Toolbar Actions

The sidebar tab bar includes action buttons for file management:

- **New File** (📄) — Creates a new file in the selected directory (or the current file's parent, or workspace root). Shows an inline text input in the tree at the correct position for entering the filename.
- **New Folder** (📁) — Creates a new folder in the selected directory. Shows an inline text input; on commit, creates the folder (via a `.keep` placeholder file) and expands it.
- **Refresh** (🔄) — Re-reads the workspace folder from disk and refreshes the file tree.
- **Delete** (🗑️) — Deletes the selected directory or the currently open file. Shows a `confirm()` dialog describing what will be deleted (including "and all its contents" for folders). On confirmation, removes the entry via `electronAPI.deleteEntry`, clears the editor if the deleted path was open, and refreshes the tree.

### Git Tab

See [git.md](git.md) for details.

### File Operations

- **Open Folder**: Toolbar button or File → Open Folder (Cmd+Shift+O) shows a native folder picker.
- **Autosave**: The editor autosaves to disk on every keystroke with a 500ms debounce via `electronAPI.writeFile`.
- **Save Output**: A save button (💾) in the implementation panel header opens a native save dialog to write implemented HTML to disk.
- **Delete**: The 🗑️ toolbar button deletes the selected folder or current file after confirmation.
- **Clean**: The 🗑 Clean button in the main toolbar removes all files and folders in the workspace root that are not listed in `.blueprintfiles`. Shows a confirmation dialog listing exactly which entries will be deleted. If no `.blueprintfiles` exists, shows an alert prompting the user to create one.
- **Keyboard**: Cmd+S saves the current file to disk immediately.

#### Verification

Use Playwright to verify the Open Folder button works: click the open-folder toolbar button, handle the native folder dialog by selecting a test folder, and verify that the folder name appears in the toolbar and that `blueprint.md` appears in the file tree.

## Blueprint Files

A `.blueprintfiles` file in the workspace root declares which files and folders are part of the blueprint and should be preserved during a Clean operation. Format:

- Plain text, one relative path per line.
- Lines starting with `#` are comments.
- Blank lines are ignored.
- Trailing `/` on directory names is optional (stripped during parsing).
- `.blueprintfiles` itself and `.git` are always preserved implicitly.

Example:
```
# Core blueprint
blueprint.md
blueprint/
```

The **Clean** action in the toolbar reads this file, computes which root-level entries are not listed, shows a confirmation dialog with the list, and deletes them on confirmation.

## Editor Panel

The editor is a full-featured markdown authoring surface with two tabs: **Edit** and **Browser**.

### Requirements

- **Edit tab**: Monospaced text input area for editing markdown and other files.
- **Browser tab**: An embedded iframe with an address bar for navigating to URLs and previewing web content. The address bar auto-prepends `http://` if no protocol is specified. Can be activated programmatically by the `open_in_preview_browser` agent tool.
- Autosave to disk on every keystroke with debounce (500ms).
- Import and export of `.md` files via drag-and-drop and file picker.
- Keyboard shortcuts: `Cmd/Ctrl+S` to save, `Cmd/Ctrl+B` to implement.

### Document Structure Conventions

Authored markdown follows a set of conventions the implementer understands:

- **Top-level heading (`#`)** defines the application name.
- **Second-level headings (`##`)** define major components or modules.
- **Third-level headings (`###`)** define requirements, behaviors, or sub-components.
- **Fenced code blocks** with a language tag are treated as inline source fragments to be preserved verbatim in output.
- **Bulleted lists** under a heading describe constraints, rules, or acceptance criteria.
- **Blockquotes (`>`)** provide additional context or rationale for the implementer but do not map to code.

## Output Panel

The output panel orchestrates transformation of the authored markdown into runnable source code.

### Requirements

- A **Implement** button that invokes the Copilot SDK agent on the workspace's `blueprint.md`.
- The SDK prompt is constructed by combining:
  - The system prompt defined in [harness.md](harness.md).
  - The contents of `blueprint.md` (appended to the system prompt at implement time by `electron.ts`).
  - The contents of `blueprint.md` as the user message.
- The output panel uses an xterm.js terminal to display agent output. The agent's streamed text (thinking, explanations) is written directly to the terminal as it arrives. Structured events are rendered inline between streamed text as human-readable formatted lines using ANSI colors:
  - **Tool start** (`🔧` yellow): shows the tool name in bold, followed by a short human-readable summary of what the tool is doing. For file-writing tools, show the file path. For shell/bash tools, show the command. For other tools, show the most relevant argument value. Do **not** dump all arguments as `key=value` pairs or render JSON.
  - **Tool complete** (`✓` green): shows the tool name that completed, e.g., `✓ create_file complete`.
  - **Token usage** (gray, dimmed): shows input/output token counts and duration, e.g., `tokens: 1,234 in / 567 out (1.2s)`. Format the duration in seconds with one decimal, not raw milliseconds.
  - **Errors** (`✗` red bold): shows the error message.
  - **Session lifecycle events** (gray, dimmed): show a short label like `session started`, `turn started`, `turn ended` — do **not** append raw JSON.
  - **File changes**: when the agent signals `files_changed`, the file tree refreshes silently (no terminal output needed).
- The file tree auto-refreshes when the agent signals `files_changed`.
- An **errors** section that surfaces any SDK invocation failures or malformed output.
- A **history** drawer listing previous implementations with timestamps, allowing rollback.
- A **save** button (💾) to write implemented output to a file on disk via a native save dialog.
- Implementation output is stored in `localStorage` for session persistence.

#### Verification

Write a test using Playwright that starts the app on a folder with a Game of Life blueprint and triggers the Implement button. The test must observe that the Output panel starts streaming messages from the Copilot CLI/SDK.

### Copilot SDK Integration

- Authentication via GitHub OAuth device flow (no API keys needed).
- Users sign in with their GitHub account; the GitHub token is passed to the shared `copilot-agent` module which handles Copilot authentication internally.
- Implementation uses the shared `copilot-agent.ts` module which wraps `@github/copilot-sdk`: it creates a `CopilotClient`, starts the Copilot CLI (`@github/copilot`), creates a streaming session with `environment: { cwd: workspaceFolder }`, and relays events to the renderer. The agent uses its built-in file tools to write output files directly to the workspace.
- Model selection dropdown, dynamically populated from the Copilot API's available models list (default: `claude-opus-4.5`). When the model list is not yet available (e.g., user not signed in, or network issues), the dropdown should indicate this state to the user rather than appearing empty.
- Max token limit is auto-filled from the selected model's `capabilities.limits.max_output_tokens` metadata.
- Temperature slider (default: 0) for controlling output determinism.

## Authentication

See [auth.md](auth.md) for details.

## Browser Tab

The Browser tab in the Editor panel provides an embedded web browser for previewing content and navigating to URLs.

### Requirements

- An iframe that can load URLs via `src` or render HTML via `srcdoc`.
- An **address bar** at the top for navigating to URLs. Typing a URL and pressing Enter loads it in the iframe. If no protocol is specified, `http://` is prepended automatically.
- The address bar can be set programmatically by the `open_in_preview_browser` agent tool, which also switches to the Browser tab.
- Console forwarding script injected into `<head>` for `srcdoc` content: intercepts `console.log`, `console.warn`, `console.error` and forwards via `parent.postMessage`.

#### Verification

Use Playwright to verify the browser iframe is only visible on the Browser tab: switch to the Edit tab and confirm the iframe and address bar are not visible, then switch to the Browser tab and confirm they are visible.

## Layout and Interaction

### Panel Arrangement

- Default layout: three-column, resizable via drag handles. Left to right: **Sidebar** (Files and Git tabs), **Editor** (Edit and Browser tabs, center), **Output** (right).
- On window resize, the center Editor panel grows and shrinks horizontally while the left (Sidebar) and right (Output) panels remain fixed in width.
- Collapsible panels: each panel can be minimized to a labeled tab on the edge of the viewport.
- A top toolbar contains: application title, open-folder button, folder name, implement button, clean button, layout toggles, and a settings gear icon.

### Settings

Accessible via gear icon in the toolbar:

- GitHub account sign-in / sign-out.
- Theme toggle (light / dark).
- Font size adjustment for the editor.
- Model selection dropdown (populated from Copilot API), temperature, and max token configuration.
- Export full project state (markdown + implemented output + settings) as a JSON bundle.
- Import project state from a JSON bundle.

#### Verification

The settings modal can be dismissed with Esc or a click on its close toolbar button.

## Testing

Automated end-to-end tests use Playwright's Electron support to launch the app and verify all basic functionality. Tests live in `/test` and are run with Node.js directly (no test framework needed). A GitHub token is required for tests that exercise implementation. Locally the GitHub CLI can be used to get a token, in CI the GITHUB_TOKEN env variable must be set.

```
GITHUB_TOKEN=$(gh auth token) node test/interact.mjs
```

### Test Setup

- Launch the Electron app via `playwright`'s `_electron.launch()`, pointing at the project root (`.`) so that `app.getAppPath()` resolves correctly for the Copilot CLI.
- Pass a workspace folder as a command-line argument to open it on launch.
- Save screenshots at each stage for visual verification.
- Save screenshots periodically during long stages for visual verification.

### Basic Functionality Tests

The test script verifies the following end-to-end scenarios:

1. **App Launch** — The Electron window opens with the correct title ("Blueprint Implementer").
2. **Folder Open** — Passing a folder path on the command line loads it into the sidebar. The folder name appears in the toolbar and `blueprint.md` is visible in the file tree.
3. **File Tree** — Directory entries render with expand/collapse arrows; files show type-appropriate icons. Clicking a file loads its content into the editor.
4. **Implement** — Clicking the Implement button triggers the Copilot agent. The status bar shows "Implementing..." and agent events stream into the xterm.js output terminal.
5. **Implement Completion** — The status element's class changes to `success` (or `error` on failure) and the status text updates. The file tree refreshes to show newly generated files.
6. **Auth Gate** — When no GitHub token is present, clicking Implement shows "Not signed in" in the status bar without crashing.

### Test Implementation

Tests use Playwright's Electron API:

- `electron.launch()` starts the app with the specified executable and arguments.
- `app.firstWindow()` returns the main `BrowserWindow` page object.
- Standard Playwright locators (`locator`, `getByText`) find UI elements.
- `window.evaluate()` executes code in the renderer context for auth injection and IPC calls.
- `waitFor()` with timeouts handles async operations (folder loading, implementation).
- Polling loops on the `#implement-status` element detect implementation completion (check `class` for `success`/`error`).

## Self-Hosting Workflow

The defining goal of this project is self-hosting. The path to get there is incremental:

1. **Samples Phase**: Start with simple, self-contained implementations — single-file HTML apps, small CLI tools — to validate the implementation pipeline and tune the system prompt.
2. **Multi-File Phase**: Graduate to projects that produce multiple output files (e.g., a TypeScript project with `package.json`, source files, and a build script).
3. **Bootstrap Phase**: Use the tool to implement this document into a working version of itself.
4. **Iteration**: The implemented version is used to edit this document and re-implement, progressively improving fidelity.
5. **Convergence**: The tool reaches a fixed point where implementing this document produces output functionally identical to the previous implementation.

At convergence, the tool is fully self-hosting: it is both the product and the factory.

## Bootstrap Implementation

The initial bootstrap version is the TypeScript implementation under `/src`, compiled to `/dist` via `node build.mjs`.

### Bootstrap Requirements

- TypeScript source in `/src`, compiled with esbuild to a renderer IIFE bundle (`dist/app.js`), an Electron main process CJS bundle (`dist/electron.cjs`), a preload CJS bundle (`dist/preload.cjs`), and a CLI implement tool ESM bundle (`dist/implement-cli.mjs`).
- An `index.html` shell in `/src` with all CSS embedded, copied to `/dist` at build time. All asset references in `index.html` must be local relative paths (no CDN URLs) — the app loads via `file://` and may run offline.
- `xterm.css` copied from `node_modules/@xterm/xterm/css/xterm.css` to `/dist` at build time. Referenced via `<link rel="stylesheet" href="xterm.css">` in `index.html`. This is **critical** — without it, xterm.js's internal helper textarea elements become visible as raw text fields in the terminal and output panels.
- `main.md` copied from `/blueprint` to `/dist` for reference.
- Launched via `npm start` (runs `electron .`) which starts the Electron app.
- The Electron main process and CLI both use the shared `copilot-agent.ts` module for implementation, which wraps the Copilot SDK (`@github/copilot-sdk`) and manages the Copilot CLI (`@github/copilot`) process automatically. The agent writes files directly to the workspace folder. Authentication IPC still uses Node.js `https` directly.
- The renderer loads `index.html` directly from disk via `loadFile()`.
- A folder can be passed on the command line: `npm start -- /path/to/folder`.
- **Runtime dependencies** (must be in `dependencies`, not `devDependencies`): `@github/copilot-sdk`, `@github/copilot`, `@xterm/xterm`, `marked`, `node-pty`. The SDK is bundled into the Electron main process and CLI at build time, but `@github/copilot` must remain in `node_modules` at runtime because its platform-specific native binary (e.g., `@github/copilot-darwin-arm64/copilot`) is spawned as a child process inside the safehouse sandbox. `node-pty` is externalized because it contains native `.node` addons that must be loaded from disk.
- **Build-time dependencies** (in `devDependencies`): `electron`, `esbuild`, `typescript`, `@electron/packager`. These are only needed during development and build, not at runtime.

### CLI Implement Tool

A standalone Node.js script (`implement-cli.ts` → `dist/implement-cli.mjs`) that implements markdown blueprints from the command line without launching the Electron app. It uses the same shared `copilot-agent.ts` module as the Electron app.

```
blueprint implement <workspace-folder> [--model <model>] [--no-sandbox]
```

- Requires `GITHUB_TOKEN` environment variable (GitHub personal access token with Copilot access).
- Uses the shared `copilot-agent` module — same `initAgent()`, `implementWithAgent()`, and system prompt as the Electron app.
- The agent writes output files directly to the workspace folder (the directory containing the input markdown file).
- Logs agent events (tool calls, progress, usage) to stdout with `[implement]` prefix and emoji markers.
- Default model: `claude-opus-4.5`.
- `--no-sandbox` runs the Copilot CLI directly without the safehouse sandbox. Useful in CI environments where the macOS Seatbelt sandbox may conflict with the runner.
- On activity timeout (no events for 120 seconds), the CLI automatically retries up to 3 times with a 10-second delay between attempts. Each retry reinitializes the agent with a fresh session. Non-timeout errors fail immediately.
