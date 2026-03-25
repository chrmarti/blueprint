// Implementer module - output panel with xterm.js for agent events

import { Terminal } from '@xterm/xterm';
import { refreshFileTree, getCurrentFolder } from './files.js';
import { loadPreviewUrl } from './preview.js';
import { loadSettings, addHistoryEntry } from './storage.js';

let outputTerminal: Terminal | null = null;
let isImplementing = false;

export function initImplementerPanel(): void {
  const container = document.getElementById('output-terminal');
  if (!container) return;

  outputTerminal = new Terminal({
    cursorBlink: false,
    cursorStyle: 'bar',
    fontSize: 13,
    fontFamily: '"SF Mono", "Fira Code", "Monaco", "Inconsolata", monospace',
    theme: getOutputTheme(),
    disableStdin: true,
    convertEol: true,
  });

  outputTerminal.open(container);

  // Set up resize observer
  const resizeObserver = new ResizeObserver(() => {
    fitOutputTerminal();
  });
  resizeObserver.observe(container);

  // Set up implement button
  document.getElementById('implement-btn')?.addEventListener('click', () => {
    startImplementation();
  });

  // Set up stop button
  document.getElementById('stop-btn')?.addEventListener('click', () => {
    stopImplementation();
  });

  // Set up save button
  document.getElementById('save-output-btn')?.addEventListener('click', () => {
    saveOutput();
  });

  // Set up Copilot event handlers
  window.electronAPI.onCopilotChunk((chunk) => {
    outputTerminal?.write(chunk);
  });

  window.electronAPI.onCopilotEvent((event) => {
    handleImplementEvent(event);
  });
}

function fitOutputTerminal(): void {
  if (!outputTerminal) return;
  
  const container = document.getElementById('output-terminal');
  if (!container) return;

  const containerWidth = container.clientWidth;
  const containerHeight = container.clientHeight;

  if (containerWidth === 0 || containerHeight === 0) return;

  const cellWidth = outputTerminal.options.fontSize! * 0.6;
  const cellHeight = outputTerminal.options.fontSize! * 1.2;

  const cols = Math.floor(containerWidth / cellWidth);
  const rows = Math.floor(containerHeight / cellHeight);

  if (cols > 0 && rows > 0) {
    outputTerminal.resize(cols, rows);
  }
}

function getOutputTheme(): { background: string; foreground: string; cursor: string } {
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

export function updateOutputTheme(): void {
  if (!outputTerminal) return;
  outputTerminal.options.theme = getOutputTheme();
}

export async function startImplementation(): Promise<void> {
  if (isImplementing) return;

  const folder = getCurrentFolder();
  if (!folder) {
    setStatus('No folder open', 'error');
    return;
  }

  // Check authentication
  const user = await window.electronAPI.getUser();
  if (!user) {
    setStatus('Not signed in', 'error');
    return;
  }

  // Get blueprint content
  let blueprintContent: string;
  try {
    blueprintContent = await window.electronAPI.readFile(`${folder}/blueprint.md`);
  } catch {
    setStatus('No blueprint.md found', 'error');
    return;
  }

  isImplementing = true;
  setStatus('Implementing...', 'implementing');
  
  // Clear output
  outputTerminal?.clear();
  writeInfo('Starting implementation...\r\n');

  const settings = loadSettings();

  try {
    const result = await window.electronAPI.implement({
      model: settings.model,
      userPrompt: blueprintContent,
    });

    if (result.ok) {
      setStatus('Complete', 'success');
      addHistoryEntry({
        workspaceFolder: folder,
        model: settings.model,
        success: true,
        outputSize: 0,
      });
    } else {
      setStatus('Failed', 'error');
      writeError(result.error || 'Unknown error');
      addHistoryEntry({
        workspaceFolder: folder,
        model: settings.model,
        success: false,
        outputSize: 0,
      });
    }
  } catch (error) {
    setStatus('Failed', 'error');
    writeError(error instanceof Error ? error.message : String(error));
  } finally {
    isImplementing = false;
    await refreshFileTree();
  }
}

export async function stopImplementation(): Promise<void> {
  if (!isImplementing) return;
  
  await window.electronAPI.stopImplement();
  isImplementing = false;
  setStatus('Stopped', 'error');
  writeInfo('\r\n[Implementation stopped]\r\n');
}

function handleImplementEvent(event: { type: string; data?: Record<string, unknown> }): void {
  switch (event.type) {
    case 'session_start':
      writeInfo(`Session started (model: ${event.data?.model})\r\n`);
      break;
    case 'turn_start':
      writeDim(`turn started\r\n`);
      break;
    case 'turn_end':
      writeDim(`turn ended\r\n`);
      break;
    case 'tool_start':
      writeToolStart(event.data?.toolName as string, event.data?.arguments as Record<string, unknown>);
      break;
    case 'tool_complete':
      writeToolComplete(event.data?.toolName as string);
      break;
    case 'usage':
      writeUsage(event.data as { inputTokens: number; outputTokens: number; duration: number });
      break;
    case 'error':
      writeError(event.data?.message as string);
      break;
    case 'files_changed':
      refreshFileTree();
      break;
    case 'preview_url':
      loadPreviewUrl(event.data?.url as string);
      revealPreviewPanel();
      break;
    case 'done':
      if (event.data?.success) {
        writeInfo('\r\n✓ Implementation complete\r\n');
      }
      break;
  }
}

function writeToolStart(toolName: string, args: Record<string, unknown>): void {
  let summary = '';
  
  if (args) {
    if (toolName === 'create' || toolName === 'create_file' || toolName === 'edit' || toolName === 'write_file') {
      summary = args.path as string || args.file_path as string || '';
    } else if (toolName === 'bash' || toolName === 'shell') {
      const cmd = args.command as string || '';
      summary = cmd.length > 60 ? cmd.substring(0, 60) + '...' : cmd;
    } else if (toolName === 'view' || toolName === 'read_file') {
      summary = args.path as string || args.file_path as string || '';
    } else {
      // Get first meaningful argument value
      const values = Object.values(args).filter(v => typeof v === 'string');
      if (values.length > 0) {
        const val = values[0] as string;
        summary = val.length > 60 ? val.substring(0, 60) + '...' : val;
      }
    }
  }

  // Yellow tool icon, bold tool name
  outputTerminal?.write(`\x1b[33m🔧\x1b[0m \x1b[1m${toolName}\x1b[0m ${summary}\r\n`);
}

function writeToolComplete(toolName: string): void {
  // Green checkmark
  outputTerminal?.write(`\x1b[32m✓\x1b[0m ${toolName} complete\r\n`);
}

function writeUsage(usage: { inputTokens: number; outputTokens: number; duration: number }): void {
  const durationSec = (usage.duration / 1000).toFixed(1);
  // Gray dimmed
  outputTerminal?.write(`\x1b[90mtokens: ${usage.inputTokens.toLocaleString()} in / ${usage.outputTokens.toLocaleString()} out (${durationSec}s)\x1b[0m\r\n`);
}

function writeError(message: string): void {
  // Red bold
  outputTerminal?.write(`\x1b[31m\x1b[1m✗\x1b[0m \x1b[31m${message}\x1b[0m\r\n`);
}

function writeInfo(message: string): void {
  outputTerminal?.write(message);
}

function writeDim(message: string): void {
  outputTerminal?.write(`\x1b[90m${message}\x1b[0m`);
}

function setStatus(text: string, status: 'implementing' | 'success' | 'error'): void {
  const statusEl = document.getElementById('implement-status');
  if (statusEl) {
    statusEl.textContent = text;
    statusEl.className = `status ${status}`;
  }
}

function revealPreviewPanel(): void {
  // Switch to Browser tab in editor panel
  const browserTab = document.getElementById('browser-tab');
  const editTab = document.getElementById('edit-tab');
  const browserPanel = document.getElementById('browser-panel');
  const editPanel = document.getElementById('edit-panel');

  browserTab?.classList.add('active');
  editTab?.classList.remove('active');
  browserPanel?.classList.add('active');
  editPanel?.classList.remove('active');
}

async function saveOutput(): Promise<void> {
  // Not implemented - output is in xterm terminal buffer
  alert('Save output not yet implemented');
}

export function clearOutput(): void {
  outputTerminal?.clear();
}
