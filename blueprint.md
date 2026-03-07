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
