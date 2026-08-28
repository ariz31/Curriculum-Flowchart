
;(() => {
  const STORAGE_KEY = 'curriculum-flowchart:vertical-graph-spacing:v1';
  const CURRICULUM_LIBRARY_KEY = 'curriculum-flowchart:curricula:v1';
  const DEFAULT_GAP = 20;
  const COREQ_GAP = 34;
  const TOP = 132;

  const safeParse = value => { try { return value ? JSON.parse(value) : null; } catch { return null; } };
  const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clone = value => JSON.parse(JSON.stringify(value || {}));
  const norm = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const activeCurriculumId = () => String(safeParse(localStorage.getItem(CURRICULUM_LIBRARY_KEY))?.activeId || 'default');
  const nodeHeight = () => Math.max(1, Number(window.CurriculumNodeDimensions?.height?.()) || 78);

  function allConfigs() {
    const stored = safeParse(localStorage.getItem(STORAGE_KEY));
    return stored && typeof stored === 'object' ? stored : {};
  }

  function getGap() {
    return Math.max(0, finite(allConfigs()[activeCurriculumId()]?.gap, DEFAULT_GAP));
  }

  function persistGap(value) {
    const configs = allConfigs();
    configs[activeCurriculumId()] = { gap: Math.max(0, finite(value, DEFAULT_GAP)) };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
  }

  function visibleCoursesFrom(state) {
    const hidden = new Set((state.hiddenTracks || []).map(norm));
    const filter = norm(state.trackFilter || 'all');
    return (state.courses || []).filter(course => {
      const explicit = String(course.track || '').trim();
      const track = norm(explicit || (/\sS\d+$/i.test(String(course.courseNo || '')) ? 'Structural' : /\sG\d+$/i.test(String(course.courseNo || '')) ? 'Geotechnical' : 'Common'));
      if (hidden.has(track)) return false;
      return filter === 'all' || track === 'common' || track === filter;
    });
  }

  function unionFind(ids) {
    const parent = new Map(ids.map(id => [id, id]));
    const find = id => {
      let root = parent.get(id) || id;
      while ((parent.get(root) || root) !== root) root = parent.get(root);
      let cursor = id;
      while ((parent.get(cursor) || cursor) !== root) {
        const next = parent.get(cursor);
        parent.set(cursor, root);
        cursor = next;
      }
      return root;
    };
    const union = (a, b) => {
      const ar = find(a); const br = find(b);
      if (ar !== br) parent.set(br, ar);
    };
    return { find, union };
  }

  function verticalUnits(state, positions) {
    const courses = visibleCoursesFrom(state);
    const byCode = new Map(courses.map(course => [norm(course.courseNo), course]));
    const uf = unionFind(courses.map(course => course.id));
    for (const course of courses) {
      for (const code of course.corequisites || []) {
        const other = byCode.get(norm(code));
        if (!other || other.id === course.id) continue;
        if (other.yearLevel === course.yearLevel && other.semester === course.semester) uf.union(course.id, other.id);
      }
    }

    const groups = new Map();
    for (const course of courses) {
      const key = `${course.yearLevel}\u0000${course.semester}`;
      if (!groups.has(key)) groups.set(key, new Map());
      const root = uf.find(course.id);
      if (!groups.get(key).has(root)) groups.get(key).set(root, []);
      groups.get(key).get(root).push(course);
    }

    const result = [];
    for (const [, unitMap] of groups) {
      const units = [...unitMap.values()].map(members => {
        members.sort((a, b) => (positions[a.id]?.y ?? TOP) - (positions[b.id]?.y ?? TOP) || String(a.id).localeCompare(String(b.id)));
        return {
          members,
          top: Math.min(...members.map(course => Number(positions[course.id]?.y) || TOP)),
        };
      }).sort((a, b) => a.top - b.top || String(a.members[0]?.id || '').localeCompare(String(b.members[0]?.id || '')));
      result.push(units);
    }
    return result;
  }

  function normalizePositions(state, positions, gap = getGap(), preserveFirstTop = true) {
    const next = clone(positions);
    const height = nodeHeight();
    for (const units of verticalUnits(state, next)) {
      if (!units.length) continue;
      let cursor = preserveFirstTop ? Math.max(0, Number(units[0].top) || TOP) : TOP;
      for (const unit of units) {
        let y = cursor;
        for (const course of unit.members) {
          next[course.id] = { ...(next[course.id] || state.positions?.[course.id] || { x: 0, y }), y };
          y += height + COREQ_GAP;
        }
        const unitHeight = unit.members.length * height + Math.max(0, unit.members.length - 1) * COREQ_GAP;
        cursor += unitHeight + gap;
      }
    }
    return next;
  }

  const runtime = window.CurriculumFlowchartRuntime;
  if (!runtime || runtime.__verticalGraphSpacing) return;

  function isAutomaticLayout(options = {}) {
    const label = String(options.label || '').toLowerCase();
    const strategy = String(options.sortStrategy || '').toLowerCase();
    return Boolean(strategy) || label.includes('sort') || label.includes('untangle') || label.includes('layout');
  }

  const baseApplyPositions = runtime.applyPositions.bind(runtime);
  runtime.applyPositions = (nextPositions, options = {}) => {
    const state = runtime.getState();
    const normalized = isAutomaticLayout(options)
      ? normalizePositions(state, nextPositions, getGap(), false)
      : nextPositions;
    return baseApplyPositions(normalized, options);
  };
  runtime.__verticalGraphSpacing = true;

  let input = null;
  let reset = null;
  let summary = null;
  let scheduled = false;

  function syncControls() {
    const gap = getGap();
    if (input instanceof HTMLInputElement) input.value = String(Number(gap.toFixed(2)));
    if (reset instanceof HTMLButtonElement) reset.disabled = Math.abs(gap - DEFAULT_GAP) < 0.001;
    if (summary instanceof HTMLElement) summary.textContent = `Vertical space between independent course rows: ${Number(gap.toFixed(2))} px. Corequisite-pair spacing remains protected.`;
  }

  function applyGap(value, options = {}) {
    const gap = Math.max(0, finite(value, DEFAULT_GAP));
    persistGap(gap);
    const state = runtime.getState();
    const next = normalizePositions(state, state.positions || {}, gap, true);
    baseApplyPositions(next, {
      layoutMode: state.layoutMode,
      sortStrategy: state.sortStrategy || null,
      label: 'Vertical graph spacing',
      message: `Vertical graph spacing set to ${Number(gap.toFixed(2))} px. Semester columns and course order were preserved.`,
      recordHistory: options.recordHistory !== false,
    });
    syncControls();
    requestAnimationFrame(() => {
      window.CurriculumNodeDimensions?.refresh?.();
      window.CurriculumConnectorInvariants?.request?.();
      window.CurriculumConnectorSemanticInvariants?.request?.();
    });
    return gap;
  }

  function scheduleReapply() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      scheduled = false;
      const state = runtime.getState();
      const normalized = normalizePositions(state, state.positions || {}, getGap(), true);
      baseApplyPositions(normalized, {
        layoutMode: state.layoutMode,
        sortStrategy: state.sortStrategy || null,
        label: 'Vertical graph adjustment',
        recordHistory: false,
      });
      window.CurriculumConnectorInvariants?.request?.();
      window.CurriculumConnectorSemanticInvariants?.request?.();
    }));
  }

  function installControl() {
    if (document.querySelector('#vertical-graph-gap')) return;
    const host = document.querySelector('#minimal-menu-layout .minimal-tool-panel') || document.querySelector('.flow-toolbar .toolbar-scroll');
    if (!(host instanceof HTMLElement)) return;
    const control = document.createElement('div');
    control.className = 'vertical-graph-spacing-control';
    control.innerHTML = `
      <div class="vertical-graph-spacing-header"><strong>Vertical graph</strong><button id="vertical-graph-gap-reset" class="toolbar-button compact" type="button">Reset</button></div>
      <label class="vertical-graph-spacing-field"><span>Row gap</span><span class="vertical-graph-spacing-input"><input id="vertical-graph-gap" type="number" min="0" step="2" inputmode="decimal" aria-label="Vertical gap between course rows in pixels"/><em>px</em></span></label>
      <div id="vertical-graph-spacing-summary" class="vertical-graph-spacing-summary"></div>`;
    host.append(control);
    input = control.querySelector('#vertical-graph-gap');
    reset = control.querySelector('#vertical-graph-gap-reset');
    summary = control.querySelector('#vertical-graph-spacing-summary');
    input?.addEventListener('change', () => applyGap(input.value));
    input?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); input.blur(); } });
    reset?.addEventListener('click', () => applyGap(DEFAULT_GAP));
    syncControls();

    if (!document.querySelector('#vertical-graph-spacing-style')) {
      const style = document.createElement('style');
      style.id = 'vertical-graph-spacing-style';
      style.textContent = `
        .vertical-graph-spacing-control{display:grid;gap:7px;padding-top:8px;margin-top:2px;border-top:1px solid #e7ebf2;width:100%}
        .vertical-graph-spacing-header{display:flex;align-items:center;justify-content:space-between;gap:8px}
        .vertical-graph-spacing-header strong{font-size:.74rem;color:#344054}
        .vertical-graph-spacing-field{display:grid;grid-template-columns:minmax(0,1fr) 92px;align-items:center;gap:7px;color:#475467;font-size:.71rem;font-weight:720}
        .vertical-graph-spacing-input{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;border:1px solid #d8deea;border-radius:7px;background:#fff;overflow:hidden}
        .vertical-graph-spacing-input input{width:100%;min-width:0;min-height:34px;border:0;padding:5px 6px;background:transparent;color:#172033;font:inherit;font-size:.75rem;text-align:right;outline:none}
        .vertical-graph-spacing-input em{padding-right:6px;color:#7a879c;font-size:.65rem;font-style:normal;font-weight:650}
        .vertical-graph-spacing-summary{color:#667085;font-size:.65rem;line-height:1.35}
      `;
      document.head.append(style);
    }
  }

  window.CurriculumVerticalGraphSpacing = {
    get: getGap,
    set: value => applyGap(value),
    reset: () => applyGap(DEFAULT_GAP),
    exportState: () => ({ gap: getGap() }),
    importState: value => applyGap(value?.gap ?? DEFAULT_GAP, { recordHistory: false }),
  };

  document.addEventListener('change', event => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest('#node-size-control, #display-typography-control') ||
        ['display-code-toggle', 'display-description-toggle', 'display-units-toggle', 'display-track-toggle'].includes(target.id)) {
      scheduleReapply();
    }
  }, true);

  document.addEventListener('click', event => {
    if (!(event.target instanceof Element) || !event.target.closest('#auto-layout, #optimize-layout')) return;
    requestAnimationFrame(() => requestAnimationFrame(scheduleReapply));
  }, true);

  installControl();
  syncControls();
})();
