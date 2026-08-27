(() => {
  function installSemesterColumnAutoAlign() {
    const alignSelectedButton = document.querySelector('#align-to-terms');
    const clearSelectionButton = document.querySelector('#clear-selection');
    const nodesLayer = document.querySelector('#nodes-layer');
    const flowHint = document.querySelector('#flow-hint');

    if (!(alignSelectedButton instanceof HTMLButtonElement) || !(nodesLayer instanceof HTMLElement) || document.querySelector('#auto-align-semester-columns')) return;

    alignSelectedButton.textContent = 'Align selected';
    alignSelectedButton.title = 'Move selected course nodes horizontally to their assigned year/semester column while preserving their vertical position';
    alignSelectedButton.setAttribute('aria-label', 'Align selected courses to their semester columns without changing vertical positions');

    const button = document.createElement('button');
    button.id = 'auto-align-semester-columns';
    button.className = 'toolbar-button';
    button.type = 'button';
    button.textContent = 'Auto-align columns';
    button.title = 'Snap every visible course horizontally to its assigned year/semester column while preserving each course vertical position';
    button.setAttribute('aria-label', 'Auto-align all visible courses to their semester columns without changing vertical positions');
    alignSelectedButton.insertAdjacentElement('afterend', button);

    const selectNode = node => {
      const rect = node.getBoundingClientRect();
      const pointerId = 987654;
      const common = {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId,
        pointerType: 'mouse',
        isPrimary: true,
        button: 0,
        clientX: rect.left + Math.max(1, rect.width / 2),
        clientY: rect.top + Math.max(1, rect.height / 2),
      };
      node.dispatchEvent(new PointerEvent('pointerdown', { ...common, buttons: 1 }));
      node.dispatchEvent(new PointerEvent('pointerup', { ...common, buttons: 0 }));
    };

    button.addEventListener('click', () => {
      const ids = [...nodesLayer.querySelectorAll('.course-node[data-id]')]
        .map(node => node.getAttribute('data-id'))
        .filter(Boolean);

      let aligned = 0;
      for (const id of ids) {
        const node = nodesLayer.querySelector(`.course-node[data-id="${CSS.escape(id)}"]`);
        if (!(node instanceof HTMLElement)) continue;
        selectNode(node);
        alignSelectedButton.click();
        aligned += 1;
      }

      if (clearSelectionButton instanceof HTMLButtonElement) clearSelectionButton.click();
      if (flowHint instanceof HTMLElement) {
        flowHint.textContent = aligned
          ? `Aligned ${aligned} visible course${aligned === 1 ? '' : 's'} to their assigned semester columns. Vertical positions were preserved.`
          : 'No visible courses were available to align.';
      }
    });
  }

  installSemesterColumnAutoAlign();
})();
