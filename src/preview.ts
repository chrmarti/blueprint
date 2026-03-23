// preview.ts - Browser tab iframe management for Blueprint Implementer

let previewIframe: HTMLIFrameElement | null = null;
let addressInput: HTMLInputElement | null = null;

export function initPreview(): void {
  previewIframe = document.getElementById('browser-iframe') as HTMLIFrameElement;
  addressInput = document.getElementById('browser-url') as HTMLInputElement;

  const goButton = document.getElementById('browser-go');

  if (addressInput) {
    addressInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        navigateToUrl(addressInput!.value);
      }
    });
  }

  if (goButton) {
    goButton.addEventListener('click', () => {
      if (addressInput) {
        navigateToUrl(addressInput.value);
      }
    });
  }
}

export function navigateToUrl(url: string): void {
  if (!previewIframe) return;

  // Auto-prepend http:// if no protocol
  let finalUrl = url.trim();
  if (finalUrl && !finalUrl.match(/^https?:\/\//i)) {
    finalUrl = 'http://' + finalUrl;
  }

  if (finalUrl) {
    previewIframe.src = finalUrl;
    if (addressInput) {
      addressInput.value = finalUrl;
    }
  }
}

export function loadPreviewUrl(url: string): void {
  navigateToUrl(url);
}

export function loadPreviewContent(html: string): void {
  if (!previewIframe) return;

  // Inject console forwarding script
  const consoleScript = `
    <script>
      (function() {
        const originalConsole = {
          log: console.log,
          warn: console.warn,
          error: console.error,
        };
        ['log', 'warn', 'error'].forEach(method => {
          console[method] = function(...args) {
            originalConsole[method].apply(console, args);
            parent.postMessage({ type: 'console', method, args: args.map(String) }, '*');
          };
        });
      })();
    </script>
  `;

  // Inject script into head
  let modifiedHtml = html;
  if (html.includes('<head>')) {
    modifiedHtml = html.replace('<head>', '<head>' + consoleScript);
  } else if (html.includes('<html>')) {
    modifiedHtml = html.replace('<html>', '<html><head>' + consoleScript + '</head>');
  } else {
    modifiedHtml = consoleScript + html;
  }

  previewIframe.srcdoc = modifiedHtml;
  if (addressInput) {
    addressInput.value = '';
  }
}

export function clearPreview(): void {
  if (previewIframe) {
    previewIframe.src = 'about:blank';
    previewIframe.srcdoc = '';
  }
  if (addressInput) {
    addressInput.value = '';
  }
}

// Listen for console messages from iframe
window.addEventListener('message', (event) => {
  if (event.data?.type === 'console') {
    const { method, args } = event.data;
    console.log(`[Preview ${method}]`, ...args);
  }
});
