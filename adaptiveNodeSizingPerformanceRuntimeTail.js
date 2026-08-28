
;(() => {
  if (window.__CURRICULUM_ADAPTIVE_NODE_RUNTIME__) return;
  window.__CURRICULUM_ADAPTIVE_NODE_RUNTIME__ = true;

  const BASE_NODE_HEIGHT = 78;
  const COMPACT_NODE_HEIGHT = 62;
  const MIN_NODE_HEIGHT = 44;
  const MIN_NODE_GAP = 24;
  const COREQ_NODE_GAP = 34;
  const DRAG_CONNECTOR_INTERVAL_MS = 50;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const EPS = 0.75;

  const flowPanelElement = document.querySelector('#flow-panel');
  if (!(flowPanelElement instanceof HTMLElement)) return;

  let adaptiveNodeHeight = BASE_NODE_HEIGHT;
  let measureFrame = 0;
  let semanticFrame = 0;
  let dragConnectorTimer = 0;
  let lastDragConnectorRefreshAt = 0;
  let applyingClearance = false;

  const legacyNodeHeight = () => flowPanelElement.classList.contains('hide-node-units')
    ? COMPACT_NODE_HEIGHT
    : BASE_NODE_HEIGHT;

  function installStyles() {
    if (document.querySelector('#adaptive-node-sizing-performance-style')) return;
    const style = document.createElement('style');
    style.id = 'adaptive-node-sizing-performance-style';
    style.textContent = `
      #flow-panel .nodes-layer .course-node{
        height:var(--curriculum-adaptive-node-height,78px)!important;
        contain:layout paint style;
      }
      #flow-panel .nodes-layer .course-node.dragging{
        transition:none!important;
        will-change:left,top;
      }
    `;
    document.head.append(style);
  }

  function restoreInlineProperty(element, name, value, priority) {
    if (value) element.style.setProperty(name, value, priority);
    else element.style.removeProperty(name);
  }

  function measureRequiredNodeHeight() {
    if (flowPanelElement.hidden) return adaptiveNodeHeight;
    const courseNodes = [...nodes.querySelectorAll('.course-node')];
    if (!courseNodes.length) return adaptiveNodeHeight;

    let required = MIN_NODE_HEIGHT;
    for (const node of courseNodes) {
      if (!(node instanceof HTMLElement)) continue;
      const previousHeight = node.style.getPropertyValue('height');
      const previousPriority = node.style.getPropertyPriority('height');
      node.style.setProperty('height', 'auto', 'important');
      required = Math.max(required, node.offsetHeight);
      restoreInlineProperty(node, 'height', previousHeight, previousPriority);
    }
    return Math.max(MIN_NODE_HEIGHT, Math.ceil(required));
  }

  function pairKey(a, b) {
    return [String(a || ''), String(b || '')].sort().join('|');
  }

  function normalizeAdaptiveClearance() {
    if (applyingClearance || flowPanelElement.hidden) return false;
    applyingClearance = true;
    try {
      const courses = visibleCourses();
      if (!courses.length) return false;
      const tableOrder = new Map((state.courses || []).map((course, index) => [course.id, index]));
      const paired = new Set(corequisitePairs().map(pair => pairKey(pair.aId, pair.bId)));
      const groups = new Map();

      for (const course of courses) {
        if (!state.positions[course.id]) continue;
        const key = `${course.yearLevel}\u0000${course.semester}`;
        const group = groups.get(key) || [];
        group.push(course);
        groups.set(key, group);
      }

      let changed = false;
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
          const gap = paired.has(pairKey(previous.id, current.id)) ? COREQ_NODE_GAP : MIN_NODE_GAP;
          const minimumY = previousPosition.y + adaptiveNodeHeight + gap;
          if (currentPosition.y < minimumY - EPS) {
            currentPosition.y = minimumY;
            const element = nodes.querySelector(`[data-id="${CSS.escape(current.id)}"]`);
            if (element instanceof HTMLElement) element.style.top = `${minimumY}px`;
            changed = true;
          }
        }
      }

      if (changed) {
        afterManualPositionChange();
        save();
      }
      return changed;
    } finally {
      applyingClearance = false;
    }
  }

  updateCanvasSize = () => {
    const cols = columns();
    const positions = visibleCourses()
      .map(course => state.positions[course.id])
      .filter(Boolean);
    const maxNodeX = Math.max(0, ...positions.map(position => position.x + W + 100));
    const maxNodeY = Math.max(0, ...positions.map(position => position.y + adaptiveNodeHeight + 120));
    const routeMaxY = routePlans
      ? Math.max(0, ...[...routePlans.values()].map(plan => plan.corridorY ?? 0)) + 70
      : 0;
    logicalWidth = Math.max(920, cols.length * COL + 70, maxNodeX);
    logicalHeight = Math.max(620, maxNodeY, routeMaxY);
    canvas.style.width = `${logicalWidth}px`;
    canvas.style.height = `${logicalHeight}px`;
    svg.setAttribute('viewBox', `0 0 ${logicalWidth} ${logicalHeight}`);
    svg.setAttribute('width', `${logicalWidth}`);
    svg.setAttribute('height', `${logicalHeight}`);
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
    const upperBottom = upper.y + adaptiveNodeHeight;
    const lowerTop = lower.y;
    return {
      pair,
      upperId,
      lowerId,
      x: upper.x + W / 2,
      upperBottom,
      lowerTop,
      junctionY: (upperBottom + lowerTop) / 2,
    };
  };

  function installAdaptiveConnectorGeometry() {
    const invariants = window.CurriculumConnectorInvariants;
    if (!invariants || invariants.__adaptiveNodeSizingPatched) return;
    const baseApplyNow = typeof invariants.applyNow === 'function' ? invariants.applyNow.bind(invariants) : null;
    const baseRequest = typeof invariants.request === 'function' ? invariants.request.bind(invariants) : null;

    invariants.nodeHeight = () => adaptiveNodeHeight;
    invariants.applyNow = (...args) => {
      const dragging = Boolean(nodes.querySelector('.course-node.dragging'));
      const legacyMatches = Math.abs(adaptiveNodeHeight - legacyNodeHeight()) < 0.5;
      if (!dragging && legacyMatches && baseApplyNow) return baseApplyNow(...args);
      return true;
    };
    invariants.request = (...args) => {
      const legacyMatches = Math.abs(adaptiveNodeHeight - legacyNodeHeight()) < 0.5;
      if (legacyMatches && baseRequest) return baseRequest(...args);
      return window.CurriculumConnectorSemanticInvariants?.request?.();
    };
    invariants.__adaptiveNodeSizingPatched = true;
  }

  function refreshSemanticConnectors() {
    installAdaptiveConnectorGeometry();
    window.CurriculumConnectorSemanticInvariants?.applyNow?.();
  }

  function scheduleSemanticRefresh() {
    if (semanticFrame) return;
    semanticFrame = requestAnimationFrame(() => {
      semanticFrame = 0;
      refreshSemanticConnectors();
    });
  }

  function applyMeasuredHeight(nextHeight) {
    const next = Math.max(MIN_NODE_HEIGHT, Math.ceil(Number(nextHeight) || BASE_NODE_HEIGHT));
    const heightChanged = Math.abs(next - adaptiveNodeHeight) >= 0.5;
    if (heightChanged) {
      adaptiveNodeHeight = next;
      flowPanelElement.style.setProperty('--curriculum-adaptive-node-height', `${adaptiveNodeHeight}px`);
    }
    installAdaptiveConnectorGeometry();
    const positionsChanged = normalizeAdaptiveClearance();
    updateCanvasSize();
    if (heightChanged || positionsChanged) renderEdges();
    scheduleSemanticRefresh();
    return heightChanged;
  }

  function scheduleMeasure() {
    if (measureFrame) return;
    measureFrame = requestAnimationFrame(() => {
      measureFrame = 0;
      if (flowPanelElement.hidden) return;
      applyMeasuredHeight(measureRequiredNodeHeight());
    });
  }

  function updateCorequisitesDuringDrag() {
    const pairs = corequisitePairs();
    const paths = [...svg.querySelectorAll('.corequisite-line')];
    pairs.forEach((pair, index) => {
      const geometry = pairGeometry(pair);
      if (!geometry) return;
      const left = paths[index * 2];
      const right = paths[index * 2 + 1];
      if (left) left.setAttribute('d', `M ${geometry.x - 5} ${geometry.upperBottom} V ${geometry.lowerTop}`);
      if (right) right.setAttribute('d', `M ${geometry.x + 5} ${geometry.lowerTop} V ${geometry.upperBottom}`);
    });
  }

  function refreshDragConnectors() {
    dragConnectorTimer = 0;
    if (!gesture || gesture.kind !== 'node' || !gesture.moved) return;
    refreshSemanticConnectors();
    updateCorequisitesDuringDrag();
    lastDragConnectorRefreshAt = performance.now();
  }

  function scheduleDragConnectorRefresh() {
    if (dragConnectorTimer) return;
    const elapsed = performance.now() - lastDragConnectorRefreshAt;
    const delay = Math.max(0, DRAG_CONNECTOR_INTERVAL_MS - elapsed);
    dragConnectorTimer = window.setTimeout(() => {
      dragConnectorTimer = 0;
      requestAnimationFrame(refreshDragConnectors);
    }, delay);
  }

  const originalPointerMove = pointerMove;
  viewport.removeEventListener('pointermove', originalPointerMove);
  const optimizedPointerMove = event => {
    if (!activePointers.has(event.pointerId)) return;
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activePointers.size >= 2) {
      if (gesture?.kind !== 'pinch') beginPinch();
      if (gesture?.kind !== 'pinch') return;
      const first = activePointers.get(gesture.pointerIds[0]);
      const second = activePointers.get(gesture.pointerIds[1]);
      if (!first || !second) return;
      const distance = Math.max(1, pointDistance(first, second));
      const scale = clamp(gesture.startScale * (distance / gesture.startDistance), MIN_SCALE, MAX_SCALE);
      const middleX = (first.x + second.x) / 2;
      const middleY = (first.y + second.y) / 2;
      const rect = viewport.getBoundingClientRect();
      state.viewport.scale = scale;
      state.viewport.x = middleX - rect.left - gesture.focalX * scale;
      state.viewport.y = middleY - rect.top - gesture.focalY * scale;
      applyViewportTransform();
      return;
    }
    if (!gesture || gesture.kind === 'pinch' || gesture.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    if (Math.abs(deltaX) + Math.abs(deltaY) > 4) gesture.moved = true;
    if (gesture.kind === 'pan') {
      state.viewport.x = gesture.startPanX + deltaX;
      state.viewport.y = gesture.startPanY + deltaY;
      viewport.classList.toggle('panning', gesture.moved);
      applyViewportTransform();
      return;
    }
    if (!gesture.moved) return;

    if (!gesture.__adaptiveElements) {
      gesture.__adaptiveElements = new Map();
      gesture.starts.forEach((_, id) => {
        const element = nodes.querySelector(`[data-id="${CSS.escape(id)}"]`);
        if (element instanceof HTMLElement) gesture.__adaptiveElements.set(id, element);
      });
    }

    const canvasDeltaX = deltaX / state.viewport.scale;
    const canvasDeltaY = deltaY / state.viewport.scale;
    gesture.starts.forEach((start, id) => {
      let x = Math.max(0, start.x + canvasDeltaX);
      let y = Math.max(108, start.y + canvasDeltaY);
      if (state.snapToGrid) {
        x = Math.round(x / GRID) * GRID;
        y = Math.round(y / GRID) * GRID;
      }
      state.positions[id] = { x, y };
      const element = gesture.__adaptiveElements.get(id);
      if (element) {
        element.style.left = `${x}px`;
        element.style.top = `${y}px`;
        element.classList.add('dragging');
      }
    });

    // Keep node motion on the pointer path. Expensive route-plan rebuilding stays deferred
    // until pointer-up; existing connector DOM is updated in-place at a modest cadence.
    scheduleDragConnectorRefresh();
  };
  viewport.addEventListener('pointermove', optimizedPointerMove);

  function installHygieneDragGuard() {
    const hygiene = window.CurriculumUntangleV2;
    if (!hygiene || typeof hygiene.runPropagation !== 'function' || hygiene.__adaptiveDragGuard) return;
    const baseRunPropagation = hygiene.runPropagation;
    hygiene.runPropagation = function(...args) {
      if (nodes.querySelector('.course-node.dragging')) return false;
      return baseRunPropagation.apply(this, args);
    };
    hygiene.__adaptiveDragGuard = true;
  }

  const number = value => Number.parseFloat(String(value ?? '0')) || 0;
  const formatNumber = value => Number(Number(value).toFixed(3)).toString();

  function isElementVisible(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function renderedTitleLines(element) {
    if (!isElementVisible(element)) return [];
    const raw = String(element.textContent || '').trim();
    if (!raw) return [];
    const textNode = [...element.childNodes].find(node => node.nodeType === Node.TEXT_NODE);
    if (!textNode) return typeof titleLines === 'function' ? titleLines(raw) : [raw];

    try {
      const bounds = element.getBoundingClientRect();
      const sourceText = String(textNode.textContent || '');
      const matches = [...sourceText.matchAll(/\S+\s*/g)];
      const lines = [];
      let hiddenContent = false;
      for (const match of matches) {
        const start = match.index ?? 0;
        const end = Math.min(sourceText.length, start + match[0].length);
        const range = document.createRange();
        range.setStart(textNode, start);
        range.setEnd(textNode, end);
        const rects = [...range.getClientRects()];
        range.detach?.();
        const rect = rects.find(candidate => candidate.width > 0 && candidate.height > 0);
        if (!rect) continue;
        if (rect.bottom <= bounds.top + 0.5 || rect.top >= bounds.bottom - 0.5) {
          hiddenContent = true;
          continue;
        }
        let line = lines.find(item => Math.abs(item.top - rect.top) < Math.max(1, state.viewport.scale));
        if (!line) {
          line = { top: rect.top, text: '' };
          lines.push(line);
        }
        line.text += match[0];
      }
      const result = lines.sort((a, b) => a.top - b.top).slice(0, 2).map(line => line.text.trim()).filter(Boolean);
      if (hiddenContent && result.length) result[result.length - 1] = `${result[result.length - 1].replace(/[.…]+$/, '')}…`;
      return result.length ? result : (typeof titleLines === 'function' ? titleLines(raw) : [raw]);
    } catch {
      return typeof titleLines === 'function' ? titleLines(raw) : [raw];
    }
  }

  function appendLiveText(documentXml, group, element, x, y, text) {
    if (!isElementVisible(element) || !String(text || '').trim()) return;
    const style = getComputedStyle(element);
    const textElement = documentXml.createElementNS(SVG_NS, 'text');
    textElement.setAttribute('x', formatNumber(x));
    textElement.setAttribute('y', formatNumber(y));
    textElement.setAttribute('dominant-baseline', 'text-before-edge');
    textElement.setAttribute('font-family', style.fontFamily || 'Arial, sans-serif');
    textElement.setAttribute('font-size', formatNumber(number(style.fontSize)));
    textElement.setAttribute('font-weight', style.fontWeight || '400');
    if (style.fontStyle && style.fontStyle !== 'normal') textElement.setAttribute('font-style', style.fontStyle);
    textElement.setAttribute('fill', style.color || '#172033');
    textElement.setAttribute('xml:space', 'preserve');
    textElement.textContent = String(text);
    group.append(textElement);
  }

  function replaceCourseTextWithLiveLayout(documentXml, group, record) {
    const node = record.node;
    if (!(node instanceof HTMLElement)) return;
    [...group.children].filter(child => child.tagName?.toLowerCase() === 'text').forEach(child => child.remove());

    const code = node.querySelector('.node-code');
    const title = node.querySelector('.node-title');
    const meta = node.querySelector('.node-meta');
    const nodeStyle = getComputedStyle(node);
    const leftPadding = number(nodeStyle.paddingLeft) || 9;

    if (code instanceof HTMLElement && isElementVisible(code)) {
      appendLiveText(documentXml, group, code, record.position.x + leftPadding, record.position.y + code.offsetTop, code.innerText || code.textContent || '');
    }

    if (title instanceof HTMLElement && isElementVisible(title)) {
      const style = getComputedStyle(title);
      const lineHeight = number(style.lineHeight) || (number(style.fontSize) * 1.16);
      renderedTitleLines(title).forEach((line, index) => {
        appendLiveText(documentXml, group, title, record.position.x + leftPadding, record.position.y + title.offsetTop + index * lineHeight, line);
      });
    }

    if (meta instanceof HTMLElement && isElementVisible(meta)) {
      const visibleMeta = String(meta.innerText || '').replace(/\s+/g, ' ').trim();
      if (visibleMeta) appendLiveText(documentXml, group, meta, record.position.x + leftPadding, record.position.y + meta.offsetTop, visibleMeta);
    }
  }

  function findCourseGroups(root) {
    const records = visibleCourses().map(course => ({
      course,
      position: state.positions[course.id],
      node: nodes.querySelector(`[data-id="${CSS.escape(course.id)}"]`),
    })).filter(record => record.position);
    const groups = [...root.querySelectorAll('g')];
    const used = new Set();

    for (const record of records) {
      const match = groups.find(group => {
        if (used.has(group)) return false;
        const rect = [...group.children].find(child => child.tagName?.toLowerCase() === 'rect');
        if (!rect) return false;
        return Math.abs(number(rect.getAttribute('width')) - W) < 0.01 &&
          Math.abs(number(rect.getAttribute('x')) - record.position.x) < EPS &&
          Math.abs(number(rect.getAttribute('y')) - record.position.y) < EPS;
      });
      if (!match) continue;
      used.add(match);
      record.group = match;
      record.rect = [...match.children].find(child => child.tagName?.toLowerCase() === 'rect');
    }
    return records.filter(record => record.group && record.rect);
  }

  function applyAdaptiveExportSvg(svgText) {
    try {
      const documentXml = new DOMParser().parseFromString(String(svgText || ''), 'image/svg+xml');
      const root = documentXml.documentElement;
      if (!root || root.tagName?.toLowerCase() !== 'svg') return svgText;
      const records = findCourseGroups(root);
      if (!records.length) return svgText;

      records.forEach(record => {
        record.rect.setAttribute('height', formatNumber(adaptiveNodeHeight));
        replaceCourseTextWithLiveLayout(documentXml, record.group, record);
      });

      // The legacy display filter may have shifted export paths to its fixed 62 px compact
      // height. Semantic routing already used the adaptive height, so restore its pre-filter
      // path whenever that canonical path is available.
      root.querySelectorAll('path[data-display-base-d]').forEach(path => {
        const base = path.getAttribute('data-display-base-d');
        if (base) path.setAttribute('d', base);
      });

      return new XMLSerializer().serializeToString(root);
    } catch {
      return svgText;
    }
  }

  function installExportDecorator() {
    document.addEventListener('click', event => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('#download-image, #download-svg')) return;
      const PreviousBlob = window.Blob;
      class AdaptiveExportBlob extends PreviousBlob {
        constructor(parts, options) {
          let nextParts = parts;
          if (options?.type?.startsWith('image/svg+xml') && parts?.length === 1 && typeof parts[0] === 'string') {
            nextParts = [applyAdaptiveExportSvg(parts[0])];
          }
          super(nextParts, options);
        }
      }
      window.Blob = AdaptiveExportBlob;
      // Existing export decorators restore on a zero-delay timer. Restore this outer base
      // after those decorators so Blob never remains patched after a download.
      window.setTimeout(() => {
        if (window.Blob === AdaptiveExportBlob) window.Blob = PreviousBlob;
      }, 25);
    }, true);
  }

  installStyles();
  flowPanelElement.style.setProperty('--curriculum-adaptive-node-height', `${adaptiveNodeHeight}px`);
  installAdaptiveConnectorGeometry();
  installHygieneDragGuard();
  installExportDecorator();

  const nodeObserver = new MutationObserver(scheduleMeasure);
  nodeObserver.observe(nodes, { childList: true, subtree: true, characterData: true });

  const flowObserver = new MutationObserver(mutations => {
    if (mutations.some(mutation => ['class', 'style', 'hidden'].includes(mutation.attributeName || ''))) scheduleMeasure();
  });
  flowObserver.observe(flowPanelElement, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] });

  // The legacy display patch runs from a child-list observer and assumes 78/62 px heights.
  // Re-assert semantic routing one animation frame later so adaptive geometry is the final
  // on-canvas result without introducing another path-rewriting algorithm.
  const connectorObserver = new MutationObserver(scheduleSemanticRefresh);
  connectorObserver.observe(svg, { childList: true, subtree: true });

  document.addEventListener('pointerup', () => {
    window.setTimeout(() => {
      if (dragConnectorTimer) {
        clearTimeout(dragConnectorTimer);
        dragConnectorTimer = 0;
      }
      scheduleMeasure();
      scheduleSemanticRefresh();
    }, 0);
  }, true);
  document.addEventListener('pointercancel', () => {
    if (dragConnectorTimer) {
      clearTimeout(dragConnectorTimer);
      dragConnectorTimer = 0;
    }
    scheduleMeasure();
  }, true);

  if (document.fonts?.ready) document.fonts.ready.then(scheduleMeasure).catch(() => {});
  scheduleMeasure();
  scheduleSemanticRefresh();

  window.CurriculumAdaptiveNodeSizing = {
    getHeight: () => adaptiveNodeHeight,
    refresh: () => { scheduleMeasure(); scheduleSemanticRefresh(); },
    exportSvg: applyAdaptiveExportSvg,
    version: 2,
  };
})();
