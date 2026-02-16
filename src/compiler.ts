/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { loadSettings, saveOutput, pushHistory } from './storage';
import { isSignedIn } from './auth';
import { refreshTree } from './files';
import { loadPreviewUrl } from './preview';
import { showBrowserTab } from './editor';
import { Terminal } from '@xterm/xterm';

const SYSTEM_PROMPT = `You are a code generator working in a project workspace. The workspace root contains a blueprint.md file that describes the application to build — its architecture, components, file structure, and behavior. The blueprint may be self-contained or it may reference other markdown documents in the workspace that together make up the full specification. Your job is to read the blueprint and turn it into working code:

1. Start by reading blueprint.md in the workspace root. If it references other markdown files, read those too to get the complete picture.
2. Each section in the blueprint describes a module, component, or file to generate. Create or update the source files in the workspace using your file tools. Write complete, working code — not stubs or placeholders.
3. The blueprint defines the project's folder structure, naming conventions, build tools, and processes. Follow those conventions exactly when deciding where to place files and how to structure them.
4. If the project already has existing files, preserve them unless the blueprint explicitly describes replacing them. Merge new code with the existing codebase.
5. After writing files, install any needed dependencies (npm install, etc.) and verify the project builds if a build step is defined.
6. If the project has a dev server, start it and use the open_in_preview_browser tool to show it in the Preview panel.

You have a custom tool available: open_in_preview_browser. Call it with a URL (e.g., http://localhost:3000) to open that URL in the application's embedded browser. Use this after starting a dev server so the user can see the running application.`;

let term: Terminal;
let outputContainerEl: HTMLElement;
let statusEl: HTMLElement;
let plainTextBuffer = '';
let onCompiled: (html: string) => void = () => {};

function getTermTheme(): { background: string; foreground: string; cursor: string } {
  const style = getComputedStyle(document.documentElement);
  return {
    background: style.getPropertyValue('--bg-surface').trim() || '#252536',
    foreground: style.getPropertyValue('--text').trim() || '#cdd6f4',
    cursor: style.getPropertyValue('--text-muted').trim() || '#888caa',
  };
}

export function initCompiler(opts: { onCompiled: (html: string) => void }): void {
  outputContainerEl = document.getElementById('compile-output') as HTMLElement;
  statusEl = document.getElementById('compile-status') as HTMLElement;
  onCompiled = opts.onCompiled;

  const colors = getTermTheme();
  term = new Terminal({
    convertEol: true,
    scrollback: 10000,
    fontSize: 13,
    fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
    theme: {
      background: colors.background,
      foreground: colors.foreground,
      cursor: colors.cursor,
    },
    cursorStyle: 'bar',
    cursorBlink: false,
    disableStdin: true,
  });
  term.open(outputContainerEl);

  // Fit terminal to container on resize
  const fit = () => {
    const dims = outputContainerEl.getBoundingClientRect();
    if (dims.width > 0 && dims.height > 0) {
      const cellWidth = term.options.fontSize! * 0.6;
      const cellHeight = (term.options.fontSize! || 13) * 1.2;
      const cols = Math.max(20, Math.floor((dims.width - 16) / cellWidth));
      const rows = Math.max(5, Math.floor((dims.height - 16) / cellHeight));
      term.resize(cols, rows);
    }
  };
  fit();
  new ResizeObserver(fit).observe(outputContainerEl);
}

export function setOutput(text: string): void {
  plainTextBuffer = text;
  term.clear();
  term.write(text);
}

export function getOutput(): string {
  return plainTextBuffer;
}

export function updateTermTheme(): void {
  if (!term) return;
  const colors = getTermTheme();
  term.options.theme = {
    background: colors.background,
    foreground: colors.foreground,
    cursor: colors.cursor,
  };
}

function appendLog(line: string, inline?: boolean): void {
  if (inline) {
    plainTextBuffer += line;
    term.write(line);
  } else {
    plainTextBuffer += line + '\n';
    term.writeln(line);
  }
}

export async function compile(markdown: string): Promise<void> {
  if (!isSignedIn()) {
    setStatus('error', 'Not signed in. Click the Sign in button in the toolbar or open Settings.');
    return;
  }

  // If editor is empty, fall back to reading blueprint.md from workspace
  if (!markdown.trim() && window.electronAPI) {
    const folder = await window.electronAPI.getWorkspaceFolder();
    if (folder) {
      try {
        markdown = await window.electronAPI.readFile(folder + '/blueprint.md');
      } catch {
        // no blueprint.md found
      }
    }
  }

  if (!markdown.trim()) {
    setStatus('error', 'Nothing to compile. Open a markdown file, type instructions, or open a folder with a blueprint.md.');
    return;
  }

  const settings = loadSettings();
  setStatus('info', 'Compiling...');
  term.clear();
  plainTextBuffer = '';

  if (!window.electronAPI) {
    setStatus('error', 'Electron API not available');
    return;
  }

  try {
    // Listen for agent events from the Copilot SDK
    window.electronAPI.removeCopilotChunkListeners();
    window.electronAPI.removeCopilotEventListeners();

    // Stream text deltas
    let textOutput = '';
    window.electronAPI.onCopilotChunk((delta: string) => {
      textOutput += delta;
      appendLog(delta, true);
    });

    // Agent lifecycle events (tools, progress)
    window.electronAPI.onCopilotEvent((event: { type: string; message?: string; data?: any }) => {
      switch (event.type) {
        case 'tool_start':
          appendLog(`🔧 ${event.message}`);
          setStatus('info', `🔧 ${event.message}`);
          break;
        case 'tool_complete':
          appendLog(`✅ ${event.message}`);
          setStatus('info', `✅ Tool done`);
          break;
        case 'usage':
          appendLog(`📊 ${event.message}`);
          setStatus('info', `📊 ${event.message}`);
          break;
        case 'error':
          appendLog(`❌ ${event.message || 'Unknown error'}`);
          setStatus('error', event.message || 'Unknown error');
          break;
        case 'preview_url': {
          const url = event.data?.url;
          if (url) {
            loadPreviewUrl(url);
            showBrowserTab();
          }
          break;
        }
        case 'files_changed':
          refreshTree();
          break;
        case 'done':
          appendLog(`✨ ${event.message || 'Done'}`);
          setStatus('success', event.message || 'Done');
          break;
        case 'turn_start':
        case 'turn_end':
          appendLog(event.message || event.type);
          break;
        case 'log':
          appendLog(event.message || '');
          break;
        default:
          if (event.message) appendLog(event.message);
          break;
      }
    });

    const result = await window.electronAPI.copilotCompile({
      model: settings.model,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: markdown,
    });
    window.electronAPI.removeCopilotChunkListeners();
    window.electronAPI.removeCopilotEventListeners();

    if (!result.ok) {
      setStatus('error', `Compilation failed: ${result.error || 'Unknown error'}`);
      return;
    }

    // The agent writes files to disk — the output area already has the full log
    const output = plainTextBuffer || '(Agent wrote files to disk — check the file tree)';

    saveOutput(output);
    pushHistory({
      timestamp: Date.now(),
      markdown,
      output,
    });

    // Refresh file tree one more time to pick up any late writes
    refreshTree();
    setStatus('success', 'Compilation complete — files written to workspace');
    onCompiled(output);
  } catch (err) {
    setStatus('error', `Compilation failed: ${(err as Error).message}`);
  }
}

function setStatus(type: 'info' | 'error' | 'success', msg: string): void {
  statusEl.textContent = msg;
  statusEl.className = type === 'info' ? '' : type;
}

export async function saveOutputToFile(): Promise<void> {
  if (!window.electronAPI) return;
  const output = getOutput();
  if (!output.trim()) {
    setStatus('error', 'No output to save');
    return;
  }
  const filePath = await window.electronAPI.showSaveDialog('output.html');
  if (filePath) {
    await window.electronAPI.writeFile(filePath, output);
    setStatus('success', `Saved to ${filePath.split('/').pop()}`);
    refreshTree();
  }
}
