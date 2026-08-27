
;(() => {
  const EPS = 0.5;
  const NODE_WIDTH = 184;
  const NODE_CLEARANCE = 10;
  const PORT_MARGIN = 11;
  const PAIR_MARGIN = 8;
  const COREQ_HALF_GAP = 5;
  const COREQ_STROKE = '#d92d20';
  const DEFAULT_SPACING = 7;
  const SOURCE_LANE_STUB = 14;

  const clone = value => JSON.parse(JSON.stringify(value));
  const number = value => Number.parseFloat(String(value ?? '0'));
  const fmt = value => Number(Number(value).toFixed(3)).toString();
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const nodeHeight = () => Number(window.CurriculumConnectorInvariants?.nodeHeight?.()) ||
    (document.querySelector('#flow-panel')?.classList.contains('hide-node-units') ? 62 : 78);
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

  function edgeDirection(edge, pairs, cols) {
    const sourceColumn = edgeSourceColumn(edge, pairs, cols);
    const targetColumn = edgeTargetColumn(edge, cols);
    if (sourceColumn < 0 || targetColumn < 0) return 0;
    return targetColumn >= sourceColumn ? 1 : -1;
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

  function sourceSide(nodeId, edge, pairs, cols) {
    const direction = edgeDirection(edge, pairs, cols);
    if (!direction) return null;
    if (edge.sourceKind === 'course' && edge.fromId === nodeId) return direction > 0 ? 'right' : 'left';
    if (edge.toId === nodeId && !(edge.targetKind === 'pair' && edge.targetPairKey)) return direction > 0 ? 'left' : 'right';
    return null;
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
        const asSource = item.sourceKind === 'course' && item.fromId === nodeId;
        const asTarget = item.toId === nodeId && !(item.targetKind === 'pair' && item.targetPairKey);
        return (asSource || asTarget) && sourceSide(nodeId, item, pairs, cols) === side;
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
    const usable = Math.max(0, high - low);
    const step = branches.length > 1 ? Math.min(horizontalSpacing(), usable / Math.max(1, branches.length - 1)) : 0;
    const span = step * Math.max(0, branches.length - 1);
    const start = clamp(geometry.junctionY - span / 2, low, Math.max(low, high - span));
    return {
      x: geometry.x + direction * COREQ_HALF_GAP,
      y: branches.length > 1 ? start + index * step : geometry.junctionY,
    };
  };

  sourceAnchor = (edge, edges, pairs, cols) => {
    if (edge.sourceKind !== 'course') {
      const pair = pairByKey(edge.pairKey, pairs);
      return pair ? pairBranchAnchor(pair, edge, edges) : null;
    }
    const position = state.positions[edge.fromId];
    if (!position) return null;
    const direction = edgeDirection(edge, pairs, cols) || 1;
    return {
      x: direction > 0 ? position.x + NODE_WIDTH : position.x,
      y: position.y + nodeHeight() / 2 + courseIncidentOffset(edge.fromId, edge, edges),
    };
  };

  targetAnchor = (edge, edges, pairs, cols) => {
    const direction = edgeDirection(edge, pairs, cols) || 1;
    if (edge.targetKind === 'pair' && edge.targetPairKey) {
      const pair = pairByKey(edge.targetPairKey, pairs);
      const geometry = pair ? pairGeometry(pair) : null;
      if (!pair || !geometry) return null;
      const incoming = edges
        .filter(item => item.targetKind === 'pair' && item.targetPairKey === pair.key && (edgeDirection(item, pairs, cols) || 1) === direction)
        .sort((a, b) => {
          const delta = sourceCenterY(a, pairs) - sourceCenterY(b, pairs);
          return Math.abs(delta) > 0.01 ? delta : a.key.localeCompare(b.key);
        });
      const index = Math.max(0, incoming.findIndex(item => item.key === edge.key));
      const low = Math.min(geometry.upperBottom + PAIR_MARGIN, geometry.lowerTop - PAIR_MARGIN);
      const high = Math.max(geometry.upperBottom + PAIR_MARGIN, geometry.lowerTop - PAIR_MARGIN);
      const usable = Math.max(0, high - low);
      const step = incoming.length > 1 ? Math.min(horizontalSpacing(), usable / Math.max(1, incoming.length - 1)) : 0;
      const span = step * Math.max(0, incoming.length - 1);
      const start = clamp(geometry.junctionY - span / 2, low, Math.max(low, high - span));
      return {
        x: geometry.x + (direction > 0 ? -COREQ_HALF_GAP : COREQ_HALF_GAP),
        y: incoming.length > 1 ? start + index * step : geometry.junctionY,
      };
    }
    const position = state.positions[edge.toId];
    if (!position) return null;
    return {
      x: direction > 0 ? position.x : position.x + NODE_WIDTH,
      y: position.y + nodeHeight() / 2 + courseIncidentOffset(edge.toId, edge, edges),
    };
  };

  corequisiteMarkup = (pair, exportMode = false) => {
    const geometry = pairGeometry(pair);
    if (!geometry) return '';
    const xLeft = geometry.x - COREQ_HALF_GAP;
    const xRight = geometry.x + COREQ_HALF_GAP;
    const className = exportMode ? '' : ' class="corequisite-line"';
    const stroke = exportMode ? ` stroke="${COREQ_STROKE}" stroke-width="1.8"` : '';
    return `<path d="M ${xLeft} ${geometry.upperBottom} V ${geometry.lowerTop}"${className}${stroke}/>` +
      `<path d="M ${xRight} ${geometry.lowerTop} V ${geometry.upperBottom}"${className}${stroke}/>`;
  };

  if (!document.querySelector('#corequisite-semantic-style')) {
    const style = document.createElement('style');
    style.id = 'corequisite-semantic-style';
    style.textContent = `.corequisite-line{stroke:${COREQ_STROKE}!important}.coreq-arrowhead-shape{display:none!important}`;
    document.head.append(style);
  }

  function pathPoints(path) {
    const candidates = [
      path.getAttribute('d'),
      path.dataset.endpointInvariantRoute,
      path.dataset.finalOrthogonalRoute,
      path.dataset.nodeClearanceRoute,
      path.dataset.semanticInvariantRoute,
      path.dataset.sourceFanoutRoute,
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
    if (!anchor || next.length < 2) return next;
    if (start) {
      const previous = next[0];
      next[0] = { ...anchor };
      if (Math.abs(previous.y - next[1].y) < EPS) next[1].y = anchor.y;
      else if (Math.abs(previous.x - next[1].x) < EPS) next[1].x = anchor.x;
    } else {
      const lastIndex = next.length - 1;
      const previous = next[lastIndex];
      next[lastIndex] = { ...anchor };
      if (Math.abs(previous.y - next[lastIndex - 1].y) < EPS) next[lastIndex - 1].y = anchor.y;
      else if (Math.abs(previous.x - next[lastIndex - 1].x) < EPS) next[lastIndex - 1].x = anchor.x;
    }
    return simplify(next);
  }

  function firstLane(points, source, laneX) {
    const base = normalizeEndpoint(points, source, true);
    if (base.length < 2) return base;
    let firstVerticalIndex = -1;
    for (let index = 1; index < base.length - 1; index += 1) {
      if (Math.abs(base[index].x - base[index + 1].x) < EPS && Math.abs(base[index].y - base[index + 1].y) >= EPS) {
        firstVerticalIndex = index;
        break;
      }
    }
    if (firstVerticalIndex >= 1) {
      const verticalEnd = base[firstVerticalIndex + 1];
      const suffix = clone(base.slice(firstVerticalIndex + 2));
      return simplify([
        { ...source },
        { x: laneX, y: source.y },
        { x: laneX, y: verticalEnd.y },
        ...suffix,
      ]);
    }
    const target = base.at(-1);
    if (!target) return base;
    return simplify([
      { ...source },
      { x: laneX, y: source.y },
      { x: laneX, y: target.y },
      { ...target },
    ]);
  }

  function enforceBalancedSourceLanes(records, edges, pairs, cols) {
    const groups = new Map();
    for (const record of records) {
      if (record.manual || record.edge.sourceKind !== 'course') continue;
      const direction = edgeDirection(record.edge, pairs, cols);
      if (!direction) continue;
      const key = `${record.edge.fromId}\u0000${direction}`;
      const list = groups.get(key) || [];
      list.push({ record, direction });
      groups.set(key, list);
    }

    for (const group of groups.values()) {
      if (group.length <= 1) continue;
      const orderedPorts = [...group].sort((a, b) => {
        const delta = targetCenterY(a.record.edge, pairs) - targetCenterY(b.record.edge, pairs);
        return Math.abs(delta) > 0.01 ? delta : a.record.edge.key.localeCompare(b.record.edge.key);
      });
      const centerY = sourceCenterY(orderedPorts[0].record.edge, pairs);
      const nesting = [...group].sort((a, b) => {
        const distance = Math.abs(targetCenterY(b.record.edge, pairs) - centerY) - Math.abs(targetCenterY(a.record.edge, pairs) - centerY);
        if (Math.abs(distance) > 0.01) return distance;
        const delta = targetCenterY(a.record.edge, pairs) - targetCenterY(b.record.edge, pairs);
        return Math.abs(delta) > 0.01 ? delta : a.record.edge.key.localeCompare(b.record.edge.key);
      });
      const laneRank = new Map(nesting.map((item, index) => [item.record.edge.key, index]));

      for (const item of orderedPorts) {
        const record = item.record;
        const source = sourceAnchor(record.edge, edges, pairs, cols);
        if (!source) continue;
        const rank = laneRank.get(record.edge.key) ?? 0;
        const laneX = source.x + item.direction * (SOURCE_LANE_STUB + rank * verticalSpacing());
        const next = firstLane(record.points, source, laneX);
        if (isOrthogonal(next)) record.points = next;
      }
    }
  }

  function enforceFrontPairTarget(points, edge, pairs, cols, target) {
    if (!(edge.targetKind === 'pair' && edge.targetPairKey) || !target || !isOrthogonal(points)) return simplify(points);
    const direction = edgeDirection(edge, pairs, cols) || 1;
    const safeX = target.x - direction * (NODE_CLEARANCE + 1);
    const previous = points[points.length - 2];
    if (previous && Math.abs(previous.y - target.y) < EPS &&
        (direction > 0 ? previous.x <= target.x + EPS : previous.x >= target.x - EPS)) return simplify(points);

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

  function updatePath(record, currentAppearance) {
    const orthogonal = serializeOrthogonal(record.points);
    if (!orthogonal) return;
    record.path.dataset.semanticInvariantRoute = orthogonal;
    record.path.dataset.sourceFanoutRoute = orthogonal;
    record.path.dataset.nodeClearanceRoute = orthogonal;
    record.path.dataset.finalOrthogonalRoute = orthogonal;
    record.path.dataset.endpointInvariantRoute = orthogonal;
    record.path.setAttribute('d', currentAppearance.cornerStyle === 'rounded'
      ? roundedArcPath(record.points, currentAppearance.radius)
      : orthogonal);
    const edgeKey = record.path.dataset.edgeKey;
    if (edgeKey) {
      const hit = svg.querySelector(`.manual-route-hit[data-edge-key="${CSS.escape(edgeKey)}"]`);
      if (hit instanceof SVGPathElement) hit.setAttribute('d', record.path.getAttribute('d') || '');
    }
  }

  function applySemanticInvariants() {
    window.CurriculumConnectorInvariants?.applyNow?.();

    const paths = [...svg.querySelectorAll('path.relationship')];
    if (!paths.length) return;
    const pairs = corequisitePairs();
    const cols = columns();
    const edges = dependencyEdges(pairs);
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
      return {
        path,
        order,
        edge,
        points,
        manual: Boolean(window.CurriculumManualRouting?.hasManualRoute?.(edge.key)),
      };
    }).filter(Boolean);

    enforceBalancedSourceLanes(records, edges, pairs, cols);
    for (const record of records) updatePath(record, { cornerStyle: 'sharp', radius: 0 });

    window.CurriculumConnectorInvariants?.applyNow?.();
    for (const record of records) {
      let points = pathPoints(record.path);
      if (!isOrthogonal(points)) points = record.points;
      const source = sourceAnchor(record.edge, edges, pairs, cols);
      const target = targetAnchor(record.edge, edges, pairs, cols);
      points = normalizeEndpoint(points, source, true);
      points = normalizeEndpoint(points, target, false);
      points = enforceFrontPairTarget(points, record.edge, pairs, cols, target);
      record.points = points;
      updatePath(record, currentAppearance);
    }
    window.CurriculumLineVisualPersistence?.apply?.();
  }

  let generation = 0;
  function scheduleSemanticInvariants() {
    const token = ++generation;
    const later = depth => {
      if (depth <= 0) {
        if (token === generation) applySemanticInvariants();
        return;
      }
      requestAnimationFrame(() => later(depth - 1));
    };
    later(16);
  }

  const baseRenderEdgesForSemanticInvariants = renderEdges;
  renderEdges = () => {
    baseRenderEdgesForSemanticInvariants();
    applySemanticInvariants();
    scheduleSemanticInvariants();
  };
  if (window.CurriculumFlowchartRuntime) window.CurriculumFlowchartRuntime.renderFlow = () => renderFlow();

  const baseBuildExportSvgForSemanticInvariants = buildExportSvg;
  buildExportSvg = () => {
    const svgText = baseBuildExportSvgForSemanticInvariants();
    applySemanticInvariants();
    const livePaths = [...svg.querySelectorAll('path.relationship')].map(path => path.getAttribute('d') || '');
    try {
      const documentXml = new DOMParser().parseFromString(svgText, 'image/svg+xml');
      const exportPaths = [...documentXml.querySelectorAll('path[marker-end*="export-arrow"]')]
        .filter(path => !path.closest('#export-legend'));
      exportPaths.forEach((path, index) => {
        if (livePaths[index]) path.setAttribute('d', livePaths[index]);
      });
      documentXml.querySelectorAll('path[marker-end*="coreq"]').forEach(path => path.removeAttribute('marker-end'));
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

  window.CurriculumConnectorSemanticInvariants = {
    applyNow: applySemanticInvariants,
    request: scheduleSemanticInvariants,
  };

  renderEdges();
})();
