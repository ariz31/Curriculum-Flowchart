
;(() => {
  const EPS = 0.5;
  const NODE_WIDTH = 184;
  const BASE_NODE_HEIGHT = 78;
  const COMPACT_NODE_HEIGHT = 62;
  const NODE_CLEARANCE = 10;
  const PORT_MARGIN = 11;
  const PAIR_MARGIN = 8;
  const DEFAULT_SPACING = 7;
  const MAX_SEARCH_STEPS = 60;

  const clone = value => JSON.parse(JSON.stringify(value));
  const number = value => Number.parseFloat(String(value ?? '0'));
  const fmt = value => Number(Number(value).toFixed(3)).toString();
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const verticalSpacing = () => clamp(Number(window.CurriculumVerticalLaneSpacing?.get?.()) || DEFAULT_SPACING, 3, 30);
  const horizontalSpacing = () => clamp(Number(window.CurriculumHorizontalLaneSpacing?.get?.()) || DEFAULT_SPACING, 3, 30);
  const nodeHeight = () => document.querySelector('#flow-panel')?.classList.contains('hide-node-units') ? COMPACT_NODE_HEIGHT : BASE_NODE_HEIGHT;

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
      Math.abs(point.x - points[index - 1].x) < EPS || Math.abs(point.y - points[index - 1].y) < EPS);
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
      if ((Math.abs(a.x - b.x) < EPS && Math.abs(b.x - c.x) < EPS) ||
          (Math.abs(a.y - b.y) < EPS && Math.abs(b.y - c.y) < EPS)) result.splice(index, 1);
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
      top: number(node.style.top),
      bottom: number(node.style.top) + height,
      left: number(node.style.left),
      right: number(node.style.left) + NODE_WIDTH,
    }));
  }

  function edgeDirection(edge, pairs, cols) {
    const sourceColumn = edgeSourceColumn(edge, pairs, cols);
    const targetColumn = edgeTargetColumn(edge, cols);
    if (sourceColumn < 0 || targetColumn < 0) return 0;
    return targetColumn >= sourceColumn ? 1 : -1;
  }

  function sourceSide(nodeId, edge, pairs, cols) {
    const direction = edgeDirection(edge, pairs, cols);
    if (!direction) return null;
    if (edge.sourceKind === 'course' && edge.fromId === nodeId) return direction > 0 ? 'right' : 'left';
    if (edge.toId === nodeId && !(edge.targetKind === 'pair' && edge.targetPairKey)) return direction > 0 ? 'left' : 'right';
    return null;
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

  function counterpartY(nodeId, edge, pairs) {
    if (edge.sourceKind === 'course' && edge.fromId === nodeId) return targetCenterY(edge, pairs);
    if (edge.toId === nodeId) return sourceCenterY(edge, pairs);
    return 0;
  }

  courseIncidentOffset = (nodeId, edge, edges) => {
    const pairs = corequisitePairs();
    const cols = columns();
    const side = sourceSide(nodeId, edge, pairs, cols);
    if (!side) return 0;
    const incident = edges
      .filter(item => {
        if (item.targetKind === 'pair' && item.targetPairKey) return false;
        const attached = (item.sourceKind === 'course' && item.fromId === nodeId) || item.toId === nodeId;
        return attached && sourceSide(nodeId, item, pairs, cols) === side;
      })
      .sort((a, b) => {
        const delta = counterpartY(nodeId, a, pairs) - counterpartY(nodeId, b, pairs);
        return Math.abs(delta) > 0.01 ? delta : a.key.localeCompare(b.key);
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
    const height = nodeHeight();
    const aAbove = a.y <= b.y;
    const upperId = aAbove ? pair.aId : pair.bId;
    const lowerId = aAbove ? pair.bId : pair.aId;
    const upper = state.positions[upperId];
    const lower = state.positions[lowerId];
    const upperBottom = upper.y + height;
    const lowerTop = lower.y;
    return {
      pair,
      upperId,
      lowerId,
      x: upper.x + NODE_WIDTH / 2,
      upperBottom,
      lowerTop,
      junctionY: (upperBottom + lowerTop) / 2,
    };
  };

  pairBranchAnchor = (pair, edge, edges) => {
    const geometry = pairGeometry(pair);
    if (!geometry) return null;
    const pairs = corequisitePairs();
    const cols = columns();
    const direction = edgeDirection(edge, pairs, cols) || 1;
    const branches = edges
      .filter(item => item.sourceKind === 'pair' && item.pairKey === pair.key && (edgeDirection(item, pairs, cols) || 1) === direction)
      .sort((a, b) => {
        const delta = targetCenterY(a, pairs) - targetCenterY(b, pairs);
        return Math.abs(delta) > 0.01 ? delta : a.key.localeCompare(b.key);
      });
    const index = Math.max(0, branches.findIndex(item => item.key === edge.key));
    const low = Math.min(geometry.upperBottom + PAIR_MARGIN, geometry.lowerTop - PAIR_MARGIN);
    const high = Math.max(geometry.upperBottom + PAIR_MARGIN, geometry.lowerTop - PAIR_MARGIN);
    const available = Math.max(0, high - low);
    const step = branches.length > 1 ? Math.min(horizontalSpacing(), available / Math.max(1, branches.length - 1)) : 0;
    const span = step * Math.max(0, branches.length - 1);
    const start = clamp(geometry.junctionY - span / 2, low, Math.max(low, high - span));
    return {
      x: geometry.x + direction * 3.5,
      y: branches.length > 1 ? start + index * step : geometry.junctionY,
    };
  };

  const baseSourceAnchorForEndpointInvariants = sourceAnchor;
  sourceAnchor = (edge, edges, pairs, cols) => {
    if (edge.sourceKind !== 'course') return baseSourceAnchorForEndpointInvariants(edge, edges, pairs, cols);
    const position = state.positions[edge.fromId];
    if (!position) return null;
    const direction = edgeDirection(edge, pairs, cols) || 1;
    return {
      x: direction > 0 ? position.x + NODE_WIDTH : position.x,
      y: position.y + nodeHeight() / 2 + courseIncidentOffset(edge.fromId, edge, edges),
    };
  };

  const baseTargetAnchorForEndpointInvariants = targetAnchor;
  targetAnchor = (edge, edges, pairs, cols) => {
    if (edge.targetKind === 'pair' && edge.targetPairKey) return baseTargetAnchorForEndpointInvariants(edge, edges, pairs, cols);
    const position = state.positions[edge.toId];
    if (!position) return null;
    const direction = edgeDirection(edge, pairs, cols) || 1;
    return {
      x: direction > 0 ? position.x : position.x + NODE_WIDTH,
      y: position.y + nodeHeight() / 2 + courseIncidentOffset(edge.toId, edge, edges),
    };
  };

  function endpointIds(edge, pairs, source) {
    const ids = new Set();
    if (source) {
      if (edge.sourceKind === 'course' && edge.fromId) ids.add(String(edge.fromId));
      if (edge.sourceKind === 'pair' && edge.pairKey) {
        const pair = pairByKey(edge.pairKey, pairs);
        if (pair) { ids.add(String(pair.aId)); ids.add(String(pair.bId)); }
      }
    } else if (edge.targetKind === 'pair' && edge.targetPairKey) {
      const pair = pairByKey(edge.targetPairKey, pairs);
      if (pair) { ids.add(String(pair.aId)); ids.add(String(pair.bId)); }
    } else if (edge.toId) ids.add(String(edge.toId));
    return ids;
  }

  function legalEndpointSides(points, edge, pairs, cols, boxById) {
    if (!isOrthogonal(points) || points.length < 2) return false;
    const direction = edgeDirection(edge, pairs, cols) || 1;

    if (edge.sourceKind === 'course') {
      const sourceBox = boxById.get(String(edge.fromId));
      const second = points[1];
      if (sourceBox) {
        if (Math.abs(points[0].y - second.y) > EPS) return false;
        if (direction > 0 && second.x < sourceBox.right - EPS) return false;
        if (direction < 0 && second.x > sourceBox.left + EPS) return false;
      }
    }

    if (!(edge.targetKind === 'pair' && edge.targetPairKey)) {
      const targetBox = boxById.get(String(edge.toId));
      const previous = points[points.length - 2];
      const last = points.at(-1);
      if (targetBox) {
        if (Math.abs(previous.y - last.y) > EPS) return false;
        if (direction > 0 && previous.x > targetBox.left - EPS) return false;
        if (direction < 0 && previous.x < targetBox.right + EPS) return false;
      }
    }
    return true;
  }

  function pathClear(points, boxes, edge, pairs, cols, boxById) {
    if (!isOrthogonal(points) || !legalEndpointSides(points, edge, pairs, cols, boxById)) return false;
    const lastSegment = points.length - 2;
    for (let index = 0; index < points.length - 1; index += 1) {
      const a = points[index];
      const b = points[index + 1];
      const ignored = new Set([
        ...(index === 0 ? endpointIds(edge, pairs, true) : []),
        ...(index === lastSegment ? endpointIds(edge, pairs, false) : []),
      ]);
      for (const box of boxes) {
        if (ignored.has(box.id)) continue;
        if (Math.abs(a.x - b.x) < EPS) {
          const low = Math.min(a.y, b.y);
          const high = Math.max(a.y, b.y);
          if (a.x > box.left - NODE_CLEARANCE && a.x < box.right + NODE_CLEARANCE && low < box.bottom + NODE_CLEARANCE && high > box.top - NODE_CLEARANCE) return false;
        } else if (Math.abs(a.y - b.y) < EPS) {
          const low = Math.min(a.x, b.x);
          const high = Math.max(a.x, b.x);
          if (a.y > box.top - NODE_CLEARANCE && a.y < box.bottom + NODE_CLEARANCE && low < box.right + NODE_CLEARANCE && high > box.left - NODE_CLEARANCE) return false;
        } else return false;
      }
    }
    return true;
  }

  function pathPoints(path) {
    const candidates = [
      path.getAttribute('d'),
      path.dataset.sourceFanoutRoute,
      path.dataset.nodeClearanceRoute,
      path.dataset.finalOrthogonalRoute,
      path.dataset.editRoute,
      path.getAttribute('data-stable-route-base'),
    ];
    for (const candidate of candidates) {
      const points = parseOrthogonalPath(candidate || '');
      if (isOrthogonal(points)) return points;
    }
    return [];
  }

  function normalizeEndpoint(points, anchor, start) {
    const next = clone(points);
    if (next.length < 2 || !anchor) return next;
    if (start) {
      const old = next[0];
      next[0] = { ...anchor };
      if (Math.abs(old.y - next[1].y) < EPS) next[1].y = anchor.y;
      else if (Math.abs(old.x - next[1].x) < EPS) next[1].x = anchor.x;
    } else {
      const lastIndex = next.length - 1;
      const old = next[lastIndex];
      next[lastIndex] = { ...anchor };
      if (Math.abs(old.y - next[lastIndex - 1].y) < EPS) next[lastIndex - 1].y = anchor.y;
      else if (Math.abs(old.x - next[lastIndex - 1].x) < EPS) next[lastIndex - 1].x = anchor.x;
    }
    return simplify(next);
  }

  function enforceTargetApproach(points, edge, pairs, cols, boxById, target) {
    if (edge.targetKind === 'pair' && edge.targetPairKey) return simplify(points);
    const targetBox = boxById.get(String(edge.toId));
    if (!targetBox || !target) return simplify(points);
    const direction = edgeDirection(edge, pairs, cols) || 1;
    const safeX = direction > 0 ? targetBox.left - NODE_CLEARANCE - 1 : targetBox.right + NODE_CLEARANCE + 1;
    const previous = points[points.length - 2];
    if (previous && Math.abs(previous.y - target.y) < EPS &&
        (direction > 0 ? previous.x <= targetBox.left - EPS : previous.x >= targetBox.right + EPS)) return simplify(points);

    let safeIndex = -1;
    for (let index = points.length - 2; index >= 0; index -= 1) {
      if (direction > 0 ? points[index].x <= safeX + EPS : points[index].x >= safeX - EPS) {
        safeIndex = index;
        break;
      }
    }
    if (safeIndex < 0) safeIndex = 0;
    const result = clone(points.slice(0, safeIndex + 1));
    const cursor = result.at(-1);
    if (Math.abs(cursor.x - safeX) > EPS) result.push({ x: safeX, y: cursor.y });
    if (Math.abs(result.at(-1).y - target.y) > EPS) result.push({ x: safeX, y: target.y });
    result.push({ ...target });
    return simplify(result);
  }

  function splitProjectionComponents(segments) {
    const sorted = [...segments].sort((a, b) => a.low - b.low || a.high - b.high || a.base - b.base || a.record.order - b.record.order || a.index - b.index);
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

  const intervalOverlap = (a, b) => Math.min(a.high, b.high) - Math.max(a.low, b.low) > EPS;

  function coordinateCandidates(base, spacing) {
    const values = [base];
    for (let step = 1; step <= MAX_SEARCH_STEPS; step += 1) values.push(base + step * spacing, base - step * spacing);
    return values;
  }

  function applyVerticalInvariant(records, boxes, pairs, cols, boxById) {
    const spacing = verticalSpacing();
    const segments = [];
    for (const record of records) {
      if (record.manual) continue;
      for (let index = 1; index < record.points.length - 2; index += 1) {
        const a = record.points[index];
        const b = record.points[index + 1];
        if (Math.abs(a.x - b.x) > EPS || Math.abs(a.y - b.y) < EPS) continue;
        segments.push({ record, index, base: a.x, low: Math.min(a.y, b.y), high: Math.max(a.y, b.y) });
      }
    }

    for (const component of splitProjectionComponents(segments)) {
      if (component.length < 2) continue;
      const ordered = [...component].sort((a, b) => a.base - b.base || a.record.order - b.record.order || a.index - b.index);
      const placed = [];
      for (const segment of ordered) {
        const overlapping = placed.filter(other => intervalOverlap(segment, other.segment));
        const minimum = overlapping.length ? Math.max(...overlapping.map(other => other.value + spacing)) : -Infinity;
        let chosen = null;
        for (const x of coordinateCandidates(segment.base, spacing)) {
          if (x < minimum - EPS) continue;
          if (overlapping.some(other => Math.abs(x - other.value) < spacing - EPS)) continue;
          const candidate = clone(segment.record.points);
          candidate[segment.index].x = x;
          candidate[segment.index + 1].x = x;
          const normalized = simplify(candidate);
          if (!pathClear(normalized, boxes, segment.record.edge, pairs, cols, boxById)) continue;
          chosen = { points: normalized, value: x };
          break;
        }
        if (!chosen) continue;
        segment.record.points = chosen.points;
        placed.push({ segment, value: chosen.value });
      }
    }
  }

  function applyHorizontalInvariant(records, boxes, pairs, cols, boxById) {
    const spacing = horizontalSpacing();
    const segments = [];
    for (const record of records) {
      if (record.manual) continue;
      for (let index = 1; index < record.points.length - 2; index += 1) {
        const a = record.points[index];
        const b = record.points[index + 1];
        if (Math.abs(a.y - b.y) > EPS || Math.abs(a.x - b.x) < EPS) continue;
        segments.push({ record, index, base: a.y, low: Math.min(a.x, b.x), high: Math.max(a.x, b.x) });
      }
    }

    for (const component of splitProjectionComponents(segments)) {
      if (component.length < 2) continue;
      const ordered = [...component].sort((a, b) => a.base - b.base || a.record.order - b.record.order || a.index - b.index);
      const placed = [];
      for (const segment of ordered) {
        const overlapping = placed.filter(other => intervalOverlap(segment, other.segment));
        const minimum = overlapping.length ? Math.max(...overlapping.map(other => other.value + spacing)) : -Infinity;
        let chosen = null;
        for (const y of coordinateCandidates(segment.base, spacing)) {
          if (y < 4 || y < minimum - EPS) continue;
          if (overlapping.some(other => Math.abs(y - other.value) < spacing - EPS)) continue;
          const candidate = clone(segment.record.points);
          candidate[segment.index].y = y;
          candidate[segment.index + 1].y = y;
          const normalized = simplify(candidate);
          if (!pathClear(normalized, boxes, segment.record.edge, pairs, cols, boxById)) continue;
          chosen = { points: normalized, value: y };
          break;
        }
        if (!chosen) continue;
        segment.record.points = chosen.points;
        placed.push({ segment, value: chosen.value });
      }
    }
  }

  function updateInteraction(path) {
    const edgeKey = path.dataset.edgeKey;
    if (!edgeKey) return;
    const hit = svg.querySelector(`.manual-route-hit[data-edge-key="${CSS.escape(edgeKey)}"]`);
    if (hit instanceof SVGPathElement) hit.setAttribute('d', path.getAttribute('d') || '');
  }

  function applyEndpointInvariants() {
    const paths = [...svg.querySelectorAll('path.relationship')];
    if (!paths.length) return;
    const pairs = corequisitePairs();
    const cols = columns();
    const edges = dependencyEdges(pairs);
    const boxes = liveBoxes();
    const boxById = new Map(boxes.map(box => [box.id, box]));
    const currentAppearance = appearance();

    const records = paths.map((path, order) => {
      const edge = edges[order];
      if (!edge) return null;
      let points = pathPoints(path);
      if (!isOrthogonal(points)) return null;
      const source = sourceAnchor(edge, edges, pairs, cols);
      const target = targetAnchor(edge, edges, pairs, cols);
      points = normalizeEndpoint(points, source, true);
      points = normalizeEndpoint(points, target, false);
      points = enforceTargetApproach(points, edge, pairs, cols, boxById, target);
      return {
        path,
        order,
        edge,
        points,
        manual: Boolean(window.CurriculumManualRouting?.hasManualRoute?.(edge.key)),
      };
    }).filter(Boolean);

    applyVerticalInvariant(records, boxes, pairs, cols, boxById);
    applyHorizontalInvariant(records, boxes, pairs, cols, boxById);

    for (const record of records) {
      const source = sourceAnchor(record.edge, edges, pairs, cols);
      const target = targetAnchor(record.edge, edges, pairs, cols);
      record.points = normalizeEndpoint(record.points, source, true);
      record.points = normalizeEndpoint(record.points, target, false);
      record.points = enforceTargetApproach(record.points, record.edge, pairs, cols, boxById, target);
      const orthogonal = serializeOrthogonal(record.points);
      if (!orthogonal) continue;
      record.path.dataset.endpointInvariantRoute = orthogonal;
      record.path.dataset.nodeClearanceRoute = orthogonal;
      record.path.dataset.finalOrthogonalRoute = orthogonal;
      record.path.setAttribute('d', currentAppearance.cornerStyle === 'rounded'
        ? roundedArcPath(record.points, currentAppearance.radius)
        : orthogonal);
      updateInteraction(record.path);
    }
    window.CurriculumLineVisualPersistence?.apply?.();
  }

  let generation = 0;
  function scheduleEndpointInvariants() {
    const token = ++generation;
    const later = depth => {
      if (depth <= 0) {
        if (token === generation) applyEndpointInvariants();
        return;
      }
      requestAnimationFrame(() => later(depth - 1));
    };
    // Source fanout settles at 12 RAFs. This is the single final endpoint/spacing writer.
    later(14);
  }

  const baseRenderEdgesForEndpointInvariants = renderEdges;
  renderEdges = () => {
    baseRenderEdgesForEndpointInvariants();
    // Keep spacing visibly stable while dragging, then re-assert after all async routers settle.
    applyEndpointInvariants();
    scheduleEndpointInvariants();
  };
  if (window.CurriculumFlowchartRuntime) window.CurriculumFlowchartRuntime.renderFlow = () => renderFlow();

  const baseBuildExportSvgForEndpointInvariants = buildExportSvg;
  buildExportSvg = () => {
    const svgText = baseBuildExportSvgForEndpointInvariants();
    applyEndpointInvariants();
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
    if (!['vertical-lane-spacing', 'horizontal-lane-spacing', 'connector-corner-style', 'connector-corner-radius', 'display-units-toggle'].includes(target.id)) return;
    renderEdges();
  }, true);

  const observer = new MutationObserver(mutations => {
    const structureChanged = mutations.some(mutation => [...mutation.addedNodes, ...mutation.removedNodes].some(node =>
      node instanceof Element && (node.matches?.('path.relationship') || Boolean(node.querySelector?.('path.relationship')))));
    if (structureChanged) scheduleEndpointInvariants();
  });
  observer.observe(svg, { childList: true, subtree: true });

  window.CurriculumConnectorInvariants = {
    applyNow: applyEndpointInvariants,
    request: scheduleEndpointInvariants,
    nodeHeight,
  };

  // Rebuild once so all anchors immediately use the rendered node geometry.
  renderEdges();
})();
