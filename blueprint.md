<!--
 Copyright (c) Microsoft Corporation. All rights reserved.
 Licensed under the MIT License. See License.txt in the project root for license information.
-->

# Blueprint

## Folder Structure

```
blueprint/    ← design documents and static assets
src/          ← TypeScript source files and HTML
test/         ← Test scripts and fixtures
cli/          ← CLI npm package (package.json checked in, build output gitignored)
dist/         ← build output (bundled JS, copied assets) — not checked in
```

## Tech Stack

- **Node.js + Express** — HTTP server and WebSocket host (serves the frontend, provides REST API and WebSocket endpoints)
- **TypeScript** — source language (target ES2020, bundler module resolution)
- **esbuild** — bundler (IIFE for renderer, ESM for server and CLI tools, target node22)
- **marked** — Markdown rendering
- **@xterm/xterm** — terminal emulator for implementation output (renders ANSI escape codes)
- **ws** — WebSocket library for terminal and agent event streaming
- **node-pty** — pseudo-terminal for the integrated terminal (server-side, exposed over WebSocket)
- **playwright** — UI testing

## Build

```
npm run build        # runs build.mjs → bundles to dist/ and cli/
npm start            # launches the web server (default port 3000)
npm run dev          # build + start
npm test             # run tests
npm run install-cli  # build + globally install the CLI
```

## Verification

Each blueprint document contains `Verification` sections that describe specific functionality to verify using Playwright. After implementation is complete and the build passes:

1. Scan all blueprint documents for `Verification` sections.
2. For each verification, write a Playwright test script in the `test/` directory. Use Playwright to connect to the running web app at `http://localhost:3000` and verify the described behavior.
3. Run all verification tests. If any test fails, fix the implementation and re-run until all tests pass.
4. Do not consider the implementation complete until every verification test passes after the last code change.

## CLI

The project produces a standalone CLI (`blueprint`) published as an npm package from `cli/`.
It uses subcommands:

```
blueprint implement <folder>              # implement a blueprint into code
blueprint implement <folder> --model X    # use a specific model
blueprint clean <folder>                  # remove generated files (keeps .blueprintfiles and .git)
blueprint clean <folder> --dry-run        # preview what would be deleted
blueprint models                          # list available models
```

Workspace cleanup is driven by a `.blueprintfiles` file in the workspace root listing
paths to keep (one per line, `#` comments). The clean logic lives in `src/clean.ts` and
is shared between the CLI and the web server.

The CLI bundles `@github/copilot-sdk` inline (not external) to avoid ESM resolution
issues when installed globally. It only depends on `@github/copilot` at runtime for the
copilot binary. A `createRequire` shim is injected via esbuild banner so bundled CJS
code can `require()` Node builtins in the ESM output. The user prompt is prefixed with
a directive to implement immediately without asking for confirmation.
