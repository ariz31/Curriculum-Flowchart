
;(() => {
  const STORAGE_KEY = 'curriculum-flowchart:node-dimensions:v1';
  const CURRICULUM_LIBRARY_KEY = 'curriculum-flowchart:curricula:v1';
  const BASE_WIDTH = 184;
  const BASE_HEIGHT = 78;
  const BASE_COLUMN_STEP = 260;
  const COLUMN_GAP = 76;
  const VERTICAL_GAP = 20;
  const MIN_WIDTH = 120;
  const MIN_HEIGHT = 48;
  const PORT_MARGIN = 11;
  const PAIR_MARGIN = 8;
  const COREQ_HALF_GAP = 5;
  const DEFAULT_SPACING = 7;

  const safeParse = value => { try { return value ? JSON.parse(value) : null; } catch { return null; } };
  const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const activeCurriculumId = () => String(safeParse(localStorage.getItem(CURRICULUM_LIBRARY_KEY))?.activeId || 'default');
  const typography = () => window.CurriculumDisplayTypography?.get?.() || { year: 12, term: 11, code: 12, title: 10.5, meta: 9.5 };
  const verticalSpacing = () => clamp(Number(window.CurriculumVerticalLaneSpacing?.get?.()) || DEFAULT_SPACING, 3, 30);
  const horizontalSpacing = () => clamp(Number(window.CurriculumHorizontalLaneSpacing?.get?.()) || DEFAULT_SPACING, 3, 30);

  function displayState() {
    const checked = id => {
      const input = document.querySelector(id);
      return input instanceof HTMLInputElement ? input.checked : true;
    };
    return {
      code: checked('#display-code-toggle'),
      description: checked('#display-description-toggle'),
      units: checked('#display-units-toggle'),
      track: checked('#display-track-toggle'),
    };
  }

  function allConfigs() {
    const stored = safeParse(localStorage.getItem(STORAGE_KEY));
    return stored && typeof stored === 'object' ? stored : {};
  }

  function normalizeConfig(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      auto: source.auto !== false,
      center: source.center !== false,
      width: Math.max(MIN_WIDTH, Math.round(finite(source.width, BASE_WIDTH))),
      height: Math.max(MIN_HEIGHT, Math.round(finite(source.height, BASE_HEIGHT))),
    };
  }

  function getConfig() {
    return normalizeConfig(allConfigs()[activeCurriculumId()]);
  }

  function measureText(text, size, weight = 600) {
    const canvas = measureText.canvas || (measureText.canvas = document.createElement('canvas'));
    const context = canvas.getContext('2d');
    if (!context) return String(text || '').length * size * 0.58;
    context.font = `${weight} ${size}px Arial, sans-serif`;
    return context.measureText(String(text || '')).width;
  }

  function wrapWords(text, maxWidth, fontSize, weight = 400) {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const lines = [];
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (!current || measureText(candidate, fontSize, weight) <= maxWidth) current = candidate;
      else { lines.push(current); current = word; }
    }
    if (current) lines.push(current);
    return lines;
  }

  function metaText(course, view) {
    const parts = [];
    if (view.units) parts.push(`${course.units || '—'} unit${course.units === '1' ? '' : 's'}`);
    if (view.track) {
      const track = typeof courseTrack === 'function' ? courseTrack(course) : String(course.track || 'Common');
      if (String(track).trim().toLowerCase() !== 'common') parts.push(track);
    }
    return parts.join(' · ');
  }

  function requiredDimensions(config = getConfig()) {
    if (!config.auto) return { width: config.width, height: config.height };
    const view = displayState();
    const type = typography();
    const courses = typeof visibleCourses === 'function' ? visibleCourses() : [];

    let requestedWidth = config.width;
    for (const course of courses) {
      if (view.code) requestedWidth = Math.max(requestedWidth, Math.ceil(measureText(course.courseNo || 'Untitled', type.code, 700) + 22));
      if (view.description) {
        const longest = String(course.title || '').split(/\s+/).reduce((best, word) => measureText(word, type.title) > measureText(best, type.title) ? word : best, '');
        requestedWidth = Math.max(requestedWidth, Math.ceil(measureText(longest, type.title) + 22));
      }
      const meta = metaText(course, view);
      if (meta) requestedWidth = Math.max(requestedWidth, Math.ceil(measureText(meta, type.meta, 600) + 22));
    }

    const fontExpansion = Math.max(
      view.code ? type.code / 12 : 1,
      view.description ? type.title / 10.5 : 1,
      (view.units || view.track) ? type.meta / 9.5 : 1,
      1,
    );
    requestedWidth = Math.max(requestedWidth, Math.ceil(BASE_WIDTH * Math.min(2.5, Math.max(1, fontExpansion * 0.9))));

    const innerWidth = Math.max(40, requestedWidth - 20);
    let requestedHeight = config.height;
    for (const course of courses) {
      const blockHeights = [];
      if (view.code) blockHeights.push(type.code * 1.1);
      if (view.description) {
        const lines = Math.max(1, wrapWords(course.title || 'No descriptive title', innerWidth, type.title).length);
        blockHeights.push(lines * type.title * 1.16);
      }
      if (metaText(course, view)) blockHeights.push(type.meta * 1.2);
      const gaps = Math.max(0, blockHeights.length - 1) * 4;
      requestedHeight = Math.max(requestedHeight, Math.ceil(16 + gaps + blockHeights.reduce((sum, value) => sum + value, 0)));
    }
    return { width: requestedWidth, height: requestedHeight };
  }

  let effective = requiredDimensions();
  const nodeWidth = () => effective.width;
  const nodeHeight = () => effective.height;
  const columnStep = () => Math.max(BASE_COLUMN_STEP, nodeWidth() + COLUMN_GAP);

  function columnList(step = columnStep()) {
    const result = [];
    let index = 0;
    years().forEach(year => terms(year).forEach(term => result.push({ year, term, x: 34 + index++ * step })));
    return result;
  }

  columns = () => columnList();

  function reflowColumns(oldWidth, nextWidth) {
    const oldStep = Math.max(BASE_COLUMN_STEP, oldWidth + COLUMN_GAP);
    const nextStep = Math.max(BASE_COLUMN_STEP, nextWidth + COLUMN_GAP);
    if (Math.abs(oldStep - nextStep) < 0.01 || !state?.positions) return;
    const previous = columnList(oldStep);
    const next = columnList(nextStep);
    for (const course of state.courses || []) {
      const position = state.positions[course.id];
      if (!position) continue;
      const index = previous.findIndex(item => item.year === course.yearLevel && item.term === course.semester);
      if (index < 0 || !next[index]) continue;
      const offset = position.x - previous[index].x;
      position.x = Math.max(0, next[index].x + offset);
    }
  }

  function preventVerticalOverlap() {
    if (!state?.positions) return;
    const groups = new Map();
    for (const course of visibleCourses()) {
      const key = `${course.yearLevel}\u0000${course.semester}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(course);
    }
    for (const courses of groups.values()) {
      courses.sort((a, b) => (state.positions[a.id]?.y ?? 0) - (state.positions[b.id]?.y ?? 0));
      let floor = -Infinity;
      for (const course of courses) {
        const position = state.positions[course.id];
        if (!position) continue;
        if (position.y < floor) position.y = floor;
        floor = position.y + nodeHeight() + VERTICAL_GAP;
      }
    }
  }

  function applyHeaderDimensions() {
    document.querySelectorAll('.term-header').forEach(element => {
      if (element instanceof HTMLElement) element.style.width = `${nodeWidth()}px`;
    });
    const yearElements = [...document.querySelectorAll('.year-header')];
    years().forEach((year, index) => {
      const yearCols = columns().filter(column => column.year === year);
      const element = yearElements[index];
      if (!(element instanceof HTMLElement) || !yearCols.length) return;
      element.style.left = `${yearCols[0].x}px`;
      element.style.width = `${yearCols.at(-1).x - yearCols[0].x + nodeWidth()}px`;
    });
  }

  function applyCanvasBounds() {
    const positions = visibleCourses().map(course => state.positions[course.id]).filter(Boolean);
    const maxNodeX = Math.max(0, ...positions.map(position => position.x + nodeWidth() + 100));
    const maxNodeY = Math.max(0, ...positions.map(position => position.y + nodeHeight() + 120));
    logicalWidth = Math.max(920, maxNodeX, columns().length ? columns().at(-1).x + nodeWidth() + 70 : 0);
    logicalHeight = Math.max(620, maxNodeY, logicalHeight || 0);
    canvas.style.width = `${logicalWidth}px`;
    canvas.style.height = `${logicalHeight}px`;
    svg.setAttribute('viewBox', `0 0 ${logicalWidth} ${logicalHeight}`);
    svg.setAttribute('width', String(logicalWidth));
    svg.setAttribute('height', String(logicalHeight));
  }

  function applyLiveDimensions() {
    const panel = document.querySelector('#flow-panel');
    if (!(panel instanceof HTMLElement)) return;
    const config = getConfig();
    panel.style.setProperty('--curriculum-node-width', `${nodeWidth()}px`);
    panel.style.setProperty('--curriculum-node-height', `${nodeHeight()}px`);
    panel.classList.toggle('center-node-content', config.center);
    panel.dataset.nodeWidth = String(nodeWidth());
    panel.dataset.nodeHeight = String(nodeHeight());
    applyHeaderDimensions();
    applyCanvasBounds();
  }

  function refreshEffective(options = {}) {
    const previous = { ...effective };
    effective = requiredDimensions();
    if (options.reflow !== false) {
      reflowColumns(previous.width, effective.width);
      if (effective.height > previous.height + 0.5 || options.forceOverlapCheck) preventVerticalOverlap();
    }
    applyLiveDimensions();
    return previous.width !== effective.width || previous.height !== effective.height;
  }

  function saveConfig(next, options = {}) {
    const configs = allConfigs();
    const normalized = normalizeConfig(next);
    configs[activeCurriculumId()] = normalized;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
    refreshEffective({ forceOverlapCheck: true });
    if (typeof save === 'function') save();
    if (options.sync !== false) syncControls();
    rerenderGeometry();
    return { ...normalized, effective: { ...effective } };
  }

  function installStyles() {
    if (document.querySelector('#node-size-display-style')) return;
    const style = document.createElement('style');
    style.id = 'node-size-display-style';
    style.textContent = `
      #flow-panel .course-node{width:var(--curriculum-node-width,184px)!important;height:var(--curriculum-node-height,78px)!important;display:flex;flex-direction:column;justify-content:center;overflow:hidden}
      #flow-panel.hide-node-units .course-node{height:var(--curriculum-node-height,78px)!important}
      #flow-panel .node-title{display:block!important;-webkit-line-clamp:unset!important;min-height:0!important;overflow:visible!important;white-space:normal}
      #flow-panel.center-node-content .course-node{align-items:center;text-align:center}
      #flow-panel.center-node-content .node-code,#flow-panel.center-node-content .node-title,#flow-panel.center-node-content .node-meta{width:100%;text-align:center}
      .node-size-control{display:grid;gap:7px;padding-top:9px;margin-top:3px;border-top:1px solid #e7ebf2;width:100%}
      .node-size-header{display:flex;align-items:center;justify-content:space-between;gap:8px}
      .node-size-header strong{font-size:.74rem;color:#344054}
      .node-size-switches{display:grid;grid-template-columns:1fr 1fr;gap:7px}
      .node-size-toggle{display:flex;align-items:center;gap:6px;color:#475467;font-size:.7rem;font-weight:720}
      .node-size-toggle input{width:17px;height:17px}
      .node-size-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}
      .node-size-field{display:grid;gap:4px;color:#475467;font-size:.69rem;font-weight:720}
      .node-size-input{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;border:1px solid #d8deea;border-radius:7px;background:#fff;overflow:hidden}
      .node-size-input input{width:100%;min-width:0;min-height:34px;border:0;padding:5px 6px;background:transparent;color:#172033;font:inherit;font-size:.75rem;text-align:right;outline:none}
      .node-size-input em{padding-right:6px;color:#7a879c;font-size:.65rem;font-style:normal;font-weight:650}
      .node-size-summary{color:#667085;font-size:.66rem;line-height:1.35}
      @media(max-width:760px){.node-size-grid,.node-size-switches{grid-template-columns:1fr}}
    `;
    document.head.append(style);
  }

  let autoInput = null;
  let centerInput = null;
  let widthInput = null;
  let heightInput = null;
  let summary = null;
  let resetButton = null;

  function syncControls() {
    effective = requiredDimensions();
    const config = getConfig();
    if (autoInput instanceof HTMLInputElement) autoInput.checked = config.auto;
    if (centerInput instanceof HTMLInputElement) centerInput.checked = config.center;
    if (widthInput instanceof HTMLInputElement) widthInput.value = String(config.width);
    if (heightInput instanceof HTMLInputElement) heightInput.value = String(config.height);
    if (summary instanceof HTMLElement) summary.textContent = config.auto
      ? `Effective: ${nodeWidth()} × ${nodeHeight()} px. Width and height are minimums; visible text and typography can expand nodes automatically.`
      : `Exact: ${nodeWidth()} × ${nodeHeight()} px. Auto fit is off.`;
    if (resetButton instanceof HTMLButtonElement) resetButton.disabled = config.auto && config.center && config.width === BASE_WIDTH && config.height === BASE_HEIGHT;
    applyLiveDimensions();
  }

  function installControls() {
    if (document.querySelector('#node-size-control')) return;
    const host = document.querySelector('#minimal-menu-display .minimal-tool-panel') || document.querySelector('.display-options');
    if (!(host instanceof HTMLElement)) return;
    const control = document.createElement('div');
    control.id = 'node-size-control';
    control.className = 'node-size-control';
    control.innerHTML = `
      <div class="node-size-header"><strong>Node size</strong><button id="node-size-reset" class="toolbar-button compact" type="button">Reset size</button></div>
      <div class="node-size-switches">
        <label class="node-size-toggle"><input id="node-size-auto" type="checkbox"/> Auto fit visible text</label>
        <label class="node-size-toggle"><input id="node-size-center" type="checkbox"/> Center node content</label>
      </div>
      <div class="node-size-grid">
        <label class="node-size-field"><span>Horizontal size</span><span class="node-size-input"><input id="node-size-width" type="number" min="${MIN_WIDTH}" step="1" inputmode="numeric" aria-label="Node width in pixels"/><em>px</em></span></label>
        <label class="node-size-field"><span>Vertical size</span><span class="node-size-input"><input id="node-size-height" type="number" min="${MIN_HEIGHT}" step="1" inputmode="numeric" aria-label="Node height in pixels"/><em>px</em></span></label>
      </div>
      <div id="node-size-summary" class="node-size-summary"></div>`;
    host.append(control);
    autoInput = control.querySelector('#node-size-auto');
    centerInput = control.querySelector('#node-size-center');
    widthInput = control.querySelector('#node-size-width');
    heightInput = control.querySelector('#node-size-height');
    summary = control.querySelector('#node-size-summary');
    resetButton = control.querySelector('#node-size-reset');

    autoInput?.addEventListener('change', () => saveConfig({ ...getConfig(), auto: autoInput.checked }));
    centerInput?.addEventListener('change', () => saveConfig({ ...getConfig(), center: centerInput.checked }));
    widthInput?.addEventListener('change', () => saveConfig({ ...getConfig(), width: widthInput.value }));
    heightInput?.addEventListener('change', () => saveConfig({ ...getConfig(), height: heightInput.value }));
    [widthInput, heightInput].forEach(input => input?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); input.blur(); } }));
    resetButton?.addEventListener('click', () => saveConfig({ auto: true, center: true, width: BASE_WIDTH, height: BASE_HEIGHT }));
    syncControls();
  }

  function edgeDirection(edge, pairs, cols) {
    const sourceColumn = edgeSourceColumn(edge, pairs, cols);
    const targetColumn = edgeTargetColumn(edge, cols);
    if (sourceColumn < 0 || targetColumn < 0) return 0;
    return targetColumn >= sourceColumn ? 1 : -1;
  }

  function sourceCenterY(edge, pairs) {
    if (edge.sourceKind === 'course') {
      const position = state.positions[edge.fromId];
      return position ? position.y + nodeHeight() / 2 : 0;
    }
    const pair = pairByKey(edge.pairKey, pairs);
    return pair ? pairGeometry(pair)?.junctionY ?? 0 : 0;
  }

  function targetCenterY(edge, pairs) {
    if (edge.targetKind === 'pair' && edge.targetPairKey) {
      const pair = pairByKey(edge.targetPairKey, pairs);
      return pair ? pairGeometry(pair)?.junctionY ?? 0 : 0;
    }
    const position = state.positions[edge.toId];
    return position ? position.y + nodeHeight() / 2 : 0;
  }

  function sourceSide(nodeId, edge, pairs, cols) {
    const direction = edgeDirection(edge, pairs, cols);
    if (!direction) return null;
    if (edge.sourceKind === 'course' && edge.fromId === nodeId) return direction > 0 ? 'right' : 'left';
    if (edge.toId === nodeId && !(edge.targetKind === 'pair' && edge.targetPairKey)) return direction > 0 ? 'left' : 'right';
    return null;
  }

  courseIncidentOffset = (nodeId, edge, edges) => {
    const pairs = corequisitePairs();
    const cols = columns();
    const side = sourceSide(nodeId, edge, pairs, cols);
    if (!side) return 0;
    const incident = edges.filter(item => {
      const attached = (item.sourceKind === 'course' && item.fromId === nodeId) || (item.toId === nodeId && !(item.targetKind === 'pair' && item.targetPairKey));
      return attached && sourceSide(nodeId, item, pairs, cols) === side;
    }).sort((a, b) => {
      const aY = a.sourceKind === 'course' && a.fromId === nodeId ? targetCenterY(a, pairs) : sourceCenterY(a, pairs);
      const bY = b.sourceKind === 'course' && b.fromId === nodeId ? targetCenterY(b, pairs) : sourceCenterY(b, pairs);
      return Math.abs(aY - bY) > 0.01 ? aY - bY : a.key.localeCompare(b.key);
    });
    if (incident.length <= 1) return 0;
    const index = Math.max(0, incident.findIndex(item => item.key === edge.key));
    const usable = Math.max(0, nodeHeight() - PORT_MARGIN * 2);
    const step = Math.min(horizontalSpacing(), usable / Math.max(1, incident.length - 1));
    return (index - (incident.length - 1) / 2) * step;
  };

  pairGeometry = pair => {
    const a = state.positions[pair.aId];
    const b = state.positions[pair.bId];
    if (!a || !b) return null;
    const aAbove = a.y <= b.y;
    const upperId = aAbove ? pair.aId : pair.bId;
    const lowerId = aAbove ? pair.bId : pair.aId;
    const upper = state.positions[upperId];
    const lower = state.positions[lowerId];
    const upperBottom = upper.y + nodeHeight();
    const lowerTop = lower.y;
    return { pair, upperId, lowerId, x: upper.x + nodeWidth() / 2, upperBottom, lowerTop, junctionY: (upperBottom + lowerTop) / 2 };
  };

  pairBranchAnchor = (pair, edge, edges) => {
    const geometry = pairGeometry(pair);
    if (!geometry) return null;
    const pairs = corequisitePairs();
    const cols = columns();
    const direction = edgeDirection(edge, pairs, cols) || 1;
    const branches = edges.filter(item => item.sourceKind === 'pair' && item.pairKey === pair.key && (edgeDirection(item, pairs, cols) || 1) === direction)
      .sort((a, b) => targetCenterY(a, pairs) - targetCenterY(b, pairs) || a.key.localeCompare(b.key));
    const index = Math.max(0, branches.findIndex(item => item.key === edge.key));
    const low = Math.min(geometry.upperBottom + PAIR_MARGIN, geometry.lowerTop - PAIR_MARGIN);
    const high = Math.max(geometry.upperBottom + PAIR_MARGIN, geometry.lowerTop - PAIR_MARGIN);
    const usable = Math.max(0, high - low);
    const step = branches.length > 1 ? Math.min(horizontalSpacing(), usable / Math.max(1, branches.length - 1)) : 0;
    const span = step * Math.max(0, branches.length - 1);
    const start = clamp(geometry.junctionY - span / 2, low, Math.max(low, high - span));
    return { x: geometry.x + direction * COREQ_HALF_GAP, y: branches.length > 1 ? start + index * step : geometry.junctionY };
  };

  sourceAnchor = (edge, edges, pairs, cols) => {
    if (edge.sourceKind !== 'course') {
      const pair = pairByKey(edge.pairKey, pairs);
      return pair ? pairBranchAnchor(pair, edge, edges) : null;
    }
    const position = state.positions[edge.fromId];
    if (!position) return null;
    const direction = edgeDirection(edge, pairs, cols) || 1;
    return { x: direction > 0 ? position.x + nodeWidth() : position.x, y: position.y + nodeHeight() / 2 + courseIncidentOffset(edge.fromId, edge, edges) };
  };

  targetAnchor = (edge, edges, pairs, cols) => {
    const direction = edgeDirection(edge, pairs, cols) || 1;
    if (edge.targetKind === 'pair' && edge.targetPairKey) {
      const pair = pairByKey(edge.targetPairKey, pairs);
      const geometry = pair ? pairGeometry(pair) : null;
      if (!pair || !geometry) return null;
      const incoming = edges.filter(item => item.targetKind === 'pair' && item.targetPairKey === pair.key && (edgeDirection(item, pairs, cols) || 1) === direction)
        .sort((a, b) => sourceCenterY(a, pairs) - sourceCenterY(b, pairs) || a.key.localeCompare(b.key));
      const index = Math.max(0, incoming.findIndex(item => item.key === edge.key));
      const low = Math.min(geometry.upperBottom + PAIR_MARGIN, geometry.lowerTop - PAIR_MARGIN);
      const high = Math.max(geometry.upperBottom + PAIR_MARGIN, geometry.lowerTop - PAIR_MARGIN);
      const usable = Math.max(0, high - low);
      const step = incoming.length > 1 ? Math.min(horizontalSpacing(), usable / Math.max(1, incoming.length - 1)) : 0;
      const span = step * Math.max(0, incoming.length - 1);
      const start = clamp(geometry.junctionY - span / 2, low, Math.max(low, high - span));
      return { x: geometry.x + (direction > 0 ? -COREQ_HALF_GAP : COREQ_HALF_GAP), y: incoming.length > 1 ? start + index * step : geometry.junctionY };
    }
    const position = state.positions[edge.toId];
    if (!position) return null;
    return { x: direction > 0 ? position.x : position.x + nodeWidth(), y: position.y + nodeHeight() / 2 + courseIncidentOffset(edge.toId, edge, edges) };
  };

  if (window.CurriculumConnectorInvariants) window.CurriculumConnectorInvariants.nodeHeight = nodeHeight;

  function rerenderGeometry() {
    requestAnimationFrame(() => {
      if (typeof renderFlow === 'function') renderFlow();
      requestAnimationFrame(() => {
        applyLiveDimensions();
        window.CurriculumConnectorInvariants?.request?.();
        window.CurriculumConnectorSemanticInvariants?.request?.();
      });
    });
  }

  const baseUpdateCanvasSizeForNodeDimensions = updateCanvasSize;
  updateCanvasSize = () => {
    baseUpdateCanvasSizeForNodeDimensions();
    applyCanvasBounds();
  };

  const baseRenderFlowForNodeDimensions = renderFlow;
  renderFlow = () => {
    baseRenderFlowForNodeDimensions();
    applyLiveDimensions();
  };

  function addSvgText(documentXml, group, text, x, baseline, size, weight, anchor) {
    const element = documentXml.createElementNS('http://www.w3.org/2000/svg', 'text');
    element.setAttribute('x', String(Number(x.toFixed(3))));
    element.setAttribute('y', String(Number(baseline.toFixed(3))));
    element.setAttribute('font-family', 'Arial,sans-serif');
    element.setAttribute('font-size', String(Number(size.toFixed(3))));
    element.setAttribute('font-weight', String(weight));
    element.setAttribute('text-anchor', anchor);
    element.setAttribute('fill', '#172033');
    element.textContent = text;
    group.append(element);
  }

  function applyExportDisplay(svgText) {
    try {
      const documentXml = new DOMParser().parseFromString(svgText, 'image/svg+xml');
      const root = documentXml.documentElement;
      const view = displayState();
      const type = typography();
      const config = getConfig();
      const cols = columns();

      const yearRects = [...root.children].filter(child => child.tagName?.toLowerCase() === 'rect' && Math.abs(Number(child.getAttribute('y')) - 18) < 0.01);
      const yearTexts = [...root.children].filter(child => child.tagName?.toLowerCase() === 'text' && Math.abs(Number(child.getAttribute('y')) - 38) < 0.01);
      years().forEach((year, index) => {
        const yearCols = cols.filter(column => column.year === year);
        const rect = yearRects[index];
        const text = yearTexts[index];
        if (!yearCols.length || !(rect instanceof SVGElement)) return;
        const x = yearCols[0].x;
        const span = yearCols.at(-1).x - x + nodeWidth();
        rect.setAttribute('x', String(x));
        rect.setAttribute('width', String(span));
        if (text instanceof SVGElement) text.setAttribute('x', String(x + span / 2));
      });

      const termRects = [...root.children].filter(child => child.tagName?.toLowerCase() === 'rect' && Math.abs(Number(child.getAttribute('y')) - 62) < 0.01);
      const termTexts = [...root.children].filter(child => child.tagName?.toLowerCase() === 'text' && Math.abs(Number(child.getAttribute('y')) - 82) < 0.01);
      termRects.forEach((rect, index) => {
        const column = cols[index];
        if (!column) return;
        rect.setAttribute('x', String(column.x));
        rect.setAttribute('width', String(nodeWidth()));
        const text = termTexts[index];
        if (text instanceof SVGElement) text.setAttribute('x', String(column.x + nodeWidth() / 2));
      });

      const courseGroups = [...root.querySelectorAll('g')].filter(group => {
        const rect = [...group.children].find(child => child.tagName?.toLowerCase() === 'rect');
        if (!(rect instanceof SVGElement)) return false;
        const currentWidth = Number(rect.getAttribute('width'));
        return Math.abs(currentWidth - BASE_WIDTH) < 0.01 || Math.abs(currentWidth - nodeWidth()) < 0.01;
      });
      const courses = visibleCourses();
      courseGroups.slice(0, courses.length).forEach((group, index) => {
        const course = courses[index];
        const position = state.positions[course.id];
        if (!position) return;
        const rect = [...group.children].find(child => child.tagName?.toLowerCase() === 'rect');
        if (!(rect instanceof SVGElement)) return;
        rect.setAttribute('x', String(position.x));
        rect.setAttribute('y', String(position.y));
        rect.setAttribute('width', String(nodeWidth()));
        rect.setAttribute('height', String(nodeHeight()));
        [...group.children].filter(child => child.tagName?.toLowerCase() === 'text').forEach(child => child.remove());

        const innerWidth = Math.max(40, nodeWidth() - 20);
        const entries = [];
        if (view.code) entries.push({ kind: 'code', lines: [course.courseNo || 'Untitled'], size: type.code, weight: 700, lineHeight: type.code * 1.1 });
        if (view.description) {
          const lines = wrapWords(course.title || 'No descriptive title', innerWidth, type.title, 400);
          entries.push({ kind: 'title', lines: lines.length ? lines : ['No descriptive title'], size: type.title, weight: 400, lineHeight: type.title * 1.16 });
        }
        const meta = metaText(course, view);
        if (meta) entries.push({ kind: 'meta', lines: [meta], size: type.meta, weight: 600, lineHeight: type.meta * 1.2 });

        const totalHeight = entries.reduce((sum, entry) => sum + entry.lines.length * entry.lineHeight, 0) + Math.max(0, entries.length - 1) * 4;
        let cursorY = position.y + (nodeHeight() - totalHeight) / 2;
        const anchor = config.center ? 'middle' : 'start';
        const textX = config.center ? position.x + nodeWidth() / 2 : position.x + 9;
        entries.forEach((entry, entryIndex) => {
          entry.lines.forEach(line => {
            cursorY += entry.lineHeight;
            addSvgText(documentXml, group, line, textX, cursorY - entry.lineHeight * 0.18, entry.size, entry.weight, anchor);
          });
          if (entryIndex < entries.length - 1) cursorY += 4;
        });
      });

      root.setAttribute('width', String(logicalWidth));
      root.setAttribute('height', String(logicalHeight));
      root.setAttribute('viewBox', `0 0 ${logicalWidth} ${logicalHeight}`);
      return new XMLSerializer().serializeToString(root);
    } catch {
      return svgText;
    }
  }

  const baseBuildExportSvgForNodeDimensions = buildExportSvg;
  buildExportSvg = () => {
    refreshEffective({ reflow: false });
    applyCanvasBounds();
    return applyExportDisplay(baseBuildExportSvgForNodeDimensions());
  };

  window.CurriculumNodeDimensions = {
    width: nodeWidth,
    height: nodeHeight,
    get: () => ({ ...getConfig(), effective: { ...effective } }),
    set: value => saveConfig({ ...getConfig(), ...(value || {}) }),
    reset: () => saveConfig({ auto: true, center: true, width: BASE_WIDTH, height: BASE_HEIGHT }),
    refresh: () => { refreshEffective({ forceOverlapCheck: true }); rerenderGeometry(); return { ...effective }; },
    exportState: () => ({ ...getConfig() }),
    importState: value => saveConfig(value || {}),
  };

  installStyles();
  installControls();
  refreshEffective({ forceOverlapCheck: true });
  rerenderGeometry();

  ['display-code-toggle', 'display-description-toggle', 'display-units-toggle', 'display-track-toggle'].forEach(id => {
    document.querySelector(`#${id}`)?.addEventListener('change', () => {
      refreshEffective({ forceOverlapCheck: true });
      rerenderGeometry();
    });
  });

  document.querySelector('#display-typography-control')?.addEventListener('change', () => {
    refreshEffective({ forceOverlapCheck: true });
    rerenderGeometry();
  });

  const curriculumObserver = new MutationObserver(mutations => {
    if (mutations.some(mutation => mutation.type === 'attributes' && mutation.attributeName === 'data-curriculum-title')) {
      effective = requiredDimensions();
      syncControls();
      rerenderGeometry();
    }
  });
  curriculumObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-curriculum-title'] });
})();
