/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

let frameEl: HTMLIFrameElement;
let consoleLogEl: HTMLElement;
let viewportBtns: NodeListOf<HTMLButtonElement>;

export function initPreview(): void {
  frameEl = document.getElementById('preview-frame') as HTMLIFrameElement;
  consoleLogEl = document.getElementById('console-log') as HTMLElement;
  viewportBtns = document.querySelectorAll('#viewport-controls button') as NodeListOf<HTMLButtonElement>;

  document.getElementById('preview-refresh')?.addEventListener('click', () => {
    // Re-inject current srcdoc
    const current = frameEl.srcdoc;
    if (current) loadPreview(current);
  });

  document.getElementById('preview-popout')?.addEventListener('click', () => {
    const html = frameEl.srcdoc;
    if (html) {
      const w = window.open('', '_blank');
      if (w) {
        w.document.open();
        w.document.write(html);
        w.document.close();
      }
    }
  });

  viewportBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      viewportBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const width = btn.dataset.width || '100%';
      frameEl.style.maxWidth = width;
      frameEl.style.margin = width === '100%' ? '0' : '0 auto';
      frameEl.style.display = 'block';
    });
  });

  // Listen for console messages from iframe
  window.addEventListener('message', (e) => {
    if (e.data?.type === 'console') {
      appendLog(e.data.level, e.data.args);
    }
  });
}

export function loadPreview(html: string): void {
  consoleLogEl.innerHTML = '';

  // Inject console forwarding script
  const consoleForwarder = `
<script>
(function() {
  const orig = { log: console.log, warn: console.warn, error: console.error };
  ['log','warn','error'].forEach(level => {
    console[level] = function(...args) {
      orig[level].apply(console, args);
      parent.postMessage({ type: 'console', level, args: args.map(String) }, '*');
    };
  });
})();
</script>`;

  const injected = html.replace(/<head>/i, `<head>${consoleForwarder}`);
  frameEl.srcdoc = injected.includes('<head>') ? injected : consoleForwarder + html;
}

function appendLog(level: string, args: string[]): void {
  const div = document.createElement('div');
  div.className = `log-entry log-${level}`;
  div.textContent = `[${level}] ${args.join(' ')}`;
  consoleLogEl.appendChild(div);
  consoleLogEl.scrollTop = consoleLogEl.scrollHeight;
}
