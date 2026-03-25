// Preview module - browser tab with iframe and address bar

let previewFrame: HTMLIFrameElement | null = null;

export function initPreviewPanel(): void {
  previewFrame = document.getElementById('preview-iframe') as HTMLIFrameElement;
  const addressBar = document.getElementById('address-bar') as HTMLInputElement;
  const goBtn = document.getElementById('go-btn');

  if (addressBar) {
    addressBar.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        navigateToUrl(addressBar.value);
      }
    });
  }

  goBtn?.addEventListener('click', () => {
    if (addressBar) {
      navigateToUrl(addressBar.value);
    }
  });
}

export function navigateToUrl(url: string): void {
  if (!previewFrame) return;

  // Auto-prepend http:// if no protocol specified
  let finalUrl = url.trim();
  if (finalUrl && !finalUrl.match(/^https?:\/\//i)) {
    finalUrl = 'http://' + finalUrl;
  }

  if (finalUrl) {
    previewFrame.src = finalUrl;
    
    // Update address bar
    const addressBar = document.getElementById('address-bar') as HTMLInputElement;
    if (addressBar) {
      addressBar.value = finalUrl;
    }
  }
}

export function loadPreviewUrl(url: string): void {
  navigateToUrl(url);
  
  // Switch to Browser tab
  const browserTab = document.getElementById('browser-tab');
  const editTab = document.getElementById('edit-tab');
  const browserPanel = document.getElementById('browser-panel');
  const editPanel = document.getElementById('edit-panel');

  browserTab?.classList.add('active');
  editTab?.classList.remove('active');
  browserPanel?.classList.add('active');
  editPanel?.classList.remove('active');
}

export function loadPreviewContent(html: string): void {
  if (!previewFrame) return;

  // Inject console forwarding script
  const consoleScript = `
    <script>
      (function() {
        const originalConsole = {
          log: console.log,
          warn: console.warn,
          error: console.error
        };
        
        ['log', 'warn', 'error'].forEach(method => {
          console[method] = function(...args) {
            originalConsole[method].apply(console, args);
            parent.postMessage({
              type: 'console',
              method: method,
              args: args.map(arg => {
                try {
                  return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
                } catch {
                  return String(arg);
                }
              })
            }, '*');
          };
        });
      })();
    </script>
  `;

  // Insert script into head
  let modifiedHtml = html;
  if (html.includes('<head>')) {
    modifiedHtml = html.replace('<head>', '<head>' + consoleScript);
  } else if (html.includes('<html>')) {
    modifiedHtml = html.replace('<html>', '<html><head>' + consoleScript + '</head>');
  } else {
    modifiedHtml = consoleScript + html;
  }

  previewFrame.srcdoc = modifiedHtml;
}

export function clearPreview(): void {
  if (previewFrame) {
    previewFrame.src = 'about:blank';
    previewFrame.srcdoc = '';
  }
  
  const addressBar = document.getElementById('address-bar') as HTMLInputElement;
  if (addressBar) {
    addressBar.value = '';
  }
}
