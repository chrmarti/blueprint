<!--
 Copyright (c) Microsoft Corporation. All rights reserved.
 Licensed under the MIT License. See License.txt in the project root for license information.
-->

# Terminal

An integrated terminal panel at the bottom of the Editor panel, providing an interactive shell session with its working directory set to the opened workspace folder.

## Architecture

The terminal uses `node-pty` in the Electron main process to spawn a real pseudo-terminal, and `@xterm/xterm` in the renderer to display it. Data flows bidirectionally via IPC:

- **Main process** (`electron.ts`): Spawns a pty process using `node-pty`, relays output to the renderer via `terminal:data` events, and accepts input via `terminal:write` IPC.
- **Renderer** (`terminal.ts`): Hosts an xterm.js `Terminal` instance, sends keystrokes to the main process, and renders pty output.

`node-pty` is a native module and must be rebuilt for Electron's Node.js version using `electron-rebuild`. It is marked as `external` in the esbuild config so it is loaded from `node_modules` at runtime.

## UI

The terminal panel sits below the editor/browser area in the Editor panel, separated by a horizontal drag handle for resizing.

### Layout

- Default height: 200px, minimum 60px.
- A horizontal drag handle (`drag-handle-h`) between the editor area and terminal allows vertical resizing.
- The terminal container fills the panel body and uses a `ResizeObserver` to auto-fit the xterm.js grid (cols/rows) to the available space. The fit function calculates cols/rows from the container dimensions and both resizes the xterm.js `Terminal` and calls `terminalResize(cols, rows)` to sync the pty. This fit function is also called immediately after `terminalSpawn()` returns, since the `ResizeObserver` only fires on size changes and won't trigger if the container is already at its final size when the pty spawns.

### Appearance

- Uses the same theme variables as the rest of the app (`--bg-surface`, `--text`, `--text-muted`).
- Monospaced font matching the editor (`SF Mono`, `Fira Code`, etc.).
- Bar cursor with blinking enabled.
- Updates theme dynamically when the user toggles light/dark mode.

## IPC Handlers

- `terminal:spawn` — Spawns a new shell process (kills any existing one first). Uses the user's default shell (`$SHELL` on Unix, `powershell.exe` on Windows) with the workspace folder as cwd. Sets `TERM=xterm-256color` for full color support. The pty starts with default dimensions (80×24). The renderer must call `terminalResize()` immediately after spawn to sync the pty to the actual terminal container size. Sends `terminal:data` events to the renderer for output and `terminal:exit` when the process ends.
- `terminal:write` — Writes data (user keystrokes) to the pty's stdin.
- `terminal:resize` — Resizes the pty to match the renderer's cols/rows.
- `terminal:kill` — Kills the current shell process.

## Lifecycle

- The terminal spawns automatically when the app starts (after `initTerminalPanel()`).
- When a new workspace folder is opened, the terminal is killed and respawned with the new folder as cwd.
- When the shell process exits, `[Process exited]` is shown in the terminal output.
- Theme changes are applied immediately via `updateTerminalTheme()`.

### Verification

Use Playwright to verify the terminal is functional after app launch: wait for the terminal panel's xterm.js instance to render, then confirm that the terminal contains visible text content (e.g., a shell prompt or directory name), not just a blinking cursor on an empty screen.

## Preload API

The preload script exposes these methods on `window.electronAPI`:

- `terminalSpawn()` — Spawns the shell, returns `{ ok: boolean }`.
- `terminalWrite(data)` — Sends input to the shell.
- `terminalResize(cols, rows)` — Resizes the pty.
- `terminalKill()` — Kills the shell.
- `onTerminalData(callback)` — Listens for pty output.
- `onTerminalExit(callback)` — Listens for process exit.
- `removeTerminalDataListeners()` / `removeTerminalExitListeners()` — Cleanup.
