// main.ts - Renderer entry point for Blueprint Implementer

import { initLayout } from './layout';
import { initEditor } from './editor';
import { initPreview } from './preview';
import { initFiles, setWorkspaceFolder, refreshFileTree } from './files';
import { initTerminalPanel, respawnTerminal, disposeTerminal } from './terminal';
import { initImplementer, loadModels } from './implementer';
import { initSettings } from './settings';
import { initAuth } from './auth';

async function main(): Promise<void> {
  // Initialize all modules
  initLayout();
  initEditor();
  initPreview();
  await initFiles();
  initTerminalPanel();
  await initImplementer();
  initSettings();
  await initAuth();
  await loadModels();

  // Setup Open Folder button
  const openFolderBtn = document.getElementById('open-folder-btn');
  openFolderBtn?.addEventListener('click', async () => {
    const folder = await window.electronAPI.openFolder();
    if (folder) {
      await setWorkspaceFolder(folder);
      await respawnTerminal();
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Cmd+Shift+O - Open folder
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'o') {
      e.preventDefault();
      openFolderBtn?.click();
    }

    // Cmd+B - Implement
    if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
      e.preventDefault();
      document.getElementById('implement-btn')?.click();
    }
  });

  // Listen for workspace changes from main process
  window.addEventListener('workspace-changed', async (e) => {
    const event = e as CustomEvent<string>;
    await setWorkspaceFolder(event.detail);
    await respawnTerminal();
  });

  // Cleanup on unload
  window.addEventListener('beforeunload', () => {
    disposeTerminal();
    window.electronAPI.removeCopilotListeners();
  });
}

// Start the app
main().catch(console.error);
