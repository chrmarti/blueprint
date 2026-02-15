/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface OutlineEntry {
  level: number;
  text: string;
  line: number;
}

let editorEl: HTMLTextAreaElement;
let tabEdit: HTMLButtonElement;
let tabBrowser: HTMLButtonElement;
let browserView: HTMLElement;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let onSave: (text: string) => void = () => {};

export function initEditor(opts: { onSave: (text: string) => void }): void {
  editorEl = document.getElementById('editor-area') as HTMLTextAreaElement;
  tabEdit = document.getElementById('tab-edit') as HTMLButtonElement;
  tabBrowser = document.getElementById('tab-browser') as HTMLButtonElement;
  browserView = document.getElementById('browser-view') as HTMLElement;
  onSave = opts.onSave;

  editorEl.addEventListener('input', handleInput);
  tabEdit.addEventListener('click', () => showEditorTab('edit'));
  tabBrowser.addEventListener('click', () => showEditorTab('browser'));

  // File drop
  editorEl.addEventListener('dragover', (e) => e.preventDefault());
  editorEl.addEventListener('drop', async (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files[0];
    if (file && file.name.endsWith('.md')) {
      editorEl.value = await file.text();
      handleInput();
    }
  });
}

export function setContent(text: string): void {
  editorEl.value = text;
}

export function getContent(): string {
  return editorEl.value;
}

export function setFontSize(size: number): void {
  editorEl.style.fontSize = `${size}px`;
}

function handleInput(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    onSave(editorEl.value);
  }, 500);
}

function showEditorTab(tab: 'edit' | 'browser'): void {
  if (tab === 'edit') {
    editorEl.style.display = '';
    browserView.style.display = 'none';
    tabEdit.classList.add('active');
    tabBrowser.classList.remove('active');
  } else {
    editorEl.style.display = 'none';
    browserView.style.display = 'flex';
    tabBrowser.classList.add('active');
    tabEdit.classList.remove('active');
  }
}

export function showBrowserTab(): void {
  showEditorTab('browser');
}

export function exportFile(): void {
  const blob = new Blob([editorEl.value], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'main.md';
  a.click();
  URL.revokeObjectURL(url);
}

export function importFile(): Promise<string> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (file) {
        const text = await file.text();
        resolve(text);
      }
    });
    input.click();
  });
}
