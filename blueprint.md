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
release/      ← packaged Electron app — not checked in
```

## Tech Stack

- **Electron** — desktop shell (main process, preload, renderer)
- **TypeScript** — source language (target ES2020, bundler module resolution)
- **esbuild** — bundler (IIFE for renderer, CJS for main/preload, ESM for CLI tools, target node22)
- **@electron/packager** — packages the Electron app as a macOS `.app` bundle
- **marked** — Markdown rendering
- **@xterm/xterm** — terminal emulator for implementation output (renders ANSI escape codes)
- **playwright** — UI testing

## Build

```
npm run build        # runs build.mjs → bundles to dist/ and cli/
npm start            # launches Electron
npm run dev          # build + start
npm test             # run tests
npm run package      # build + package macOS .app to release/
npm run install-cli  # build + globally install the CLI
```

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
is shared between the CLI and the Electron app.
