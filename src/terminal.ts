/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Terminal } from '@xterm/xterm';

let term: Terminal;
let containerEl: HTMLElement;
let spawned = false;

function getTermTheme(): { background: string; foreground: string; cursor: string } {
  const style = getComputedStyle(document.documentElement);
  return {
    background: style.getPropertyValue('--bg-surface').trim() || '#252536',
    foreground: style.getPropertyValue('--text').trim() || '#cdd6f4',
    cursor: style.getPropertyValue('--text-muted').trim() || '#888caa',
  };
}

export function initTerminalPanel(): void {
  containerEl = document.getElementById('terminal-container') as HTMLElement;

  const colors = getTermTheme();
  term = new Terminal({
    convertEol: false,
    scrollback: 5000,
    fontSize: 13,
    fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
    theme: {
      background: colors.background,
      foreground: colors.foreground,
      cursor: colors.cursor,
    },
    cursorStyle: 'bar',
    cursorBlink: true,
  });
  term.open(containerEl);

  // Send user input to the pty
  term.onData((data) => {
    window.electronAPI?.terminalWrite(data);
  });

  // Fit terminal to container
  const fit = () => {
    const dims = containerEl.getBoundingClientRect();
    if (dims.width > 0 && dims.height > 0) {
      const cellWidth = term.options.fontSize! * 0.6;
      const cellHeight = (term.options.fontSize! || 13) * 1.2;
      const cols = Math.max(20, Math.floor((dims.width - 16) / cellWidth));
      const rows = Math.max(3, Math.floor((dims.height - 8) / cellHeight));
      term.resize(cols, rows);
      window.electronAPI?.terminalResize(cols, rows);
    }
  };
  new ResizeObserver(fit).observe(containerEl);

  // Receive data from pty
  if (window.electronAPI) {
    window.electronAPI.onTerminalData((data) => {
      term.write(data);
    });
    window.electronAPI.onTerminalExit(() => {
      term.writeln('\r\n[Process exited]');
      spawned = false;
    });
  }
}

export async function spawnTerminal(): Promise<void> {
  if (!window.electronAPI) return;
  if (spawned) {
    await window.electronAPI.terminalKill();
    spawned = false;
  }
  const result = await window.electronAPI.terminalSpawn();
  if (result.ok) {
    spawned = true;
    term.clear();
    term.focus();
  }
}

export function updateTerminalTheme(): void {
  if (!term) return;
  const colors = getTermTheme();
  term.options.theme = {
    background: colors.background,
    foreground: colors.foreground,
    cursor: colors.cursor,
  };
}
