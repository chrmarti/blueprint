<!--
 Copyright (c) Microsoft Corporation. All rights reserved.
 Licensed under the MIT License. See License.txt in the project root for license information.
-->

# Authentication

The application uses the GitHub OAuth device flow to authenticate users and access their Copilot subscription. For CI GITHUB_TOKEN may be set in which case the app will assume being signed in by that token.

## Device Flow

1. User clicks "Sign in with GitHub" in the toolbar or settings.
2. The app requests a device code from GitHub via IPC (`api:authDeviceCode`).
3. A one-time code is displayed and copied to the clipboard; GitHub's verification page is opened.
4. The app polls for authorization (`api:authToken`) until the user completes sign-in.
5. On success, the GitHub access token is stored in `localStorage`.

### Verification

- The sign button in the toolbar can be clicked.

## Copilot Token

- After GitHub sign-in, the app fetches a Copilot API token via IPC (`api:copilotToken`).
- The Copilot token is cached in `localStorage` and refreshed when it nears expiration.
- All implementation requests use this token to authenticate with the Copilot chat completions endpoint via IPC.

## IPC API Proxy

Authentication API calls are made from the Electron main process via Node.js `https` module. The renderer communicates with the main process through IPC:

- `api:authDeviceCode(body)` → `POST https://github.com/login/device/code` — returns `{ status, body }`
- `api:authToken(body)` → `POST https://github.com/login/oauth/access_token` — returns `{ status, body }`
- `api:githubUser(token)` → `GET https://api.github.com/user` — returns `{ status, body }`
- `api:copilotToken(ghToken)` → `GET https://api.github.com/copilot_internal/v2/token` — returns `{ status, body }`
- `api:copilotModels(copilotToken)` → `GET https://api.githubcopilot.com/models` — returns `{ status, body }`

## How It Works

The renderer never makes network requests directly. Authentication API calls go through `window.electronAPI` IPC methods to the main process, which uses Node.js `https`. Implementation goes through the Copilot SDK agent: the renderer calls `window.electronAPI.copilotImplement()`, which triggers the main process to call `implementWithAgent()` from the shared module. The agent creates a session, writes files to the workspace folder via its tools, and streams events back. Text deltas are relayed via `copilot:chunk` and structured events via `copilot:event`. When the agent signals `files_changed`, the file tree refreshes automatically.
