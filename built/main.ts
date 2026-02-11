/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { initEditor, setContent, getContent, setFontSize } from './editor';
import { initCompiler, compile, setOutput, getOutput, saveOutputToFile } from './compiler';
import { initPreview, loadPreview } from './preview';
import { initLayout } from './layout';
import { initSettings, applyTheme, updateAuthUI } from './settings';
import { loadOutput, loadSettings, saveSettings } from './storage';
import { initAuth } from './auth';
import { initFileBrowser, saveCurrentFile, promptOpenFolder } from './files';

async function boot(): Promise<void> {
  // Initialize file browser (uses Electron IPC for disk access)
  initFileBrowser({
    onFileOpen: (filePath, content) => {
      setContent(content);
      // Show filename in editor panel header
      const parts = filePath.split('/');
      const editorTitle = document.querySelector('#editor-panel .panel-header > span');
      if (editorTitle) editorTitle.textContent = parts[parts.length - 1];
    },
  });

  // Initialize editor — autosave writes to disk via IPC
  initEditor({
    onSave: (text: string) => {
      saveCurrentFile(text);
    },
  });

  initCompiler({
    onCompiled: (html: string) => loadPreview(html),
  });

  initPreview();
  initLayout();
  initSettings();

  // Initialize GitHub auth
  initAuth({
    onAuthChange: (user) => updateAuthUI(user),
  });

  // Apply saved settings
  const settings = loadSettings();
  applyTheme(settings.theme);
  setFontSize(settings.fontSize);

  // Restore last compiled output from localStorage (session persistence)
  const output = loadOutput();
  if (output) {
    setOutput(output);
    loadPreview(output);
  }

  // If Electron provided a workspace folder on launch, the file browser
  // picks it up via the 'workspace:folderOpened' IPC event automatically.

  // Listen for auto-compile command (triggered by `npm start -- compile [file]`)
  if (window.electronAPI) {
    window.electronAPI.onAutoCompile(async (filePath) => {
      if (filePath) {
        try {
          const content = await window.electronAPI!.readFile(filePath);
          setContent(content);
          const parts = filePath.split('/');
          const editorTitle = document.querySelector('#editor-panel .panel-header > span');
          if (editorTitle) editorTitle.textContent = parts[parts.length - 1];
        } catch (err) {
          console.error('Failed to read file for auto-compile:', err);
          return;
        }
      }
      const md = getContent();
      if (md.trim()) {
        compile(md);
      } else {
        console.warn('Auto-compile: no content to compile');
      }
    });
  }

  // Toolbar: open folder
  document.getElementById('open-folder-btn')?.addEventListener('click', () => {
    promptOpenFolder();
  });

  // Toolbar: compile
  document.getElementById('compile-btn')?.addEventListener('click', () => {
    compile(getContent());
  });

  // Toolbar: save output to file
  document.getElementById('save-output-btn')?.addEventListener('click', () => {
    saveOutputToFile();
  });

  // Toolbar: theme toggle
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const s = loadSettings();
    s.theme = s.theme === 'dark' ? 'light' : 'dark';
    saveSettings(s);
    applyTheme(s.theme);
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === 'b') {
      e.preventDefault();
      compile(getContent());
    }
    if (mod && e.key === 's') {
      e.preventDefault();
      saveCurrentFile(getContent());
    }
    if (mod && e.key === 'p') {
      e.preventDefault();
      const tabPreview = document.getElementById('tab-preview') as HTMLButtonElement;
      tabPreview.click();
    }
  });
}

document.addEventListener('DOMContentLoaded', boot);
