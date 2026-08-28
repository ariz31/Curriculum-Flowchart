
;(() => {
  const EPS = 0.5;
  const NODE_WIDTH = 184;
  const BASE_NODE_HEIGHT = 78;
  const COMPACT_NODE_HEIGHT = 62;
  const MIN_NODE_GAP = 24;
  const COREQ_NODE_GAP = 34;
  const NODE_CLEARANCE = 12;
  const DEFAULT_LANE_SPACING = 7;
  const MAX_REPAIR_PASSES = 12;
  const FINAL_RAF_DEPTH = 18;

  const clone = value => JSON.parse(JSON.stringify(value));
  const number = value => Number.parseFloat(String(value ?? '0'));
  const fmt = value => Number(Number(value).toFixed(3)).toString();
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const nodeHeight = () => document.querySelector('#flow-panel')?.classList.contains('hide-node-units')
    ? COMPACT_NODE_HEIGHT
    : BASE_NODE_HEIGHT;
  const verticalLaneSpacing = () => clamp(Number(window.CurriculumVerticalLaneSpacing?.get?.()) || DEFAULT_LANE_SPACING, 3, 30);
  const horizontalLaneSpacing = () => clamp(Number(window.CurriculumHorizontalLaneSpacing?.get?.()) || DEFAULT_LANE_SPACING, 3, 30);

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

  function routeLength(points) {
    let total = 0;
    for (let index = 1; index < points.length; index += 1) {
      total += Math.abs(points[index].x - points[index - 1].x) + Math.abs(points[index].y - points[index - 1].y);
    }
    return total;
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
      const before = { x: corner.x - inDx / incoming * radius, y: corner.y - inDy / incoming * radius };
      const after = { x: corner.x + outDx / outgoing * radius, y: corner.y + outDy / outgoing * radius };
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
    const nodesLayer = document.querySelector('#nodes-layer');
    if (!(nodesLayer instanceof HTMLElement)) return [];
    const height = nodeHeight();
    return [...nodesLayer.querySelectorAll('.course-node[data-id]')].map(node => ({
      id: String(node.dataset.id || ''),
      left: number(node.style.left),
      right: number(node.style.left) + NODE_WIDTH,
      top: number(node.style.top),
      bottom: number(node.style.top) + height,
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
    const ignored = new Set([
      ...(segmentIndex === 0 ? endpointIds(edge, pairs, true) : []),
      ...(segmentIndex === lastSegment ? endpointIds(edge, pairs, false) : []),
    ]);
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
      } else return boxes;
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
    const spacing = vertical ? verticalLaneSpacing() : horizontalLaneSpacing();
    const values = [];
    for (const box of collisions) {
      if (vertical) values.push(box.left - NODE_CLEARANCE - 1, box.right + NODE_CLEARANCE + 1);
      else values.push(Math.max(4, box.top - NODE_CLEARANCE - 1), box.bottom + NODE_CLEARANCE + 1);
    }
    for (let step = 1; step <= 24; step += 1) values.push(original - step * spacing, original + step * spacing);
    return [...new Set(values.map(value => Number(value.toFixed(3))))]
      .filter(value => Number.isFinite(value) && (vertical || value >= 4))
      .sort((a, b) => Math.abs(a - original) - Math.abs(b - original));
  }

  function bestClear(candidates, boxes, edge, pairs, originalLength) {
    let best = null;
    let bestScore = Infinity;
    for (const candidate of candidates) {
      const normalized = simplify(candidate);
      if (!routeClear(normalized, boxes, edge, pairs)) continue;
      const score = routeLength(normalized) + Math.max(0, routeLength(normalized) - originalLength) * 0.35;
      if (score < bestScore) {
        best = normalized;
        bestScore = score;
      }
    }
    return best;
  }

  function shiftInteriorSegment(points, segmentIndex, collisions, boxes, edge, pairs) {
    if (segmentIndex <= 0 || segmentIndex >= points.length - 2) return null;
    const a = points[segmentIndex];
    const b = points[segmentIndex + 1];
    const vertical = Math.abs(a.x - b.x) < EPS;
    const horizontal = Math.abs(a.y - b.y) < EPS;
    if (!vertical && !horizontal) return null;
    const original = vertical ? a.x : a.y;
    const candidates = candidateCoordinates(original, collisions, vertical).map(coordinate => {
      const candidate = clone(points);
      if (vertical) {
        candidate[segmentIndex].x = coordinate;
        candidate[segmentIndex + 1].x = coordinate;
      } else {
        candidate[segmentIndex].y = coordinate;
        candidate[segmentIndex + 1].y = coordinate;
      }
      return candidate;
    });
    return bestClear(candidates, boxes, edge, pairs, routeLength(points));
  }

  function endpointDetour(points, segmentIndex, collisions, boxes, edge, pairs) {
    const lastSegment = points.length - 2;
    if (segmentIndex !== 0 && segmentIndex !== lastSegment) return null;
    const a = points[segmentIndex];
    const b = points[segmentIndex + 1];
    const horizontal = Math.abs(a.y - b.y) < EPS;
    const vertical = Math.abs(a.x - b.x) < EPS;
    if (!horizontal && !vertical) return null;
    const candidates = [];

    if (horizontal) {
      const direction = Math.sign(b.x - a.x) || 1;
      const length = Math.abs(b.x - a.x);
      const stub = Math.min(Math.max(12, verticalLaneSpacing() * 1.5), Math.max(12, length / 3));
      if (length >= stub + 4) {
        for (const bypassY of candidateCoordinates(a.y, collisions, false)) {
          if (segmentIndex === 0) {
            const stubX = a.x + direction * stub;
            candidates.push([{ ...a }, { x: stubX, y: a.y }, { x: stubX, y: bypassY }, { x: b.x, y: bypassY }, { ...b }, ...clone(points.slice(2))]);
          } else {
            const stubX = b.x - direction * stub;
            candidates.push([...clone(points.slice(0, segmentIndex)), { ...a }, { x: stubX, y: a.y }, { x: stubX, y: bypassY }, { x: b.x, y: bypassY }, { ...b }]);
          }
        }
      }
    } else {
      const direction = Math.sign(b.y - a.y) || 1;
      const length = Math.abs(b.y - a.y);
      const stub = Math.min(Math.max(12, horizontalLaneSpacing() * 1.5), Math.max(12, length / 3));
      if (length >= stub + 4) {
        for (const bypassX of candidateCoordinates(a.x, collisions, true)) {
          if (segmentIndex === 0) {
            const stubY = a.y + direction * stub;
            candidates.push([{ ...a }, { x: a.x, y: stubY }, { x: bypassX, y: stubY }, { x: bypassX, y: b.y }, { ...b }, ...clone(points.slice(2))]);
          } else {
            const stubY = b.y - direction * stub;
            candidates.push([...clone(points.slice(0, segmentIndex)), { ...a }, { x: a.x, y: stubY }, { x: bypassX, y: stubY }, { x: bypassX, y: b.y }, { ...b }]);
          }
        }
      }
    }
    return bestClear(candidates, boxes, edge, pairs, routeLength(points));
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
      path.dataset.semanticInvariantRoute,
      path.dataset.endpointInvariantRoute,
      path.dataset.finalOrthogonalRoute,
      path.dataset.nodeClearanceRoute,
      path.dataset.sourceFanoutRoute,
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

  function applyFinalRouteClearance() {
    const connections = document.querySelector('#connections-svg');
    if (!(connections instanceof SVGSVGElement)) return;
    const paths = [...connections.querySelectorAll('path.relationship')];
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
      path.dataset.finalLayoutClearanceRoute = orthogonal;
      path.dataset.nodeClearanceRoute = orthogonal;
      path.dataset.finalOrthogonalRoute = orthogonal;
      path.dataset.endpointInvariantRoute = orthogonal;
      path.dataset.semanticInvariantRoute = orthogonal;
      path.setAttribute('d', currentAppearance.cornerStyle === 'rounded'
        ? roundedArcPath(repaired, currentAppearance.radius)
        : orthogonal);
      const edgeKey = path.dataset.edgeKey;
      if (edgeKey) {
        const hit = connections.querySelector(`.manual-route-hit[data-edge-key="${CSS.escape(edgeKey)}"]`);
        if (hit instanceof SVGPathElement) hit.setAttribute('d', path.getAttribute('d') || '');
      }
    });
    window.CurriculumLineVisualPersistence?.apply?.();
  }

  let clearanceGeneration = 0;
  function scheduleFinalRouteClearance() {
    const token = ++clearanceGeneration;
    const later = depth => {
      if (depth <= 0) {
        if (token === clearanceGeneration) applyFinalRouteClearance();
        return;
      }
      requestAnimationFrame(() => later(depth - 1));
    };
    later(FINAL_RAF_DEPTH);
  }

  let rendering = false;
  const baseRenderFlowForClearance = renderFlow;
  renderFlow = () => {
    if (rendering) return baseRenderFlowForClearance();
    rendering = true;
    const moved = normalizeNodePositions();
    const result = baseRenderFlowForClearance();
    rendering = false;
    if (moved && typeof save === 'function') save();
    applyFinalRouteClearance();
    scheduleFinalRouteClearance();
    return result;
  };

  const baseRenderEdgesForFinalClearance = renderEdges;
  renderEdges = () => {
    baseRenderEdgesForFinalClearance();
    applyFinalRouteClearance();
    scheduleFinalRouteClearance();
  };

  if (window.CurriculumFlowchartRuntime) window.CurriculumFlowchartRuntime.renderFlow = () => renderFlow();

  const baseBuildExportSvgForFinalClearance = buildExportSvg;
  buildExportSvg = () => {
    const svgText = baseBuildExportSvgForFinalClearance();
    applyFinalRouteClearance();
    const livePaths = [...document.querySelectorAll('#connections-svg path.relationship')].map(path => path.getAttribute('d') || '');
    try {
      const documentXml = new DOMParser().parseFromString(svgText, 'image/svg+xml');
      const exportPaths = [...documentXml.querySelectorAll('path[marker-end*="export-arrow"]')]
        .filter(path => !path.closest('#export-legend'));
      exportPaths.forEach((path, index) => {
        if (livePaths[index]) path.setAttribute('d', livePaths[index]);
      });
      return new XMLSerializer().serializeToString(documentXml.documentElement);
    } catch {
      return svgText;
    }
  };

  window.CurriculumFinalLayoutClearance = {
    normalizeNodes: () => {
      const changed = normalizeNodePositions();
      if (changed) renderFlow();
      return changed;
    },
    applyRoutes: applyFinalRouteClearance,
    requestRoutes: scheduleFinalRouteClearance,
    minNodeGap: MIN_NODE_GAP,
    nodeClearance: NODE_CLEARANCE,
  };

  if (normalizeNodePositions()) {
    if (typeof save === 'function') save();
    renderFlow();
  } else {
    applyFinalRouteClearance();
    scheduleFinalRouteClearance();
  }
})();
