// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

import { loadSettings, saveSettings, type Settings } from './storage.js';

let currentSettings: Settings;

export function initLayout(): void {
  currentSettings = loadSettings();
  applyTheme(currentSettings.theme);
  setupDragHandles();
  setupPanelCollapse();
}

function applyTheme(theme: 'light' | 'dark'): void {
  document.documentElement.setAttribute('data-theme', theme);
}

export function setTheme(theme: 'light' | 'dark'): void {
  currentSettings.theme = theme;
  saveSettings(currentSettings);
  applyTheme(theme);
  // Dispatch event for terminal theme update
  window.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme } }));
}

export function getTheme(): 'light' | 'dark' {
  return currentSettings.theme;
}

function setupDragHandles(): void {
  // Vertical drag handles between columns
  const leftHandle = document.getElementById('drag-handle-left');
  const rightHandle = document.getElementById('drag-handle-right');
  
  if (leftHandle) {
    setupVerticalDrag(leftHandle, 'sidebar', 'left');
  }
  
  if (rightHandle) {
    setupVerticalDrag(rightHandle, 'right-panel', 'right');
  }

  // Horizontal drag handle for terminal
  const terminalHandle = document.getElementById('drag-handle-terminal');
  if (terminalHandle) {
    setupHorizontalDrag(terminalHandle);
  }
}

function setupVerticalDrag(handle: HTMLElement, panelId: string, side: 'left' | 'right'): void {
  let isDragging = false;
  let startX = 0;
  let startWidth = 0;
  const panel = document.getElementById(panelId);
  
  if (!panel) return;

  handle.addEventListener('mousedown', (e) => {
    isDragging = true;
    startX = e.clientX;
    startWidth = panel.offsetWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    
    const delta = side === 'left' ? e.clientX - startX : startX - e.clientX;
    const newWidth = Math.max(150, Math.min(600, startWidth + delta));
    panel.style.width = `${newWidth}px`;
    panel.style.flexShrink = '0';
    panel.style.flexGrow = '0';
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
}

function setupHorizontalDrag(handle: HTMLElement): void {
  let isDragging = false;
  let startY = 0;
  let startHeight = 0;
  const terminal = document.getElementById('terminal-panel');
  
  if (!terminal) return;

  handle.addEventListener('mousedown', (e) => {
    isDragging = true;
    startY = e.clientY;
    startHeight = terminal.offsetHeight;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    
    const delta = startY - e.clientY;
    const newHeight = Math.max(60, Math.min(400, startHeight + delta));
    terminal.style.height = `${newHeight}px`;
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // Trigger resize event for terminal to refit
      window.dispatchEvent(new Event('resize'));
    }
  });
}

function setupPanelCollapse(): void {
  // Setup collapse toggles for each panel
  const collapseButtons = document.querySelectorAll('[data-collapse]');
  collapseButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const panelId = (btn as HTMLElement).dataset.collapse;
      if (panelId) {
        togglePanelCollapse(panelId);
      }
    });
  });
}

function togglePanelCollapse(panelId: string): void {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  
  panel.classList.toggle('collapsed');
}

export function expandPreviewPanel(): void {
  const panel = document.getElementById('right-panel');
  if (panel) {
    panel.classList.remove('collapsed');
  }
}
