// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

import { serverAPI } from './api-client.js';
import { initLayout } from './layout.js';
import { initEditor } from './editor.js';
import { initPreview } from './preview.js';
import { initFiles, refreshFileTree } from './files.js';
import { initTerminal } from './terminal.js';
import { initAuth, loadModels } from './auth.js';
import { initSettings } from './settings.js';
import { initImplementer } from './implementer.js';
import { initChat } from './chat.js';

// Initialize all modules on DOM ready
document.addEventListener('DOMContentLoaded', async () => {
  console.log('Blueprint Implementer initializing...');

  // Initialize layout first
  initLayout();

  // Initialize UI modules
  initEditor();
  initPreview();
  initFiles();
  initTerminal();
  initSettings();
  initImplementer();
  initChat();

  // Load workspace info
  try {
    const folder = await serverAPI.getWorkspaceFolder();
    const folderName = folder.split('/').pop() || folder;
    const workspaceEl = document.getElementById('workspace-name');
    if (workspaceEl) {
      workspaceEl.textContent = folderName;
    }
  } catch (err) {
    console.error('Failed to get workspace folder:', err);
  }

  // Initialize auth and load models
  await initAuth();
  await loadModels();

  // Setup clean button
  const cleanBtn = document.getElementById('clean-btn');
  if (cleanBtn) {
    cleanBtn.addEventListener('click', handleClean);
  }

  console.log('Blueprint Implementer ready');
});

async function handleClean(): Promise<void> {
  // First do a dry run to see what would be deleted
  const result = await serverAPI.cleanWorkspace(true);
  
  if (!result.ok) {
    alert(result.error || 'Clean failed');
    return;
  }
  
  if (result.deleted.length === 0) {
    alert('Nothing to clean - all files are in .blueprintfiles');
    return;
  }
  
  // Show confirmation
  const message = `The following entries will be deleted:\n\n${result.deleted.join('\n')}\n\nContinue?`;
  if (!confirm(message)) {
    return;
  }
  
  // Actually clean
  const cleanResult = await serverAPI.cleanWorkspace(false);
  if (cleanResult.ok) {
    alert(`Deleted ${cleanResult.deleted.length} entries`);
    await refreshFileTree();
  } else {
    alert(cleanResult.error || 'Clean failed');
  }
}
