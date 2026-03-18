<!--
 Copyright (c) Microsoft Corporation. All rights reserved.
 Licensed under the MIT License. See License.txt in the project root for license information.
-->

# Agent Harness

The Copilot SDK agent runs with a set of custom tools defined by the host application. These tools extend the agent's built-in capabilities (filesystem, shell, etc.) with application-specific actions.

## Custom Tools

### `open_in_preview_browser`

Opens a URL in the application's Preview panel — the embedded browser on the right side of the UI.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `url` | string | yes | The URL to open (e.g., `http://localhost:3000`) |

**Behavior:**

- Sets the Preview panel's iframe `src` to the given URL.
- Reveals the Preview panel if it is collapsed.
- Returns a confirmation string to the agent (e.g., `Opened http://localhost:3000 in the Preview panel.`).

**Use case:** After the agent starts a dev server via the shell tool, it calls `open_in_preview_browser` to show the running application to the user without requiring manual navigation.

**Implementation:** Defined in `copilot-agent.ts` via the SDK's `defineTool()` helper with a raw JSON schema for parameters. The tool's handler emits a `preview_url` event through the `onEvent` callback, which the Electron main process relays to the renderer via IPC (`copilot:event`). The renderer's `implementer.ts` handles the event by calling `loadPreviewUrl()` from `preview.ts` and un-collapsing the preview panel.

## System Prompt

The system prompt is appended to the SDK's built-in prompt (using `mode: 'append'`) and includes:

1. The base role definition: code generator operating in the project workspace root, following `blueprint.md` conventions.
2. A structured workflow: Planning & Discovery → Implementation → Verification → Delivery.
3. A description of the `open_in_preview_browser` tool and when to use it.
4. The contents of `blueprint.md` from the workspace root (injected by `electron.ts` at implement time, if the file exists).

```
You are a code generator working in a project workspace. The workspace root contains a blueprint.md file that describes the application to build — its architecture, components, file structure, and behavior. The blueprint may be self-contained or it may reference other markdown documents in the workspace that together make up the full specification. Your job is to read the blueprint and turn it into working code.

Follow this workflow:

## Planning & Discovery
1. Start by reading blueprint.md in the workspace root. If it references other markdown files, read those too to get the complete picture.
2. Scan the existing project structure — list directories, check for existing source files, package.json, build scripts, and installed tools. Understand what already exists before writing anything.
3. Form a plan: identify which files need to be created or updated, in what order, and how you will verify the result.

## Implementation
4. Each section in the blueprint describes a module, component, or file to generate. Create or update the source files in the workspace using your file tools. Write complete, working code — not stubs or placeholders.
5. Use strong typing everywhere. Avoid the `any` type — use precise types, interfaces, or generics instead.
6. The blueprint defines the project's folder structure, naming conventions, build tools, and processes. Follow those conventions exactly when deciding where to place files and how to structure them.
7. If the project already has existing files, preserve them unless the blueprint explicitly describes replacing them. Merge new code with the existing codebase.

## Verification
8. The generated source must compile and type-check without errors. After writing files, install any needed dependencies (npm install, etc.) and verify both type-checking (e.g., `npx tsc --noEmit`) and the build step pass without errors.
9. When installing packages, always use the latest versions available. Do not pin to old versions you may have seen during training — use `npm install <package>@latest` or omit version specifiers to get the current release.
10. Write tests for any existing functionality you changed and for any new functionality you implemented. Run all tests and verify they pass. Don't just re-read your own code — execute it.
11. If compilation or tests fail, read the full error output, diagnose the root cause, and fix it. If you find yourself editing the same file repeatedly without progress, step back and reconsider your approach.
12. After the build passes, scan the blueprint documents for sections titled "Verification". For each one, write a test script that verifies the described behavior (e.g., using Playwright for Electron apps, or the project's test framework). Run all verification tests and fix any failures before considering the implementation complete.

## Delivery
13. If the project has a dev server, start it and use the open_in_preview_browser tool to show it in the Preview panel.

You have a custom tool available: open_in_preview_browser. Call it with a URL (e.g., http://localhost:3000) to open that URL in the application's embedded browser. Use this after starting a dev server so the user can see the running application.
```

## Copilot Agent (Shared Module)

The `copilot-agent.ts` module is the shared implementation backend, used by both the Electron main process and the standalone CLI. It wraps the Copilot SDK:

- `initAgent({ githubToken, appRoot, noSandbox? })` — Stores the init options and stops any existing client. Does **not** create the `CopilotClient` yet — client creation is deferred to `implementWithAgent()`, where the workspace folder is known and can be used for safehouse `--workdir`. Safe to call multiple times.
- `implementWithAgent({ model, markdown, workspaceFolder, systemPrompt?, onEvent })` — Creates (or reuses) the `CopilotClient` for the given workspace folder. If the workspace folder differs from the previous run, the client is recreated so that safehouse `--workdir` and `cwd` point at the correct directory. Then creates a streaming session with `workingDirectory: workspaceFolder` so the agent's file tools operate in the project folder. Attaches a wildcard event listener that emits typed `ImplementEvent`s (`log`, `chunk`, `tool_start`, `tool_complete`, `usage`, `error`, `done`, `files_changed`). Calls `sendAndWait()` with a 600-second timeout. Returns `{ ok, error? }`.
- `stopAgent()` — Destroys the active session and stops the client.

The module uses `import type` for compile-time SDK types (e.g., `import type { CopilotClient, CopilotClientOptions, CopilotSession, SessionEvent } from '@github/copilot-sdk'`) and `await import('@github/copilot-sdk')` at runtime, since the SDK is ESM-only and the Electron main process is bundled as CJS. Always use the SDK's exported types rather than ad-hoc type annotations — use `CopilotClientOptions` for client construction, `SessionEvent` for event listener callbacks, `SessionConfig` for session creation, etc.

## Sandbox (Safehouse)

The Copilot CLI runs inside an [agent-safehouse](https://github.com/eugene1g/agent-safehouse) sandbox on macOS. Safehouse uses macOS Seatbelt (`sandbox-exec`) to enforce a deny-by-default policy that restricts the agent's filesystem access, process execution, and other system calls.

### Setup

The safehouse script is downloaded during `npm install` via a `postinstall` script in `package.json`:

```
mkdir -p scripts && curl -fsSL https://raw.githubusercontent.com/eugene1g/agent-safehouse/main/dist/safehouse.sh -o scripts/safehouse && chmod +x scripts/safehouse
```

The script lives at `scripts/safehouse`, is listed in `.gitignore`, and is copied into the CLI npm package at build time (`build.mjs` copies it to `cli/scripts/safehouse`).

### CLI Binary Resolution

`resolveCLIPath()` prefers the platform-specific native binary at `node_modules/@github/copilot-<platform>-<arch>/copilot` (e.g., `copilot-darwin-arm64/copilot`). This is a standalone executable that doesn't require Node.js. If the native binary isn't available, it falls back to the JS entry point at `node_modules/@github/copilot/npm-loader.js`.

Using the native binary is critical for safehouse integration: safehouse auto-detects the `copilot` command basename and loads the `copilot-cli.sb` agent profile, which grants access to `~/.copilot` (config/state) and requires the keychain integration profile. With the JS entry point, the command would be `node` or the Electron binary, and the copilot-cli profile would not be auto-detected.

### Integration

`implementWithAgent()` in `copilot-agent.ts` creates the `CopilotClient` on first use (or recreates it when the workspace folder changes) and configures it to run the CLI through safehouse:

```ts
new CopilotClient({
  cwd: workspaceFolder,
  cliPath: safehousePath,           // scripts/safehouse
  cliArgs: [
    '--workdir', workspaceFolder,               // read+write access to the workspace
    '--add-dirs-ro', opts.appRoot,   // read-only access to appRoot (for the CLI binary in node_modules)
    '--enable=electron',            // enable Electron/Chromium sandbox profile (GPU, Metal, crashpad, window server)
    '--add-dirs', electronCachePath + ':' + appSupportPath,  // Electron download cache + app data (Code Cache, GPU cache)
    '--append-profile', electronExtraProfilePath,  // supplementary Electron sandbox rules (Mach IPC, user fonts)
    '--env-pass=COPILOT_SDK_AUTH_TOKEN',  // pass the auth token through the sanitized env
    cliPath,                        // the native copilot CLI binary to run
  ],
  ...
})
```

Where `electronCachePath` is `path.join(os.homedir(), 'Library', 'Caches', 'electron')`, `appSupportPath` is `path.join(os.homedir(), 'Library', 'Application Support', 'blueprint-implementer')`, and `electronExtraProfilePath` is the path to `scripts/electron-safehouse-extra.sb`.

Safehouse wraps the copilot binary: `safehouse --workdir <workspace> --add-dirs-ro <appRoot> --enable=electron --add-dirs ~/Library/Caches/electron:~/Library/Application\ Support/blueprint-implementer --append-profile scripts/electron-safehouse-extra.sb --env-pass=COPILOT_SDK_AUTH_TOKEN <copilot-native-binary> [sdk-managed-flags...]`.

The agent also passes `--no-sandbox` to the Electron binary it launches (not to safehouse). This disables Chromium's internal Seatbelt sandbox, which cannot initialize inside safehouse's outer sandbox (macOS blocks nested `sandbox_init` calls with `EPERM`). Safehouse's outer sandbox still enforces all policy rules on the entire process tree.

Key details:

- **`--workdir`** grants read+write access to the workspace folder so the agent can create and modify files.
- **`--add-dirs-ro`** grants read-only access to `appRoot` so the sandboxed process can access support files from the app's `node_modules`.
- **`--enable=electron`** enables the `electron.sb` optional integration profile, which grants Chromium/Electron runtime permissions: GPU/Metal shader compilation (`com.apple.MTLCompilerService`), crashpad Mach IPC, and IOKit GPU user clients. This transitively enables `macos-gui.sb` (window server, AppKit, fonts, accessibility) and `clipboard.sb`. Without this, the Electron binary segfaults because it cannot initialize its GPU process or connect to the window server.
- **`--add-dirs`** grants read+write access to colon-separated paths: `~/Library/Caches/electron` (where the `electron` npm package downloads and caches its platform-specific binary) and `~/Library/Application Support/blueprint-implementer` (where Electron writes disk caches — Code Cache, GPU cache, network state). Without the first, `npm install` fails when the Electron postinstall script tries to write to the cache. Without the second, Electron logs `Database IO error` and cache-creation failures.
- **`--append-profile scripts/electron-safehouse-extra.sb`** appends a supplementary sandbox profile that covers two gaps in the upstream `electron.sb` profile: (1) allows `mach-register` and `mach-lookup` for Electron's `com.github.Electron.MachPortRendezvousServer.<pid>` service, which Chromium's multi-process architecture uses for parent–child process communication — without this, child processes (GPU, Renderer, Utility) crash with `bootstrap_check_in: Permission denied`; (2) grants `file-read*` on `~/Library/Fonts` and `~/Library/FontCollections` so Chromium can resolve user-installed fonts — without this, all text renders as replacement characters ("tofu").
- **`--env-pass=COPILOT_SDK_AUTH_TOKEN`** passes the authentication token through safehouse's sanitized environment. Without this, the token is stripped by safehouse's `env -i` and the CLI cannot authenticate with the Copilot API.
- **Agent profile auto-detection**: Safehouse sees the `copilot` command basename and automatically loads the `copilot-cli.sb` agent profile, which grants access to `~/.copilot` for config/state and auto-requires the keychain integration profile.
- Network access is allowed by default via the core `20-network.sb` profile (no `--enable` flag needed).
- If `scripts/safehouse` is not found, `initAgent()` throws an error with installation instructions.

### The `electron-safehouse-extra.sb` Profile

The file `scripts/electron-safehouse-extra.sb` is a supplementary sandbox profile checked into the repo that fills gaps in the upstream `electron.sb` profile:

```scheme
;; Allow Electron's MachPortRendezvousServer registration and lookup
;; Required for Chromium's child process communication under sandbox-exec
(allow mach-register
    (global-name-regex #"^com\.github\.Electron\.MachPortRendezvousServer\.")
)
(allow mach-lookup
    (global-name-regex #"^com\.github\.Electron\.MachPortRendezvousServer\.")
)

;; Allow access to user fonts and font database cache
;; Without this, Chromium renders all text as replacement characters (tofu)
(allow file-read*
    (home-subpath "/Library/Fonts")
    (home-subpath "/Library/FontCollections")
)
```

The two rules address:
1. **Mach port rendezvous** — the upstream `electron.sb` only covers `org.chromium.crashpad.*` Mach services, not Electron's own `MachPortRendezvousServer` used for GPU/Renderer/Utility child process communication.
2. **User fonts** — the `macos-gui.sb` profile grants font service Mach IPC (`com.apple.fonts`) and system font reads (`/Library/Fonts`, `/System/Library/Fonts`), but not user-installed fonts at `~/Library/Fonts`. Without this, Chromium falls back to missing glyph rendering.

The profile is passed to safehouse via `--append-profile` and is copied into the CLI npm package at build time alongside the main safehouse script.

### Packaging

The packaged Electron app uses `asar: false` (no archive) so all files remain directly on disk. This avoids issues with executable permissions being lost inside asar archives and eliminates the need for `asar.unpackDir` configuration. The `build.package.mjs` script fixes executable bits on native binaries (`node-pty/spawn-helper`, `copilot-darwin-arm64/copilot`) that `electron-packager` strips during copying.

## Copilot SDK IPC (Electron)

The Electron main process delegates to the shared agent module via IPC:

- `copilot:init(githubToken)` — Calls `initAgent()` with the GitHub token and `app.getAppPath()`. Returns `{ ok, error? }`.
- `copilot:implement({ model, systemPrompt, userPrompt })` — Calls `implementWithAgent()` and relays events to the renderer: `copilot:chunk` for text deltas (backward-compatible streaming) and `copilot:event` for structured agent events (tool calls, usage, errors, files_changed). Returns `{ ok, error? }` on completion.
- `copilot:stop` — Calls `stopAgent()` to clean up the session and client.

## Logging

All Copilot SDK activity is logged to the launch terminal (stdout/stderr) with a `[copilot]` prefix. A wildcard event listener on each session logs:

- Client lifecycle: init, start, stop
- Session events: `session.start`, `session.info`, `session.error`, `session.idle`, `session.model_change`, `session.shutdown`
- Turn progress: `assistant.turn_start`, `assistant.turn_end`, `assistant.intent`
- Tool calls: `tool.execution_start`, `tool.execution_complete`
- Token usage: `assistant.usage` (model, input/output tokens, duration)
- Final response size in characters

`assistant.message_delta` events are excluded from logging (too noisy).

## Event Flow

When the agent calls `open_in_preview_browser`:

1. The tool handler in `copilot-agent.ts` emits a `preview_url` event with `{ url }` data.
2. `electron.ts` relays the event to the renderer via `mainWindow.webContents.send('copilot:event', event)`.
3. `implementer.ts` receives the event, calls `loadPreviewUrl(url)` and reveals the preview panel.
4. `preview.ts` sets the iframe's `src` attribute to the URL (adding `allow-same-origin` to the sandbox for proper origin access).
5. The tool handler returns a success string to the agent, which continues its turn.
