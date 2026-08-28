
;(() => {
  const DRAG_EDGE_INTERVAL_MS = 34;

  const baseRenderFlowForPerformance = renderFlow;
  const baseRenderTableForPerformance = renderTable;
  const baseSwitchViewForPerformance = switchView;
  const baseRenderEdgesForPerformance = renderEdges;
  const baseRebuildOptimizedRoutesForPerformance = rebuildOptimizedRoutes;
  const baseBuildExportSvgForPerformance = buildExportSvg;
  const baseColumnsForPerformance = columns;
  const baseVisibleCoursesForPerformance = visibleCourses;
  const baseVisibleCourseIdsForPerformance = visibleCourseIds;
  const baseCorequisitePairsForPerformance = corequisitePairs;
  const baseDependencyEdgesForPerformance = dependencyEdges;
  const basePairByKeyForPerformance = pairByKey;

  let flowRenderDirty = false;
  let tableRenderDirty = false;
  let dragRouteDirty = false;
  let dragRenderTimer = 0;
  let dragRenderFrame = 0;
  let lastDragRenderAt = 0;

  let topologyCache = {
    signature: '',
    columns: null,
    visibleCourses: null,
    visibleIds: null,
    pairs: null,
    edges: null,
  };
  const pairIndexByList = new WeakMap();

  function hashText(hash, value) {
    const text = String(value ?? '');
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function topologySignature() {
    let hash = 2166136261;
    hash = hashText(hash, state.trackFilter || 'all');
    for (const hidden of state.hiddenTracks || []) hash = hashText(hash, hidden);
    for (const course of state.courses) {
      hash = hashText(hash, course.id);
      hash = hashText(hash, course.yearLevel);
      hash = hashText(hash, course.semester);
      hash = hashText(hash, course.track || '');
      hash = hashText(hash, course.courseNo);
      for (const value of course.prerequisites || []) hash = hashText(hash, value);
      hash = hashText(hash, '|');
      for (const value of course.corequisites || []) hash = hashText(hash, value);
      hash = hashText(hash, '|');
      for (const value of course.electivePrerequisites || []) hash = hashText(hash, value);
      hash = hashText(hash, ';');
    }
    return `${state.courses.length}:${hash >>> 0}`;
  }

  function currentTopologyCache() {
    const signature = topologySignature();
    if (signature !== topologyCache.signature) {
      topologyCache = {
        signature,
        columns: null,
        visibleCourses: null,
        visibleIds: null,
        pairs: null,
        edges: null,
      };
    }
    return topologyCache;
  }

  columns = () => {
    const cache = currentTopologyCache();
    if (!cache.columns) cache.columns = baseColumnsForPerformance();
    return cache.columns;
  };

  visibleCourses = () => {
    const cache = currentTopologyCache();
    if (!cache.visibleCourses) cache.visibleCourses = baseVisibleCoursesForPerformance();
    return cache.visibleCourses;
  };

  visibleCourseIds = () => {
    const cache = currentTopologyCache();
    if (!cache.visibleIds) cache.visibleIds = baseVisibleCourseIdsForPerformance();
    return cache.visibleIds;
  };

  corequisitePairs = () => {
    const cache = currentTopologyCache();
    if (!cache.pairs) cache.pairs = baseCorequisitePairsForPerformance();
    return cache.pairs;
  };

  dependencyEdges = (pairs = corequisitePairs()) => {
    const cache = currentTopologyCache();
    if (pairs === cache.pairs) {
      if (!cache.edges) cache.edges = baseDependencyEdgesForPerformance(pairs);
      return cache.edges;
    }
    return baseDependencyEdgesForPerformance(pairs);
  };

  pairByKey = (key, pairs = corequisitePairs()) => {
    if (!pairs || typeof pairs !== 'object') return basePairByKeyForPerformance(key, pairs);
    let index = pairIndexByList.get(pairs);
    if (!index) {
      index = new Map(pairs.map(pair => [pair.key, pair]));
      pairIndexByList.set(pairs, index);
    }
    return index.get(key);
  };

  function cancelScheduledDragRender() {
    if (dragRenderTimer) {
      clearTimeout(dragRenderTimer);
      dragRenderTimer = 0;
    }
    if (dragRenderFrame) {
      cancelAnimationFrame(dragRenderFrame);
      dragRenderFrame = 0;
    }
  }

  function renderDragEdgesNow() {
    cancelScheduledDragRender();
    if (dragRouteDirty && state.layoutMode === 'optimized') {
      dragRouteDirty = false;
      baseRebuildOptimizedRoutesForPerformance();
    } else if (state.layoutMode !== 'optimized') {
      dragRouteDirty = false;
      routePlans = null;
    }
    baseRenderEdgesForPerformance();
    lastDragRenderAt = performance.now();
  }

  function scheduleDragEdgeRender() {
    if (dragRenderTimer || dragRenderFrame) return;
    const elapsed = performance.now() - lastDragRenderAt;
    const delay = Math.max(0, DRAG_EDGE_INTERVAL_MS - elapsed);
    dragRenderTimer = window.setTimeout(() => {
      dragRenderTimer = 0;
      dragRenderFrame = requestAnimationFrame(() => {
        dragRenderFrame = 0;
        renderDragEdgesNow();
      });
    }, delay);
  }

  rebuildOptimizedRoutes = () => {
    if (gesture?.kind === 'node' && gesture.moved) {
      dragRouteDirty = true;
      return;
    }
    dragRouteDirty = false;
    return baseRebuildOptimizedRoutesForPerformance();
  };

  renderEdges = () => {
    if (gesture?.kind === 'node' && gesture.moved) {
      scheduleDragEdgeRender();
      return;
    }
    if (dragRouteDirty || dragRenderTimer || dragRenderFrame) renderDragEdgesNow();
    else baseRenderEdgesForPerformance();
  };

  renderFlow = () => {
    if (flowPanel.hidden) {
      flowRenderDirty = true;
      return;
    }
    flowRenderDirty = false;
    baseRenderFlowForPerformance();
  };

  renderTable = () => {
    if (tablePanel.hidden) {
      tableRenderDirty = true;
      return;
    }
    tableRenderDirty = false;
    baseRenderTableForPerformance();
  };

  switchView = view => {
    baseSwitchViewForPerformance(view);
    if (view === 'table' && tableRenderDirty) {
      tableRenderDirty = false;
      baseRenderTableForPerformance();
    }
  };

  buildExportSvg = () => {
    if (flowRenderDirty) {
      flowRenderDirty = false;
      baseRenderFlowForPerformance();
    } else if (dragRouteDirty || dragRenderTimer || dragRenderFrame) {
      renderDragEdgesNow();
    }
    return baseBuildExportSvgForPerformance();
  };

  if (!document.querySelector('#curriculum-performance-style')) {
    const style = document.createElement('style');
    style.id = 'curriculum-performance-style';
    style.textContent = '#flow-canvas{will-change:transform}#connections-svg{pointer-events:none}';
    document.head.append(style);
  }

  if (window.CurriculumFlowchartRuntime) {
    window.CurriculumFlowchartRuntime.renderFlow = () => renderFlow();
  }

  window.CurriculumPerformance = {
    topologySignature,
    flush: () => {
      if (dragRouteDirty || dragRenderTimer || dragRenderFrame) renderDragEdgesNow();
      if (flowRenderDirty && !flowPanel.hidden) renderFlow();
      if (tableRenderDirty && !tablePanel.hidden) renderTable();
    },
  };
})();
