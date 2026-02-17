<!--
 Copyright (c) Microsoft Corporation. All rights reserved.
 Licensed under the MIT License. See License.txt in the project root for license information.
-->

# Authentication

The application uses the GitHub OAuth device flow to authenticate users and access their Copilot subscription.

## Device Flow

1. User clicks "Sign in with GitHub" in the toolbar or settings.
2. The app requests a device code from GitHub via IPC (`api:authDeviceCode`).
3. A one-time code is displayed; the user copies it and opens GitHub's verification page.
4. The app polls for authorization (`api:authToken`) until the user completes sign-in.
5. On success, the GitHub access token is stored in `localStorage`.

## Copilot Token

- After GitHub sign-in, the app fetches a Copilot API token via IPC (`api:copilotToken`).
- The Copilot token is cached in `localStorage` and refreshed when it nears expiration.
- All compilation requests use this token to authenticate with the Copilot chat completions endpoint via IPC.

## IPC API Proxy

Authentication API calls are made from the Electron main process via Node.js `https` module. The renderer communicates with the main process through IPC:

- `api:authDeviceCode(body)` → `POST https://github.com/login/device/code` — returns `{ status, body }`
- `api:authToken(body)` → `POST https://github.com/login/oauth/access_token` — returns `{ status, body }`
- `api:githubUser(token)` → `GET https://api.github.com/user` — returns `{ status, body }`
- `api:copilotToken(ghToken)` → `GET https://api.github.com/copilot_internal/v2/token` — returns `{ status, body }`
- `api:copilotModels(copilotToken)` → `GET https://api.githubcopilot.com/models` — returns `{ status, body }`

## How It Works

The renderer never makes network requests directly. Authentication API calls go through `window.electronAPI` IPC methods to the main process, which uses Node.js `https`. Compilation goes through the Copilot SDK agent: the renderer calls `window.electronAPI.copilotCompile()`, which triggers the main process to call `compileWithAgent()` from the shared module. The agent creates a session, writes files to the workspace folder via its tools, and streams events back. Text deltas are relayed via `copilot:chunk` and structured events via `copilot:event`. When the agent signals `files_changed`, the file tree refreshes automatically.
