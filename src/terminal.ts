// Terminal module - integrated terminal panel with xterm.js and node-pty

import { Terminal } from '@xterm/xterm';
import { loadSettings } from './storage.js';

let terminal: Terminal | null = null;
let terminalContainer: HTMLElement | null = null;

export function initTerminalPanel(): void {
  terminalContainer = document.getElementById('terminal-container');
  if (!terminalContainer) return;

  // Create terminal instance
  terminal = new Terminal({
    cursorBlink: true,
    cursorStyle: 'bar',
    fontSize: 14,
    fontFamily: '"SF Mono", "Fira Code", "Monaco", "Inconsolata", monospace',
    theme: getTerminalTheme(),
  });

  terminal.open(terminalContainer);

  // Set up data handlers
  window.electronAPI.onTerminalData((data) => {
    terminal?.write(data);
  });

  window.electronAPI.onTerminalExit(() => {
    terminal?.writeln('\r\n[Process exited]');
  });

  // Send keystrokes to pty
  terminal.onData((data) => {
    window.electronAPI.terminalWrite(data);
  });

  // Set up resize observer
  const resizeObserver = new ResizeObserver(() => {
    fitTerminal();
  });
  resizeObserver.observe(terminalContainer);

  // Spawn initial shell
  spawnTerminal();
}

export async function spawnTerminal(): Promise<void> {
  const result = await window.electronAPI.terminalSpawn();
  if (result.ok) {
    // Fit terminal after spawn (ResizeObserver may not fire if size hasn't changed)
    setTimeout(fitTerminal, 100);
  }
}

export function fitTerminal(): void {
  if (!terminal || !terminalContainer) return;

  const containerWidth = terminalContainer.clientWidth;
  const containerHeight = terminalContainer.clientHeight;

  if (containerWidth === 0 || containerHeight === 0) return;

  // Calculate cell dimensions
  const cellWidth = terminal.options.fontSize! * 0.6;
  const cellHeight = terminal.options.fontSize! * 1.2;

  const cols = Math.floor(containerWidth / cellWidth);
  const rows = Math.floor(containerHeight / cellHeight);

  if (cols > 0 && rows > 0) {
    terminal.resize(cols, rows);
    window.electronAPI.terminalResize(cols, rows);
  }
}

export function updateTerminalTheme(): void {
  if (!terminal) return;
  terminal.options.theme = getTerminalTheme();
}

function getTerminalTheme(): { background: string; foreground: string; cursor: string } {
  const settings = loadSettings();
  if (settings.theme === 'dark') {
    return {
      background: '#1e1e1e',
      foreground: '#d4d4d4',
      cursor: '#d4d4d4',
    };
  } else {
    return {
      background: '#ffffff',
      foreground: '#1e1e1e',
      cursor: '#1e1e1e',
    };
  }
}

export function clearTerminal(): void {
  terminal?.clear();
}

export function killTerminal(): void {
  window.electronAPI.terminalKill();
}
