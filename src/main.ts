// main.ts — Renderer entry point, boots all modules

import { initLayout } from './layout';
import { initEditor } from './editor';
import { initPreview } from './preview';
import { initFiles, setWorkspaceFolder, refreshFileTree } from './files';
import { initTerminalPanel, respawnTerminal } from './terminal';
import { initImplementer } from './implementer';
import { initSettings, populateModels } from './settings';

async function boot(): Promise<void> {
  // Initialize UI modules
  initLayout();
  initEditor();
  initPreview();
  initFiles();
  initImplementer();
  initSettings();

  // Initialize terminal
  initTerminalPanel();

  // Check for workspace folder from command line
  const folder = await window.electronAPI.getWorkspaceFolder();
  if (folder) {
    await setWorkspaceFolder(folder);
    respawnTerminal();
  }

  // Load user info and models
  loadUserInfo();
  populateModels();

  // Open folder button
  const openFolderBtn = document.getElementById('open-folder-btn');
  if (openFolderBtn) {
    openFolderBtn.addEventListener('click', async () => {
      const selected = await window.electronAPI.openFolder();
      if (selected) {
        await setWorkspaceFolder(selected);
        respawnTerminal();
      }
    });
  }

  // Clean button
  const cleanBtn = document.getElementById('clean-btn');
  if (cleanBtn) {
    cleanBtn.addEventListener('click', handleClean);
  }

  // Listen for folder changes (from menu)
  window.addEventListener('folder-changed', (async (e: Event) => {
    const folder = (e as CustomEvent<string>).detail;
    await setWorkspaceFolder(folder);
    respawnTerminal();
  }) as EventListener);
}

async function loadUserInfo(): Promise<void> {
  const userInfo = document.getElementById('user-info') as HTMLElement;
  if (!userInfo) return;

  const user = await window.electronAPI.getUser();
  if (user) {
    userInfo.innerHTML = `<img src="${user.avatar_url}" alt="${user.login}" class="avatar"> <span>${user.login}</span>`;

    // Init copilot with token (resolved by main process)
    // The main process handles token resolution internally
  } else {
    userInfo.innerHTML = '<span class="text-muted">Not signed in</span>';
  }
}

async function handleClean(): Promise<void> {
  // First do a dry run to see what would be deleted
  const dryResult = await window.electronAPI.cleanWorkspace({ dryRun: true });

  if (!dryResult.ok) {
    alert(dryResult.error || 'Clean failed. Make sure .blueprintfiles exists in the workspace root.');
    return;
  }

  if (dryResult.deleted.length === 0) {
    alert('Nothing to clean — all files are listed in .blueprintfiles.');
    return;
  }

  const message = `The following ${dryResult.deleted.length} entries will be deleted:\n\n${dryResult.deleted.join('\n')}\n\nContinue?`;
  if (!confirm(message)) return;

  const result = await window.electronAPI.cleanWorkspace();
  if (result.ok) {
    await refreshFileTree();
  } else {
    alert(result.error || 'Clean failed.');
  }
}

// Boot when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
