/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { loadSettings, saveOutput, pushHistory } from './storage';
import { isSignedIn } from './auth';
import { refreshTree } from './files';
import { Terminal } from '@xterm/xterm';

const SYSTEM_PROMPT = `You are a code generator. Your working directory is the project workspace root. A blueprint.md file in the workspace root describes the project's folder structure, tools, and processes. Follow its conventions when generating code.`;

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
