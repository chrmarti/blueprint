/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { loadSettings, saveOutput, pushHistory } from './storage';
import { isSignedIn } from './auth';
import { refreshTree } from './files';

const SYSTEM_PROMPT = `You are a code generator. Your working directory is the project workspace root. A blueprint.md file in the workspace root describes the project's folder structure, tools, and processes. Follow its conventions when generating code.`;

let outputEl: HTMLTextAreaElement;
let statusEl: HTMLElement;
let onCompiled: (html: string) => void = () => {};

export function initCompiler(opts: { onCompiled: (html: string) => void }): void {
  outputEl = document.getElementById('compile-output') as HTMLTextAreaElement;
  statusEl = document.getElementById('compile-status') as HTMLElement;
  onCompiled = opts.onCompiled;
}

export function setOutput(text: string): void {
  outputEl.value = text;
}

export function getOutput(): string {
  return outputEl.value;
}

function appendLog(line: string, inline?: boolean): void {
  if (inline) {
    outputEl.value += line;
  } else {
    // Ensure log lines start on a new line
    if (outputEl.value.length > 0 && !outputEl.value.endsWith('\n')) {
      outputEl.value += '\n';
    }
    outputEl.value += line + '\n';
  }
  outputEl.scrollTop = outputEl.scrollHeight;
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
  outputEl.value = '';

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
    const output = outputEl.value || '(Agent wrote files to disk — check the file tree)';

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
