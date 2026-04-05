<!--
 Copyright (c) Microsoft Corporation. All rights reserved.
 Licensed under the MIT License. See License.txt in the project root for license information.
-->

# Authentication

The application resolves a GitHub token automatically on the server: if the `GITHUB_TOKEN` environment variable is set it is used directly (this is the default in GitHub Codespaces); otherwise the server runs `gh auth token` (GitHub CLI) to obtain a token. No manual sign-in flow is needed. The token never leaves the server.

## Token Resolution (Server)

1. Check `process.env.GITHUB_TOKEN`. If set, use it.
2. Otherwise, run `gh auth token` and use the output.
3. If neither is available, API endpoints that require authentication return an error message prompting the user to set `GITHUB_TOKEN` or run `gh auth login`.

## User Display

- On startup the frontend calls `GET /api/auth/user`.
- The server resolves the token, fetches the GitHub user (`GET https://api.github.com/user`), and returns the user object.
- The toolbar shows the signed-in user's avatar and login name.

## Model Listing

- After authentication completes, the frontend calls `GET /api/copilot/models`.
- The server resolves the GitHub token, creates a temporary `CopilotClient` from `@github/copilot-sdk`, calls `listModels()`, and stops the client.
- This uses the same SDK path as the CLI — the SDK handles Copilot token exchange internally.
- The frontend does not manage tokens; the GitHub token stays server-side.

## REST API

- `GET /api/auth/user` → resolves the GitHub token and returns the user object (or null)
- `GET /api/copilot/models` → resolves the GitHub token, starts a temporary SDK client, returns `{ ok, models: [{ id, name }], error? }`
