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

function appendLog(line: string): void {
  outputEl.value += line + '\n';
  outputEl.scrollTop = outputEl.scrollHeight;
}

export async function compile(markdown: string): Promise<void> {
  if (!isSignedIn()) {
    setStatus('error', 'Not signed in. Click the Sign in button in the toolbar or open Settings.');
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
      // Show text in output area (agent may also print explanations)
      outputEl.value = textOutput;
      outputEl.scrollTop = outputEl.scrollHeight;
    });

    // Agent lifecycle events (tools, progress)
    window.electronAPI.onCopilotEvent((event: { type: string; message?: string; data?: any }) => {
      switch (event.type) {
        case 'tool_start':
          setStatus('info', `🔧 ${event.message}`);
          break;
        case 'tool_complete':
          setStatus('info', `✅ Tool done`);
          break;
        case 'usage':
          setStatus('info', `📊 ${event.message}`);
          break;
        case 'error':
          setStatus('error', event.message || 'Unknown error');
          break;
        case 'files_changed':
          // Refresh the file tree when the agent writes files
          refreshTree();
          break;
        case 'done':
          setStatus('success', event.message || 'Done');
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

    // The agent writes files to disk — the output area shows its text/explanation
    const output = textOutput || '(Agent wrote files to disk — check the file tree)';
    outputEl.value = output;

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
