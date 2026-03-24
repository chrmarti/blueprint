// layout.ts — Drag-handle resizable three-column layout

export function initLayout(): void {
  const sidebar = document.getElementById('sidebar') as HTMLElement;
  const editorPanel = document.getElementById('editor-panel') as HTMLElement;
  const outputPanel = document.getElementById('output-panel') as HTMLElement;
  const dragLeft = document.getElementById('drag-handle-left') as HTMLElement;
  const dragRight = document.getElementById('drag-handle-right') as HTMLElement;

  // Sidebar toggle
  const sidebarToggle = document.getElementById('toggle-sidebar') as HTMLElement;
  const outputToggle = document.getElementById('toggle-output') as HTMLElement;

  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      dragLeft.classList.toggle('hidden', sidebar.classList.contains('collapsed'));
    });
  }

  if (outputToggle) {
    outputToggle.addEventListener('click', () => {
      outputPanel.classList.toggle('collapsed');
      dragRight.classList.toggle('hidden', outputPanel.classList.contains('collapsed'));
    });
  }

  // Horizontal drag handles
  initDragHandle(dragLeft, (dx) => {
    const currentWidth = sidebar.offsetWidth;
    const newWidth = Math.max(150, currentWidth + dx);
    sidebar.style.width = newWidth + 'px';
  });

  initDragHandle(dragRight, (dx) => {
    const currentWidth = outputPanel.offsetWidth;
    const newWidth = Math.max(200, currentWidth - dx);
    outputPanel.style.width = newWidth + 'px';
  });

  // Terminal drag handle (vertical)
  const dragTerminal = document.getElementById('drag-handle-terminal') as HTMLElement;
  const terminalPanel = document.getElementById('terminal-panel') as HTMLElement;

  if (dragTerminal && terminalPanel) {
    initVerticalDragHandle(dragTerminal, (dy) => {
      const currentHeight = terminalPanel.offsetHeight;
      const newHeight = Math.max(60, currentHeight - dy);
      terminalPanel.style.height = newHeight + 'px';
    });
  }
}

function initDragHandle(handle: HTMLElement, onDrag: (dx: number) => void): void {
  if (!handle) return;

  let startX = 0;

  const onMouseMove = (e: MouseEvent) => {
    const dx = e.clientX - startX;
    startX = e.clientX;
    onDrag(dx);
  };

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}

function initVerticalDragHandle(handle: HTMLElement, onDrag: (dy: number) => void): void {
  if (!handle) return;

  let startY = 0;

  const onMouseMove = (e: MouseEvent) => {
    const dy = e.clientY - startY;
    startY = e.clientY;
    onDrag(dy);
  };

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startY = e.clientY;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}
