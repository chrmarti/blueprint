// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

import { serverAPI } from './api-client.js';
import { getTheme } from './layout.js';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

let terminal: Terminal | null = null;
let fitAddon: FitAddon | null = null;
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
  fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);

  // Expose for e2e test access
  (window as unknown as Record<string, unknown>)._xtermTerminal = terminal;

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

  // Spawn shell once connection is open
  terminalConnection.onOpen(() => {
    if (terminalConnection) {
      terminalConnection.send({ type: 'spawn' });
      fitTerminal();
    }
  });

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
  if (!terminal || !fitAddon) return;

  fitAddon.fit();

  if (terminalConnection) {
    terminalConnection.send({ type: 'resize', cols: terminal.cols, rows: terminal.rows });
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
    fitAddon = null;
  }
}
