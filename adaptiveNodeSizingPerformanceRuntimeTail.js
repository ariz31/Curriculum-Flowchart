
;(() => {
  if (window.__CURRICULUM_ADAPTIVE_NODE_RUNTIME__) return;
  window.__CURRICULUM_ADAPTIVE_NODE_RUNTIME__ = true;

  const BASE_NODE_HEIGHT = 78;
  const MIN_NODE_HEIGHT = 44;
  const MIN_NODE_GAP = 24;
  const COREQ_NODE_GAP = 34;
  const DRAG_EDGE_INTERVAL_MS = 80;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const EPS = 0.75;

  const flowPanelElement = document.querySelector('#flow-panel');
  if (!(flowPanelElement instanceof HTMLElement)) return;

  let adaptiveNodeHeight = BASE_NODE_HEIGHT;
  let measureFrame = 0;
  let geometryFrame = 0;
  let dragEdgeTimer = 0;
  let lastDragEdgeRenderAt = 0;
  let applyingClearance = false;

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

  function applyMeasuredHeight(nextHeight) {
    const next = Math.max(MIN_NODE_HEIGHT, Math.ceil(Number(nextHeight) || BASE_NODE_HEIGHT));
    if (Math.abs(next - adaptiveNodeHeight) < 0.5) {
      normalizeAdaptiveClearance();
      updateCanvasSize();
      scheduleGeometryPatch();
      return false;
    }
    adaptiveNodeHeight = next;
    flowPanelElement.style.setProperty('--curriculum-adaptive-node-height', `${adaptiveNodeHeight}px`);
    normalizeAdaptiveClearance();
    updateCanvasSize();
    renderEdges();
    scheduleGeometryPatch();
    return true;
  }

  function scheduleMeasure() {
    if (measureFrame) return;
    measureFrame = requestAnimationFrame(() => {
      measureFrame = 0;
      if (flowPanelElement.hidden) return;
      applyMeasuredHeight(measureRequiredNodeHeight());
    });
  }

  const number = value => Number.parseFloat(String(value ?? '0')) || 0;
  const formatNumber = value => Number(Number(value).toFixed(3)).toString();

  function parseOrthogonalPath(d) {
    if (!d || /[CLQSTAZ]/i.test(d)) return [];
    const commands = [...String(d).matchAll(/([MHV])\s*(-?[\d.]+)(?:\s+(-?[\d.]+))?/g)];
    if (!commands.length) return [];
    const points = [];
    let x = 0;
    let y = 0;
    for (const match of commands) {
      if (match[1] === 'M') {
        x = number(match[2]);
        y = number(match[3]);
      } else if (match[1] === 'H') x = number(match[2]);
      else if (match[1] === 'V') y = number(match[2]);
      points.push({ x, y });
    }
    return points;
  }

  function serializeOrthogonalPath(points) {
    if (!points.length) return '';
    let result = `M ${formatNumber(points[0].x)} ${formatNumber(points[0].y)}`;
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const point = points[index];
      if (Math.abs(previous.y - point.y) < 0.001) result += ` H ${formatNumber(point.x)}`;
      else if (Math.abs(previous.x - point.x) < 0.001) result += ` V ${formatNumber(point.y)}`;
      else return '';
    }
    return result;
  }

  function currentBoxes() {
    return visibleCourses().map(course => {
      const position = state.positions[course.id];
      if (!position) return null;
      return {
        id: course.id,
        top: position.y,
        bottom: position.y + adaptiveNodeHeight,
        left: position.x,
        right: position.x + W,
        baselineBottom: position.y + BASE_NODE_HEIGHT,
      };
    }).filter(Boolean);
  }

  function pointTouchesBox(point, box) {
    return point.x >= box.left - 1 && point.x <= box.right + 1 && point.y >= box.top - 1 && point.y <= box.bottom + 1;
  }

  function verticalBlocked(x, y1, y2, boxes) {
    const low = Math.min(y1, y2);
    const high = Math.max(y1, y2);
    const clearance = 10;
    return boxes.some(box =>
      x > box.left - clearance && x < box.right + clearance &&
      low < box.bottom + clearance && high > box.top - clearance
    );
  }

  function horizontalBlocked(y, x1, x2, boxes, ignored = new Set()) {
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const clearance = 10;
    return boxes.some((box, index) => {
      if (ignored.has(index)) return false;
      return y > box.top - clearance && y < box.bottom + clearance &&
        left < box.right + clearance && right > box.left - clearance;
    });
  }

  function touchingBoxIndexes(point, boxes) {
    return new Set(boxes.map((box, index) => pointTouchesBox(point, box) ? index : -1).filter(index => index >= 0));
  }

  function verticalLaneCandidates(currentX, boxes) {
    const values = new Set([currentX]);
    const step = 12;
    for (let index = 1; index <= 24; index += 1) {
      values.add(currentX - index * step);
      values.add(currentX + index * step);
    }
    boxes.forEach(box => {
      values.add(box.left - 12);
      values.add(box.right + 12);
    });
    const maxRight = Math.max(W, ...boxes.map(box => box.right));
    const minLeft = Math.min(0, ...boxes.map(box => box.left));
    values.add(Math.max(8, minLeft - 26));
    values.add(maxRight + 26);
    values.add(Math.max(8, logicalWidth - 14));
    return [...values]
      .filter(value => Number.isFinite(value) && value >= 6)
      .sort((a, b) => Math.abs(a - currentX) - Math.abs(b - currentX));
  }

  function avoidAdaptiveNodeIntersections(path, boxes) {
    const d = path.getAttribute('d') || '';
    const points = parseOrthogonalPath(d);
    if (points.length < 3) return;
    let changed = false;
    for (let index = 0; index < points.length - 1; index += 1) {
      const start = points[index];
      const end = points[index + 1];
      if (Math.abs(start.x - end.x) > 0.001 || Math.abs(start.y - end.y) < 0.001) continue;
      if (!verticalBlocked(start.x, start.y, end.y, boxes)) continue;
      const previous = points[index - 1] || start;
      const next = points[index + 2] || end;
      const startIgnored = touchingBoxIndexes(previous, boxes);
      const endIgnored = touchingBoxIndexes(next, boxes);
      const candidates = verticalLaneCandidates(start.x, boxes);
      let safeX = candidates.find(candidate => {
        if (verticalBlocked(candidate, start.y, end.y, boxes)) return false;
        if (index > 0 && horizontalBlocked(start.y, previous.x, candidate, boxes, startIgnored)) return false;
        if (index + 2 < points.length && horizontalBlocked(end.y, candidate, next.x, boxes, endIgnored)) return false;
        return true;
      });
      if (safeX === undefined) safeX = candidates.find(candidate => !verticalBlocked(candidate, start.y, end.y, boxes));
      if (safeX === undefined) continue;
      start.x = safeX;
      end.x = safeX;
      changed = true;
    }
    if (!changed) return;
    const serialized = serializeOrthogonalPath(points);
    if (serialized) path.setAttribute('d', serialized);
  }

  function relationshipBaseD(path) {
    return path.getAttribute('data-display-base-d') ||
      path.getAttribute('data-adaptive-base-d') ||
      path.getAttribute('d') || '';
  }

  function shiftRelationshipD(d, delta) {
    if (!d || Math.abs(delta) < 0.001) return d;
    const centerShift = delta / 2;
    let next = String(d).replace(/^M\s+(-?[\d.]+)\s+(-?[\d.]+)/, (_, x, y) => `M ${x} ${number(y) - centerShift}`);
    const matches = [...next.matchAll(/V\s+(-?[\d.]+)\s+H\s+(-?[\d.]+)/g)];
    if (matches.length) {
      const last = matches[matches.length - 1];
      const replacement = `V ${number(last[1]) - centerShift} H ${last[2]}`;
      next = next.slice(0, last.index) + replacement + next.slice(last.index + last[0].length);
    }
    return next;
  }

  function shiftCorequisiteD(d, delta, boxes) {
    if (!d || Math.abs(delta) < 0.001) return d;
    const match = String(d).match(/^M\s+(-?[\d.]+)\s+(-?[\d.]+)\s+V\s+(-?[\d.]+)/);
    if (!match) return d;
    const x = number(match[1]);
    let y1 = number(match[2]);
    let y2 = number(match[3]);
    const isBaselineBottom = y => boxes.some(box => Math.abs(box.baselineBottom - y) < 0.9 && x >= box.left - 8 && x <= box.right + 8);
    if (isBaselineBottom(y1)) y1 -= delta;
    if (isBaselineBottom(y2)) y2 -= delta;
    return `M ${match[1]} ${formatNumber(y1)} V ${formatNumber(y2)}`;
  }

  function patchLiveGeometry(duringDrag = false) {
    const boxes = currentBoxes();
    if (!boxes.length) return;
    const delta = BASE_NODE_HEIGHT - adaptiveNodeHeight;

    svg.querySelectorAll('.relationship').forEach(path => {
      const base = relationshipBaseD(path);
      if (!path.hasAttribute('data-adaptive-base-d')) path.setAttribute('data-adaptive-base-d', base);
      path.setAttribute('d', shiftRelationshipD(base, delta));
      if (!duringDrag) avoidAdaptiveNodeIntersections(path, boxes);
    });

    svg.querySelectorAll('.corequisite-line').forEach(path => {
      const base = relationshipBaseD(path);
      if (!path.hasAttribute('data-adaptive-base-d')) path.setAttribute('data-adaptive-base-d', base);
      path.setAttribute('d', shiftCorequisiteD(base, delta, boxes));
    });
  }

  function scheduleGeometryPatch() {
    if (geometryFrame) return;
    geometryFrame = requestAnimationFrame(() => {
      geometryFrame = 0;
      patchLiveGeometry(Boolean(nodes.querySelector('.course-node.dragging')));
    });
  }

  function suppressDeferredRoutingWhile(callback) {
    const nativeRaf = window.requestAnimationFrame;
    let result;
    try {
      window.requestAnimationFrame = () => 0;
      result = callback();
    } finally {
      window.requestAnimationFrame = nativeRaf;
    }
    return result;
  }

  function renderDragEdges() {
    dragEdgeTimer = 0;
    if (!gesture || gesture.kind !== 'node' || !gesture.moved) return;
    suppressDeferredRoutingWhile(() => renderEdges());
    lastDragEdgeRenderAt = performance.now();
    patchLiveGeometry(true);
  }

  function scheduleDragEdges() {
    if (dragEdgeTimer) return;
    const elapsed = performance.now() - lastDragEdgeRenderAt;
    const delay = Math.max(0, DRAG_EDGE_INTERVAL_MS - elapsed);
    dragEdgeTimer = window.setTimeout(() => {
      dragEdgeTimer = 0;
      requestAnimationFrame(renderDragEdges);
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

    scheduleDragEdges();
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
      const matches = [...raw.matchAll(/\S+\s*/g)];
      const lines = [];
      let hiddenContent = false;
      for (const match of matches) {
        const start = match.index ?? 0;
        const end = Math.min(textNode.textContent?.length ?? raw.length, start + match[0].length);
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
          Math.abs(number(rect.getAttribute('x')) - record.position.x) < 0.75 &&
          Math.abs(number(rect.getAttribute('y')) - record.position.y) < 0.75;
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

      const boxes = records.map(record => ({
        top: record.position.y,
        bottom: record.position.y + adaptiveNodeHeight,
        left: record.position.x,
        right: record.position.x + W,
        baselineBottom: record.position.y + BASE_NODE_HEIGHT,
      }));
      const delta = BASE_NODE_HEIGHT - adaptiveNodeHeight;

      [...root.querySelectorAll('path')].forEach(path => {
        if (path.closest('defs')) return;
        const markerEnd = path.getAttribute('marker-end') || '';
        const className = path.getAttribute('class') || '';
        const isCorequisite = markerEnd.includes('export-coreq') || className.includes('export-corequisite');
        const hasRelationshipIdentity = markerEnd.includes('export-arrow') || path.hasAttribute('data-display-base-d');
        if (isCorequisite) {
          const base = relationshipBaseD(path);
          path.setAttribute('d', shiftCorequisiteD(base, delta, boxes));
          return;
        }
        if (!hasRelationshipIdentity) return;
        const base = relationshipBaseD(path);
        path.setAttribute('d', shiftRelationshipD(base, delta));
        avoidAdaptiveNodeIntersections(path, boxes);
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
      window.setTimeout(() => {
        if (window.Blob === AdaptiveExportBlob) window.Blob = PreviousBlob;
      }, 25);
    }, true);
  }

  installStyles();
  flowPanelElement.style.setProperty('--curriculum-adaptive-node-height', `${adaptiveNodeHeight}px`);
  installHygieneDragGuard();
  installExportDecorator();

  const nodeObserver = new MutationObserver(scheduleMeasure);
  nodeObserver.observe(nodes, { childList: true, subtree: true, characterData: true });

  const flowObserver = new MutationObserver(mutations => {
    if (mutations.some(mutation => ['class', 'style', 'hidden'].includes(mutation.attributeName || ''))) scheduleMeasure();
  });
  flowObserver.observe(flowPanelElement, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] });

  const geometryObserver = new MutationObserver(scheduleGeometryPatch);
  geometryObserver.observe(svg, { childList: true, subtree: true });

  document.addEventListener('pointerup', () => {
    window.setTimeout(() => {
      if (!nodes.querySelector('.course-node.dragging')) {
        if (dragEdgeTimer) {
          clearTimeout(dragEdgeTimer);
          dragEdgeTimer = 0;
        }
        scheduleMeasure();
        scheduleGeometryPatch();
      }
    }, 0);
  }, true);
  document.addEventListener('pointercancel', () => scheduleMeasure(), true);

  document.fonts?.ready?.then?.(scheduleMeasure).catch?.(() => {});
  scheduleMeasure();
  scheduleGeometryPatch();

  window.CurriculumAdaptiveNodeSizing = {
    getHeight: () => adaptiveNodeHeight,
    refresh: () => { scheduleMeasure(); scheduleGeometryPatch(); },
    exportSvg: applyAdaptiveExportSvg,
    version: 1,
  };
})();
