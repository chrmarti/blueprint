<!--
 Copyright (c) Microsoft Corporation. All rights reserved.
 Licensed under the MIT License. See License.txt in the project root for license information.
-->

# Blueprint Compiler

<!-- This document is the canonical definition of the application. The TypeScript
     implementation lives under /built, compiles to /dist, and runs as an
     Electron desktop application that opens on a local folder. Keep this file
     in /src up to date whenever the implementation changes. -->

A desktop authoring environment for writing structured markdown blueprints and compiling them into executable applications using the Copilot SDK. Built with Electron, the app opens on a local folder and reads/writes files directly on disk.

## Overview

Blueprint Compiler is a self-hosting tool: a markdown document describes an application, and the tool transforms that description into working code. The tool itself is defined by the document you are reading now, and will be compiled by an early bootstrap version of itself until it can produce its own runtime.

## Project Structure

```
/src/blueprint.md     ← this document (canonical definition)
/built/               ← TypeScript source
  electron.ts         ← Electron main process (window, menu, IPC, embedded server)
  preload.ts          ← preload script (contextBridge for IPC)
  main.ts             ← renderer entry point, boots all modules
  editor.ts           ← editor panel (textarea, outline, markdown preview)
  compiler.ts         ← compilation panel (Copilot API streaming call)
  preview.ts          ← preview panel (iframe sandbox, console forwarding)
  layout.ts           ← drag-handle resizable three-column layout
  settings.ts         ← settings modal, history drawer, theme, import/export
  storage.ts          ← localStorage persistence layer (settings, history)
  files.ts            ← file browser module (tree view, open/save via IPC)
  auth.ts             ← GitHub OAuth device flow + Copilot token management
  types.d.ts          ← global type declarations (ElectronAPI)
  index.html          ← HTML shell with all CSS
/dist/                ← compiled output (esbuild bundle)
  index.html          ← copied from /built
  app.js              ← bundled renderer JS (IIFE)
  electron.cjs        ← bundled Electron main process (CJS)
  preload.cjs         ← bundled preload script (CJS)
  blueprint.md        ← copied from /src for reference
package.json          ← dependencies: electron, esbuild, typescript, marked
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
- **Compilation Backend**: GitHub Copilot chat completions API, accessed via the user's GitHub account and Copilot subscription. An embedded HTTP server in the Electron main process proxies API requests.
- **File System**: Electron IPC (`ipcMain.handle` / `ipcRenderer.invoke`) for reading directories, reading files, writing files, and showing native dialogs.
- **Runtime Sandbox**: An iframe with `srcdoc` and `sandbox="allow-scripts allow-modals"` for rendering and executing compiled output in isolation.
- **Build Tooling**: esbuild for bundling (renderer IIFE + main CJS + preload CJS), TypeScript for type checking.

## Electron Main Process

The Electron main process (`electron.ts`) handles:

### Window Management

- Creates a `BrowserWindow` (1400×900 default) loading the renderer from an embedded HTTP server.
- Supports a folder path argument on the command line: `electron . /path/to/folder`.
- Sets the window title to include the workspace folder name.
- Application menu with File → Open Folder (Cmd+Shift+O), standard Edit and View menus.

### Embedded HTTP Server

- Starts an HTTP server on a random available port (`port 0`) bound to `127.0.0.1`.
- Serves static files from the `/dist` directory (same as `__dirname`).
- Proxies API routes to GitHub and Copilot (same routes as before — see Server Proxy Routes below).
- The renderer loads from `http://127.0.0.1:<port>`, so all existing `fetch()` calls work unchanged.

### IPC Handlers

- `dialog:openFolder` — Opens a native folder picker, returns the selected path.
- `workspace:getFolder` — Returns the current workspace folder path.
- `fs:readDir` — Lists directory entries (name, isDirectory), sorted directories-first, excluding dotfiles.
- `fs:readFile` — Reads a file's UTF-8 content.
- `fs:writeFile` — Writes UTF-8 content to a file (creates parent directories as needed).
- `dialog:saveFile` — Opens a native save dialog, returns the chosen path.

### Preload Script

The preload script (`preload.ts`) uses `contextBridge.exposeInMainWorld` to expose a safe `window.electronAPI` object with typed methods for all IPC operations.

## File Browser

The editor panel's sidebar has two tabs: **Files** and **Outline**.

### Files Tab

- Displays a tree view of the workspace folder, populated via `electronAPI.readDir`.
- Directories show expand/collapse arrows (▸/▾) and are sorted before files.
- Files show type-appropriate icons (📝 .md, 🌐 .html, 📜 .ts/.js, etc.).
- Clicking a file loads its content into the editor via `electronAPI.readFile`.
- The active file is highlighted with the accent color.
- The tree is re-rendered after saving compilation output to reflect new files.

### Outline Tab

- Derived from heading structure (H1–H3) of the currently open markdown file.
- Click-to-navigate scrolls the editor to the corresponding heading.

### File Operations

- **Open Folder**: Toolbar button or File → Open Folder (Cmd+Shift+O) shows a native folder picker.
- **Autosave**: The editor autosaves to disk on every keystroke with a 500ms debounce via `electronAPI.writeFile`.
- **Save Output**: A save button (💾) in the compilation panel header opens a native save dialog to write compiled HTML to disk.
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

- A **Compile** button that sends the current markdown content to the Copilot SDK.
- The SDK prompt is constructed by combining:
  - A system message defining the compiler's role: *"You are a code generator. Given a structured markdown document describing an application, produce a complete, self-contained HTML file with embedded CSS and JavaScript that implements every requirement described. Output only the HTML file content, no explanation."*
  - The full markdown document as the user message.
- Streaming response display: compiled output appears token-by-token in a read-only code viewer.
- An **errors** section that surfaces any SDK invocation failures or malformed output.
- A **history** drawer listing previous compilations with timestamps, allowing rollback.
- A **save** button (💾) to write compiled output to a file on disk via a native save dialog.
- Compilation output is stored in `localStorage` for session persistence.

### Copilot SDK Integration

- Authentication via GitHub OAuth device flow (no API keys needed).
- Users sign in with their GitHub account; the app obtains a Copilot token using their subscription.
- The embedded server proxies requests to `https://api.githubcopilot.com/chat/completions`.
- Model selection dropdown, dynamically populated from the Copilot API's available models list (default: `claude-opus-4.6`).
- Max token limit is auto-filled from the selected model's `capabilities.limits.max_output_tokens` metadata.
- Temperature slider (default: 0) for controlling output determinism.
- Streaming via `ReadableStream` reader, parsing SSE `data:` lines in real time.

## Authentication

The application uses the GitHub OAuth device flow to authenticate users and access their Copilot subscription.

### Device Flow

1. User clicks "Sign in with GitHub" in the toolbar or settings.
2. The app requests a device code from GitHub via the embedded proxy (`/api/auth/device-code`).
3. A one-time code is displayed; the user copies it and opens GitHub's verification page.
4. The app polls for authorization (`/api/auth/token`) until the user completes sign-in.
5. On success, the GitHub access token is stored in `localStorage`.

### Copilot Token

- After GitHub sign-in, the app fetches a Copilot API token from `https://api.github.com/copilot_internal/v2/token` (proxied through `/api/copilot/token`).
- The Copilot token is cached in `localStorage` and refreshed when it nears expiration.
- All compilation requests use this token to authenticate with the Copilot chat completions endpoint.

### Server Proxy Routes

The embedded HTTP server provides these proxy endpoints:

- `POST /api/auth/device-code` → `https://github.com/login/device/code`
- `POST /api/auth/token` → `https://github.com/login/oauth/access_token`
- `GET /api/github/user` → `https://api.github.com/user`
- `GET /api/copilot/token` → `https://api.github.com/copilot_internal/v2/token`
- `GET /api/copilot/models` → `https://api.githubcopilot.com/models`
- `POST /api/copilot/chat` → `https://api.githubcopilot.com/chat/completions` (streaming)

## Preview Panel

The preview panel renders the compiled output as a live, interactive application.

### Requirements

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

The defining goal of this project is self-hosting. The workflow proceeds as follows:

1. **Bootstrap Phase**: A minimal, hand-written version of the tool is built — just enough to load this document, send it to the Copilot SDK, and render the result.
2. **First Compilation**: The bootstrap version compiles this document into a more complete version of the tool.
3. **Iteration**: The compiled version is used to edit this document and recompile, progressively improving fidelity.
4. **Convergence**: The tool reaches a fixed point where compiling this document produces output functionally identical to the previous compilation.

At convergence, the tool is fully self-hosting: it is both the product and the factory.

## Bootstrap Implementation

The initial bootstrap version is the TypeScript implementation under `/built`, compiled to `/dist` via `node build.mjs`.

### Bootstrap Requirements

- TypeScript source in `/built`, compiled with esbuild to a renderer IIFE bundle (`dist/app.js`), an Electron main process CJS bundle (`dist/electron.cjs`), and a preload CJS bundle (`dist/preload.cjs`).
- An `index.html` shell in `/built` with all CSS embedded, copied to `/dist` at build time.
- `blueprint.md` copied from `/src` to `/dist` for reference.
- Launched via `npm start` (runs `electron .`) which starts the Electron app.
- The Electron main process starts an embedded HTTP server on a random port, serves static files from `/dist`, and proxies API calls.
- The renderer loads from `http://127.0.0.1:<port>` inside the BrowserWindow.
- A folder can be passed on the command line: `npm start -- /path/to/folder`.
- No build-time framework dependencies beyond electron, esbuild, typescript, and marked.

This is sufficient to compile this document into the first real version of the tool.
