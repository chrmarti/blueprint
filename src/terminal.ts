// terminal.ts — Integrated terminal panel (xterm.js + node-pty IPC)

import { Terminal } from '@xterm/xterm';

let terminal: Terminal | null = null;
let terminalContainer: HTMLElement | null = null;

export function initTerminalPanel(): void {
  terminalContainer = document.getElementById('terminal-container') as HTMLElement;
  if (!terminalContainer) return;

  terminal = new Terminal({
    cursorBlink: true,
    cursorStyle: 'bar',
    fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", "Consolas", monospace',
    fontSize: 13,
    theme: getTerminalTheme(),
  });

  terminal.open(terminalContainer);

  // Send keystrokes to pty
  terminal.onData((data) => {
    window.electronAPI.terminalWrite(data);
  });

  // Receive pty output
  window.electronAPI.onTerminalData((data) => {
    if (terminal) terminal.write(data);
  });

  // Handle process exit
  window.electronAPI.onTerminalExit(() => {
    if (terminal) terminal.writeln('\r\n[Process exited]');
  });

  // Auto-fit on resize
  const resizeObserver = new ResizeObserver(() => {
    fitTerminal();
  });
  resizeObserver.observe(terminalContainer);

  // Spawn the terminal
  spawnTerminal();
}

async function spawnTerminal(): Promise<void> {
  await window.electronAPI.terminalSpawn();
  // Fit after spawn since ResizeObserver may not fire if container is already at final size
  fitTerminal();
}

function fitTerminal(): void {
  if (!terminal || !terminalContainer) return;

  const dims = calculateDimensions();
  if (dims.cols > 0 && dims.rows > 0) {
    terminal.resize(dims.cols, dims.rows);
    window.electronAPI.terminalResize(dims.cols, dims.rows);
  }
}

function calculateDimensions(): { cols: number; rows: number } {
  if (!terminalContainer || !terminal) return { cols: 80, rows: 24 };

  const core = (terminal as unknown as { _core: { _renderService: { dimensions: { css: { cell: { width: number; height: number } } } } } })._core;
  if (!core?._renderService?.dimensions?.css?.cell) {
    return { cols: 80, rows: 24 };
  }

  const cellWidth = core._renderService.dimensions.css.cell.width;
  const cellHeight = core._renderService.dimensions.css.cell.height;

  if (cellWidth === 0 || cellHeight === 0) return { cols: 80, rows: 24 };

  const cols = Math.max(2, Math.floor(terminalContainer.clientWidth / cellWidth));
  const rows = Math.max(1, Math.floor(terminalContainer.clientHeight / cellHeight));

  return { cols, rows };
}

function getTerminalTheme(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  return {
    background: style.getPropertyValue('--bg-surface').trim() || '#1e1e1e',
    foreground: style.getPropertyValue('--text').trim() || '#cccccc',
    cursor: style.getPropertyValue('--accent').trim() || '#007acc',
    selectionBackground: style.getPropertyValue('--accent').trim() + '40' || '#007acc40',
  };
}

export function updateTerminalTheme(): void {
  if (terminal) {
    terminal.options.theme = getTerminalTheme();
  }
}

export async function respawnTerminal(): Promise<void> {
  if (terminal) {
    terminal.clear();
  }

  // spawnTerminal calls terminalSpawn which kills the old pty internally
  await spawnTerminal();
  
  // Re-focus the terminal (native dialogs can steal focus)
  if (terminal) {
    terminal.focus();
  }
}
