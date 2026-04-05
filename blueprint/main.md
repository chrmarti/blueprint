<!--
 Copyright (c) Microsoft Corporation. All rights reserved.
 Licensed under the MIT License. See License.txt in the project root for license information.
-->

# Blueprint Implementer

<!-- This document is the canonical definition of the application. The TypeScript
     implementation lives under /src, compiles to /dist, and runs as a web
     application served by a Node.js server. Keep this file in /blueprint
     up to date whenever the implementation changes. -->

A web-based authoring environment for writing structured markdown blueprints and implementing them into executable applications using the Copilot SDK as an agent. The agent reads a `blueprint.md` file in the workspace root to understand the project's folder structure, tools, and processes, then generates code following those conventions. The output can be anything — a web app, a CLI tool, a library, or any other kind of software. Built with Node.js and Express, the app runs as an HTTP server (ideal for GitHub Codespaces) and serves a browser-based frontend.

## Overview

Blueprint Implementer transforms markdown documents into working software. A markdown document describes an application — its architecture, components, requirements, and behavior — and the implementer turns that description into code via the Copilot SDK agent. The agent reads `blueprint.md` from the workspace root to learn the project's folder structure and conventions, then generates code accordingly. The agent runs the Copilot CLI through the SDK's `CopilotClient`, which manages a JSON-RPC session. Within that session, the agent uses file-writing tools to create and update files directly in the workspace folder, rather than returning code as text output.

The long-term goal is **self-hosting**: this tool is itself defined by a markdown blueprint (this document), and will eventually be able to implement itself. To get there, we start with simpler samples (single-file HTML apps, small CLI tools) and progressively tackle more complex multi-file projects until the tool can produce its own runtime.

## Project Structure

```
/blueprint/main.md    ← this document (canonical definition)
/src/                 ← TypeScript source
  server.ts           ← Node.js HTTP + WebSocket server (Express, ws)
  main.ts             ← renderer entry point, boots all modules
  api-client.ts       ← client-side API module (fetch + WebSocket calls)
  editor.ts           ← editor panel (Edit and Browser tabs)
  implementer.ts      ← output panel (agent events, streaming)
  copilot-agent.ts    ← shared Copilot agent module (used by server & CLI)
  preview.ts          ← browser tab (iframe, address bar, URL navigation)
  layout.ts           ← drag-handle resizable three-column layout
  settings.ts         ← settings modal, history drawer, theme, import/export
  storage.ts          ← localStorage persistence layer (settings, history)
  files.ts            ← sidebar module (Files and Git tabs, tree view, open/save via API)
  terminal.ts         ← integrated terminal panel (xterm.js + WebSocket)
  auth.ts             ← authentication display (token resolved server-side)
  implement-cli.ts    ← standalone CLI implement tool (no server)
  types.d.ts          ← global type declarations (ServerAPI)
  index.html          ← HTML shell with all CSS
/dist/                ← compiled output (esbuild bundle)
  index.html          ← copied from /src
  xterm.css           ← copied from node_modules/@xterm/xterm/css/xterm.css
  app.js              ← bundled renderer JS (IIFE)
  server.mjs          ← bundled server (ESM)
  implement-cli.mjs   ← bundled CLI implement tool (ESM)
  main.md             ← copied from /blueprint for reference
/scripts/
package.json          ← project config (see Dependencies below)
tsconfig.json         ← TypeScript config (target ES2020, bundler resolution)
build.mjs             ← build script: esbuild bundles + file copy
```

## Architecture

The application is a client-server web app composed of a Node.js backend and a browser-based frontend with three primary regions in a single page:

1. **Sidebar** (left) — A file browser with **Files** and **Git** tabs, plus toolbar actions for creating/deleting files and folders.
2. **Editor Panel** (center) — A tabbed view with **Edit** (markdown textarea) and **Browser** (embedded iframe with address bar) tabs, with an integrated terminal panel at the bottom. Direct file I/O via server API with autosave.
3. **Right Panel** — Tabbed view with **Chat** (conversational blueprint editing) and **Output** (agent implementation, streaming terminal output). See [chat.md](chat.md) and [output.md](output.md).

### Technology Stack

- **Server Runtime**: Node.js with Express for HTTP and `ws` for WebSocket.
- **Frontend**: TypeScript compiled via esbuild into a single IIFE bundle, no framework dependencies.
- **Markdown Engine**: `marked` (npm) for rendering and structural analysis.
- **Terminal Output**: `@xterm/xterm` (xterm.js) for rendering implementation output with full ANSI escape code support (colors, formatting from the Copilot CLI).
- **Implementation Backend**: GitHub Copilot SDK (`@github/copilot-sdk`), which communicates with the Copilot CLI (`@github/copilot`) via JSON-RPC. The SDK handles authentication, model selection, and agent tool execution. A shared module (`copilot-agent.ts`) encapsulates the SDK lifecycle and is used by both the server and the standalone CLI. The agent creates/updates files directly in the workspace folder via its built-in tools. Events (tool calls, progress, errors) are relayed to UIs via typed callbacks.
- **Terminal Emulation**: `node-pty` on the server for pseudo-terminal, connected to the browser via WebSocket. `@xterm/xterm` for rendering in the browser.
- **File System**: REST API endpoints on the server for reading directories, reading files, writing files, and deleting entries. The client-side `api-client.ts` module wraps these calls.
- **Runtime Sandbox**: An iframe with `srcdoc` and `sandbox="allow-scripts allow-modals"` for rendering and executing implemented output in isolation.
- **Build Tooling**: esbuild for bundling (renderer IIFE + server ESM). Only `node-pty` is externalized in the server bundle — all other dependencies including `@github/copilot-sdk` are bundled into `server.mjs`. This avoids ESM resolution issues at runtime (e.g., `vscode-jsonrpc/node` missing `.js` extension) since esbuild resolves all imports at build time. The CLI bundle similarly bundles everything except native modules.

## Server (`server.ts`)

The Node.js server handles HTTP requests, serves static files, and manages WebSocket connections:

### Static File Serving

- Serves the `dist/` directory as static files at the root URL.
- Navigating to `/` serves `index.html`.
- The server listens on `process.env.PORT` or `3000` by default.

### Workspace Management

- The workspace folder is configured via a command-line argument (`node dist/server.mjs /path/to/folder`) or defaults to the current working directory.
- The workspace path is stored in server state and available to all API endpoints.

### REST API Endpoints

- `GET /api/workspace` — Returns `{ folder }` with the current workspace folder path.
- `GET /api/fs/readDir?path=<relative>` — Lists directory entries (name, isDirectory), sorted directories-first. Shows dotfiles but excludes `.git`. The `path` parameter is relative to the workspace root; if omitted, lists the workspace root.
- `GET /api/fs/readFile?path=<relative>` — Reads a file's UTF-8 content. Path is relative to the workspace root.
- `POST /api/fs/writeFile` — Body: `{ path, content }`. Writes UTF-8 content to a file (creates parent directories as needed). Path is relative to the workspace root.
- `POST /api/fs/delete` — Body: `{ path }`. Deletes a file or folder (recursive for directories). Path is relative to the workspace root.
- `POST /api/fs/cleanWorkspace` — Reads `.blueprintfiles` from the workspace root, parses the list of files/folders to keep, and deletes all other root-level entries. Always preserves `.blueprintfiles` itself and `.git`. Returns `{ ok, deleted[], error }`. Supports `{ dryRun: true }` in the request body to preview deletions without executing them.
- `GET /api/auth/user` — Resolves the GitHub token server-side and fetches the user profile. Returns the user object or null.
- `GET /api/copilot/models` — Returns `{ ok, models: [{ id, name }], error? }`.
- `POST /api/copilot/init` — Initializes the Copilot agent with the server-side GitHub token. Returns `{ ok, error? }`.
- `POST /api/copilot/implement` — Body: `{ model, systemPrompt, userPrompt }`. Starts implementation and streams events over the `copilot` WebSocket channel. Returns `{ ok, error? }` on completion.
- `POST /api/copilot/stop` — Stops the active agent session. Returns `{ ok }`.
- `GET /api/git/status` — Runs `git status --porcelain` in the workspace folder and returns parsed entries.

All `path` parameters in filesystem endpoints are validated to prevent path traversal — they must resolve to a location within the workspace folder.

### WebSocket Endpoints

The server upgrades HTTP connections to WebSocket for two channels:

- **`/ws/terminal`** — Bidirectional stream for the integrated terminal. See [terminal.md](terminal.md).
- **`/ws/copilot`** — Server-to-client stream for Copilot agent events (chunks, tool calls, usage, errors, files_changed). See [harness.md](harness.md).
- **`/ws/chat`** — Bidirectional stream for the chat panel. The client sends user messages; the server streams agent responses. See [chat.md](chat.md).

## Client-Side API (`api-client.ts`)

The client-side module provides the browser-to-server API layer. It exports a `serverAPI` object (available globally) with typed methods for all server interactions:

- `readDir(relativePath?)` → `GET /api/fs/readDir`
- `readFile(relativePath)` → `GET /api/fs/readFile`
- `writeFile(relativePath, content)` → `POST /api/fs/writeFile`
- `deleteEntry(relativePath)` → `POST /api/fs/delete`
- `cleanWorkspace(dryRun?)` → `POST /api/fs/cleanWorkspace`
- `getWorkspaceFolder()` → `GET /api/workspace`
- `getUser()` → `GET /api/auth/user`
- `listModels()` → `GET /api/copilot/models`
- `initCopilot()` → `POST /api/copilot/init`
- `implement(options)` → `POST /api/copilot/implement` (events arrive via `/ws/copilot` WebSocket)
- `stopCopilot()` → `POST /api/copilot/stop`
- `gitStatus()` → `GET /api/git/status`
- `connectTerminal()` — Opens a WebSocket to `/ws/terminal`, returns handlers for write/resize/kill.
- `connectChat()` — Opens a WebSocket to `/ws/chat`, returns handlers for send/receive.

## File Browser

The sidebar has two tabs: **Files** and **Git**.

### Files Tab

- Displays a tree view of the workspace folder, populated via `serverAPI.readDir`.
- Directories show expand/collapse arrows (▸/▾) and are sorted before files.
- Clicking a directory both toggles its expanded state and selects it as the active directory (highlighted).
- Files show type-appropriate icons (📝 .md, 🌐 .html, 📜 .ts/.js, etc.).
- Clicking a file loads its content into the editor via `serverAPI.readFile` and clears any directory selection.
- The active file or selected directory is highlighted with the accent color.
- Each tree entry stores its full path in a `data-path` attribute for positioning inline inputs.
- The tree is re-rendered after saving implementation output to reflect new files.

### Toolbar Actions

The sidebar tab bar includes action buttons for file management:

- **New File** (📄) — Creates a new file in the selected directory (or the current file's parent, or workspace root). Shows an inline text input in the tree at the correct position for entering the filename.
- **New Folder** (📁) — Creates a new folder in the selected directory. Shows an inline text input; on commit, creates the folder (via a `.keep` placeholder file) and expands it.
- **Refresh** (🔄) — Re-reads the workspace folder from disk and refreshes the file tree.
- **Delete** (🗑️) — Deletes the selected directory or the currently open file. Shows a `confirm()` dialog describing what will be deleted (including "and all its contents" for folders). On confirmation, removes the entry via `serverAPI.deleteEntry`, clears the editor if the deleted path was open, and refreshes the tree.

### Git Tab

See [git.md](git.md) for details.

### File Operations

- **Autosave**: The editor autosaves to disk on every keystroke with a 500ms debounce via `serverAPI.writeFile`.
- **Save Output**: A save button (💾) in the implementation panel header writes implemented output to a file in the workspace and triggers a browser download of the content.
- **Delete**: The 🗑️ toolbar button deletes the selected folder or current file after confirmation.
- **Clean**: The 🗑 Clean button in the main toolbar removes all files and folders in the workspace root that are not listed in `.blueprintfiles`. Shows a confirmation dialog listing exactly which entries will be deleted. If no `.blueprintfiles` exists, shows an alert prompting the user to create one.
- **Keyboard**: Cmd/Ctrl+S saves the current file to disk immediately.

#### Verification

Use Playwright to verify the file tree loads: navigate to the app URL, wait for the file tree to populate, and verify that `blueprint.md` appears in the file tree.

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

See [output.md](output.md) for details.

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
- A top toolbar contains: application title, workspace folder name, implement button, clean button, layout toggles, and a settings gear icon.

### Settings

See [settings.md](settings.md) for details.

## Testing

Automated end-to-end tests use Playwright to connect to the running web server and verify all basic functionality, plus CLI smoke tests that verify the standalone `blueprint` command works. Tests live in `/test` and are run with Node.js directly (no test framework needed). A GitHub token is required for tests that exercise implementation. In a Codespace the `GITHUB_TOKEN` env variable is available automatically; locally the GitHub CLI can be used to get a token.

```
GITHUB_TOKEN=$(gh auth token) node test/interact.mjs
```

### Test Setup

- Start the web server via `node dist/server.mjs <workspace-folder>` as a child process.
- Wait for the server to be ready (poll `http://localhost:3000` until it responds).
- Use Playwright to open a browser page at `http://localhost:3000`.
- Save screenshots at each stage for visual verification.
- Save screenshots periodically during long stages for visual verification.
- Shut down the server process after tests complete.

### Basic Functionality Tests

The test script verifies the following end-to-end scenarios:

1. **App Launch** — The page loads with the correct title ("Blueprint Implementer").
2. **Folder Open** — The workspace folder is loaded into the sidebar. The folder name appears in the toolbar and `blueprint.md` is visible in the file tree.
3. **File Tree** — Directory entries render with expand/collapse arrows; files show type-appropriate icons. Clicking a file loads its content into the editor.
4. **Implement** — Clicking the Implement button triggers the Copilot agent. The status bar shows "Implementing..." and agent events stream into the xterm.js output terminal.
5. **Implement Completion** — The status element's class changes to `success` (or `error` on failure) and the status text updates. The file tree refreshes to show newly generated files.
6. **Terminal Echo** — The terminal panel is visible, typing an echo command produces output.
7. **Auth Display** — The user avatar and login name are displayed in the toolbar after the server resolves the token.
8. **Model Picker Populated** — After launch, the `#model-select` dropdown has more than one `<option>` and none of them say "unavailable" or "Loading". This confirms that `copilot:listModels` succeeded end-to-end (token resolution → SDK client → `listModels()` → API → renderer).
9. **Implementation Completes** — Click the Implement button, wait for `#implement-status` to have class `success` (timeout: 10 minutes), and take periodic screenshots while waiting. On success, verify that `index.html` appears in the file tree.
10. **Chat Multi-Turn** — Switch to the Chat tab. Type "Create a file called counter.txt containing just the number 1" and send. Wait for the agent response to complete (input re-enabled). Then type "Increase the counter" (without mentioning the filename, to test that conversation history provides context) and send. Wait for the response. Read `test/tictactoe/counter.txt` via `serverAPI.readFile` and assert its trimmed content is "2".

Tests 8–10 require a GitHub token. The test resolves one using the same logic as the app: `GITHUB_TOKEN` env var, falling back to `gh auth token`. If neither is available, the test fails. All tests are in `test/interact.mjs` and use the `test/tictactoe` workspace.

### Test Implementation

Tests use Playwright's browser API:

- Start the server as a child process, then `browser.newPage()` to navigate to the app URL.
- Standard Playwright locators (`locator`, `getByText`) find UI elements.
- `page.evaluate()` executes code in the browser context for API calls.
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

- TypeScript source in `/src`, compiled with esbuild to a renderer IIFE bundle (`dist/app.js`), a server ESM bundle (`dist/server.mjs`), and a CLI implement tool ESM bundle (`cli/index.mjs`).
- An `index.html` shell in `/src` with all CSS embedded, copied to `/dist` at build time. All asset references in `index.html` must be local relative paths — the app is served from `dist/` by the Express server.
- `xterm.css` copied from `node_modules/@xterm/xterm/css/xterm.css` to `/dist` at build time. Referenced via `<link rel="stylesheet" href="xterm.css">` in `index.html`. This is **critical** — without it, xterm.js's internal helper textarea elements become visible as raw text fields in the terminal and output panels.
- `main.md` copied from `/blueprint` to `/dist` for reference.
- Launched via `npm start` (runs `node dist/server.mjs`) which starts the web server on port 3000.
- The server and CLI both use the shared `copilot-agent.ts` module for implementation, which wraps the Copilot SDK (`@github/copilot-sdk`) and manages the Copilot CLI (`@github/copilot`) process automatically. The agent writes files directly to the workspace folder. Model listing also uses the SDK (`CopilotClient.listModels()`). Only GitHub user lookup (`GET /user`) uses Node.js `https` directly.
- The server serves `dist/` as static files; navigating to `/` loads `index.html`.
- A workspace folder can be passed on the command line: `node dist/server.mjs /path/to/folder`.
- **Runtime dependencies** (must be in `dependencies`, not `devDependencies`): `@github/copilot-sdk`, `@github/copilot`, `@xterm/xterm`, `marked`, `node-pty`, `express`, `ws`. The SDK is bundled into the server and CLI at build time, but `@github/copilot` must remain in `node_modules` at runtime because its platform-specific native binary is spawned as a child process. `node-pty` is externalized because it contains native `.node` addons that must be loaded from disk.
- **Build-time dependencies** (in `devDependencies`): `esbuild`, `typescript`, `@types/node`, `@types/express`, `playwright`.

### CLI Implement Tool

A standalone Node.js script (`implement-cli.ts` → `cli/index.mjs`) that implements markdown blueprints from the command line without launching the server. It uses the same shared `copilot-agent.ts` module as the server.

```
blueprint implement <workspace-folder> [--model <model>]
```

- Resolves a GitHub token using the same logic as the server: `GITHUB_TOKEN` env var first, falling back to `gh auth token`. Exits with an error if neither is available.
- Uses the shared `copilot-agent` module — same `initAgent()`, `implementWithAgent()`, and system prompt as the server.
- The agent writes output files directly to the workspace folder (the directory containing the input markdown file).
- Logs agent events (tool calls, progress, usage) to stdout with `[implement]` prefix and emoji markers.
- Default model: `claude-opus-4.5`.
- On activity timeout (no events for 120 seconds), the CLI automatically retries up to 3 times with a 10-second delay between attempts. Each retry reinitializes the agent with a fresh session. Non-timeout errors fail immediately.
- **Global install**: `npm run install-cli` builds, then uses `npm pack` in `cli/` to create a tarball and installs it globally from that tarball (`npm install -g blueprint-1.0.0.tgz`). This copies the files rather than symlinking — important because `npm install -g ./cli` creates a symlink back to the workspace, which breaks when the workspace is cleaned or moved.

### End-to-End Verification

`test/tictactoe/blueprint.md` is a small self-contained blueprint that produces a single-file HTML tic-tac-toe game. All Playwright tests (steps 1–8 above) run against this workspace.

#### CLI Verification

The test script (`test/interact.mjs`) includes automated CLI smoke tests that run **before** the Playwright/browser tests. These verify the packaged CLI works correctly after building, installed locally to a temp directory to avoid polluting the global `npm` path.

**Setup**: Build the CLI, pack it with `npm pack` in `cli/`, then install the tarball into a temp directory using `npm install --prefix <tmpdir> ./cli/blueprint-1.0.0.tgz`. Run the `blueprint` binary from `<tmpdir>/node_modules/.bin/blueprint`. Clean up the temp directory after the tests.

1. **Help text** — Run `blueprint` with no arguments. Assert it exits with a non-zero exit code and its combined stdout/stderr output contains the word "usage" (case-insensitive). This catches bundling errors (e.g., duplicate ESM imports, syntax errors) and dependency issues (e.g., missing Copilot CLI) that would prevent the CLI from working after install.

2. **Clean** — Run `blueprint clean test/tictactoe`. Assert it exits successfully (exit code 0).

3. **Implement** — Run `blueprint implement test/tictactoe`. Assert it exits successfully and `test/tictactoe/index.html` exists afterward.

These CLI tests use `execFileSync` (or `execFile`) to invoke the locally installed `blueprint` binary — not `node cli/index.mjs`, and not a global install. No Playwright involved. They must be part of the same `test/interact.mjs` script so they run as part of the standard test suite.
