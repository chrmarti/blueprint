// preview.ts — Browser tab (iframe, address bar, URL navigation)

let previewIframe: HTMLIFrameElement | null = null;
let addressBar: HTMLInputElement | null = null;

export function initPreview(): void {
  previewIframe = document.getElementById('preview-iframe') as HTMLIFrameElement;
  addressBar = document.getElementById('address-bar') as HTMLInputElement;

  if (addressBar) {
    addressBar.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        let url = addressBar!.value.trim();
        if (url && !url.match(/^https?:\/\//)) {
          url = 'http://' + url;
          addressBar!.value = url;
        }
        if (url && previewIframe) {
          previewIframe.removeAttribute('srcdoc');
          previewIframe.sandbox.add('allow-same-origin');
          previewIframe.src = url;
        }
      }
    });
  }
}

export function loadPreviewUrl(url: string): void {
  if (previewIframe) {
    previewIframe.removeAttribute('srcdoc');
    previewIframe.sandbox.add('allow-same-origin');
    previewIframe.src = url;
  }
  if (addressBar) {
    addressBar.value = url;
  }

  // Switch to Browser tab
  const browserTab = document.querySelector('[data-tab="browser"]') as HTMLElement;
  if (browserTab) {
    browserTab.click();
  }
}

export function loadPreviewContent(html: string): void {
  if (previewIframe) {
    // Inject console forwarding script
    const consoleScript = `<script>
      ['log','warn','error'].forEach(function(m){
        var orig=console[m];
        console[m]=function(){
          orig.apply(console,arguments);
          try{parent.postMessage({type:'console',method:m,args:Array.from(arguments).map(String)},'*')}catch(e){}
        };
      });
    <\/script>`;
    const injected = html.replace(/<head>/i, '<head>' + consoleScript);
    previewIframe.removeAttribute('src');
    previewIframe.srcdoc = injected;
  }
}
