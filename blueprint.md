<!--
 Copyright (c) Microsoft Corporation. All rights reserved.
 Licensed under the MIT License. See License.txt in the project root for license information.
-->

# Blueprint

## Folder Structure

```
src/          ← design documents and static assets
built/        ← TypeScript source files and HTML
dist/         ← build output (bundled JS, copied assets) — not checked in
```

## Tech Stack

- **Electron** — desktop shell (main process, preload, renderer)
- **TypeScript** — source language (target ES2020, bundler module resolution)
- **esbuild** — bundler (IIFE for renderer, CJS for main/preload, ESM for CLI tools)
- **marked** — Markdown rendering

## Build

```
npm run build     # runs build.mjs → bundles to dist/
npm start         # launches Electron
npm run dev       # build + start
```
