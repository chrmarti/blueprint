/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { initEditor, setContent, getContent, setFontSize } from './editor';
import { initCompiler, compile, setOutput, getOutput } from './compiler';
import { initPreview, loadPreview } from './preview';
import { initLayout } from './layout';
import { initSettings, applyTheme } from './settings';
import { loadMarkdown, saveMarkdown, loadOutput, loadSettings, saveSettings } from './storage';

async function boot(): Promise<void> {
  // Initialize all modules
  initEditor({
    onSave: (text: string) => saveMarkdown(text),
  });

  initCompiler({
    onCompiled: (html: string) => loadPreview(html),
  });

  initPreview();
  initLayout();
  initSettings();

  // Apply saved settings
  const settings = loadSettings();
  applyTheme(settings.theme);
  setFontSize(settings.fontSize);

  // Restore saved state
  let md = loadMarkdown();
  if (!md) {
    // Load the blueprint as default content
    try {
      const res = await fetch('blueprint.md');
      if (res.ok) md = await res.text();
    } catch {
      // ignore
    }
  }
  if (md) {
    setContent(md);
    saveMarkdown(md);
  }

  const output = loadOutput();
  if (output) {
    setOutput(output);
    loadPreview(output);
  }

  // Toolbar: compile
  document.getElementById('compile-btn')?.addEventListener('click', () => {
    compile(getContent());
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
      saveMarkdown(getContent());
    }
    if (mod && e.key === 'p') {
      e.preventDefault();
      const tabPreview = document.getElementById('tab-preview') as HTMLButtonElement;
      tabPreview.click();
    }
  });
}

document.addEventListener('DOMContentLoaded', boot);
