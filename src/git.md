<!--
 Copyright (c) Microsoft Corporation. All rights reserved.
 Licensed under the MIT License. See License.txt in the project root for license information.
-->

# Git Integration

The sidebar's **Git** tab shows the working tree status of the currently open workspace folder.

## Git Status Tab

Located behind the **Files** tab in the editor panel sidebar, the Git tab displays files that have been added, modified, deleted, or are untracked according to `git status`.

### Data Source

The renderer calls `electronAPI.gitStatus()` which invokes the `git:status` IPC handler in the Electron main process. The handler runs:

```
git status --porcelain
```

in the workspace folder directory via `child_process.execFile` and parses the output into `{ status, file }` entries. Each line of porcelain output has a two-character status code (index + working tree) in columns 0–1 and the file path starting at column 3.

### IPC

- **Handler**: `git:status` (in `electron.ts`)
- **Preload**: `electronAPI.gitStatus()` → `ipcRenderer.invoke('git:status')`
- **Return type**: `{ status: string; file: string }[]`

Returns an empty array if the workspace folder is not set, not a git repository, or if `git` is not available.

### Status Display

Each file is shown as a row with a colored status badge and the file path:

| Badge | Color | Meaning |
|-------|-------|---------|
| **M** | warning (orange) | Modified |
| **A** | success (green) | Added / staged |
| **D** | error (red) | Deleted |
| **?** | muted (gray) | Untracked |
| **R** | warning (orange) | Renamed |

When there are no changes, a "No changes" placeholder is shown.

### Refresh

The git status is fetched each time the Git tab is activated (clicked). It can also be refreshed programmatically via the exported `refreshGitStatus()` function from `files.ts`.
