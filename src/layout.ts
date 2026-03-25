// Layout module - drag-handle resizable three-column layout

export function initLayout(): void {
  initVerticalDragHandles();
  initHorizontalDragHandle();
}

function initVerticalDragHandles(): void {
  const leftHandle = document.getElementById('drag-handle-left');
  const rightHandle = document.getElementById('drag-handle-right');
  const sidebar = document.getElementById('sidebar');
  const rightPanel = document.getElementById('right-panel');

  if (leftHandle && sidebar) {
    setupVerticalDrag(leftHandle, sidebar, 'left');
  }

  if (rightHandle && rightPanel) {
    setupVerticalDrag(rightHandle, rightPanel, 'right');
  }
}

function setupVerticalDrag(handle: HTMLElement, panel: HTMLElement, side: 'left' | 'right'): void {
  let startX = 0;
  let startWidth = 0;

  const onMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    startX = e.clientX;
    startWidth = panel.offsetWidth;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const onMouseMove = (e: MouseEvent) => {
    const diff = e.clientX - startX;
    let newWidth: number;
    
    if (side === 'left') {
      newWidth = startWidth + diff;
    } else {
      newWidth = startWidth - diff;
    }

    // Enforce min/max widths
    newWidth = Math.max(150, Math.min(600, newWidth));
    panel.style.width = `${newWidth}px`;
  };

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  handle.addEventListener('mousedown', onMouseDown);
}

function initHorizontalDragHandle(): void {
  const handle = document.getElementById('drag-handle-h');
  const terminalPanel = document.getElementById('terminal-panel');

  if (!handle || !terminalPanel) return;

  let startY = 0;
  let startHeight = 0;

  const onMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    startY = e.clientY;
    startHeight = terminalPanel.offsetHeight;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  };

  const onMouseMove = (e: MouseEvent) => {
    const diff = startY - e.clientY;
    let newHeight = startHeight + diff;

    // Enforce min/max heights
    newHeight = Math.max(60, Math.min(500, newHeight));
    terminalPanel.style.height = `${newHeight}px`;
  };

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  handle.addEventListener('mousedown', onMouseDown);
}
