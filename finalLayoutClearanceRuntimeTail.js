
;(() => {
  const EPS = 0.5;
  const FALLBACK_NODE_WIDTH = 184;
  const BASE_NODE_HEIGHT = 78;
  const COMPACT_NODE_HEIGHT = 62;
  const BASE_NODE_GAP = 24;
  const COREQ_NODE_GAP = 34;
  const NODE_CLEARANCE = 9;
  const COREQ_CLEARANCE = 4.5;
  const DEFAULT_LANE_SPACING = 7;
  const MAX_TURNS = 4;
  const MAX_LANE_STEPS = 4;
  const MIN_ENDPOINT_STUB = 12;
  const BEND_PENALTY = 14;
  const PARALLEL_PENALTY = 80;
  const FINAL_RAF_DEPTH = 22;

  const clone = value => JSON.parse(JSON.stringify(value));
  const number = value => Number.parseFloat(String(value ?? '0'));
  const fmt = value => Number(Number(value).toFixed(3)).toString();
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const verticalLaneSpacing = () =>
    clamp(Number(window.CurriculumVerticalLaneSpacing?.get?.()) || DEFAULT_LANE_SPACING, 3, 30);
  const horizontalLaneSpacing = () =>
    clamp(Number(window.CurriculumHorizontalLaneSpacing?.get?.()) || DEFAULT_LANE_SPACING, 3, 30);
  const fallbackNodeHeight = () =>
    document.querySelector('#flow-panel')?.classList.contains('hide-node-units')
      ? COMPACT_NODE_HEIGHT
      : BASE_NODE_HEIGHT;

  const adaptiveNodeGap = () =>
    Math.max(BASE_NODE_GAP, NODE_CLEARANCE * 2 + horizontalLaneSpacing() + 6);

  function pairKey(a, b) {
    return [String(a || ''), String(b || '')].sort().join('|');
  }

  function nodeMetrics() {
    const metrics = new Map();
    document.querySelectorAll('#nodes-layer .course-node[data-id]').forEach(node => {
      if (!(node instanceof HTMLElement)) return;
      const id = String(node.dataset.id || '');
      const width = node.offsetWidth || number(node.style.width) || FALLBACK_NODE_WIDTH;
      const height = node.offsetHeight || number(node.style.height) || fallbackNodeHeight();
      metrics.set(id, { width, height });
    });
    return metrics;
  }

  function normalizeNodePositions() {
    if (!state?.positions || typeof visibleCourses !== 'function') return false;
    const courses = visibleCourses();
    if (!courses.length) return false;

    const metrics = nodeMetrics();
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

        const previousHeight = metrics.get(previous.id)?.height || fallbackNodeHeight();
        const requiredGap = paired.has(pairKey(previous.id, current.id))
          ? Math.max(COREQ_NODE_GAP, adaptiveNodeGap())
          : adaptiveNodeGap();
        const minimumY = previousPosition.y + previousHeight + requiredGap;
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
      } else if (match[1] === 'H') {
        x = number(match[2]);
      } else if (match[1] === 'V') {
        y = number(match[2]);
      }
      points.push({ x, y });
    }
    return points;
  }

  function isOrthogonal(points) {
    return Array.isArray(points) && points.length >= 2 && points.every((point, index) =>
      index === 0 ||
      Math.abs(point.x - points[index - 1].x) < EPS ||
      Math.abs(point.y - points[index - 1].y) < EPS);
  }

  function simplify(points) {
    const result = [];
    for (const point of points || []) {
      if (!result.length ||
          Math.abs(point.x - result.at(-1).x) > EPS ||
          Math.abs(point.y - result.at(-1).y) > EPS) {
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
    if (!isOrthogonal(normalized) || normalized.length < 3 || requestedRadius <= 0) {
      return serializeOrthogonal(normalized);
    }

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

  function coreqObstacleId(pair, side) {
    return `coreq:${pair.key}:${side}`;
  }

  function liveObstacles(pairs) {
    const metrics = nodeMetrics();
    const obstacles = [];

    document.querySelectorAll('#nodes-layer .course-node[data-id]').forEach(node => {
      if (!(node instanceof HTMLElement)) return;
      const id = String(node.dataset.id || '');
      const metric = metrics.get(id) || {
        width: FALLBACK_NODE_WIDTH,
        height: fallbackNodeHeight(),
      };
      const left = number(node.style.left);
      const top = number(node.style.top);
      obstacles.push({
        kind: 'node',
        id: `node:${id}`,
        nodeId: id,
        left: left - NODE_CLEARANCE,
        right: left + metric.width + NODE_CLEARANCE,
        top: top - NODE_CLEARANCE,
        bottom: top + metric.height + NODE_CLEARANCE,
      });
    });

    for (const pair of pairs || []) {
      const geometry = typeof pairGeometry === 'function' ? pairGeometry(pair) : null;
      if (!geometry) continue;
      const top = Math.min(geometry.upperBottom, geometry.lowerTop) - COREQ_CLEARANCE;
      const bottom = Math.max(geometry.upperBottom, geometry.lowerTop) + COREQ_CLEARANCE;
      const leftX = geometry.x - 3.5;
      const rightX = geometry.x + 3.5;

      obstacles.push({
        kind: 'coreq',
        id: coreqObstacleId(pair, 'left'),
        pairKey: pair.key,
        side: 'left',
        left: leftX - COREQ_CLEARANCE,
        right: leftX + COREQ_CLEARANCE,
        top,
        bottom,
      });
      obstacles.push({
        kind: 'coreq',
        id: coreqObstacleId(pair, 'right'),
        pairKey: pair.key,
        side: 'right',
        left: rightX - COREQ_CLEARANCE,
        right: rightX + COREQ_CLEARANCE,
        top,
        bottom,
      });
    }

    return obstacles;
  }

  function nearestPairStrokeId(pair, endpoint) {
    const geometry = typeof pairGeometry === 'function' ? pairGeometry(pair) : null;
    if (!geometry || !endpoint) return null;
    const leftDistance = Math.abs(endpoint.x - (geometry.x - 3.5));
    const rightDistance = Math.abs(endpoint.x - (geometry.x + 3.5));
    return coreqObstacleId(pair, leftDistance <= rightDistance ? 'left' : 'right');
  }

  function endpointIgnoredIds(edge, pairs, source, endpoint) {
    const result = new Set();

    if (source) {
      if (edge?.sourceKind === 'course' && edge.fromId) {
        result.add(`node:${String(edge.fromId)}`);
      } else if (edge?.sourceKind === 'pair' && edge.pairKey) {
        const pair = pairByKey(edge.pairKey, pairs);
        if (pair) {
          result.add(`node:${String(pair.aId)}`);
          result.add(`node:${String(pair.bId)}`);
          const strokeId = nearestPairStrokeId(pair, endpoint);
          if (strokeId) result.add(strokeId);
        }
      }
    } else if (edge?.targetKind === 'pair' && edge.targetPairKey) {
      const pair = pairByKey(edge.targetPairKey, pairs);
      if (pair) {
        result.add(`node:${String(pair.aId)}`);
        result.add(`node:${String(pair.bId)}`);
        const strokeId = nearestPairStrokeId(pair, endpoint);
        if (strokeId) result.add(strokeId);
      }
    } else if (edge?.toId) {
      result.add(`node:${String(edge.toId)}`);
    }

    return result;
  }

  function segmentObstacleCollisions(a, b, obstacles, ignored) {
    const collisions = [];
    for (const box of obstacles) {
      if (ignored?.has(box.id)) continue;

      if (Math.abs(a.x - b.x) < EPS) {
        const low = Math.min(a.y, b.y);
        const high = Math.max(a.y, b.y);
        if (a.x > box.left + EPS &&
            a.x < box.right - EPS &&
            low < box.bottom - EPS &&
            high > box.top + EPS) {
          collisions.push(box);
        }
      } else if (Math.abs(a.y - b.y) < EPS) {
        const low = Math.min(a.x, b.x);
        const high = Math.max(a.x, b.x);
        if (a.y > box.top + EPS &&
            a.y < box.bottom - EPS &&
            low < box.right - EPS &&
            high > box.left + EPS) {
          collisions.push(box);
        }
      } else {
        return obstacles;
      }
    }
    return collisions;
  }

  function firstCollision(points, obstacles, edge, pairs) {
    for (let index = 0; index < points.length - 1; index += 1) {
      const ignored = new Set([
        ...(index === 0 ? endpointIgnoredIds(edge, pairs, true, points[0]) : []),
        ...(index === points.length - 2
          ? endpointIgnoredIds(edge, pairs, false, points.at(-1))
          : []),
      ]);
      const collisions = segmentObstacleCollisions(
        points[index],
        points[index + 1],
        obstacles,
        ignored,
      );
      if (collisions.length) return { index, collisions };
    }
    return null;
  }

  function routeLength(points) {
    let total = 0;
    for (let index = 1; index < points.length; index += 1) {
      total += Math.abs(points[index].x - points[index - 1].x) +
        Math.abs(points[index].y - points[index - 1].y);
    }
    return total;
  }

  function bendCount(points) {
    let bends = 0;
    for (let index = 1; index < points.length - 1; index += 1) {
      const a = points[index - 1];
      const b = points[index];
      const c = points[index + 1];
      const firstVertical = Math.abs(a.x - b.x) < EPS;
      const secondVertical = Math.abs(b.x - c.x) < EPS;
      if (firstVertical !== secondVertical) bends += 1;
    }
    return bends;
  }

  function pathSegments(points) {
    const segments = [];
    for (let index = 0; index < points.length - 1; index += 1) {
      segments.push({ a: points[index], b: points[index + 1] });
    }
    return segments;
  }

  function overlapPenalty(points, occupied) {
    const spacing = Math.min(verticalLaneSpacing(), horizontalLaneSpacing());
    let penalty = 0;

    for (const segment of pathSegments(points)) {
      const vertical = Math.abs(segment.a.x - segment.b.x) < EPS;
      for (const other of occupied || []) {
        const otherVertical = Math.abs(other.a.x - other.b.x) < EPS;
        if (vertical !== otherVertical) continue;

        if (vertical) {
          const delta = Math.abs(segment.a.x - other.a.x);
          if (delta >= spacing - EPS) continue;
          const low = Math.max(
            Math.min(segment.a.y, segment.b.y),
            Math.min(other.a.y, other.b.y),
          );
          const high = Math.min(
            Math.max(segment.a.y, segment.b.y),
            Math.max(other.a.y, other.b.y),
          );
          if (high > low + EPS) penalty += (spacing - delta) * (high - low);
        } else {
          const delta = Math.abs(segment.a.y - other.a.y);
          if (delta >= spacing - EPS) continue;
          const low = Math.max(
            Math.min(segment.a.x, segment.b.x),
            Math.min(other.a.x, other.b.x),
          );
          const high = Math.min(
            Math.max(segment.a.x, segment.b.x),
            Math.max(other.a.x, other.b.x),
          );
          if (high > low + EPS) penalty += (spacing - delta) * (high - low);
        }
      }
    }

    return penalty;
  }

  function pathPoints(path) {
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

  function endpointProfile(points) {
    const normalized = simplify(points);
    if (normalized.length < 2) return null;
    const source = normalized[0];
    const sourceNext = normalized[1];
    const target = normalized.at(-1);
    const targetPrevious = normalized.at(-2);

    const sourceHorizontal = Math.abs(source.y - sourceNext.y) < EPS;
    const targetHorizontal = Math.abs(target.y - targetPrevious.y) < EPS;
    if (!sourceHorizontal || !targetHorizontal) return null;

    const sourceDirection = Math.sign(sourceNext.x - source.x) || 1;
    const targetDirection = Math.sign(target.x - targetPrevious.x) || 1;
    return { source, target, sourceDirection, targetDirection };
  }

  function approachValid(points, profile) {
    const normalized = simplify(points);
    if (!profile || normalized.length < 2) return false;
    const source = normalized[0];
    const sourceNext = normalized[1];
    const target = normalized.at(-1);
    const targetPrevious = normalized.at(-2);

    if (Math.abs(source.y - sourceNext.y) >= EPS ||
        Math.abs(target.y - targetPrevious.y) >= EPS) return false;

    const sourceDelta = sourceNext.x - source.x;
    const targetDelta = target.x - targetPrevious.x;

    if (Math.sign(sourceDelta) !== profile.sourceDirection ||
        Math.sign(targetDelta) !== profile.targetDirection) return false;

    return Math.abs(sourceDelta) >= MIN_ENDPOINT_STUB - EPS &&
      Math.abs(targetDelta) >= MIN_ENDPOINT_STUB - EPS;
  }

  function routeClear(points, obstacles, edge, pairs, profile) {
    const normalized = simplify(points);
    return isOrthogonal(normalized) &&
      bendCount(normalized) <= MAX_TURNS &&
      approachValid(normalized, profile) &&
      !firstCollision(normalized, obstacles, edge, pairs);
  }

  function uniqueNumbers(values) {
    return [...new Set(values
      .filter(value => Number.isFinite(value))
      .map(value => Number(value.toFixed(3))))];
  }

  function laneCandidates(profile, obstacles, originalPoints) {
    const xSpacing = verticalLaneSpacing();
    const ySpacing = horizontalLaneSpacing();
    const midY = (profile.source.y + profile.target.y) / 2;

    const xValues = [
      ...originalPoints.slice(1, -1).map(point => point.x),
      profile.source.x + profile.sourceDirection * MIN_ENDPOINT_STUB,
      profile.target.x - profile.targetDirection * MIN_ENDPOINT_STUB,
      (profile.source.x + profile.target.x) / 2,
    ];
    const yValues = [
      ...originalPoints.slice(1, -1).map(point => point.y),
      midY,
    ];

    let globalTop = Math.min(profile.source.y, profile.target.y);
    let globalBottom = Math.max(profile.source.y, profile.target.y);

    for (const box of obstacles) {
      globalTop = Math.min(globalTop, box.top);
      globalBottom = Math.max(globalBottom, box.bottom);

      for (let step = 0; step <= MAX_LANE_STEPS; step += 1) {
        const xOffset = 1 + step * xSpacing;
        xValues.push(box.left - xOffset, box.right + xOffset);

        const yOffset = 1 + step * ySpacing;
        yValues.push(box.top - yOffset, box.bottom + yOffset);
      }
    }

    yValues.push(
      Math.max(4, globalTop - ySpacing - NODE_CLEARANCE - 4),
      globalBottom + ySpacing + NODE_CLEARANCE + 4,
    );

    const sourceLanes = uniqueNumbers(xValues)
      .filter(x => profile.sourceDirection > 0
        ? x >= profile.source.x + MIN_ENDPOINT_STUB - EPS
        : x <= profile.source.x - MIN_ENDPOINT_STUB + EPS)
      .sort((a, b) => Math.abs(a - profile.source.x) - Math.abs(b - profile.source.x))
      .slice(0, 12);

    const targetLanes = uniqueNumbers(xValues)
      .filter(x => profile.targetDirection > 0
        ? x <= profile.target.x - MIN_ENDPOINT_STUB + EPS
        : x >= profile.target.x + MIN_ENDPOINT_STUB - EPS)
      .sort((a, b) => Math.abs(a - profile.target.x) - Math.abs(b - profile.target.x))
      .slice(0, 12);

    const sharedLanes = uniqueNumbers([...sourceLanes, ...targetLanes])
      .filter(x => {
        const sourceOk = profile.sourceDirection > 0
          ? x >= profile.source.x + MIN_ENDPOINT_STUB - EPS
          : x <= profile.source.x - MIN_ENDPOINT_STUB + EPS;
        const targetOk = profile.targetDirection > 0
          ? x <= profile.target.x - MIN_ENDPOINT_STUB + EPS
          : x >= profile.target.x + MIN_ENDPOINT_STUB - EPS;
        return sourceOk && targetOk;
      })
      .sort((a, b) => {
        const middle = (profile.source.x + profile.target.x) / 2;
        return Math.abs(a - middle) - Math.abs(b - middle);
      })
      .slice(0, 16);

    const corridorValues = uniqueNumbers(yValues)
      .filter(y => y >= 4)
      .sort((a, b) => Math.abs(a - midY) - Math.abs(b - midY));

    const forced = uniqueNumbers([
      Math.max(4, globalTop - ySpacing - NODE_CLEARANCE - 4),
      globalBottom + ySpacing + NODE_CLEARANCE + 4,
    ]);
    const corridors = uniqueNumbers([
      ...corridorValues.slice(0, 18),
      ...forced,
    ]);

    return { sourceLanes, targetLanes, sharedLanes, corridors };
  }

  function bestBoundedRoute(points, obstacles, edge, pairs, occupied) {
    const original = simplify(points);
    const profile = endpointProfile(original);
    if (!profile) return original;

    if (routeClear(original, obstacles, edge, pairs, profile)) return original;

    const { source, target } = profile;
    const lanes = laneCandidates(profile, obstacles, original);
    const candidates = [];

    const addCandidate = raw => {
      const candidate = simplify(raw);
      if (!routeClear(candidate, obstacles, edge, pairs, profile)) return;
      const turns = bendCount(candidate);
      const score =
        routeLength(candidate) +
        turns * BEND_PENALTY +
        overlapPenalty(candidate, occupied) * PARALLEL_PENALTY;
      candidates.push({ points: candidate, score });
    };

    if (Math.abs(source.y - target.y) < EPS) {
      addCandidate([source, target]);
    }

    for (const laneX of lanes.sharedLanes) {
      addCandidate([
        source,
        { x: laneX, y: source.y },
        { x: laneX, y: target.y },
        target,
      ]);
    }

    for (const sourceLaneX of lanes.sourceLanes) {
      for (const targetLaneX of lanes.targetLanes) {
        for (const corridorY of lanes.corridors) {
          addCandidate([
            source,
            { x: sourceLaneX, y: source.y },
            { x: sourceLaneX, y: corridorY },
            { x: targetLaneX, y: corridorY },
            { x: targetLaneX, y: target.y },
            target,
          ]);
        }
      }
    }

    candidates.sort((a, b) => a.score - b.score);
    return candidates[0]?.points || original;
  }

  function writePath(path, points, currentAppearance) {
    const orthogonal = serializeOrthogonal(points);
    if (!orthogonal) return;

    path.dataset.finalOrthogonalRoute = orthogonal;
    path.dataset.nodeClearanceRoute = orthogonal;
    path.dataset.endpointInvariantRoute = orthogonal;
    path.dataset.semanticInvariantRoute = orthogonal;
    path.setAttribute(
      'd',
      currentAppearance.cornerStyle === 'rounded'
        ? roundedArcPath(points, currentAppearance.radius)
        : orthogonal,
    );

    const edgeKey = path.dataset.edgeKey;
    if (!edgeKey) return;
    const hit = svg.querySelector(
      `.manual-route-hit[data-edge-key="${CSS.escape(edgeKey)}"]`,
    );
    if (hit instanceof SVGPathElement) {
      hit.setAttribute('d', path.getAttribute('d') || '');
    }
  }

  let applying = false;
  function applyAdaptiveClearance() {
    if (applying) return;
    applying = true;

    try {
      const nodesChanged = normalizeNodePositions();
      if (nodesChanged) {
        if (typeof save === 'function') save();
        if (typeof renderFlow === 'function') renderFlow();
        return;
      }

      window.CurriculumConnectorSemanticInvariants?.applyNow?.();
      window.CurriculumConnectorInvariants?.applyNow?.();

      const paths = [...svg.querySelectorAll('path.relationship')];
      if (!paths.length) return;

      const pairs = typeof corequisitePairs === 'function' ? corequisitePairs() : [];
      const edges = typeof dependencyEdges === 'function' ? dependencyEdges(pairs) : [];
      const obstacles = liveObstacles(pairs);
      const currentAppearance = appearance();

      const records = paths
        .map((path, index) => ({
          path,
          edge: edges[index],
          points: pathPoints(path),
        }))
        .filter(record => record.edge && isOrthogonal(record.points));

      for (const record of records) {
        const manual = Boolean(
          window.CurriculumManualRouting?.hasManualRoute?.(record.edge.key),
        );
        if (manual) continue;

        const occupied = records
          .filter(other => other !== record)
          .flatMap(other => pathSegments(other.points));

        const repaired = bestBoundedRoute(
          record.points,
          obstacles,
          record.edge,
          pairs,
          occupied,
        );

        if (!isOrthogonal(repaired)) continue;

        const profile = endpointProfile(repaired);
        if (!profile ||
            bendCount(repaired) > MAX_TURNS ||
            firstCollision(repaired, obstacles, record.edge, pairs)) {
          continue;
        }

        record.points = repaired;
        writePath(record.path, repaired, currentAppearance);
      }

      window.CurriculumLineVisualPersistence?.apply?.();
    } finally {
      applying = false;
    }
  }

  let generation = 0;
  function scheduleAdaptiveClearance() {
    const token = ++generation;
    const later = depth => {
      if (depth <= 0) {
        if (token === generation) applyAdaptiveClearance();
        return;
      }
      requestAnimationFrame(() => later(depth - 1));
    };
    later(FINAL_RAF_DEPTH);
  }

  const baseRenderEdgesForAdaptiveClearance = renderEdges;
  renderEdges = () => {
    baseRenderEdgesForAdaptiveClearance();
    scheduleAdaptiveClearance();
  };

  if (window.CurriculumFlowchartRuntime) {
    window.CurriculumFlowchartRuntime.renderFlow = () => renderFlow();
  }

  const baseBuildExportSvgForAdaptiveClearance = buildExportSvg;
  buildExportSvg = () => {
    applyAdaptiveClearance();
    const svgText = baseBuildExportSvgForAdaptiveClearance();
    applyAdaptiveClearance();

    try {
      const documentXml = new DOMParser().parseFromString(svgText, 'image/svg+xml');
      const livePaths = [...svg.querySelectorAll('path.relationship')]
        .map(path => path.getAttribute('d') || '');
      const exportPaths = [
        ...documentXml.querySelectorAll('path[marker-end*="export-arrow"]'),
      ].filter(path => !path.closest('#export-legend'));

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

    if (![
      'vertical-lane-spacing',
      'horizontal-lane-spacing',
      'display-units-toggle',
      'connector-corner-style',
      'connector-corner-radius',
    ].includes(target.id)) return;

    scheduleAdaptiveClearance();
  }, true);

  window.CurriculumFinalLayoutClearance = {
    applyNow: applyAdaptiveClearance,
    request: scheduleAdaptiveClearance,
    maxTurns: MAX_TURNS,
  };

  scheduleAdaptiveClearance();
})();
