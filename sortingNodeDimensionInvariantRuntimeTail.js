
;(() => {
  const BASE_NODE_HEIGHT = 78;
  const DEFAULT_GAP = 14;
  const BASE_COLUMN_STEP = 260;
  const COLUMN_GAP = 76;
  const START_X = 34;
  const YEARS = ['First Year', 'Second Year', 'Third Year', 'Fourth Year'];
  const TERMS = ['First Semester', 'Second Semester', 'Short Term'];

  const runtime = window.CurriculumFlowchartRuntime;
  if (!runtime || runtime.__sortingNodeDimensionInvariant) return;

  const clone = value => JSON.parse(JSON.stringify(value || {}));
  const unique = values => [...new Set(values.filter(Boolean))];
  const ordered = (values, defaults) => [
    ...defaults.filter(value => values.includes(value)),
    ...unique(values).filter(value => !defaults.includes(value)).sort(),
  ];

  function nodeWidth() {
    return Math.max(1, Number(window.CurriculumNodeDimensions?.width?.()) || 184);
  }

  function nodeHeight() {
    return Math.max(1, Number(window.CurriculumNodeDimensions?.height?.()) || BASE_NODE_HEIGHT);
  }

  function fallbackColumns(stateSnapshot) {
    const courses = stateSnapshot?.courses || [];
    const years = ordered(unique(courses.map(course => course.yearLevel)), YEARS);
    const step = Math.max(BASE_COLUMN_STEP, nodeWidth() + COLUMN_GAP);
    const result = [];
    let index = 0;
    for (const year of years) {
      const termsForYear = ordered(
        unique(courses.filter(course => course.yearLevel === year).map(course => course.semester)),
        TERMS,
      );
      for (const term of termsForYear) result.push({ year, term, x: START_X + index++ * step });
    }
    return result;
  }

  function currentColumns(stateSnapshot) {
    try {
      const live = typeof columns === 'function' ? columns() : null;
      if (Array.isArray(live) && live.length) return live;
    } catch { /* use deterministic fallback */ }
    return fallbackColumns(stateSnapshot);
  }

  function isSortOperation(options = {}) {
    const label = String(options.label || '').toLowerCase();
    const strategy = String(options.sortStrategy || '').toLowerCase();
    return Boolean(strategy) || label.includes('sort') || label.includes('untangle');
  }

  function normalizeSortPositions(nextPositions, options = {}) {
    const snapshot = runtime.getState();
    const next = clone(nextPositions);
    const coursesById = new Map((snapshot.courses || []).map(course => [course.id, course]));
    const cols = currentColumns(snapshot);

    // A sorting strategy controls vertical ordering, but semester membership controls X.
    // Always resolve X against the same live columns used by the rendered semester headers.
    for (const [id, position] of Object.entries(next)) {
      const course = coursesById.get(id);
      if (!course || !position) continue;
      const column = cols.find(item => item.year === course.yearLevel && item.term === course.semester);
      if (column) position.x = column.x;
    }

    // Older sort engines use the original 78 px node height. Preserve the spacing they
    // selected between consecutive nodes while replacing that base height with the live
    // effective height. This keeps the actual sort order intact without overlaps.
    const effectiveHeight = nodeHeight();
    if (Math.abs(effectiveHeight - BASE_NODE_HEIGHT) > 0.01) {
      const groups = new Map();
      for (const [id, position] of Object.entries(next)) {
        const course = coursesById.get(id);
        if (!course || !position || !Number.isFinite(Number(position.y))) continue;
        const key = `${course.yearLevel}\u0000${course.semester}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ id, position, originalY: Number(position.y) });
      }

      for (const items of groups.values()) {
        items.sort((a, b) => a.originalY - b.originalY || String(a.id).localeCompare(String(b.id)));
        for (let index = 1; index < items.length; index += 1) {
          const previous = items[index - 1];
          const current = items[index];
          const originalDelta = Math.max(0, current.originalY - previous.originalY);
          const originalGap = Math.max(DEFAULT_GAP, originalDelta - BASE_NODE_HEIGHT);
          const requiredY = Number(previous.position.y) + effectiveHeight + originalGap;
          if (Number(current.position.y) < requiredY) current.position.y = requiredY;
        }
      }
    }

    return next;
  }

  const baseApplyPositions = runtime.applyPositions.bind(runtime);
  runtime.applyPositions = (nextPositions, options = {}) => {
    const normalized = isSortOperation(options) ? normalizeSortPositions(nextPositions, options) : nextPositions;
    const result = baseApplyPositions(normalized, options);
    if (isSortOperation(options)) {
      requestAnimationFrame(() => {
        window.CurriculumNodeDimensions?.refresh?.();
        window.CurriculumConnectorInvariants?.request?.();
        window.CurriculumConnectorSemanticInvariants?.request?.();
      });
    }
    return result;
  };

  runtime.__sortingNodeDimensionInvariant = true;

  // Balanced sort is implemented by the native layout path rather than runtime.applyPositions.
  // Normalize it after the native handler has finished so resized nodes still honor semester X.
  document.addEventListener('click', event => {
    if (!(event.target instanceof Element) || !event.target.closest('#optimize-layout')) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      try {
        const cols = currentColumns(runtime.getState());
        let changed = false;
        if (typeof visibleCourses === 'function' && state?.positions) {
          for (const course of visibleCourses()) {
            const position = state.positions[course.id];
            const column = cols.find(item => item.year === course.yearLevel && item.term === course.semester);
            if (!position || !column || Math.abs(position.x - column.x) < 0.01) continue;
            position.x = column.x;
            changed = true;
          }
        }
        window.CurriculumNodeDimensions?.refresh?.();
        if (changed) {
          if (typeof save === 'function') save();
          if (typeof renderFlow === 'function') renderFlow();
        }
        window.CurriculumConnectorInvariants?.request?.();
        window.CurriculumConnectorSemanticInvariants?.request?.();
      } catch (error) {
        console.error('Sort geometry normalization failed safely:', error);
      }
    }));
  }, true);
})();
