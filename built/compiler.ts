/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { loadSettings, saveOutput, pushHistory } from './storage';
import { isSignedIn } from './auth';
import { refreshTree } from './files';

const SYSTEM_PROMPT = `You are a code generator. Given a structured markdown document describing an application, produce a complete, self-contained HTML file with embedded CSS and JavaScript that implements every requirement described. Output only the HTML file content, no explanation.`;

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
    // Listen for streaming chunks from the Copilot SDK
    let accumulated = '';
    window.electronAPI.removeCopilotChunkListeners();
    window.electronAPI.onCopilotChunk((delta: string) => {
      accumulated += delta;
      outputEl.value = accumulated;
      outputEl.scrollTop = outputEl.scrollHeight;
    });

    const result = await window.electronAPI.copilotCompile({
      model: settings.model,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: markdown,
    });
    window.electronAPI.removeCopilotChunkListeners();

    if (!result.ok) {
      setStatus('error', `Compilation failed: ${result.error || 'Unknown error'}`);
      return;
    }

    // Use accumulated streaming content (or final content from SDK)
    const raw = accumulated || result.content || '';
    // Strip markdown code fences if the model wrapped output
    const cleaned = stripCodeFences(raw);
    outputEl.value = cleaned;

    saveOutput(cleaned);
    pushHistory({
      timestamp: Date.now(),
      markdown,
      output: cleaned,
    });

    setStatus('success', `Compiled successfully (${cleaned.length} bytes)`);
    onCompiled(cleaned);
  } catch (err) {
    setStatus('error', `Compilation failed: ${(err as Error).message}`);
  }
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  // Match ```html ... ``` wrapper
  const match = trimmed.match(/^```(?:html)?\s*\n([\s\S]*?)\n```\s*$/);
  return match ? match[1] : trimmed;
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
