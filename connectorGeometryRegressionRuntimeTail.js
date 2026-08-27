
;(() => {
  const EPS = 0.5;
  const DEFAULT_SPACING = 7;
  const NODE_WIDTH = 184;
  const BASE_NODE_HEIGHT = 78;
  const COMPACT_NODE_HEIGHT = 62;
  const NODE_CLEARANCE = 10;
  const PORT_USABLE_SPAN = 54;

  const clone = value => JSON.parse(JSON.stringify(value));
  const number = value => Number.parseFloat(String(value ?? '0'));
  const fmt = value => Number(Number(value).toFixed(3)).toString();
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const intervalOverlap = (aLow, aHigh, bLow, bHigh) => Math.min(aHigh, bHigh) - Math.max(aLow, bLow);
  const verticalSpacing = () => clamp(Number(window.CurriculumVerticalLaneSpacing?.get?.()) || DEFAULT_SPACING, 3, 30);
  const horizontalSpacing = () => clamp(Number(window.CurriculumHorizontalLaneSpacing?.get?.()) || DEFAULT_SPACING, 3, 30);

  function parseOrthogonalPath(d) {
    const commands = [...String(d || '').matchAll(/([MHV])\s*(-?[\d.]+)(?:\s+(-?[\d.]+))?/g)];
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

  function isOrthogonal(points) {
    return Array.isArray(points) && points.length >= 2 && points.every((point, index) => index === 0 ||
      Math.abs(point.x - points[index - 1].x) < EPS ||
      Math.abs(point.y - points[index - 1].y) < EPS);
  }

  function serializeOrthogonal(points) {
    if (!isOrthogonal(points)) return '';
    let d = `M ${fmt(points[0].x)} ${fmt(points[0].y)}`;
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const point = points[index];
      if (Math.abs(previous.y - point.y) < EPS) d += ` H ${fmt(point.x)}`;
      else if (Math.abs(previous.x - point.x) < EPS) d += ` V ${fmt(point.y)}`;
      else return '';
    }
    return d;
  }

  function roundedArcPath(points, requestedRadius) {
    if (!isOrthogonal(points) || points.length < 3 || requestedRadius <= 0) return serializeOrthogonal(points);
    let d = `M ${fmt(points[0].x)} ${fmt(points[0].y)}`;
    for (let index = 1; index < points.length - 1; index += 1) {
      const previous = points[index - 1];
      const corner = points[index];
      const next = points[index + 1];
      const inDx = corner.x - previous.x;
      const inDy = corner.y - previous.y;
      const outDx = next.x - corner.x;
      const outDy = next.y - corner.y;
      const incoming = Math.hypot(inDx, inDy);
      const outgoing = Math.hypot(outDx, outDy);
      const cross = inDx * outDy - inDy * outDx;
      if (incoming < EPS || outgoing < EPS || Math.abs(cross) < EPS) {
        d += ` L ${fmt(corner.x)} ${fmt(corner.y)}`;
        continue;
      }
      const radius = Math.min(requestedRadius, incoming / 2, outgoing / 2);
      if (radius < 0.5) {
        d += ` L ${fmt(corner.x)} ${fmt(corner.y)}`;
        continue;
      }
      const before = {
        x: corner.x - inDx / incoming * radius,
        y: corner.y - inDy / incoming * radius,
      };
      const after = {
        x: corner.x + outDx / outgoing * radius,
        y: corner.y + outDy / outgoing * radius,
      };
      const sweep = cross > 0 ? 1 : 0;
      d += ` L ${fmt(before.x)} ${fmt(before.y)} A ${fmt(radius)} ${fmt(radius)} 0 0 ${sweep} ${fmt(after.x)} ${fmt(after.y)}`;
    }
    const last = points.at(-1);
    d += ` L ${fmt(last.x)} ${fmt(last.y)}`;
    return d;
  }

  const pointTouchesBox = (point, box) =>
    point.x >= box.left - 1 && point.x <= box.right + 1 && point.y >= box.top - 1 && point.y <= box.bottom + 1;

  function liveBoxes() {
    const flowPanel = document.querySelector('#flow-panel');
    const nodesLayer = document.querySelector('#nodes-layer');
    if (!(nodesLayer instanceof HTMLElement)) return [];
    const height = flowPanel?.classList.contains('hide-node-units') ? COMPACT_NODE_HEIGHT : BASE_NODE_HEIGHT;
    return [...nodesLayer.querySelectorAll('.course-node')].map(node => ({
      top: number(node.style.top),
      bottom: number(node.style.top) + height,
      left: number(node.style.left),
      right: number(node.style.left) + NODE_WIDTH,
    }));
  }

  function pathBlocked(points, boxes) {
    if (!isOrthogonal(points)) return true;
    const sourceIgnored = new Set(boxes.map((box, index) => pointTouchesBox(points[0], box) ? index : -1).filter(index => index >= 0));
    const targetIgnored = new Set(boxes.map((box, index) => pointTouchesBox(points.at(-1), box) ? index : -1).filter(index => index >= 0));
    for (let index = 0; index < points.length - 1; index += 1) {
      const a = points[index];
      const b = points[index + 1];
      const ignored = index === 0 ? sourceIgnored : index === points.length - 2 ? targetIgnored : new Set();
      for (let boxIndex = 0; boxIndex < boxes.length; boxIndex += 1) {
        if (ignored.has(boxIndex)) continue;
        const box = boxes[boxIndex];
        if (Math.abs(a.x - b.x) < EPS) {
          const low = Math.min(a.y, b.y);
          const high = Math.max(a.y, b.y);
          if (a.x > box.left - NODE_CLEARANCE && a.x < box.right + NODE_CLEARANCE && low < box.bottom + NODE_CLEARANCE && high > box.top - NODE_CLEARANCE) return true;
        } else {
          const low = Math.min(a.x, b.x);
          const high = Math.max(a.x, b.x);
          if (a.y > box.top - NODE_CLEARANCE && a.y < box.bottom + NODE_CLEARANCE && low < box.right + NODE_CLEARANCE && high > box.left - NODE_CLEARANCE) return true;
        }
      }
    }
    return false;
  }

  function sourceSide(nodeId, edge, pairs, cols) {
    const sourceColumn = edgeSourceColumn(edge, pairs, cols);
    const targetColumn = edgeTargetColumn(edge, cols);
    if (sourceColumn < 0 || targetColumn < 0) return null;
    const forward = targetColumn >= sourceColumn;
    if (edge.sourceKind === 'course' && edge.fromId === nodeId) return forward ? 'right' : 'left';
    if (edge.toId === nodeId) return forward ? 'left' : 'right';
    return null;
  }

  function counterpartY(nodeId, edge, pairs) {
    if (edge.sourceKind === 'course' && edge.fromId === nodeId) {
      const target = state.positions[edge.toId];
      return target ? target.y + H / 2 : 0;
    }
    if (edge.toId === nodeId) {
      if (edge.sourceKind === 'course') {
        const source = state.positions[edge.fromId];
        return source ? source.y + H / 2 : 0;
      }
      const pair = pairByKey(edge.pairKey, pairs);
      const geometry = pair ? pairGeometry(pair) : null;
      return geometry?.junctionY ?? 0;
    }
    return 0;
  }

  // Horizontal spacing is a global connector rule, including every source/target port.
  // The usable node face remains the physical upper bound when many edges share one side.
  courseIncidentOffset = (nodeId, edge, edges) => {
    const pairs = corequisitePairs();
    const cols = columns();
    const side = sourceSide(nodeId, edge, pairs, cols);
    if (!side) return 0;
    const incident = edges
      .filter(item => {
        const attached = (item.sourceKind === 'course' && item.fromId === nodeId) || item.toId === nodeId;
        return attached && sourceSide(nodeId, item, pairs, cols) === side;
      })
      .sort((a, b) => {
        const delta = counterpartY(nodeId, a, pairs) - counterpartY(nodeId, b, pairs);
        return Math.abs(delta) > 0.01 ? delta : a.key.localeCompare(b.key);
      });
    if (incident.length <= 1) return 0;
    const index = Math.max(0, incident.findIndex(item => item.key === edge.key));
    const requested = horizontalSpacing();
    const step = Math.min(requested, PORT_USABLE_SPAN / Math.max(1, incident.length - 1));
    return (index - (incident.length - 1) / 2) * step;
  };

  const previousPairBranchAnchor = pairBranchAnchor;
  pairBranchAnchor = (pair, edge, edges) => {
    const geometry = pairGeometry(pair);
    if (!geometry) return previousPairBranchAnchor(pair, edge, edges);
    const branches = edges
      .filter(item => item.sourceKind === 'pair' && item.pairKey === pair.key)
      .sort((a, b) => {
        const ay = (state.positions[a.toId]?.y ?? 0) + H / 2;
        const by = (state.positions[b.toId]?.y ?? 0) + H / 2;
        return Math.abs(ay - by) > 0.01 ? ay - by : a.key.localeCompare(b.key);
      });
    if (branches.length <= 1) return { x: geometry.x + 3.5, y: geometry.junctionY };
    const index = Math.max(0, branches.findIndex(item => item.key === edge.key));
    const requested = horizontalSpacing();
    const low = Math.min(geometry.upperBottom + 8, geometry.lowerTop - 8);
    const high = Math.max(geometry.upperBottom + 8, geometry.lowerTop - 8);
    const available = Math.max(0, high - low);
    const step = Math.min(requested, available / Math.max(1, branches.length - 1));
    const start = geometry.junctionY - step * (branches.length - 1) / 2;
    return { x: geometry.x + 3.5, y: clamp(start + index * step, low, high) };
  };

  function basePointsForPath(path) {
    const candidates = [
      path.dataset.editRoute,
      path.getAttribute('data-stable-route-base'),
      path.getAttribute('d'),
    ];
    for (const candidate of candidates) {
      const points = parseOrthogonalPath(candidate || '');
      if (isOrthogonal(points)) return points;
    }
    return [];
  }

  function splitProjectionComponents(segments) {
    const sorted = [...segments].sort((a, b) => a.low - b.low || a.high - b.high || a.record.order - b.record.order || a.index - b.index);
    const components = [];
    let current = [];
    let maxHigh = -Infinity;
    for (const segment of sorted) {
      if (current.length && segment.low >= maxHigh - EPS) {
        components.push(current);
        current = [];
        maxHigh = -Infinity;
      }
      current.push(segment);
      maxHigh = Math.max(maxHigh, segment.high);
    }
    if (current.length) components.push(current);
    return components;
  }

  function candidateValues(desired, original, spacing) {
    const values = [desired];
    for (let step = 1; step <= 12; step += 1) values.push(desired - step * spacing, desired + step * spacing);
    if (!values.some(value => Math.abs(value - original) < EPS)) values.push(original);
    return values;
  }

  function applyVerticalSpacing(records, boxes) {
    const spacing = verticalSpacing();
    const groups = new Map();
    for (const record of records) {
      for (let index = 1; index < record.points.length - 2; index += 1) {
        const a = record.points[index];
        const b = record.points[index + 1];
        if (Math.abs(a.x - b.x) > EPS || Math.abs(a.y - b.y) < EPS) continue;
        const key = String(Math.round(a.x * 2) / 2);
        const list = groups.get(key) || [];
        list.push({ record, index, base: a.x, low: Math.min(a.y, b.y), high: Math.max(a.y, b.y) });
        groups.set(key, list);
      }
    }

    for (const group of groups.values()) {
      for (const component of splitProjectionComponents(group)) {
        if (component.length < 2) continue;
        const ordered = [...component].sort((a, b) => a.record.order - b.record.order || a.index - b.index || a.low - b.low);
        const center = ordered.reduce((sum, item) => sum + item.base, 0) / ordered.length;
        const placed = [];
        ordered.forEach((segment, rank) => {
          const desired = center + (rank - (ordered.length - 1) / 2) * spacing;
          for (const x of candidateValues(desired, segment.base, spacing)) {
            if (placed.some(other => intervalOverlap(segment.low, segment.high, other.low, other.high) > EPS && Math.abs(x - other.value) < spacing - 0.5)) continue;
            const candidate = clone(segment.record.points);
            candidate[segment.index].x = x;
            candidate[segment.index + 1].x = x;
            if (!isOrthogonal(candidate) || pathBlocked(candidate, boxes)) continue;
            segment.record.points = candidate;
            placed.push({ low: segment.low, high: segment.high, value: x });
            break;
          }
        });
      }
    }
  }

  function applyHorizontalSpacing(records, boxes) {
    const spacing = horizontalSpacing();
    const groups = new Map();
    for (const record of records) {
      // Endpoint horizontal segments are already spaced by courseIncidentOffset/pairBranchAnchor.
      // This pass covers every interior horizontal propagation lane, including manual routes.
      for (let index = 1; index < record.points.length - 2; index += 1) {
        const a = record.points[index];
        const b = record.points[index + 1];
        if (Math.abs(a.y - b.y) > EPS || Math.abs(a.x - b.x) < EPS) continue;
        const key = String(Math.round(a.y * 2) / 2);
        const list = groups.get(key) || [];
        list.push({ record, index, base: a.y, low: Math.min(a.x, b.x), high: Math.max(a.x, b.x) });
        groups.set(key, list);
      }
    }

    for (const group of groups.values()) {
      for (const component of splitProjectionComponents(group)) {
        if (component.length < 2) continue;
        const ordered = [...component].sort((a, b) => a.record.order - b.record.order || a.index - b.index || a.low - b.low);
        const center = ordered.reduce((sum, item) => sum + item.base, 0) / ordered.length;
        const placed = [];
        ordered.forEach((segment, rank) => {
          const desired = center + (rank - (ordered.length - 1) / 2) * spacing;
          for (const y of candidateValues(desired, segment.base, spacing)) {
            if (y < 4) continue;
            if (placed.some(other => intervalOverlap(segment.low, segment.high, other.low, other.high) > EPS && Math.abs(y - other.value) < spacing - 0.5)) continue;
            const candidate = clone(segment.record.points);
            candidate[segment.index].y = y;
            candidate[segment.index + 1].y = y;
            if (!isOrthogonal(candidate) || pathBlocked(candidate, boxes)) continue;
            segment.record.points = candidate;
            placed.push({ low: segment.low, high: segment.high, value: y });
            break;
          }
        });
      }
    }
  }

  function appearance() {
    const value = window.CurriculumManualRouting?.getAppearance?.() || {};
    return {
      cornerStyle: value.cornerStyle === 'rounded' ? 'rounded' : 'sharp',
      radius: clamp(Number(value.radius) || 0, 0, 30),
    };
  }

  function updateInteractionGeometry(records) {
    const byKey = new Map(records.map(record => [record.path.dataset.edgeKey, record]));
    svg.querySelectorAll('.manual-route-hit[data-edge-key]').forEach(hit => {
      if (!(hit instanceof SVGPathElement)) return;
      const record = byKey.get(hit.dataset.edgeKey);
      if (record) hit.setAttribute('d', record.path.getAttribute('d') || record.orthogonal);
    });
    svg.querySelectorAll('.route-bend-handle[data-edge-key][data-point-index]').forEach(handle => {
      if (!(handle instanceof SVGCircleElement)) return;
      const record = byKey.get(handle.dataset.edgeKey);
      const point = record?.points?.[Number(handle.dataset.pointIndex)];
      if (!point) return;
      handle.setAttribute('cx', String(point.x));
      handle.setAttribute('cy', String(point.y));
    });
  }

  function applyFinalGeometry() {
    const paths = [...svg.querySelectorAll('path.relationship')];
    if (!paths.length) return;
    const records = paths.map((path, order) => ({ path, order, points: basePointsForPath(path), orthogonal: '' }))
      .filter(record => isOrthogonal(record.points));
    if (!records.length) return;
    const boxes = liveBoxes();

    // Both settings are post-routing invariants. Manual and automatic relationships
    // participate in the same lane-spacing pass; manual waypoints remain the stored base.
    applyVerticalSpacing(records, boxes);
    applyHorizontalSpacing(records, boxes);

    const currentAppearance = appearance();
    for (const record of records) {
      record.orthogonal = serializeOrthogonal(record.points);
      if (!record.orthogonal) continue;
      record.path.dataset.finalOrthogonalRoute = record.orthogonal;
      const visibleD = currentAppearance.cornerStyle === 'rounded'
        ? roundedArcPath(record.points, currentAppearance.radius)
        : record.orthogonal;
      record.path.setAttribute('d', visibleD);
    }
    updateInteractionGeometry(records);
    window.CurriculumLineVisualPersistence?.apply?.();
  }

  let generation = 0;
  function scheduleFinalGeometry() {
    const token = ++generation;
    const later = depth => {
      if (depth <= 0) {
        if (token === generation) applyFinalGeometry();
        return;
      }
      requestAnimationFrame(() => later(depth - 1));
    };
    // The legacy/manual finaliser uses four RAFs. Six guarantees this is the final writer.
    later(6);
  }

  const baseRenderEdgesForRegressionFix = renderEdges;
  renderEdges = () => {
    baseRenderEdgesForRegressionFix();
    scheduleFinalGeometry();
  };

  const routing = window.CurriculumConnectorRouting;
  if (routing?.applyNow) {
    const previousApplyNow = routing.applyNow.bind(routing);
    routing.applyNow = () => {
      const result = previousApplyNow();
      applyFinalGeometry();
      return result;
    };
  }
  if (routing?.request) {
    const previousRequest = routing.request.bind(routing);
    routing.request = () => {
      const result = previousRequest();
      scheduleFinalGeometry();
      return result;
    };
  }

  if (window.CurriculumManualRouting?.finalise) {
    const previousManualFinalise = window.CurriculumManualRouting.finalise.bind(window.CurriculumManualRouting);
    window.CurriculumManualRouting.finalise = () => {
      const result = previousManualFinalise();
      applyFinalGeometry();
      return result;
    };
  }

  const baseBuildExportSvgForRegressionFix = buildExportSvg;
  buildExportSvg = () => {
    const svgText = baseBuildExportSvgForRegressionFix();
    applyFinalGeometry();
    const livePaths = [...svg.querySelectorAll('path.relationship')].map(path => path.getAttribute('d') || '');
    try {
      const documentXml = new DOMParser().parseFromString(svgText, 'image/svg+xml');
      const exportPaths = [...documentXml.querySelectorAll('path[marker-end]')]
        .filter(path => !path.closest('#export-legend') && !String(path.getAttribute('marker-end')).includes('coreq'));
      exportPaths.forEach((path, index) => {
        if (livePaths[index]) path.setAttribute('d', livePaths[index]);
      });
      return new XMLSerializer().serializeToString(documentXml.documentElement);
    } catch {
      return svgText;
    }
  };

  document.addEventListener('change', event => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    if (!['vertical-lane-spacing', 'horizontal-lane-spacing', 'connector-corner-style', 'connector-corner-radius'].includes(target.id)) return;
    scheduleFinalGeometry();
  }, true);

  const structureObserver = new MutationObserver(mutations => {
    const relationshipChanged = mutations.some(mutation => [...mutation.addedNodes, ...mutation.removedNodes].some(node =>
      node instanceof Element && (node.matches?.('path.relationship') || Boolean(node.querySelector?.('path.relationship')))));
    if (relationshipChanged) scheduleFinalGeometry();
  });
  structureObserver.observe(svg, { childList: true, subtree: true });

  window.CurriculumConnectorGeometry = {
    applyNow: applyFinalGeometry,
    request: scheduleFinalGeometry,
  };

  // Rebuild once so the new global port-spacing rule is reflected immediately.
  renderEdges();
})();
