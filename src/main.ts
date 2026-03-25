// Main renderer entry point - boots all modules

import { initAuth } from './auth.js';
import { initFilesPanel, setOnFileSelect, openFolder, refreshFileTree } from './files.js';
import { initEditorPanel, loadFile } from './editor.js';
import { initPreviewPanel } from './preview.js';
import { initTerminalPanel, spawnTerminal } from './terminal.js';
import { initImplementerPanel } from './implementer.js';
import { initChatPanel } from './chat.js';
import { initSettingsPanel } from './settings.js';
import { initLayout } from './layout.js';

async function main(): Promise<void> {
  console.log('Blueprint Implementer starting...');

  // Initialize layout first
  initLayout();

  // Initialize all panels
  initEditorPanel();
  initPreviewPanel();
  initTerminalPanel();
  initImplementerPanel();
  initChatPanel();

  // Set up file selection handler
  setOnFileSelect(async (filePath) => {
    await loadFile(filePath);
  });

  // Initialize files panel (loads workspace folder)
  await initFilesPanel();

  // Initialize settings (loads models, theme)
  await initSettingsPanel();

  // Initialize authentication
  await initAuth();

  // Set up Open Folder button
  document.getElementById('open-folder-btn')?.addEventListener('click', async () => {
    const folder = await window.electronAPI.openFolderDialog();
    if (folder) {
      await openFolder(folder);
      // Respawn terminal with new cwd
      await spawnTerminal();
    }
  });

  // Set up tab switching for right panel (Chat/Output)
  const chatTab = document.getElementById('chat-tab');
  const outputTab = document.getElementById('output-tab');
  const chatPanel = document.getElementById('chat-panel');
  const outputPanel = document.getElementById('output-panel');

  chatTab?.addEventListener('click', () => {
    chatTab.classList.add('active');
    outputTab?.classList.remove('active');
    chatPanel?.classList.add('active');
    outputPanel?.classList.remove('active');
  });

  outputTab?.addEventListener('click', () => {
    outputTab.classList.add('active');
    chatTab?.classList.remove('active');
    outputPanel?.classList.add('active');
    chatPanel?.classList.remove('active');
  });

  // Listen for custom file-changed events
  document.addEventListener('files-changed', () => {
    refreshFileTree();
  });

  console.log('Blueprint Implementer ready');
}

// Start the app
main().catch(console.error);
