// implementer.ts - Output panel for agent events and streaming for Blueprint Implementer
import { Terminal } from '@xterm/xterm';
import { getTheme, getSelectedModel, setSelectedModel, addToHistory } from './storage';
import { getCachedUser } from './auth';
import { refreshFileTree, getWorkspaceFolder } from './files';
import { loadPreviewUrl } from './preview';
import { switchEditorTab } from './editor';

let outputTerminal: Terminal | null = null;
let outputContainer: HTMLElement | null = null;
let modelSelect: HTMLSelectElement | null = null;
let statusEl: HTMLElement | null = null;
let isImplementing = false;
let outputBuffer = '';

export async function initImplementer(): Promise<void> {
  outputContainer = document.getElementById('output-terminal');
  modelSelect = document.getElementById('model-select') as HTMLSelectElement;
  statusEl = document.getElementById('implement-status');

  // Initialize output terminal
  if (outputContainer) {
    outputTerminal = new Terminal({
      cursorBlink: false,
      cursorStyle: 'underline',
      fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
      fontSize: 12,
      lineHeight: 1.3,
      theme: getOutputTerminalTheme(),
      convertEol: true,
      scrollback: 10000,
    });
    outputTerminal.open(outputContainer);
  }

  // Setup Copilot event listeners
  window.electronAPI.onCopilotChunk((chunk) => {
    outputTerminal?.write(chunk);
    outputBuffer += chunk;
  });

  window.electronAPI.onCopilotEvent((event) => {
    handleCopilotEvent(event);
  });

  // Setup model selection
  if (modelSelect) {
    modelSelect.addEventListener('change', () => {
      setSelectedModel(modelSelect!.value);
    });
  }

  // Setup buttons
  document.getElementById('implement-btn')?.addEventListener('click', startImplementation);
  document.getElementById('stop-btn')?.addEventListener('click', stopImplementation);
  document.getElementById('save-output-btn')?.addEventListener('click', saveOutput);
  document.getElementById('clean-btn')?.addEventListener('click', cleanWorkspace);
}

export async function loadModels(): Promise<void> {
  if (!modelSelect) return;

  try {
    const response = await window.electronAPI.copilotListModels();
    if (response.ok && response.models.length > 0) {
      const savedModel = getSelectedModel();

      modelSelect.innerHTML = response.models
        .map((m) => `<option value="${m.id}" ${m.id === savedModel ? 'selected' : ''}>${m.name}</option>`)
        .join('');

      // Ensure saved model is selected
      if (savedModel && response.models.some((m) => m.id === savedModel)) {
        modelSelect.value = savedModel;
      }
    } else {
      modelSelect.innerHTML = '<option value="">Sign in to load models</option>';
    }
  } catch (err) {
    console.error('Failed to load models:', err);
    modelSelect.innerHTML = '<option value="">Failed to load models</option>';
  }
}

function getOutputTerminalTheme(): { background: string; foreground: string; cursor: string } {
  const theme = getTheme();
  if (theme === 'dark') {
    return {
      background: '#1e1e1e',
      foreground: '#e0e0e0',
      cursor: '#e0e0e0',
    };
  }
  return {
    background: '#ffffff',
    foreground: '#1a1a1a',
    cursor: '#1a1a1a',
  };
}

export function updateOutputTerminalTheme(): void {
  if (outputTerminal) {
    outputTerminal.options.theme = getOutputTerminalTheme();
  }
}

async function startImplementation(): Promise<void> {
  if (isImplementing) return;

  const user = getCachedUser();
  if (!user) {
    setStatus('Not signed in', 'error');
    return;
  }

  const workspaceFolder = getWorkspaceFolder();
  if (!workspaceFolder) {
    setStatus('No folder open', 'error');
    return;
  }

  const model = modelSelect?.value;
  if (!model) {
    setStatus('No model selected', 'error');
    return;
  }

  isImplementing = true;
  outputBuffer = '';
  outputTerminal?.clear();
  setStatus('Implementing...', 'running');

  // Initialize agent
  const initResult = await window.electronAPI.copilotInit('');
  if (!initResult.ok) {
    setStatus(`Init failed: ${initResult.error}`, 'error');
    isImplementing = false;
    return;
  }

  // Read blueprint.md for the prompt
  let blueprintContent = '';
  try {
    blueprintContent = await window.electronAPI.readFile(`${workspaceFolder}/blueprint.md`);
  } catch {
    setStatus('No blueprint.md found', 'error');
    isImplementing = false;
    return;
  }

  // Prefix with implementation directive
  const userPrompt = `Implement the following blueprint now. Do not ask for confirmation — start immediately.\n\n${blueprintContent}`;

  // Start implementation
  const result = await window.electronAPI.copilotImplement({
    model,
    userPrompt,
  });

  if (result.ok) {
    setStatus('Complete', 'success');
    // Save to history
    addToHistory({
      timestamp: Date.now(),
      model,
      prompt: blueprintContent,
      output: outputBuffer,
    });
  } else {
    setStatus(`Error: ${result.error}`, 'error');
  }

  isImplementing = false;
  await refreshFileTree();
}

async function stopImplementation(): Promise<void> {
  if (!isImplementing) return;

  await window.electronAPI.copilotStop();
  setStatus('Stopped', 'error');
  isImplementing = false;
}

async function saveOutput(): Promise<void> {
  const path = await window.electronAPI.saveFile('output.txt');
  if (path) {
    await window.electronAPI.writeFile(path, outputBuffer);
  }
}

async function cleanWorkspace(): Promise<void> {
  const workspaceFolder = getWorkspaceFolder();
  if (!workspaceFolder) {
    alert('No folder open');
    return;
  }

  // First do a dry run
  const dryResult = await window.electronAPI.cleanWorkspace({ dryRun: true });

  if (!dryResult.ok) {
    if (dryResult.error?.includes('.blueprintfiles')) {
      alert('No .blueprintfiles found in the workspace root. Create a .blueprintfiles file listing the files and folders to preserve.');
    } else {
      alert(`Clean failed: ${dryResult.error}`);
    }
    return;
  }

  if (!dryResult.deleted || dryResult.deleted.length === 0) {
    alert('Nothing to clean — workspace matches .blueprintfiles.');
    return;
  }

  const confirmMsg = `The following ${dryResult.deleted.length} item(s) will be deleted:\n\n${dryResult.deleted.join('\n')}\n\nProceed?`;
  if (!confirm(confirmMsg)) {
    return;
  }

  // Execute clean
  const result = await window.electronAPI.cleanWorkspace();
  if (result.ok) {
    await refreshFileTree();
    alert(`Cleaned ${result.deleted?.length || 0} item(s).`);
  } else {
    alert(`Clean failed: ${result.error}`);
  }
}

function setStatus(text: string, type: 'running' | 'success' | 'error' | ''): void {
  if (statusEl) {
    statusEl.textContent = text;
    statusEl.className = 'output-status ' + type;
  }
}

function handleCopilotEvent(event: ImplementEvent): void {
  const { type, data } = event;

  switch (type) {
    case 'tool_start': {
      const toolName = data.toolName as string;
      const args = data.arguments as Record<string, unknown> | undefined;
      const summary = getToolSummary(toolName, args);
      writeEventLine(`\x1b[33m🔧 \x1b[1m${toolName}\x1b[0m\x1b[33m ${summary}\x1b[0m`);
      break;
    }

    case 'tool_complete': {
      const toolName = data.toolName as string;
      writeEventLine(`\x1b[32m✓ ${toolName} complete\x1b[0m`);
      break;
    }

    case 'usage': {
      const inputTokens = data.inputTokens as number;
      const outputTokens = data.outputTokens as number;
      const duration = data.duration as number;
      const durationSec = (duration / 1000).toFixed(1);
      writeEventLine(`\x1b[90mtokens: ${inputTokens.toLocaleString()} in / ${outputTokens.toLocaleString()} out (${durationSec}s)\x1b[0m`);
      break;
    }

    case 'error': {
      const message = data.message as string;
      writeEventLine(`\x1b[31m\x1b[1m✗ ${message}\x1b[0m`);
      break;
    }

    case 'log': {
      const message = data.message as string;
      if (message) {
        const label = message.replace(/\./g, ' ').replace(/_/g, ' ');
        writeEventLine(`\x1b[90m${label}\x1b[0m`);
      }
      break;
    }

    case 'files_changed': {
      refreshFileTree();
      break;
    }

    case 'preview_url': {
      const url = data.url as string;
      if (url) {
        loadPreviewUrl(url);
        switchEditorTab('browser');
        // Un-collapse preview panel if collapsed
        const outputPanel = document.getElementById('output-panel');
        if (outputPanel?.classList.contains('collapsed')) {
          outputPanel.classList.remove('collapsed');
        }
      }
      break;
    }

    case 'done': {
      // Implementation complete - handled by main promise
      break;
    }
  }
}

function getToolSummary(toolName: string, args?: Record<string, unknown>): string {
  if (!args) return '';

  // File operations - show path
  if (toolName.includes('file') || toolName.includes('create') || toolName.includes('edit') || toolName.includes('view')) {
    const path = args.path || args.file_path || args.filepath || args.file;
    if (path) return String(path);
  }

  // Shell/bash - show command
  if (toolName.includes('bash') || toolName.includes('shell') || toolName.includes('command')) {
    const cmd = args.command || args.cmd;
    if (cmd) {
      const cmdStr = String(cmd);
      return cmdStr.length > 60 ? cmdStr.substring(0, 57) + '...' : cmdStr;
    }
  }

  // Grep/search - show pattern
  if (toolName.includes('grep') || toolName.includes('search')) {
    const pattern = args.pattern || args.query;
    if (pattern) return `"${pattern}"`;
  }

  // Glob - show pattern
  if (toolName.includes('glob')) {
    const pattern = args.pattern;
    if (pattern) return String(pattern);
  }

  // Preview browser
  if (toolName === 'open_in_preview_browser') {
    const url = args.url;
    if (url) return String(url);
  }

  // Default: show first string argument
  for (const value of Object.values(args)) {
    if (typeof value === 'string' && value.length < 80) {
      return value;
    }
  }

  return '';
}

function writeEventLine(line: string): void {
  outputTerminal?.writeln(line);
}

interface ImplementEvent {
  type: string;
  data: Record<string, unknown>;
}
