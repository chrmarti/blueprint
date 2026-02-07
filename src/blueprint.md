<!--
 Copyright (c) Microsoft Corporation. All rights reserved.
 Licensed under the MIT License. See License.txt in the project root for license information.
-->

# Blueprint Compiler

<!-- This document is the canonical definition of the application. The TypeScript
     implementation lives under /built, compiles to /dist, and is served from a
     local HTTP server. Keep this file in /src up to date whenever the
     implementation changes. -->

A web-based authoring environment for writing structured markdown blueprints and compiling them into executable applications using the Copilot SDK.

## Overview

Blueprint Compiler is a self-hosting tool: a markdown document describes an application, and the tool transforms that description into working code. The tool itself is defined by the document you are reading now, and will be compiled by an early bootstrap version of itself until it can produce its own runtime.

## Project Structure

```
/src/blueprint.md     ← this document (canonical definition)
/built/               ← TypeScript source
  main.ts             ← entry point, boots all modules
  editor.ts           ← editor panel (textarea, outline, markdown preview)
  compiler.ts         ← compilation panel (Copilot SDK streaming call)
  preview.ts          ← preview panel (iframe sandbox, console forwarding)
  layout.ts           ← drag-handle resizable three-column layout
  settings.ts         ← settings modal, history drawer, theme, import/export
  storage.ts          ← localStorage persistence layer
  index.html          ← HTML shell with all CSS
/dist/                ← compiled output (esbuild bundle)
  index.html          ← copied from /built
  app.js              ← bundled JS (IIFE)
  app.js.map          ← source map
  blueprint.md        ← copied from /src for default loading
package.json          ← dependencies: esbuild, typescript, marked
tsconfig.json         ← TypeScript config (target ES2020, bundler resolution)
build.mjs             ← build script: esbuild bundle + file copy
```

## Architecture

The application is a single-page web UI composed of three primary regions:

1. **Editor Panel** — A markdown editor with syntax highlighting, live preview, and structural navigation.
2. **Compilation Panel** — Controls for invoking the Copilot SDK to transform the markdown into source code, with streaming output and error display.
3. **Preview Panel** — A live-rendered view of the compiled application running in a sandboxed iframe.

### Technology Stack

- **Frontend**: TypeScript compiled via esbuild into a single IIFE bundle, no framework dependencies.
- **Markdown Engine**: `marked` (npm) for rendering and structural analysis.
- **Compilation Backend**: Copilot SDK / OpenAI-compatible chat completions endpoint, invoked client-side with streaming, translating authored markdown into application source code.
- **Runtime Sandbox**: An iframe with `srcdoc` and `sandbox="allow-scripts allow-modals"` for rendering and executing compiled output in isolation.
- **Build Tooling**: esbuild for bundling, TypeScript for type checking. Single `node build.mjs` produces `/dist`.

## Editor Panel

The editor is a full-featured markdown authoring surface.

### Requirements

- Monospaced text input area with line numbers.
- Live-rendered markdown preview in a split or tabbed view.
- Syntax highlighting for markdown constructs (headings, code blocks, lists, links).
- A document outline sidebar derived from heading structure, supporting click-to-navigate.
- Autosave to `localStorage` on every keystroke with debounce (500ms).
- Import and export of `.md` files via drag-and-drop and file picker.
- Keyboard shortcuts: `Cmd/Ctrl+S` to force save, `Cmd/Ctrl+B` to compile, `Cmd/Ctrl+P` to toggle preview.

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
- Compilation output is stored in `localStorage` alongside the source document.

### Copilot SDK Integration

- Uses any OpenAI-compatible chat completions endpoint (configurable in settings).
- Model selection input field (default: `gpt-4o`).
- Temperature slider (default: 0) for controlling output determinism.
- Max token limit input (default: 16000).
- An API key input field, stored in `localStorage` (with a warning label about client-side storage).
- Streaming via `ReadableStream` reader, parsing SSE `data:` lines in real time.

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
- A top toolbar contains: application title, compile button, layout toggles, and a settings gear icon.

### Settings

Accessible via gear icon in the toolbar:

- Theme toggle (light / dark).
- Font size adjustment for the editor.
- Copilot SDK configuration (API key, model, temperature, max tokens).
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

- TypeScript source in `/built`, compiled with esbuild to a single IIFE bundle in `/dist/app.js`.
- An `index.html` shell in `/built` with all CSS embedded, copied to `/dist` at build time.
- `blueprint.md` copied from `/src` to `/dist` so the app can load it as default content.
- Served via `npx http-server dist -p 8080 -c-1` (no caching).
- No build-time framework dependencies beyond esbuild, typescript, and marked.

This is sufficient to compile this document into the first real version of the tool.
