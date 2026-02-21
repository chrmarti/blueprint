/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function initLayout(): void {
  // Horizontal (column) drag handles
  const handles = document.querySelectorAll('.drag-handle');
  handles.forEach((handle) => {
    const el = handle as HTMLElement;
    const leftId = el.dataset.left!;
    const rightId = el.dataset.right!;
    const leftPanel = document.getElementById(leftId) as HTMLElement;
    const rightPanel = document.getElementById(rightId) as HTMLElement;

    let startX = 0;
    let startLeftWidth = 0;
    let startRightWidth = 0;

    const onMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - startX;
      const newLeft = Math.max(80, startLeftWidth + dx);
      const newRight = Math.max(80, startRightWidth - dx);
      leftPanel.style.flex = 'none';
      rightPanel.style.flex = 'none';
      leftPanel.style.width = `${newLeft}px`;
      rightPanel.style.width = `${newRight}px`;
    };

    const onMouseUp = () => {
      el.classList.remove('active');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    el.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault();
      el.classList.add('active');
      startX = e.clientX;
      startLeftWidth = leftPanel.getBoundingClientRect().width;
      startRightWidth = rightPanel.getBoundingClientRect().width;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  });

  // Vertical (row) drag handle for terminal panel
  const termHandle = document.getElementById('terminal-drag-handle');
  const termPanel = document.getElementById('terminal-panel');
  if (termHandle && termPanel) {
    let startY = 0;
    let startHeight = 0;

    const onMouseMove = (e: MouseEvent) => {
      const dy = startY - e.clientY;
      termPanel.style.height = `${Math.max(60, startHeight + dy)}px`;
    };

    const onMouseUp = () => {
      termHandle.classList.remove('active');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    termHandle.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault();
      termHandle.classList.add('active');
      startY = e.clientY;
      startHeight = termPanel.getBoundingClientRect().height;
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }
}
