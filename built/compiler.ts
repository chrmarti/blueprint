/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { loadSettings, saveOutput, pushHistory } from './storage';

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
  const settings = loadSettings();

  if (!settings.apiKey) {
    setStatus('error', 'No API key configured. Open Settings to add one.');
    return;
  }

  setStatus('info', 'Compiling...');
  outputEl.value = '';

  try {
    const response = await fetch(settings.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: markdown },
        ],
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
        stream: true,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      setStatus('error', `API error ${response.status}: ${body.slice(0, 200)}`);
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      setStatus('error', 'No response stream');
      return;
    }

    const decoder = new TextDecoder();
    let accumulated = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            accumulated += delta;
            outputEl.value = accumulated;
            outputEl.scrollTop = outputEl.scrollHeight;
          }
        } catch {
          // skip malformed chunks
        }
      }
    }

    // Strip markdown code fences if the model wrapped output
    const cleaned = stripCodeFences(accumulated);
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
