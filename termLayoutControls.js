(() => {
  const STORAGE_KEY = 'curriculum-flowchart:term-layout:v1';
  const CURRICULUM_LIBRARY_KEY = 'curriculum-flowchart:curricula:v1';
  const W = 184;
  const START_X = 34;
  const DEFAULT_GAP = 76;
  const MIN_GAP = 20;
  const MAX_GAP = 360;
  const MIN_TERM_SEPARATION = 20;
  const YEARS = ['First Year', 'Second Year', 'Third Year', 'Fourth Year'];
  const TERMS = ['First Semester', 'Second Semester', 'Short Term'];

  const clone = value => JSON.parse(JSON.stringify(value));
  const safeParse = value => { try { return value ? JSON.parse(value) : null; } catch { return null; } };
  const unique = values => [...new Set(values.filter(Boolean))];
  const ordered = (values, defaults) => [
    ...defaults.filter(value => values.includes(value)),
    ...unique(values).filter(value => !defaults.includes(value)).sort(),
  ];
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const termKey = (year, term) => `${year}\u0000${term}`;

  function activeCurriculumId() {
    return String(safeParse(localStorage.getItem(CURRICULUM_LIBRARY_KEY))?.activeId || 'default');
  }

  function allConfigs() {
    const stored = safeParse(localStorage.getItem(STORAGE_KEY));
    return stored && typeof stored === 'object' ? stored : {};
  }

  function normalizeConfig(value) {
    const gap = clamp(Number(value?.gap) || DEFAULT_GAP, MIN_GAP, MAX_GAP);
    const customX = {};
    if (value?.customX && typeof value.customX === 'object') {
      for (const [key, raw] of Object.entries(value.customX)) {
        const x = Number(raw);
        if (Number.isFinite(x)) customX[key] = Math.max(0, x);
      }
    }
    return { gap, customX };
  }

  function getConfig() {
    return normalizeConfig(allConfigs()[activeCurriculumId()]);
  }

  function saveConfig(config) {
    const configs = allConfigs();
    configs[activeCurriculumId()] = normalizeConfig(config);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
    syncInput();
  }

  function exportState() {
    return clone(getConfig());
  }

  function importState(value, options = {}) {
    saveConfig(normalizeConfig(value));
    if (!options.silent) window.CurriculumFlowchartRuntime?.renderFlow?.();
  }

  function columnsFor(courses, config = getConfig()) {
    const years = ordered(unique((courses || []).map(course => course.yearLevel)), YEARS);
    const columns = [];
    let index = 0;
    for (const year of years) {
      const terms = ordered(
        unique((courses || []).filter(course => course.yearLevel === year).map(course => course.semester)),
        TERMS,
      );
      for (const term of terms) {
        const key = termKey(year, term);
        const defaultX = START_X + index * (W + config.gap);
        const override = Number(config.customX?.[key]);
        columns.push({ year, term, key, x: Number.isFinite(override) ? override : defaultX, defaultX });
        index += 1;
      }
    }
    return columns;
  }

  let runtime = null;
  let gapInput = null;
  let resetButton = null;
  let drag = null;
  let headersObserver = null;

  function attachRuntime(value) {
    runtime = value || null;
    refreshHeaders();
    syncInput();
  }

  function syncInput() {
    if (gapInput instanceof HTMLInputElement) gapInput.value = String(Math.round(getConfig().gap));
  }

  function applyConfigChange(nextConfig, label, message) {
    const app = runtime || window.CurriculumFlowchartRuntime;
    if (!app) return false;
    const state = app.getState();
    const before = app.snapshot();
    const oldColumns = columnsFor(state.courses, getConfig());
    const newColumns = columnsFor(state.courses, normalizeConfig(nextConfig));
    const oldByKey = new Map(oldColumns.map(column => [column.key, column]));
    const newByKey = new Map(newColumns.map(column => [column.key, column]));
    const nextPositions = {};

    for (const course of state.courses || []) {
      const current = state.positions?.[course.id];
      if (!current) continue;
      const key = termKey(course.yearLevel, course.semester);
      const oldColumn = oldByKey.get(key);
      const newColumn = newByKey.get(key);
      if (!oldColumn || !newColumn) continue;
      nextPositions[course.id] = {
        x: current.x + (newColumn.x - oldColumn.x),
        y: current.y,
      };
    }

    saveConfig(nextConfig);
    app.applyPositions(nextPositions, {
      layoutMode: state.layoutMode,
      sortStrategy: state.sortStrategy || null,
      recordHistory: false,
      label,
      message,
    });
    app.pushHistory(before, label);
    refreshHeaders();
    return true;
  }

  function applyGap(rawValue) {
    const nextGap = clamp(Number(rawValue) || DEFAULT_GAP, MIN_GAP, MAX_GAP);
    const current = getConfig();
    if (Math.abs(current.gap - nextGap) < 0.01) { syncInput(); return; }
    applyConfigChange(
      { ...current, gap: nextGap },
      'Term spacing',
      `Term horizontal gap set to ${Math.round(nextGap)} px. Manual term positions were preserved.`,
    );
  }

  function resetTermPositions() {
    const current = getConfig();
    if (!Object.keys(current.customX).length) {
      runtime?.setHint?.('Term columns are already using the default horizontal spacing.');
      return;
    }
    applyConfigChange(
      { ...current, customX: {} },
      'Reset term columns',
      'Manual term-column positions were reset while preserving the current term gap.',
    );
  }

  function installControls() {
    if (document.querySelector('#term-horizontal-gap')) return;
    const anchor = document.querySelector('#auto-align-semester-columns') || document.querySelector('#align-to-terms');
    if (!(anchor instanceof HTMLElement)) return;

    const group = document.createElement('span');
    group.className = 'term-layout-controls';
    group.innerHTML = `
      <label class="term-gap-control" title="Set the default empty horizontal space between term columns">
        <span>Term gap</span>
        <input id="term-horizontal-gap" type="number" min="${MIN_GAP}" max="${MAX_GAP}" step="4" inputmode="numeric" aria-label="Horizontal gap between term columns in pixels" />
        <span>px</span>
      </label>
      <button id="reset-term-columns" class="toolbar-button" type="button" title="Reset manually moved term columns to the current default spacing">Reset terms</button>`;
    anchor.insertAdjacentElement('afterend', group);

    gapInput = group.querySelector('#term-horizontal-gap');
    resetButton = group.querySelector('#reset-term-columns');
    syncInput();

    gapInput?.addEventListener('change', () => applyGap(gapInput.value));
    gapInput?.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      gapInput.blur();
    });
    resetButton?.addEventListener('click', resetTermPositions);

    const style = document.createElement('style');
    style.textContent = `
      .term-layout-controls{display:inline-flex;align-items:center;gap:6px;flex-wrap:nowrap}
      .term-gap-control{display:inline-flex;align-items:center;gap:4px;font-size:.76rem;font-weight:650;color:#44516a;white-space:nowrap}
      #term-horizontal-gap{width:62px;min-height:34px;border:1px solid #d8deea;border-radius:7px;padding:4px 6px;font:inherit;color:#172033;background:#fff}
      #headers-layer .term-header.term-column-draggable{pointer-events:auto;cursor:ew-resize;touch-action:none;user-select:none}
      #headers-layer .term-header.term-column-dragging{opacity:.8;box-shadow:0 0 0 2px rgba(31,93,184,.22)}
      @media(max-width:760px){#term-horizontal-gap{min-height:42px;width:68px}.term-gap-control{font-size:.72rem}}
    `;
    document.head.append(style);
  }

  function refreshHeaders() {
    const app = runtime || window.CurriculumFlowchartRuntime;
    const layer = document.querySelector('#headers-layer');
    if (!app || !(layer instanceof HTMLElement)) return;
    const state = app.getState();
    const columns = columnsFor(state.courses);
    const headers = [...layer.querySelectorAll('.term-header')];
    headers.forEach((header, index) => {
      const column = columns[index];
      if (!(header instanceof HTMLElement) || !column) return;
      header.dataset.termKey = column.key;
      header.dataset.year = column.year;
      header.dataset.term = column.term;
      header.classList.add('term-column-draggable');
      header.title = `${column.year} · ${column.term} — drag horizontally to move this term column`;
    });
  }

  function movementBounds(columns, index) {
    const previous = columns[index - 1];
    const next = columns[index + 1];
    return {
      min: previous ? previous.x + W + MIN_TERM_SEPARATION : 0,
      max: next ? next.x - W - MIN_TERM_SEPARATION : Infinity,
    };
  }

  function beginDrag(event) {
    if (!(event.target instanceof Element)) return;
    const header = event.target.closest('.term-header.term-column-draggable');
    if (!(header instanceof HTMLElement) || event.button !== 0) return;
    const app = runtime || window.CurriculumFlowchartRuntime;
    if (!app) return;
    const state = app.getState();
    const columns = columnsFor(state.courses);
    const index = columns.findIndex(column => column.key === header.dataset.termKey);
    if (index < 0) return;
    const column = columns[index];
    const affected = (state.courses || []).filter(course => termKey(course.yearLevel, course.semester) === column.key);
    const starts = new Map();
    for (const course of affected) {
      const position = state.positions?.[course.id];
      if (position) starts.set(course.id, { ...position });
    }
    if (!starts.size) return;

    event.preventDefault();
    event.stopPropagation();
    const bounds = movementBounds(columns, index);
    drag = {
      pointerId: event.pointerId,
      header,
      key: column.key,
      startClientX: event.clientX,
      startColumnX: column.x,
      scale: Math.max(.01, Number(state.viewport?.scale) || 1),
      starts,
      before: app.snapshot(),
      bounds,
      delta: 0,
    };
    header.classList.add('term-column-dragging');
    try { header.setPointerCapture(event.pointerId); } catch { /* optional */ }
  }

  function previewDrag(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const logicalDelta = (event.clientX - drag.startClientX) / drag.scale;
    const proposedX = clamp(drag.startColumnX + logicalDelta, drag.bounds.min, drag.bounds.max);
    drag.delta = proposedX - drag.startColumnX;
    drag.header.style.transform = `translateX(${drag.delta}px)`;
    const nodesLayer = document.querySelector('#nodes-layer');
    if (!(nodesLayer instanceof HTMLElement)) return;
    for (const [id, start] of drag.starts) {
      const node = nodesLayer.querySelector(`.course-node[data-id="${CSS.escape(id)}"]`);
      if (node instanceof HTMLElement) node.style.left = `${start.x + drag.delta}px`;
    }
  }

  function finishDrag(event) {
    if (!drag || (event && drag.pointerId !== event.pointerId)) return;
    const current = drag;
    drag = null;
    current.header.classList.remove('term-column-dragging');
    current.header.style.transform = '';
    if (Math.abs(current.delta) < .5) {
      runtime?.renderFlow?.();
      return;
    }

    const app = runtime || window.CurriculumFlowchartRuntime;
    if (!app) return;
    const config = getConfig();
    config.customX[current.key] = Math.max(0, current.startColumnX + current.delta);
    saveConfig(config);

    const nextPositions = {};
    for (const [id, start] of current.starts) nextPositions[id] = { x: start.x + current.delta, y: start.y };
    const state = app.getState();
    app.applyPositions(nextPositions, {
      layoutMode: state.layoutMode,
      sortStrategy: state.sortStrategy || null,
      recordHistory: false,
      label: 'Move term column',
      message: 'Term column moved horizontally. Course vertical positions were preserved.',
    });
    app.pushHistory(current.before, 'Move term column');
    refreshHeaders();
  }

  function installHeaderDragging() {
    const layer = document.querySelector('#headers-layer');
    if (!(layer instanceof HTMLElement)) return;
    layer.addEventListener('pointerdown', beginDrag, true);
    layer.addEventListener('pointermove', previewDrag, true);
    layer.addEventListener('pointerup', finishDrag, true);
    layer.addEventListener('pointercancel', finishDrag, true);
    headersObserver = new MutationObserver(refreshHeaders);
    headersObserver.observe(layer, { childList: true, subtree: true });
  }

  window.CurriculumTermLayout = {
    columnsFor,
    getConfig: () => clone(getConfig()),
    exportState,
    importState,
    attachRuntime,
    refreshHeaders,
  };

  installControls();
  installHeaderDragging();
  syncInput();
})();
