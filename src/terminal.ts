// terminal.ts - Integrated terminal panel for Blueprint Implementer
import { Terminal } from '@xterm/xterm';
import { getTheme } from './storage';

let terminal: Terminal | null = null;
let terminalContainer: HTMLElement | null = null;
let resizeObserver: ResizeObserver | null = null;

export function initTerminalPanel(): void {
  terminalContainer = document.getElementById('terminal');
  if (!terminalContainer) return;

  // Create terminal instance
  terminal = new Terminal({
    cursorBlink: true,
    cursorStyle: 'bar',
    fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
    fontSize: 13,
    lineHeight: 1.2,
    theme: getTerminalTheme(),
  });

  terminal.open(terminalContainer);

  // Setup IPC listeners
  window.electronAPI.onTerminalData((data) => {
    terminal?.write(data);
  });

  window.electronAPI.onTerminalExit((code) => {
    terminal?.writeln(`\r\n[Process exited with code ${code}]`);
  });

  // Forward input to main process
  terminal.onData((data) => {
    window.electronAPI.terminalWrite(data);
  });

  // Setup resize observer
  resizeObserver = new ResizeObserver(() => {
    fitTerminal();
  });
  resizeObserver.observe(terminalContainer);

  // Spawn shell
  spawnShell();
}

async function spawnShell(): Promise<void> {
  const result = await window.electronAPI.terminalSpawn();
  if (result.ok) {
    // Fit terminal after spawn
    fitTerminal();
  } else {
    terminal?.writeln('[Failed to spawn shell]');
  }
}

function fitTerminal(): void {
  if (!terminal || !terminalContainer) return;

  // Calculate dimensions
  const dims = calculateDimensions();
  if (dims.cols > 0 && dims.rows > 0) {
    terminal.resize(dims.cols, dims.rows);
    window.electronAPI.terminalResize(dims.cols, dims.rows);
  }
}

function calculateDimensions(): { cols: number; rows: number } {
  if (!terminal || !terminalContainer) {
    return { cols: 80, rows: 24 };
  }

  const core = (terminal as unknown as { _core: { _renderService: { dimensions: { css: { cell: { width: number; height: number } } } } } })._core;
  const cellWidth = core?._renderService?.dimensions?.css?.cell?.width || 9;
  const cellHeight = core?._renderService?.dimensions?.css?.cell?.height || 17;

  const rect = terminalContainer.getBoundingClientRect();
  const cols = Math.max(2, Math.floor(rect.width / cellWidth));
  const rows = Math.max(2, Math.floor(rect.height / cellHeight));

  return { cols, rows };
}

function getTerminalTheme(): { background: string; foreground: string; cursor: string; cursorAccent: string } {
  const theme = getTheme();
  if (theme === 'dark') {
    return {
      background: '#1e1e1e',
      foreground: '#e0e0e0',
      cursor: '#e0e0e0',
      cursorAccent: '#1e1e1e',
    };
  }
  return {
    background: '#ffffff',
    foreground: '#1a1a1a',
    cursor: '#1a1a1a',
    cursorAccent: '#ffffff',
  };
}

export function updateTerminalTheme(): void {
  if (terminal) {
    terminal.options.theme = getTerminalTheme();
  }
}

export async function respawnTerminal(): Promise<void> {
  await window.electronAPI.terminalKill();
  terminal?.clear();
  await spawnShell();
}

export function disposeTerminal(): void {
  window.electronAPI.removeTerminalDataListeners();
  window.electronAPI.removeTerminalExitListeners();
  resizeObserver?.disconnect();
  terminal?.dispose();
  terminal = null;
}
