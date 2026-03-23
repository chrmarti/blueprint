<!--
 Copyright (c) Microsoft Corporation. All rights reserved.
 Licensed under the MIT License. See License.txt in the project root for license information.
-->

# Authentication

The application resolves a GitHub token automatically: if the `GITHUB_TOKEN` environment variable is set it is used directly; otherwise the app runs `gh auth token` (GitHub CLI) to obtain a token. No manual sign-in flow is needed.

## Token Resolution (Main Process)

1. Check `process.env.GITHUB_TOKEN`. If set, use it.
2. Otherwise, run `gh auth token` and use the output.
3. If neither is available, the user is shown a message to set `GITHUB_TOKEN` or run `gh auth login`.

## User Display

- On startup the renderer calls `auth:getUser` via IPC to the main process.
- The main process resolves the token, fetches the GitHub user (`GET https://api.github.com/user`), and returns the user object.
- The toolbar shows the signed-in user's avatar and login name.

## Copilot Token

- After resolving the GitHub token, the app fetches a Copilot API token via IPC (`api:copilotToken`).
- The main process resolves the GitHub token internally — the renderer does not pass it.
- The Copilot token is cached in `localStorage` and refreshed when it nears expiration.

## IPC API

- `auth:getUser()` → resolves the GitHub token and returns the user object (or null)
- `api:copilotToken()` → resolves the GitHub token and fetches a Copilot token — returns `{ status, body }`
- `api:copilotModels(copilotToken)` → `GET https://api.githubcopilot.com/models` — returns `{ status, body }`
