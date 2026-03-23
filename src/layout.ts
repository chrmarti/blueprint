// layout.ts - Drag-handle resizable layout for Blueprint Implementer

let isDragging = false;
let currentHandle: HTMLElement | null = null;
let startX = 0;
let startY = 0;
let startWidth = 0;
let startHeight = 0;
let targetElement: HTMLElement | null = null;

export function initLayout(): void {
  const dragHandleLeft = document.getElementById('drag-handle-left');
  const dragHandleRight = document.getElementById('drag-handle-right');
  const dragHandleTerminal = document.getElementById('drag-handle-terminal');

  if (dragHandleLeft) {
    dragHandleLeft.addEventListener('mousedown', (e) => startDrag(e, 'left'));
  }

  if (dragHandleRight) {
    dragHandleRight.addEventListener('mousedown', (e) => startDrag(e, 'right'));
  }

  if (dragHandleTerminal) {
    dragHandleTerminal.addEventListener('mousedown', (e) => startDrag(e, 'terminal'));
  }

  document.addEventListener('mousemove', onDrag);
  document.addEventListener('mouseup', endDrag);
}

function startDrag(e: MouseEvent, type: 'left' | 'right' | 'terminal'): void {
  isDragging = true;
  currentHandle = e.target as HTMLElement;
  currentHandle.classList.add('dragging');
  startX = e.clientX;
  startY = e.clientY;

  if (type === 'left') {
    targetElement = document.getElementById('sidebar');
    startWidth = targetElement?.offsetWidth || 0;
  } else if (type === 'right') {
    targetElement = document.getElementById('output-panel');
    startWidth = targetElement?.offsetWidth || 0;
  } else if (type === 'terminal') {
    targetElement = document.getElementById('terminal-container');
    startHeight = targetElement?.offsetHeight || 0;
  }

  e.preventDefault();
}

function onDrag(e: MouseEvent): void {
  if (!isDragging || !targetElement) return;

  const handle = currentHandle;
  if (handle?.id === 'drag-handle-left') {
    const delta = e.clientX - startX;
    const newWidth = Math.max(180, Math.min(500, startWidth + delta));
    targetElement.style.width = `${newWidth}px`;
  } else if (handle?.id === 'drag-handle-right') {
    const delta = startX - e.clientX;
    const newWidth = Math.max(280, Math.min(600, startWidth + delta));
    targetElement.style.width = `${newWidth}px`;
  } else if (handle?.id === 'drag-handle-terminal') {
    const delta = startY - e.clientY;
    const newHeight = Math.max(60, Math.min(400, startHeight + delta));
    targetElement.style.height = `${newHeight}px`;
    // Trigger resize observer for terminal
    window.dispatchEvent(new Event('resize'));
  }
}

function endDrag(): void {
  if (currentHandle) {
    currentHandle.classList.remove('dragging');
  }
  isDragging = false;
  currentHandle = null;
  targetElement = null;
}
