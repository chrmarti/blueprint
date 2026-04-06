// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

import { expandPreviewPanel } from './layout.js';

let previewIframe: HTMLIFrameElement | null = null;
let addressBar: HTMLInputElement | null = null;

export function initPreview(): void {
  previewIframe = document.getElementById('preview-iframe') as HTMLIFrameElement;
  addressBar = document.getElementById('address-bar') as HTMLInputElement;

  if (addressBar) {
    addressBar.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const url = normalizeUrl(addressBar!.value);
        loadPreviewUrl(url);
      }
    });
  }

  // Listen for console messages from iframe
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'console') {
      const { level, args } = event.data;
      const consoleMethod = (console as unknown as Record<string, (...args: unknown[]) => void>)[level] || console.log;
      consoleMethod.apply(console, ['[Preview]', ...args]);
    }
  });
}

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  
  // If no protocol specified, prepend http://
  if (!/^https?:\/\//i.test(trimmed)) {
    return `http://${trimmed}`;
  }
  return trimmed;
}

export function loadPreviewUrl(url: string): void {
  if (previewIframe && url) {
    previewIframe.src = url;
    if (addressBar) {
      addressBar.value = url;
    }
  }
}

export function loadPreviewContent(html: string): void {
  if (!previewIframe) return;

  // Inject console forwarding script
  const consoleForwarder = `
    <script>
      (function() {
        const origConsole = {};
        ['log', 'warn', 'error', 'info', 'debug'].forEach(function(level) {
          origConsole[level] = console[level];
          console[level] = function() {
            origConsole[level].apply(console, arguments);
            try {
              parent.postMessage({
                type: 'console',
                level: level,
                args: Array.from(arguments).map(function(arg) {
                  try { return JSON.parse(JSON.stringify(arg)); }
                  catch { return String(arg); }
                })
              }, '*');
            } catch {}
          };
        });
      })();
    </script>
  `;

  // Insert script into head if there's a head, otherwise prepend to content
  let modifiedHtml = html;
  if (/<head[^>]*>/i.test(html)) {
    modifiedHtml = html.replace(/<head([^>]*)>/i, `<head$1>${consoleForwarder}`);
  } else if (/<html[^>]*>/i.test(html)) {
    modifiedHtml = html.replace(/<html([^>]*)>/i, `<html$1><head>${consoleForwarder}</head>`);
  } else {
    modifiedHtml = consoleForwarder + html;
  }

  previewIframe.srcdoc = modifiedHtml;
  if (addressBar) {
    addressBar.value = '';
  }
}

export function showPreview(url: string): void {
  // Switch to Browser tab
  const browserTab = document.getElementById('browser-tab');
  if (browserTab) {
    browserTab.click();
  }
  
  // Expand the preview panel if collapsed
  expandPreviewPanel();
  
  // Load the URL
  loadPreviewUrl(url);
}
