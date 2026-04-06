<!--
 Copyright (c) Microsoft Corporation. All rights reserved.
 Licensed under the MIT License. See License.txt in the project root for license information.
-->

# Terminal

An integrated terminal panel at the bottom of the Editor panel, providing an interactive shell session with its working directory set to the workspace folder.

## Architecture

The terminal uses `node-pty` on the server to spawn a real pseudo-terminal, and `@xterm/xterm` with `@xterm/addon-fit` in the browser to display it. Data flows bidirectionally via WebSocket:

- **Server** (`server.ts`): Spawns a pty process using `node-pty`, relays output to the browser via the `/ws/terminal` WebSocket, and accepts input via incoming WebSocket messages.
- **Browser** (`terminal.ts`): Hosts an xterm.js `Terminal` instance with the `FitAddon` for automatic sizing, sends keystrokes to the server over WebSocket, and renders pty output.

`node-pty` is a native module and is marked as `external` in the esbuild config so it is loaded from `node_modules` at runtime.

## UI

The terminal panel sits below the editor/browser area in the Editor panel, separated by a horizontal drag handle for resizing.

### Layout

- Default height: 200px, minimum 60px.
- A horizontal drag handle (`drag-handle-h`) between the editor area and terminal allows vertical resizing.
- The terminal container fills the panel body and uses a `ResizeObserver` to auto-fit the xterm.js grid (cols/rows) to the available space via `@xterm/addon-fit`. The `FitAddon.fit()` method measures actual cell dimensions using xterm's internal render metrics, then resizes the terminal and sends a resize message over WebSocket to sync the pty. This fit is also called immediately after the WebSocket connects and the pty spawns, since the `ResizeObserver` only fires on size changes and won't trigger if the container is already at its final size.

### Appearance

- Uses the same theme variables as the rest of the app (`--bg-surface`, `--text`, `--text-muted`).
- Monospaced font matching the editor (`SF Mono`, `Fira Code`, etc.).
- Bar cursor with blinking enabled.
- Updates theme dynamically when the user toggles light/dark mode.

## WebSocket Protocol (`/ws/terminal`)

The server upgrades HTTP connections at `/ws/terminal` to a WebSocket. Messages are JSON-encoded:

### Client → Server

- `{ type: "spawn" }` — Spawns a new shell process (kills any existing one first). Uses the user's default shell (`$SHELL` on Linux) with the workspace folder as cwd. Sets `TERM=xterm-256color` for full color support. The pty starts with default dimensions (80×24). The client should send a `resize` message immediately after to sync the pty to the actual terminal container size.
- `{ type: "write", data: "<input>" }` — Writes data (user keystrokes) to the pty's stdin.
- `{ type: "resize", cols: N, rows: N }` — Resizes the pty to match the browser's cols/rows.
- `{ type: "kill" }` — Kills the current shell process.

### Server → Client

- `{ type: "data", data: "<output>" }` — Pty output (terminal content).
- `{ type: "exit" }` — The shell process exited.

## Lifecycle

- The terminal spawns automatically when the page loads and the WebSocket connects.
- The browser sends a `spawn` message once the WebSocket `open` event fires (via the `onOpen` callback), followed by a `resize` to set the correct dimensions. This avoids race conditions from arbitrary timeouts.
- When the shell process exits, `[Process exited]` is shown in the terminal output.
- Theme changes are applied immediately via `updateTerminalTheme()`.

### Verification

Write a Playwright test to verify the terminal is functional after the page loads. The terminal exposes its xterm.js `Terminal` instance as `window._xtermTerminal` for test access. Tests should read terminal content through the xterm buffer API (`terminal.buffer.active.getLine(i).translateToString()`) rather than screenshots or DOM scraping.

The test must:
1. Wait for the shell prompt to appear by polling the xterm buffer for a non-empty line.
2. Type and run an echo command with some longish text.
3. Assert the echo output appears in the xterm buffer.
4. Verify the terminal reports valid dimensions (`terminal.cols > 0`, `terminal.rows > 0`).

## Client-Side API

The `api-client.ts` module exposes these methods on `serverAPI`:

- `connectTerminal()` — Opens a WebSocket to `/ws/terminal`. Returns an object with:
  - `send(message)` — Send a JSON message to the server (silently drops if not yet connected).
  - `onData(callback)` — Listen for pty output.
  - `onExit(callback)` — Listen for process exit.
  - `onOpen(callback)` — Listen for WebSocket connection open (fires immediately if already open).
  - `close()` — Close the WebSocket connection.
