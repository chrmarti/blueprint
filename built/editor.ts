/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { marked } from 'marked';

export interface OutlineEntry {
  level: number;
  text: string;
  line: number;
}

let editorEl: HTMLTextAreaElement;
let outlineEl: HTMLElement;
let previewEl: HTMLElement;
let tabEdit: HTMLButtonElement;
let tabPreview: HTMLButtonElement;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let onSave: (text: string) => void = () => {};

export function initEditor(opts: { onSave: (text: string) => void }): void {
  editorEl = document.getElementById('editor-area') as HTMLTextAreaElement;
  outlineEl = document.getElementById('outline') as HTMLElement;
  previewEl = document.getElementById('md-preview') as HTMLElement;
  tabEdit = document.getElementById('tab-edit') as HTMLButtonElement;
  tabPreview = document.getElementById('tab-preview') as HTMLButtonElement;
  onSave = opts.onSave;

  editorEl.addEventListener('input', handleInput);
  tabEdit.addEventListener('click', () => showTab('edit'));
  tabPreview.addEventListener('click', () => showTab('preview'));

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
  updateOutline();
}

export function getContent(): string {
  return editorEl.value;
}

export function setFontSize(size: number): void {
  editorEl.style.fontSize = `${size}px`;
}

function handleInput(): void {
  updateOutline();
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    onSave(editorEl.value);
  }, 500);
}

function showTab(tab: 'edit' | 'preview'): void {
  if (tab === 'edit') {
    editorEl.style.display = '';
    previewEl.style.display = 'none';
    tabEdit.classList.add('active');
    tabPreview.classList.remove('active');
  } else {
    editorEl.style.display = 'none';
    previewEl.style.display = 'block';
    previewEl.innerHTML = marked.parse(editorEl.value) as string;
    tabPreview.classList.add('active');
    tabEdit.classList.remove('active');
  }
}

function updateOutline(): void {
  const lines = editorEl.value.split('\n');
  const entries: OutlineEntry[] = [];
  lines.forEach((line, i) => {
    const m = line.match(/^(#{1,3})\s+(.+)/);
    if (m) {
      entries.push({ level: m[1].length, text: m[2], line: i });
    }
  });

  outlineEl.innerHTML = '';
  for (const entry of entries) {
    const div = document.createElement('div');
    div.className = `outline-item h${entry.level}`;
    div.textContent = entry.text;
    div.addEventListener('click', () => {
      // Scroll editor to the line
      const lines = editorEl.value.split('\n');
      let pos = 0;
      for (let i = 0; i < entry.line; i++) pos += lines[i].length + 1;
      editorEl.focus();
      editorEl.setSelectionRange(pos, pos);
      // Approximate scroll
      const lineHeight = parseInt(getComputedStyle(editorEl).lineHeight) || 22;
      editorEl.scrollTop = entry.line * lineHeight - editorEl.clientHeight / 3;
    });
    outlineEl.appendChild(div);
  }
}

export function exportFile(): void {
  const blob = new Blob([editorEl.value], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'blueprint.md';
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
