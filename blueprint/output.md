## Output Panel

The output panel orchestrates transformation of the authored markdown into runnable source code.

### Requirements

- A **Implement** button that invokes the Copilot SDK agent on the workspace's `blueprint.md`.
- The SDK prompt is constructed by combining:
  - The system prompt defined in [harness.md](harness.md).
  - The contents of `blueprint.md` (appended to the system prompt at implement time by `electron.ts`).
  - The contents of `blueprint.md` as the user message.
- The output panel uses an xterm.js terminal to display agent output. The agent's streamed text (thinking, explanations) is written directly to the terminal as it arrives. Structured events are rendered inline between streamed text as human-readable formatted lines using ANSI colors:
  - **Tool start** (`🔧` yellow): shows the tool name in bold, followed by a short human-readable summary of what the tool is doing. For file-writing tools, show the file path. For shell/bash tools, show the command. For other tools, show the most relevant argument value. Do **not** dump all arguments as `key=value` pairs or render JSON.
  - **Tool complete** (`✓` green): shows the tool name that completed, e.g., `✓ create_file complete`.
  - **Token usage** (gray, dimmed): shows input/output token counts and duration, e.g., `tokens: 1,234 in / 567 out (1.2s)`. Format the duration in seconds with one decimal, not raw milliseconds.
  - **Errors** (`✗` red bold): shows the error message.
  - **Session lifecycle events** (gray, dimmed): show a short label like `session started`, `turn started`, `turn ended` — do **not** append raw JSON.
  - **File changes**: when the agent signals `files_changed`, the file tree refreshes silently (no terminal output needed).
- The file tree auto-refreshes when the agent signals `files_changed`.
- An **errors** section that surfaces any SDK invocation failures or malformed output.
- A **history** drawer listing previous implementations with timestamps, allowing rollback.
- A **save** button (💾) to write implemented output to a file on disk via a native save dialog.
- Implementation output is stored in `localStorage` for session persistence.

#### Verification

Write a test using Playwright that starts the app on a folder with a Game of Life blueprint and triggers the Implement button. The test must observe that the Output panel starts streaming messages from the Copilot CLI/SDK.

### Copilot SDK Integration

- Authentication via GitHub OAuth device flow (no API keys needed).
- Users sign in with their GitHub account; the GitHub token is passed to the shared `copilot-agent` module which handles Copilot authentication internally.
- Implementation uses the shared `copilot-agent.ts` module which wraps `@github/copilot-sdk`: it creates a `CopilotClient`, starts the Copilot CLI (`@github/copilot`), creates a streaming session with `environment: { cwd: workspaceFolder }`, and relays events to the renderer. The agent uses its built-in file tools to write output files directly to the workspace.
