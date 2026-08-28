
;(() => {
  const EPS = 0.5;
  const BASE_NODE_HEIGHT = 78;
  const COMPACT_NODE_HEIGHT = 62;
  const MIN_NODE_GAP = 24;
  const COREQ_NODE_GAP = 34;
  const FINAL_RAF_DEPTH = 20;

  const nodeHeight = () => document.querySelector('#flow-panel')?.classList.contains('hide-node-units')
    ? COMPACT_NODE_HEIGHT
    : BASE_NODE_HEIGHT;

  function pairKey(a, b) {
    return [String(a || ''), String(b || '')].sort().join('|');
  }

  function normalizeNodePositions() {
    if (!state?.positions || typeof visibleCourses !== 'function') return false;
    const courses = visibleCourses();
    if (!courses.length) return false;

    const tableOrder = new Map((state.courses || []).map((course, index) => [course.id, index]));
    const paired = new Set((typeof corequisitePairs === 'function' ? corequisitePairs() : [])
      .map(pair => pairKey(pair.aId, pair.bId)));
    const groups = new Map();

    for (const course of courses) {
      const position = state.positions[course.id];
      if (!position) continue;
      const key = `${course.yearLevel}\u0000${course.semester}`;
      const list = groups.get(key) || [];
      list.push(course);
      groups.set(key, list);
    }

    let changed = false;
    const height = nodeHeight();
    for (const group of groups.values()) {
      group.sort((a, b) => {
        const ay = Number(state.positions[a.id]?.y) || 0;
        const by = Number(state.positions[b.id]?.y) || 0;
        return ay - by || (tableOrder.get(a.id) ?? 0) - (tableOrder.get(b.id) ?? 0);
      });

      for (let index = 1; index < group.length; index += 1) {
        const previous = group[index - 1];
        const current = group[index];
        const previousPosition = state.positions[previous.id];
        const currentPosition = state.positions[current.id];
        if (!previousPosition || !currentPosition) continue;

        const requiredGap = paired.has(pairKey(previous.id, current.id)) ? COREQ_NODE_GAP : MIN_NODE_GAP;
        const minimumY = previousPosition.y + height + requiredGap;
        if (currentPosition.y < minimumY - EPS) {
          currentPosition.y = minimumY;
          changed = true;
        }
      }
    }
    return changed;
  }

  let applying = false;
  function applyFinalLayoutClearance() {
    if (applying) return;
    applying = true;
    try {
      // Node de-overlap is the only geometry mutation owned by this final layer.
      // The previous implementation also rewrote connector paths here, which bypassed
      // the established horizontal/vertical lane-separation invariants and caused
      // regressions where parallel lanes collapsed into one another.
      const nodesChanged = normalizeNodePositions();
      if (nodesChanged) {
        if (typeof save === 'function') save();
        if (typeof renderFlow === 'function') renderFlow();
        return;
      }

      // The semantic routing layer settles first (including balanced fan-out and
      // corequisite front-face targeting). After that, run the existing endpoint/lane
      // invariant once more as the authoritative final pass. It already validates
      // horizontal and vertical lane separation against course-node clearance.
      window.CurriculumConnectorInvariants?.applyNow?.();
      window.CurriculumLineVisualPersistence?.apply?.();
    } finally {
      applying = false;
    }
  }

  let generation = 0;
  function scheduleFinalLayoutClearance() {
    const token = ++generation;
    const later = depth => {
      if (depth <= 0) {
        if (token === generation) applyFinalLayoutClearance();
        return;
      }
      requestAnimationFrame(() => later(depth - 1));
    };
    // connectorSemanticRoutingRuntimeTail settles at RAF 16. Run after it rather than
    // competing with it, so the final lane-separation pass cannot be overwritten later.
    later(FINAL_RAF_DEPTH);
  }

  const baseRenderEdgesForFinalLayoutClearance = renderEdges;
  renderEdges = () => {
    baseRenderEdgesForFinalLayoutClearance();
    scheduleFinalLayoutClearance();
  };

  if (window.CurriculumFlowchartRuntime) {
    window.CurriculumFlowchartRuntime.renderFlow = () => renderFlow();
  }

  document.addEventListener('change', event => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    if (![
      'vertical-lane-spacing',
      'horizontal-lane-spacing',
      'display-units-toggle',
      'connector-corner-style',
      'connector-corner-radius',
    ].includes(target.id)) return;
    scheduleFinalLayoutClearance();
  }, true);

  window.CurriculumFinalLayoutClearance = {
    applyNow: applyFinalLayoutClearance,
    request: scheduleFinalLayoutClearance,
  };

  scheduleFinalLayoutClearance();
})();
