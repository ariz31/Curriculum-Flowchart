
;(() => {
  const HISTORY_LIMIT = 100;
  const clone = value => JSON.parse(JSON.stringify(value));
  const undoStack = [];
  const redoStack = [];
  let undoButton = null;
  let redoButton = null;
  let pendingPointerSnapshot = null;

  const positionsEqual = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {});

  const snapshot = () => ({
    positions: clone(state.positions || {}),
    layoutMode: state.layoutMode,
    sortStrategy: state.sortStrategy || null,
    viewport: clone(state.viewport),
  });

  const updateHistoryButtons = () => {
    if (undoButton instanceof HTMLButtonElement) undoButton.disabled = undoStack.length === 0;
    if (redoButton instanceof HTMLButtonElement) redoButton.disabled = redoStack.length === 0;
  };

  const pushHistory = (before, label = 'Move') => {
    if (!before || positionsEqual(before.positions, state.positions)) return false;
    undoStack.push({ ...before, label });
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack.length = 0;
    updateHistoryButtons();
    return true;
  };

  const restoreSnapshot = (entry, message) => {
    if (!entry) return;
    state.positions = clone(entry.positions || {});
    state.layoutMode = entry.layoutMode === 'optimized' ? 'optimized' : 'basic';
    state.sortStrategy = entry.sortStrategy || null;
    if (entry.viewport) state.viewport = clone(entry.viewport);
    selected.clear();
    afterManualPositionChange();
    save();
    renderFlow();
    switchView('flow');
    if (message) flowHint.textContent = message;
  };

  const undo = () => {
    const previous = undoStack.pop();
    if (!previous) return;
    redoStack.push({ ...snapshot(), label: previous.label });
    restoreSnapshot(previous, `Undid ${previous.label.toLowerCase()}.`);
    updateHistoryButtons();
  };

  const redo = () => {
    const next = redoStack.pop();
    if (!next) return;
    undoStack.push({ ...snapshot(), label: next.label });
    restoreSnapshot(next, `Redid ${next.label.toLowerCase()}.`);
    updateHistoryButtons();
  };

  const applyPositions = (nextPositions, options = {}) => {
    const before = snapshot();
    const validIds = new Set(state.courses.map(course => course.id));
    for (const [id, position] of Object.entries(nextPositions || {})) {
      if (!validIds.has(id) || !position) continue;
      const x = Number(position.x);
      const y = Number(position.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      state.positions[id] = { x, y };
    }
    if (options.layoutMode === 'optimized' || options.layoutMode === 'basic') state.layoutMode = options.layoutMode;
    if (Object.prototype.hasOwnProperty.call(options, 'sortStrategy')) state.sortStrategy = options.sortStrategy || null;
    if (options.viewport) state.viewport = sanitizeViewport(options.viewport);
    selected.clear();
    afterManualPositionChange();
    save();
    renderFlow();
    switchView('flow');
    if (options.fit) requestAnimationFrame(() => requestAnimationFrame(fitView));
    if (options.message) flowHint.textContent = options.message;
    if (options.recordHistory !== false) pushHistory(before, options.label || 'Layout change');
    return true;
  };

  const setLayoutMode = mode => {
    state.layoutMode = mode === 'optimized' ? 'optimized' : 'basic';
    afterManualPositionChange();
    save();
    renderFlow();
  };

  const getState = () => clone(state);

  window.CurriculumFlowchartRuntime = {
    getState,
    snapshot,
    pushHistory,
    applyPositions,
    setLayoutMode,
    renderFlow: () => renderFlow(),
    switchToFlow: () => switchView('flow'),
    setHint: message => { flowHint.textContent = String(message || ''); },
    undo,
    redo,
  };

  const installButtons = () => {
    const clearSelection = document.querySelector('#clear-selection');
    if (!(clearSelection instanceof HTMLButtonElement) || document.querySelector('#undo-layout-movement')) return;

    undoButton = document.createElement('button');
    undoButton.id = 'undo-layout-movement';
    undoButton.className = 'toolbar-button';
    undoButton.type = 'button';
    undoButton.textContent = 'Undo';
    undoButton.title = 'Undo the last node movement or layout operation (Ctrl/Cmd+Z)';

    redoButton = document.createElement('button');
    redoButton.id = 'redo-layout-movement';
    redoButton.className = 'toolbar-button';
    redoButton.type = 'button';
    redoButton.textContent = 'Redo';
    redoButton.title = 'Redo the last undone movement or layout operation (Ctrl/Cmd+Shift+Z or Ctrl+Y)';

    clearSelection.insertAdjacentElement('beforebegin', redoButton);
    redoButton.insertAdjacentElement('beforebegin', undoButton);
    undoButton.addEventListener('click', undo);
    redoButton.addEventListener('click', redo);
    updateHistoryButtons();
  };

  const editableTarget = target => target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));

  document.addEventListener('keydown', event => {
    if (editableTarget(event.target)) return;
    const modifier = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (modifier && key === 'z') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.shiftKey) redo(); else undo();
      return;
    }
    if (modifier && key === 'y') {
      event.preventDefault();
      event.stopImmediatePropagation();
      redo();
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    if (!(event.target instanceof Element) || !event.target.closest('#canvas-viewport')) return;
    const before = snapshot();
    window.setTimeout(() => pushHistory(before, 'Node movement'), 0);
  }, true);

  document.addEventListener('pointerdown', event => {
    if (!(event.target instanceof Element) || !event.target.closest('.course-node')) return;
    pendingPointerSnapshot = snapshot();
  }, true);

  const finishPointerHistory = () => {
    const before = pendingPointerSnapshot;
    pendingPointerSnapshot = null;
    if (!before) return;
    window.setTimeout(() => pushHistory(before, 'Node movement'), 0);
  };
  document.addEventListener('pointerup', finishPointerHistory, true);
  document.addEventListener('pointercancel', finishPointerHistory, true);

  document.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest('button');
    if (!(button instanceof HTMLButtonElement)) return;
    const sortSelect = document.querySelector('#sorting-strategy');
    const nativeMovement =
      button.matches('[data-align]') ||
      button.id === 'auto-layout' ||
      button.id === 'align-to-terms' ||
      button.id === 'auto-align-semester-columns' ||
      (button.id === 'optimize-layout' && (!(sortSelect instanceof HTMLSelectElement) || sortSelect.value === 'balanced'));
    if (!nativeMovement) return;
    const before = snapshot();
    const label = button.id === 'optimize-layout' ? 'Balanced sort' : button.id === 'auto-layout' ? 'Basic layout' : 'Alignment';
    window.setTimeout(() => pushHistory(before, label), 0);
  }, true);

  installButtons();
})();
