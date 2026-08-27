
;(() => {
  const EPS = 0.5;
  const DEFAULT_SPACING = 7;
  const NODE_CLEARANCE = 10;
  const SOURCE_FACE_MARGIN = 11;
  const SOURCE_LANE_STUB = 14;

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

  function edgeDirection(edge, pairs, cols) {
    const sourceColumn = edgeSourceColumn(edge, pairs, cols);
    const targetColumn = edgeTargetColumn(edge, cols);
    if (sourceColumn < 0 || targetColumn < 0) return 0;
    return targetColumn >= sourceColumn ? 1 : -1;
  }

  function targetCenterY(edge, pairs) {
    if (edge.targetKind === 'pair' && edge.targetPairKey) {
      const pair = pairByKey(edge.targetPairKey, pairs);
      const geometry = pair ? pairGeometry(pair) : null;
      return geometry?.junctionY ?? 0;
    }
    const position = state.positions[edge.toId];
    return position ? position.y + H / 2 : 0;
  }

  function liveBoxes() {
    const nodesLayer = document.querySelector('#nodes-layer');
    if (!(nodesLayer instanceof HTMLElement)) return [];
    const flowPanel = document.querySelector('#flow-panel');
    const nodeHeight = flowPanel?.classList.contains('hide-node-units') ? 62 : H;
    return [...nodesLayer.querySelectorAll('.course-node[data-id]')].map(node => ({
      id: String(node.dataset.id || ''),
      top: number(node.style.top),
      bottom: number(node.style.top) + nodeHeight,
      left: number(node.style.left),
      right: number(node.style.left) + W,
    }));
  }

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

  function routeClear(points, boxes, edge, pairs) {
    if (!isOrthogonal(points)) return false;
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
          if (a.x > box.left - NODE_CLEARANCE && a.x < box.right + NODE_CLEARANCE &&
              low < box.bottom + NODE_CLEARANCE && high > box.top - NODE_CLEARANCE) return false;
        } else if (Math.abs(a.y - b.y) < EPS) {
          const low = Math.min(a.x, b.x);
          const high = Math.max(a.x, b.x);
          if (a.y > box.top - NODE_CLEARANCE && a.y < box.bottom + NODE_CLEARANCE &&
              low < box.right + NODE_CLEARANCE && high > box.left - NODE_CLEARANCE) return false;
        } else return false;
      }
    }
    return true;
  }

  function pathPoints(path) {
    const candidates = [
      path.dataset.nodeClearanceRoute,
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

  function portAssignments(group, sourcePosition, pairs) {
    const ordered = [...group].sort((a, b) => {
      const delta = targetCenterY(a.edge, pairs) - targetCenterY(b.edge, pairs);
      return Math.abs(delta) > 0.01 ? delta : a.edge.key.localeCompare(b.edge.key);
    });
    if (ordered.length === 1) return new Map([[ordered[0].edge.key, sourcePosition.y + H / 2]]);

    const centerY = sourcePosition.y + H / 2;
    const minY = sourcePosition.y + SOURCE_FACE_MARGIN;
    const maxY = sourcePosition.y + H - SOURCE_FACE_MARGIN;
    const usable = Math.max(0, maxY - minY);
    const step = Math.min(horizontalSpacing(), usable / Math.max(1, ordered.length - 1));
    const span = step * (ordered.length - 1);
    const targets = ordered.map(item => targetCenterY(item.edge, pairs));
    const minTarget = Math.min(...targets);
    const maxTarget = Math.max(...targets);
    const meanTarget = targets.reduce((sum, value) => sum + value, 0) / targets.length;
    let desiredCenter = centerY;
    if (maxTarget < centerY - EPS) desiredCenter = minY + span / 2;
    else if (minTarget > centerY + EPS) desiredCenter = maxY - span / 2;
    else {
      const slack = Math.max(0, usable - span) / 2;
      desiredCenter += clamp((meanTarget - centerY) / Math.max(H * 2, 1), -1, 1) * slack;
    }
    const start = clamp(desiredCenter - span / 2, minY, Math.max(minY, maxY - span));
    return new Map(ordered.map((item, index) => [item.edge.key, start + index * step]));
  }

  function laneOrder(group, sourcePosition, pairs) {
    const sourceCenter = sourcePosition.y + H / 2;
    return [...group].sort((a, b) => {
      const distanceDelta = Math.abs(targetCenterY(b.edge, pairs) - sourceCenter) - Math.abs(targetCenterY(a.edge, pairs) - sourceCenter);
      if (Math.abs(distanceDelta) > 0.01) return distanceDelta;
      const targetDelta = targetCenterY(a.edge, pairs) - targetCenterY(b.edge, pairs);
      return Math.abs(targetDelta) > 0.01 ? targetDelta : a.edge.key.localeCompare(b.edge.key);
    });
  }

  function portOnly(points, portY) {
    const next = clone(points);
    if (next.length < 2) return next;
    const originalY = next[0].y;
    next[0].y = portY;
    if (Math.abs(next[1].y - originalY) < EPS) next[1].y = portY;
    return simplify(next);
  }

  function withFirstLane(points, portY, laneX) {
    const base = portOnly(points, portY);
    if (base.length < 2) return base;
    let firstVerticalIndex = -1;
    for (let index = 0; index < base.length - 1; index += 1) {
      if (Math.abs(base[index].x - base[index + 1].x) < EPS && Math.abs(base[index].y - base[index + 1].y) >= EPS) {
        firstVerticalIndex = index;
        break;
      }
    }

    const source = { ...base[0], y: portY };
    if (firstVerticalIndex >= 1) {
      const verticalEnd = base[firstVerticalIndex + 1];
      const suffix = clone(base.slice(firstVerticalIndex + 2));
      return simplify([
        source,
        { x: laneX, y: portY },
        { x: laneX, y: verticalEnd.y },
        ...suffix,
      ]);
    }

    const target = base.at(-1);
    if (!target) return base;
    return simplify([
      source,
      { x: laneX, y: portY },
      { x: laneX, y: target.y },
      { ...target },
    ]);
  }

  function updatePath(path, points, currentAppearance) {
    const orthogonal = serializeOrthogonal(points);
    if (!orthogonal) return;
    path.dataset.sourceFanoutRoute = orthogonal;
    path.dataset.nodeClearanceRoute = orthogonal;
    path.dataset.finalOrthogonalRoute = orthogonal;
    path.setAttribute('d', currentAppearance.cornerStyle === 'rounded'
      ? roundedArcPath(points, currentAppearance.radius)
      : orthogonal);
  }

  function applySourceFanout() {
    const paths = [...svg.querySelectorAll('path.relationship')];
    if (!paths.length) return;
    const pairs = corequisitePairs();
    const cols = columns();
    const edges = dependencyEdges(pairs);
    const boxes = liveBoxes();
    const currentAppearance = appearance();
    const records = paths.map((path, index) => ({ path, edge: edges[index], points: pathPoints(path) }))
      .filter(record => record.edge && record.edge.sourceKind === 'course' && isOrthogonal(record.points) && !window.CurriculumManualRouting?.hasManualRoute?.(record.edge.key));

    const groups = new Map();
    for (const record of records) {
      const direction = edgeDirection(record.edge, pairs, cols);
      if (!direction) continue;
      const key = `${record.edge.fromId}\u0000${direction}`;
      const list = groups.get(key) || [];
      list.push({ ...record, direction });
      groups.set(key, list);
    }

    for (const group of groups.values()) {
      if (group.length <= 1) continue;
      const sourcePosition = state.positions[group[0].edge.fromId];
      if (!sourcePosition) continue;
      const ports = portAssignments(group, sourcePosition, pairs);
      const nesting = laneOrder(group, sourcePosition, pairs);
      let previousLane = null;

      nesting.forEach((record, rank) => {
        const portY = ports.get(record.edge.key) ?? sourcePosition.y + H / 2;
        const sourceX = record.points[0].x;
        const desiredLane = sourceX + record.direction * (SOURCE_LANE_STUB + rank * verticalSpacing());
        const minimumOrderedLane = previousLane == null
          ? null
          : previousLane + record.direction * verticalSpacing();
        const candidates = [];
        for (let step = 0; step <= 24; step += 1) candidates.push(desiredLane + record.direction * step * verticalSpacing());

        let chosenPoints = null;
        let chosenLane = null;
        for (const laneX of candidates) {
          if (minimumOrderedLane != null) {
            if (record.direction > 0 && laneX < minimumOrderedLane - EPS) continue;
            if (record.direction < 0 && laneX > minimumOrderedLane + EPS) continue;
          }
          const candidate = withFirstLane(record.points, portY, laneX);
          if (!routeClear(candidate, boxes, record.edge, pairs)) continue;
          chosenPoints = candidate;
          chosenLane = laneX;
          break;
        }

        if (!chosenPoints) {
          const candidate = portOnly(record.points, portY);
          if (routeClear(candidate, boxes, record.edge, pairs)) chosenPoints = candidate;
        }
        if (!chosenPoints) return;
        record.points = chosenPoints;
        if (chosenLane != null) previousLane = chosenLane;
        updatePath(record.path, record.points, currentAppearance);
      });
    }

    window.CurriculumLineVisualPersistence?.apply?.();
  }

  let generation = 0;
  function scheduleSourceFanout() {
    const token = ++generation;
    const later = depth => {
      if (depth <= 0) {
        if (token === generation) applySourceFanout();
        return;
      }
      requestAnimationFrame(() => later(depth - 1));
    };
    // Node-clearance settles at nine RAFs; source fanout is the final ordering pass.
    later(12);
  }

  const baseRenderEdgesForSourceFanout = renderEdges;
  renderEdges = () => {
    baseRenderEdgesForSourceFanout();
    scheduleSourceFanout();
  };
  if (window.CurriculumFlowchartRuntime) window.CurriculumFlowchartRuntime.renderFlow = () => renderFlow();

  const nodeClearance = window.CurriculumConnectorNodeClearance;
  if (nodeClearance?.applyNow) {
    const previousApplyNow = nodeClearance.applyNow.bind(nodeClearance);
    nodeClearance.applyNow = () => {
      const result = previousApplyNow();
      scheduleSourceFanout();
      return result;
    };
  }
  if (nodeClearance?.request) {
    const previousRequest = nodeClearance.request.bind(nodeClearance);
    nodeClearance.request = () => {
      const result = previousRequest();
      scheduleSourceFanout();
      return result;
    };
  }

  const baseBuildExportSvgForSourceFanout = buildExportSvg;
  buildExportSvg = () => {
    const svgText = baseBuildExportSvgForSourceFanout();
    applySourceFanout();
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
    scheduleSourceFanout();
  }, true);

  window.CurriculumSourceFanoutStability = {
    applyNow: applySourceFanout,
    request: scheduleSourceFanout,
  };

  renderEdges();
  scheduleSourceFanout();
})();
