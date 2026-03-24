// implementer.ts — Output panel (agent events, streaming terminal output)

import { Terminal } from '@xterm/xterm';
import { loadPreviewUrl } from './preview';
import { refreshFileTree } from './files';
import { addHistoryEntry, saveOutput } from './storage';

let outputTerminal: Terminal | null = null;
let outputBuffer = '';
let isImplementing = false;

export function initImplementer(): void {
  const container = document.getElementById('output-terminal') as HTMLElement;
  if (!container) return;

  outputTerminal = new Terminal({
    cursorBlink: false,
    cursorStyle: 'bar',
    fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", "Consolas", monospace',
    fontSize: 13,
    disableStdin: true,
    convertEol: true,
    theme: getOutputTheme(),
  });

  outputTerminal.open(container);

  // Auto-fit on resize
  const resizeObserver = new ResizeObserver(() => {
    fitOutputTerminal(container);
  });
  resizeObserver.observe(container);

  // Set up implement button
  const implementBtn = document.getElementById('implement-btn') as HTMLButtonElement;
  if (implementBtn) {
    implementBtn.addEventListener('click', startImplementation);
  }

  // Save button
  const saveBtn = document.getElementById('save-output-btn') as HTMLButtonElement;
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      window.electronAPI.saveFileDialog('output.txt', outputBuffer);
    });
  }

  // History button
  const historyBtn = document.getElementById('history-btn') as HTMLButtonElement;
  if (historyBtn) {
    historyBtn.addEventListener('click', toggleHistory);
  }

  // Listen for copilot events
  window.electronAPI.onCopilotChunk((chunk) => {
    if (outputTerminal && typeof chunk === 'string') {
      outputTerminal.write(chunk);
      outputBuffer += chunk;
    }
  });

  window.electronAPI.onCopilotEvent((event) => {
    handleImplementEvent(event);
  });
}

function fitOutputTerminal(container: HTMLElement): void {
  if (!outputTerminal) return;

  const core = (outputTerminal as unknown as { _core: { _renderService: { dimensions: { css: { cell: { width: number; height: number } } } } } })._core;
  if (!core?._renderService?.dimensions?.css?.cell) return;

  const cellWidth = core._renderService.dimensions.css.cell.width;
  const cellHeight = core._renderService.dimensions.css.cell.height;

  if (cellWidth === 0 || cellHeight === 0) return;

  const cols = Math.max(2, Math.floor(container.clientWidth / cellWidth));
  const rows = Math.max(1, Math.floor(container.clientHeight / cellHeight));

  outputTerminal.resize(cols, rows);
}

async function startImplementation(): Promise<void> {
  if (isImplementing) return;

  const status = document.getElementById('implement-status') as HTMLElement;
  const modelSelect = document.getElementById('model-select') as HTMLSelectElement;
  const model = modelSelect?.value || 'claude-opus-4.6-1m';

  // Check auth
  const user = await window.electronAPI.getUser();
  if (!user) {
    if (status) {
      status.textContent = 'Not signed in';
      status.className = 'status error';
    }
    return;
  }

  isImplementing = true;
  outputBuffer = '';
  if (outputTerminal) outputTerminal.clear();

  if (status) {
    status.textContent = 'Implementing...';
    status.className = 'status implementing';
  }

  const implementBtn = document.getElementById('implement-btn') as HTMLButtonElement;
  if (implementBtn) implementBtn.disabled = true;

  // Read blueprint.md content for the user prompt
  const folder = await window.electronAPI.getWorkspaceFolder();
  let userPrompt = '';
  if (folder) {
    try {
      userPrompt = await window.electronAPI.readFile(folder + '/blueprint.md');
    } catch {
      userPrompt = 'Implement the blueprint in this workspace.';
    }
  }

  const result = await window.electronAPI.implement({
    model,
    userPrompt,
  });

  isImplementing = false;
  if (implementBtn) implementBtn.disabled = false;

  if (status) {
    if (result.ok) {
      status.textContent = 'Implementation complete';
      status.className = 'status success';
    } else {
      status.textContent = result.error || 'Implementation failed';
      status.className = 'status error';
    }
  }

  // Save to history
  addHistoryEntry({
    id: Date.now().toString(),
    timestamp: Date.now(),
    model,
    status: result.ok ? 'success' : 'error',
    output: outputBuffer,
  });

  saveOutput(outputBuffer);
  await refreshFileTree();
}

function handleImplementEvent(event: ImplementEvent): void {
  if (!outputTerminal) return;

  switch (event.type) {
    case 'tool_start': {
      const toolName = event.data.toolName as string;
      const args = event.data.arguments as Record<string, unknown>;
      let summary = '';

      if (toolName === 'create_file' || toolName === 'write_file' || toolName === 'create') {
        summary = (args?.path || args?.filePath || '') as string;
      } else if (toolName === 'bash' || toolName === 'shell') {
        summary = (args?.command || '') as string;
      } else if (toolName === 'edit') {
        summary = (args?.path || args?.filePath || '') as string;
      } else {
        const firstVal = Object.values(args || {})[0];
        summary = typeof firstVal === 'string' ? firstVal : '';
      }

      outputTerminal.writeln(`\x1b[33m🔧 \x1b[1m${toolName}\x1b[22m ${summary}\x1b[0m`);
      break;
    }
    case 'tool_complete': {
      const name = event.data.toolName as string;
      outputTerminal.writeln(`\x1b[32m✓ ${name} complete\x1b[0m`);
      break;
    }
    case 'usage': {
      const inTokens = (event.data.inputTokens as number || 0).toLocaleString();
      const outTokens = (event.data.outputTokens as number || 0).toLocaleString();
      const durationMs = event.data.duration as number || 0;
      const durationSec = (durationMs / 1000).toFixed(1);
      outputTerminal.writeln(
        `\x1b[2m\x1b[37mtokens: ${inTokens} in / ${outTokens} out (${durationSec}s)\x1b[0m`
      );
      break;
    }
    case 'error': {
      const msg = event.data.message as string;
      outputTerminal.writeln(`\x1b[31m\x1b[1m✗ ${msg}\x1b[0m`);
      break;
    }
    case 'log': {
      const logMsg = event.data.message as string;
      outputTerminal.writeln(`\x1b[2m\x1b[37m${logMsg}\x1b[0m`);
      break;
    }
    case 'files_changed':
      refreshFileTree();
      break;
    case 'preview_url': {
      const url = event.data.url as string;
      if (url) {
        loadPreviewUrl(url);
        // Reveal output panel if collapsed
        const outputPanel = document.getElementById('output-panel');
        if (outputPanel?.classList.contains('collapsed')) {
          outputPanel.classList.remove('collapsed');
        }
      }
      break;
    }
    case 'done':
      outputTerminal.writeln(`\x1b[2m\x1b[37msession complete\x1b[0m`);
      break;
  }
}

function toggleHistory(): void {
  const drawer = document.getElementById('history-drawer') as HTMLElement;
  if (!drawer) return;

  drawer.classList.toggle('open');
}

function getOutputTheme(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  return {
    background: style.getPropertyValue('--bg-surface').trim() || '#1e1e1e',
    foreground: style.getPropertyValue('--text').trim() || '#cccccc',
    cursor: 'transparent',
  };
}

export function updateOutputTheme(): void {
  if (outputTerminal) {
    outputTerminal.options.theme = getOutputTheme();
  }
}
