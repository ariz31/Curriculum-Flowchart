
;(() => {
  const EPS = 0.5;
  const NODE_WIDTH = 184;
  const BASE_NODE_HEIGHT = 78;
  const COMPACT_NODE_HEIGHT = 62;
  const NODE_CLEARANCE = 10;
  const DEFAULT_SPACING = 7;
  const MAX_REPAIR_PASSES = 10;

  const clone = value => JSON.parse(JSON.stringify(value));
  const number = value => Number.parseFloat(String(value ?? '0'));
  const fmt = value => Number(Number(value).toFixed(3)).toString();
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const verticalSpacing = () => clamp(Number(window.CurriculumVerticalLaneSpacing?.get?.()) || DEFAULT_SPACING, 3, 30);
  const horizontalSpacing = () => clamp(Number(window.CurriculumHorizontalLaneSpacing?.get?.()) || DEFAULT_SPACING, 3, 30);

  function parseOrthogonalPath(d) {
    const source = String(d || '').trim();
    if (!source || /[ACQSTLZ]/i.test(source)) return [];
    const commands = [...source.matchAll(/([MHV])\s*(-?[\d.]+)(?:\s+(-?[\d.]+))?/g)];
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

  function simplify(points) {
    const result = [];
    for (const point of points || []) {
      if (!result.length || Math.abs(point.x - result.at(-1).x) > EPS || Math.abs(point.y - result.at(-1).y) > EPS) {
        result.push({ x: point.x, y: point.y });
      }
    }
    for (let index = result.length - 2; index > 0; index -= 1) {
      const a = result[index - 1];
      const b = result[index];
      const c = result[index + 1];
      const vertical = Math.abs(a.x - b.x) < EPS && Math.abs(b.x - c.x) < EPS;
      const horizontal = Math.abs(a.y - b.y) < EPS && Math.abs(b.y - c.y) < EPS;
      if (vertical || horizontal) result.splice(index, 1);
    }
    return result;
  }

  function serializeOrthogonal(points) {
    const normalized = simplify(points);
    if (!isOrthogonal(normalized)) return '';
    let d = `M ${fmt(normalized[0].x)} ${fmt(normalized[0].y)}`;
    for (let index = 1; index < normalized.length; index += 1) {
      const previous = normalized[index - 1];
      const point = normalized[index];
      if (Math.abs(previous.y - point.y) < EPS) d += ` H ${fmt(point.x)}`;
      else if (Math.abs(previous.x - point.x) < EPS) d += ` V ${fmt(point.y)}`;
      else return '';
    }
    return d;
  }

  function roundedArcPath(points, requestedRadius) {
    const normalized = simplify(points);
    if (!isOrthogonal(normalized) || normalized.length < 3 || requestedRadius <= 0) return serializeOrthogonal(normalized);
    let d = `M ${fmt(normalized[0].x)} ${fmt(normalized[0].y)}`;
    for (let index = 1; index < normalized.length - 1; index += 1) {
      const previous = normalized[index - 1];
      const corner = normalized[index];
      const next = normalized[index + 1];
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
      d += ` L ${fmt(before.x)} ${fmt(before.y)} A ${fmt(radius)} ${fmt(radius)} 0 0 ${cross > 0 ? 1 : 0} ${fmt(after.x)} ${fmt(after.y)}`;
    }
    const last = normalized.at(-1);
    d += ` L ${fmt(last.x)} ${fmt(last.y)}`;
    return d;
  }

  function appearance() {
    const value = window.CurriculumManualRouting?.getAppearance?.() || {};
    return {
      cornerStyle: value.cornerStyle === 'rounded' ? 'rounded' : 'sharp',
      radius: clamp(Number(value.radius) || 0, 0, 30),
    };
  }

  function liveBoxes() {
    const flowPanel = document.querySelector('#flow-panel');
    const nodesLayer = document.querySelector('#nodes-layer');
    if (!(nodesLayer instanceof HTMLElement)) return [];
    const height = flowPanel?.classList.contains('hide-node-units') ? COMPACT_NODE_HEIGHT : BASE_NODE_HEIGHT;
    return [...nodesLayer.querySelectorAll('.course-node[data-id]')].map(node => ({
      id: String(node.dataset.id || ''),
      top: number(node.style.top),
      bottom: number(node.style.top) + height,
      left: number(node.style.left),
      right: number(node.style.left) + NODE_WIDTH,
    }));
  }

  function endpointIds(edge, pairs, source) {
    const result = new Set();
    if (source) {
      if (edge?.sourceKind === 'course' && edge.fromId) result.add(String(edge.fromId));
      if (edge?.sourceKind === 'pair' && edge.pairKey) {
        const pair = pairByKey(edge.pairKey, pairs);
        if (pair) { result.add(String(pair.aId)); result.add(String(pair.bId)); }
      }
    } else if (edge?.targetKind === 'pair' && edge.targetPairKey) {
      const pair = pairByKey(edge.targetPairKey, pairs);
      if (pair) { result.add(String(pair.aId)); result.add(String(pair.bId)); }
    } else if (edge?.toId) result.add(String(edge.toId));
    return result;
  }

  function segmentCollisions(points, segmentIndex, boxes, edge, pairs) {
    const a = points[segmentIndex];
    const b = points[segmentIndex + 1];
    if (!a || !b) return [];
    const lastSegment = points.length - 2;
    const sourceIds = segmentIndex === 0 ? endpointIds(edge, pairs, true) : new Set();
    const targetIds = segmentIndex === lastSegment ? endpointIds(edge, pairs, false) : new Set();
    const ignored = new Set([...sourceIds, ...targetIds]);
    const collisions = [];
    for (const box of boxes) {
      if (ignored.has(box.id)) continue;
      if (Math.abs(a.x - b.x) < EPS) {
        const low = Math.min(a.y, b.y);
        const high = Math.max(a.y, b.y);
        if (a.x > box.left - NODE_CLEARANCE && a.x < box.right + NODE_CLEARANCE &&
            low < box.bottom + NODE_CLEARANCE && high > box.top - NODE_CLEARANCE) collisions.push(box);
      } else if (Math.abs(a.y - b.y) < EPS) {
        const low = Math.min(a.x, b.x);
        const high = Math.max(a.x, b.x);
        if (a.y > box.top - NODE_CLEARANCE && a.y < box.bottom + NODE_CLEARANCE &&
            low < box.right + NODE_CLEARANCE && high > box.left - NODE_CLEARANCE) collisions.push(box);
      } else collisions.push(box);
    }
    return collisions;
  }

  function firstCollision(points, boxes, edge, pairs) {
    for (let index = 0; index < points.length - 1; index += 1) {
      const collisions = segmentCollisions(points, index, boxes, edge, pairs);
      if (collisions.length) return { index, collisions };
    }
    return null;
  }

  function routeClear(points, boxes, edge, pairs) {
    return isOrthogonal(points) && !firstCollision(points, boxes, edge, pairs);
  }

  function candidateCoordinates(original, collisions, vertical) {
    const spacing = vertical ? verticalSpacing() : horizontalSpacing();
    const candidates = [];
    for (const box of collisions) {
      if (vertical) {
        candidates.push(box.left - NODE_CLEARANCE - 1, box.right + NODE_CLEARANCE + 1);
      } else {
        candidates.push(Math.max(4, box.top - NODE_CLEARANCE - 1), box.bottom + NODE_CLEARANCE + 1);
      }
    }
    for (let step = 1; step <= 30; step += 1) {
      candidates.push(original - step * spacing, original + step * spacing);
    }
    return [...new Set(candidates.map(value => Number(value.toFixed(3))))]
      .filter(value => Number.isFinite(value) && (!vertical ? value >= 4 : true))
      .sort((a, b) => Math.abs(a - original) - Math.abs(b - original));
  }

  function shiftInteriorSegment(points, segmentIndex, collisions, boxes, edge, pairs) {
    if (segmentIndex <= 0 || segmentIndex >= points.length - 2) return null;
    const a = points[segmentIndex];
    const b = points[segmentIndex + 1];
    const vertical = Math.abs(a.x - b.x) < EPS;
    const horizontal = Math.abs(a.y - b.y) < EPS;
    if (!vertical && !horizontal) return null;
    const original = vertical ? a.x : a.y;
    for (const coordinate of candidateCoordinates(original, collisions, vertical)) {
      const candidate = clone(points);
      if (vertical) {
        candidate[segmentIndex].x = coordinate;
        candidate[segmentIndex + 1].x = coordinate;
      } else {
        candidate[segmentIndex].y = coordinate;
        candidate[segmentIndex + 1].y = coordinate;
      }
      const normalized = simplify(candidate);
      if (routeClear(normalized, boxes, edge, pairs)) return normalized;
    }
    return null;
  }

  function endpointDetour(points, segmentIndex, collisions, boxes, edge, pairs) {
    const lastSegment = points.length - 2;
    if (segmentIndex !== 0 && segmentIndex !== lastSegment) return null;
    const a = points[segmentIndex];
    const b = points[segmentIndex + 1];
    const horizontal = Math.abs(a.y - b.y) < EPS;
    const vertical = Math.abs(a.x - b.x) < EPS;
    if (!horizontal && !vertical) return null;

    if (horizontal) {
      const direction = Math.sign(b.x - a.x) || 1;
      const length = Math.abs(b.x - a.x);
      const stub = Math.min(Math.max(12, verticalSpacing() * 1.5), Math.max(12, length / 3));
      if (length < stub + 4) return null;
      const bypasses = candidateCoordinates(a.y, collisions, false);
      for (const bypassY of bypasses) {
        let candidate;
        if (segmentIndex === 0) {
          const stubX = a.x + direction * stub;
          candidate = [
            { ...a },
            { x: stubX, y: a.y },
            { x: stubX, y: bypassY },
            { x: b.x, y: bypassY },
            { ...b },
            ...clone(points.slice(2)),
          ];
        } else {
          const stubX = b.x - direction * stub;
          candidate = [
            ...clone(points.slice(0, segmentIndex)),
            { ...a },
            { x: stubX, y: a.y },
            { x: stubX, y: bypassY },
            { x: b.x, y: bypassY },
            { ...b },
          ];
        }
        const normalized = simplify(candidate);
        if (routeClear(normalized, boxes, edge, pairs)) return normalized;
      }
    }

    if (vertical) {
      const direction = Math.sign(b.y - a.y) || 1;
      const length = Math.abs(b.y - a.y);
      const stub = Math.min(Math.max(12, horizontalSpacing() * 1.5), Math.max(12, length / 3));
      if (length < stub + 4) return null;
      const bypasses = candidateCoordinates(a.x, collisions, true);
      for (const bypassX of bypasses) {
        let candidate;
        if (segmentIndex === 0) {
          const stubY = a.y + direction * stub;
          candidate = [
            { ...a },
            { x: a.x, y: stubY },
            { x: bypassX, y: stubY },
            { x: bypassX, y: b.y },
            { ...b },
            ...clone(points.slice(2)),
          ];
        } else {
          const stubY = b.y - direction * stub;
          candidate = [
            ...clone(points.slice(0, segmentIndex)),
            { ...a },
            { x: a.x, y: stubY },
            { x: bypassX, y: stubY },
            { x: bypassX, y: b.y },
            { ...b },
          ];
        }
        const normalized = simplify(candidate);
        if (routeClear(normalized, boxes, edge, pairs)) return normalized;
      }
    }
    return null;
  }

  function repairRoute(points, boxes, edge, pairs) {
    let current = simplify(points);
    for (let pass = 0; pass < MAX_REPAIR_PASSES; pass += 1) {
      const collision = firstCollision(current, boxes, edge, pairs);
      if (!collision) return current;
      const shifted = shiftInteriorSegment(current, collision.index, collision.collisions, boxes, edge, pairs);
      if (shifted) { current = shifted; continue; }
      const detoured = endpointDetour(current, collision.index, collision.collisions, boxes, edge, pairs);
      if (detoured) { current = detoured; continue; }
      break;
    }
    return current;
  }

  function basePoints(path) {
    const candidates = [
      path.dataset.finalOrthogonalRoute,
      path.dataset.editRoute,
      path.getAttribute('d'),
      path.getAttribute('data-stable-route-base'),
    ];
    for (const candidate of candidates) {
      const points = parseOrthogonalPath(candidate || '');
      if (isOrthogonal(points)) return points;
    }
    return [];
  }

  function updateInteraction(path, points) {
    const edgeKey = path.dataset.edgeKey;
    if (!edgeKey) return;
    const hit = svg.querySelector(`.manual-route-hit[data-edge-key="${CSS.escape(edgeKey)}"]`);
    if (hit instanceof SVGPathElement) hit.setAttribute('d', path.getAttribute('d') || '');
    svg.querySelectorAll(`.route-bend-handle[data-edge-key="${CSS.escape(edgeKey)}"][data-point-index]`).forEach(handle => {
      if (!(handle instanceof SVGCircleElement)) return;
      const point = points[Number(handle.dataset.pointIndex)];
      if (!point) return;
      handle.setAttribute('cx', String(point.x));
      handle.setAttribute('cy', String(point.y));
    });
  }

  function applyNodeClearance() {
    const paths = [...svg.querySelectorAll('path.relationship')];
    if (!paths.length) return;
    const pairs = corequisitePairs();
    const edges = dependencyEdges(pairs);
    const boxes = liveBoxes();
    const currentAppearance = appearance();

    paths.forEach((path, index) => {
      const edge = edges[index];
      if (!edge) return;
      const points = basePoints(path);
      if (!isOrthogonal(points)) return;
      const repaired = repairRoute(points, boxes, edge, pairs);
      const orthogonal = serializeOrthogonal(repaired);
      if (!orthogonal) return;
      path.dataset.nodeClearanceRoute = orthogonal;
      path.dataset.finalOrthogonalRoute = orthogonal;
      path.setAttribute('d', currentAppearance.cornerStyle === 'rounded'
        ? roundedArcPath(repaired, currentAppearance.radius)
        : orthogonal);
      updateInteraction(path, repaired);
    });

    window.CurriculumLineVisualPersistence?.apply?.();
  }

  let generation = 0;
  function scheduleNodeClearance() {
    const token = ++generation;
    const later = depth => {
      if (depth <= 0) {
        if (token === generation) applyNodeClearance();
        return;
      }
      requestAnimationFrame(() => later(depth - 1));
    };
    // Existing routing/final-geometry layers settle within six RAFs. This pass is the
    // final geometry writer so node-clearance cannot be undone by a later spacing pass.
    later(9);
  }

  const baseRenderEdgesForNodeClearance = renderEdges;
  renderEdges = () => {
    baseRenderEdgesForNodeClearance();
    scheduleNodeClearance();
  };
  if (window.CurriculumFlowchartRuntime) window.CurriculumFlowchartRuntime.renderFlow = () => renderFlow();

  const routing = window.CurriculumConnectorRouting;
  if (routing?.applyNow) {
    const previousApplyNow = routing.applyNow.bind(routing);
    routing.applyNow = () => {
      const result = previousApplyNow();
      scheduleNodeClearance();
      return result;
    };
  }
  if (routing?.request) {
    const previousRequest = routing.request.bind(routing);
    routing.request = () => {
      const result = previousRequest();
      scheduleNodeClearance();
      return result;
    };
  }

  const geometry = window.CurriculumConnectorGeometry;
  if (geometry?.applyNow) {
    const previousApplyNow = geometry.applyNow.bind(geometry);
    geometry.applyNow = () => {
      const result = previousApplyNow();
      applyNodeClearance();
      return result;
    };
  }
  if (geometry?.request) {
    const previousRequest = geometry.request.bind(geometry);
    geometry.request = () => {
      const result = previousRequest();
      scheduleNodeClearance();
      return result;
    };
  }

  if (window.CurriculumManualRouting?.finalise) {
    const previousFinalise = window.CurriculumManualRouting.finalise.bind(window.CurriculumManualRouting);
    window.CurriculumManualRouting.finalise = () => {
      const result = previousFinalise();
      scheduleNodeClearance();
      return result;
    };
  }

  const baseBuildExportSvgForNodeClearance = buildExportSvg;
  buildExportSvg = () => {
    const svgText = baseBuildExportSvgForNodeClearance();
    applyNodeClearance();
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
    scheduleNodeClearance();
  }, true);

  const structureObserver = new MutationObserver(mutations => {
    const relationshipChanged = mutations.some(mutation => [...mutation.addedNodes, ...mutation.removedNodes].some(node =>
      node instanceof Element && (node.matches?.('path.relationship') || Boolean(node.querySelector?.('path.relationship')))));
    if (relationshipChanged) scheduleNodeClearance();
  });
  structureObserver.observe(svg, { childList: true, subtree: true });

  window.CurriculumConnectorNodeClearance = {
    applyNow: applyNodeClearance,
    request: scheduleNodeClearance,
    clearance: NODE_CLEARANCE,
  };

  renderEdges();
  scheduleNodeClearance();
})();
