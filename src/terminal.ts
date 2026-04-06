// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

import { serverAPI } from './api-client.js';
import { getTheme } from './layout.js';
import { Terminal } from '@xterm/xterm';

let terminal: Terminal | null = null;
let terminalConnection: ReturnType<typeof serverAPI.connectTerminal> | null = null;

export function initTerminal(): void {
  const container = document.getElementById('terminal-container');
  if (!container) return;

  terminal = new Terminal({
    fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", Menlo, Monaco, monospace',
    fontSize: 14,
    cursorBlink: true,
    cursorStyle: 'bar',
    theme: getTerminalTheme(getTheme()),
  });

  terminal.open(container);

  // Connect to WebSocket
  connectTerminal();

  // Setup resize observer for auto-fitting
  const resizeObserver = new ResizeObserver(() => {
    fitTerminal();
  });
  resizeObserver.observe(container);

  // Listen for theme changes
  window.addEventListener('theme-changed', (e) => {
    const event = e as CustomEvent<{ theme: 'light' | 'dark' }>;
    updateTerminalTheme(event.detail.theme);
  });
}

function getTerminalTheme(theme: 'light' | 'dark'): { background: string; foreground: string; cursor: string } {
  if (theme === 'light') {
    return {
      background: '#ffffff',
      foreground: '#1e1e1e',
      cursor: '#1e1e1e',
    };
  }
  return {
    background: '#1e1e1e',
    foreground: '#d4d4d4',
    cursor: '#d4d4d4',
  };
}

export function updateTerminalTheme(theme: 'light' | 'dark'): void {
  if (terminal) {
    terminal.options.theme = getTerminalTheme(theme);
  }
}

function connectTerminal(): void {
  terminalConnection = serverAPI.connectTerminal();

  terminalConnection.onData((data) => {
    if (terminal) {
      terminal.write(data);
    }
  });

  terminalConnection.onExit(() => {
    if (terminal) {
      terminal.writeln('\r\n[Process exited]');
    }
  });

  // Wait for connection to open before spawning
  setTimeout(() => {
    if (terminalConnection) {
      // Spawn shell
      terminalConnection.send({ type: 'spawn' });
      // Send initial resize
      fitTerminal();
    }
  }, 100);

  // Forward user input
  if (terminal) {
    terminal.onData((data) => {
      if (terminalConnection) {
        terminalConnection.send({ type: 'write', data });
      }
    });
  }
}

function fitTerminal(): void {
  if (!terminal) return;
  
  const container = document.getElementById('terminal-container');
  if (!container) return;

  // Calculate available dimensions
  const dims = terminal.element;
  if (!dims) return;

  const cellWidth = dims.querySelector('.xterm-char-measure-element')?.getBoundingClientRect().width || 9;
  const cellHeight = 17; // Approximate line height
  
  const cols = Math.floor(container.clientWidth / cellWidth);
  const rows = Math.floor(container.clientHeight / cellHeight);

  if (cols > 0 && rows > 0) {
    terminal.resize(cols, rows);
    if (terminalConnection) {
      terminalConnection.send({ type: 'resize', cols, rows });
    }
  }
}

export function closeTerminal(): void {
  if (terminalConnection) {
    terminalConnection.send({ type: 'kill' });
    terminalConnection.close();
    terminalConnection = null;
  }
  if (terminal) {
    terminal.dispose();
    terminal = null;
  }
}
