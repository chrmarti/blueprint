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

## Model Listing

- After authentication completes, the renderer calls `copilot:listModels` via IPC.
- The main process resolves the GitHub token, creates a temporary `CopilotClient` from `@github/copilot-sdk`, calls `listModels()`, and stops the client.
- This uses the same SDK path as the CLI — the SDK handles Copilot token exchange internally.
- The renderer does not manage Copilot tokens; only the GitHub token (resolved in the main process) is needed.

## IPC API

- `auth:getUser()` → resolves the GitHub token and returns the user object (or null)
- `copilot:listModels()` → resolves the GitHub token, starts a temporary SDK client, returns `{ ok, models: [{ id, name }], error? }`
