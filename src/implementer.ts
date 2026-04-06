// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

import { serverAPI } from './api-client.js';
import { refreshFileTree } from './files.js';
import { showPreview } from './preview.js';
import { addHistoryEntry } from './storage.js';
import { getSelectedModel } from './settings.js';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { getTheme } from './layout.js';

let outputTerminal: Terminal | null = null;
let outputFitAddon: FitAddon | null = null;
let copilotConnection: ReturnType<typeof serverAPI.connectCopilot> | null = null;
let isImplementing = false;

export function initImplementer(): void {
  const container = document.getElementById('output-terminal');
  if (!container) return;

  outputTerminal = new Terminal({
    fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", Menlo, Monaco, monospace',
    fontSize: 13,
    cursorBlink: false,
    disableStdin: true,
    convertEol: true,
    theme: getOutputTerminalTheme(getTheme()),
  });

  outputTerminal.open(container);
  outputFitAddon = new FitAddon();
  outputTerminal.loadAddon(outputFitAddon);

  // Setup implement button
  const implementBtn = document.getElementById('implement-btn');
  if (implementBtn) {
    implementBtn.addEventListener('click', startImplementation);
  }

  // Setup stop button
  const stopBtn = document.getElementById('stop-btn');
  if (stopBtn) {
    stopBtn.addEventListener('click', stopImplementation);
  }

  // Setup save button
  const saveBtn = document.getElementById('save-output-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', saveOutput);
  }

  // Setup right panel tabs
  setupOutputTabs();

  // Listen for theme changes
  window.addEventListener('theme-changed', (e) => {
    const event = e as CustomEvent<{ theme: 'light' | 'dark' }>;
    if (outputTerminal) {
      outputTerminal.options.theme = getOutputTerminalTheme(event.detail.theme);
    }
  });

  // Resize observer for auto-fitting
  const resizeObserver = new ResizeObserver(() => {
    fitOutputTerminal();
  });
  resizeObserver.observe(container);
}

function getOutputTerminalTheme(theme: 'light' | 'dark'): { background: string; foreground: string } {
  if (theme === 'light') {
    return {
      background: '#f5f5f5',
      foreground: '#1e1e1e',
    };
  }
  return {
    background: '#1e1e1e',
    foreground: '#d4d4d4',
  };
}

function fitOutputTerminal(): void {
  if (!outputTerminal || !outputFitAddon) return;
  outputFitAddon.fit();
}

function setupOutputTabs(): void {
  const chatTab = document.getElementById('chat-tab');
  const outputTab = document.getElementById('output-tab');
  const chatPanel = document.getElementById('chat-panel');
  const outputPanel = document.getElementById('output-panel');

  if (chatTab && outputTab && chatPanel && outputPanel) {
    chatTab.addEventListener('click', () => {
      chatTab.classList.add('active');
      outputTab.classList.remove('active');
      chatPanel.style.display = 'flex';
      outputPanel.style.display = 'none';
    });

    outputTab.addEventListener('click', () => {
      outputTab.classList.add('active');
      chatTab.classList.remove('active');
      outputPanel.style.display = 'flex';
      chatPanel.style.display = 'none';
    });
  }
}

async function startImplementation(): Promise<void> {
  if (isImplementing) return;
  
  isImplementing = true;
  updateStatus('implementing', 'Implementing...');

  // Clear previous output
  if (outputTerminal) {
    outputTerminal.clear();
    outputTerminal.writeln('\x1b[90m━━━ Starting implementation ━━━\x1b[0m\r\n');
  }

  // Switch to output tab
  const outputTab = document.getElementById('output-tab');
  if (outputTab) {
    outputTab.click();
  }

  const model = getSelectedModel();

  try {
    // Initialize Copilot
    const initResult = await serverAPI.initCopilot();
    if (!initResult.ok) {
      writeError(`Failed to initialize Copilot: ${initResult.error}`);
      updateStatus('error', 'Init failed');
      isImplementing = false;
      return;
    }

    // Connect to WebSocket for events
    copilotConnection = serverAPI.connectCopilot();

    copilotConnection.onChunk((content) => {
      if (outputTerminal) {
        outputTerminal.write(content);
      }
    });

    copilotConnection.onEvent((data) => {
      handleEvent(data);
    });

    copilotConnection.onDone((ok, error) => {
      isImplementing = false;
      if (ok) {
        updateStatus('success', 'Complete');
        addHistoryEntry({ model, prompt: '', result: 'success' });
      } else {
        updateStatus('error', error || 'Failed');
        addHistoryEntry({ model, prompt: '', result: 'error' });
      }
      refreshFileTree();
      if (copilotConnection) {
        copilotConnection.close();
        copilotConnection = null;
      }
    });

    // Read blueprint.md for the prompt
    let userPrompt = '';
    try {
      userPrompt = await serverAPI.readFile('blueprint.md');
    } catch {
      writeError('No blueprint.md found in workspace');
      updateStatus('error', 'No blueprint');
      isImplementing = false;
      return;
    }

    // Start implementation
    const result = await serverAPI.implement({
      model,
      userPrompt,
    });

    if (!result.ok) {
      writeError(result.error || 'Implementation failed');
      updateStatus('error', 'Failed');
      isImplementing = false;
    }
  } catch (err) {
    writeError(`Error: ${err}`);
    updateStatus('error', 'Error');
    isImplementing = false;
  }
}

function handleEvent(data: unknown): void {
  if (!outputTerminal) return;
  
  const event = data as { type: string; [key: string]: unknown };
  
  switch (event.type) {
    case 'session_start':
    case 'turn_start':
    case 'turn_end':
      outputTerminal.writeln(`\x1b[90m${event.type.replace('_', ' ')}\x1b[0m`);
      break;
      
    case 'tool_start': {
      const toolName = event.toolName as string || 'unknown';
      let summary = '';
      const args = event.arguments as Record<string, unknown> | undefined;
      
      if (args) {
        if (args.path) {
          summary = String(args.path);
        } else if (args.command) {
          summary = String(args.command).substring(0, 60);
        } else if (args.url) {
          summary = String(args.url);
        } else {
          const firstArg = Object.values(args)[0];
          if (firstArg) {
            summary = String(firstArg).substring(0, 40);
          }
        }
      }
      
      outputTerminal.writeln(`\x1b[33m🔧 \x1b[1m${toolName}\x1b[0m\x1b[33m ${summary}\x1b[0m`);
      break;
    }
    
    case 'tool_complete': {
      const toolName = event.toolName as string || 'unknown';
      outputTerminal.writeln(`\x1b[32m✓ ${toolName} complete\x1b[0m`);
      break;
    }
    
    case 'usage': {
      const inputTokens = event.inputTokens as number || 0;
      const outputTokens = event.outputTokens as number || 0;
      const duration = event.duration as number || 0;
      const durationSec = (duration / 1000).toFixed(1);
      outputTerminal.writeln(`\x1b[90mtokens: ${inputTokens.toLocaleString()} in / ${outputTokens.toLocaleString()} out (${durationSec}s)\x1b[0m`);
      break;
    }
    
    case 'error': {
      const message = event.message as string || 'Unknown error';
      outputTerminal.writeln(`\x1b[31m\x1b[1m✗ ${message}\x1b[0m`);
      break;
    }
    
    case 'files_changed':
      refreshFileTree();
      break;
      
    case 'preview_url': {
      const url = event.url as string;
      if (url) {
        showPreview(url);
      }
      break;
    }
  }
}

function writeError(message: string): void {
  if (outputTerminal) {
    outputTerminal.writeln(`\x1b[31m\x1b[1m✗ ${message}\x1b[0m`);
  }
}

function updateStatus(status: 'implementing' | 'success' | 'error', text: string): void {
  const statusEl = document.getElementById('implement-status');
  if (statusEl) {
    statusEl.className = `status ${status}`;
    statusEl.textContent = text;
  }
}

async function stopImplementation(): Promise<void> {
  try {
    await serverAPI.stopCopilot();
    if (outputTerminal) {
      outputTerminal.writeln('\r\n\x1b[33m[Stopped by user]\x1b[0m');
    }
    updateStatus('error', 'Stopped');
    isImplementing = false;
    if (copilotConnection) {
      copilotConnection.close();
      copilotConnection = null;
    }
  } catch (err) {
    console.error('Failed to stop:', err);
  }
}

function saveOutput(): void {
  // Trigger a browser download of implementation output
  // For now, we just alert - full implementation would save actual output
  alert('Save functionality - would download implementation output');
}
