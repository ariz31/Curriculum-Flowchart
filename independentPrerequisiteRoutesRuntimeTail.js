
;(() => {
  const EPS = 0.5;
  const DEFAULT_VERTICAL_SPACING = 7;

  const clone = value => JSON.parse(JSON.stringify(value));
  const number = value => Number.parseFloat(String(value ?? '0'));
  const fmt = value => Number(Number(value).toFixed(3)).toString();
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const verticalSpacing = () => clamp(Number(window.CurriculumVerticalLaneSpacing?.get?.()) || DEFAULT_VERTICAL_SPACING, 3, 30);

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

  function edgeDirection(edge, pairs, cols) {
    const sourceColumn = edgeSourceColumn(edge, pairs, cols);
    const targetColumn = edgeTargetColumn(edge, cols);
    if (sourceColumn < 0 || targetColumn < 0) return 0;
    return targetColumn >= sourceColumn ? 1 : -1;
  }

  function targetCenterY(edge) {
    if (edge.targetKind === 'pair' && edge.targetPairKey) {
      const pair = pairByKey(edge.targetPairKey, corequisitePairs());
      const geometry = pair ? pairGeometry(pair) : null;
      return geometry?.junctionY ?? 0;
    }
    const position = state.positions[edge.toId];
    return position ? position.y + H / 2 : 0;
  }

  function outgoingSiblings(edge, edges, pairs, cols) {
    if (edge.sourceKind !== 'course') return [];
    const direction = edgeDirection(edge, pairs, cols);
    return edges
      .filter(item => item.sourceKind === 'course' && item.fromId === edge.fromId && edgeDirection(item, pairs, cols) === direction)
      .sort((a, b) => {
        const delta = targetCenterY(a) - targetCenterY(b);
        return Math.abs(delta) > 0.01 ? delta : a.key.localeCompare(b.key);
      });
  }

  function laneBounds(sourceX, targetX, direction, count, spacing) {
    const near = sourceX + direction * 12;
    const far = targetX - direction * 18;
    const low = Math.min(near, far);
    const high = Math.max(near, far);
    const needed = Math.max(0, count - 1) * spacing;
    return { low, high, available: Math.max(0, high - low), needed };
  }

  function uniqueSourceLane(edge, edges, pairs, cols, points) {
    if (edge.sourceKind !== 'course' || points.length < 4) return points;
    if (window.CurriculumManualRouting?.hasManualRoute?.(edge.key)) return points;

    const first = points[0];
    const firstTurn = points[1];
    const secondTurn = points[2];
    if (!first || !firstTurn || !secondTurn) return points;
    if (Math.abs(first.y - firstTurn.y) >= EPS || Math.abs(firstTurn.x - secondTurn.x) >= EPS) return points;

    const siblings = outgoingSiblings(edge, edges, pairs, cols);
    if (siblings.length <= 1) return points;
    const index = siblings.findIndex(item => item.key === edge.key);
    if (index < 0) return points;

    const direction = edgeDirection(edge, pairs, cols) || (secondTurn.x >= first.x ? 1 : -1);
    const requested = verticalSpacing();
    const bounds = laneBounds(first.x, points.at(-1).x, direction, siblings.length, requested);
    const spacing = bounds.needed <= bounds.available
      ? requested
      : Math.max(3, bounds.available / Math.max(1, siblings.length - 1));

    // Keep the family's lane group near the router's original first propagation lane,
    // but guarantee a separate X lane for every outgoing prerequisite relationship.
    const originalCenter = firstTurn.x;
    const desiredStart = originalCenter - direction * spacing * (siblings.length - 1) / 2;
    const minimumStart = direction > 0 ? bounds.low : bounds.high;
    const maximumStart = direction > 0
      ? bounds.high - spacing * (siblings.length - 1)
      : bounds.low + spacing * (siblings.length - 1);
    const start = direction > 0
      ? clamp(desiredStart, minimumStart, Math.max(minimumStart, maximumStart))
      : clamp(desiredStart, Math.min(minimumStart, maximumStart), minimumStart);
    const laneX = start + direction * index * spacing;

    const next = clone(points);
    next[1].x = laneX;
    next[2].x = laneX;
    return isOrthogonal(next) ? next : points;
  }

  const baseEdgePathForIndependentPrerequisites = edgePath;
  edgePath = (edge, edges, pairs, cols) => {
    const base = baseEdgePathForIndependentPrerequisites(edge, edges, pairs, cols);
    const points = parseOrthogonalPath(base);
    if (!isOrthogonal(points)) return base;
    const separated = uniqueSourceLane(edge, edges, pairs, cols, points);
    return serializeOrthogonal(separated) || base;
  };

  // Rebuild immediately and after spacing changes so source lanes remain independent.
  document.addEventListener('change', event => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (!['vertical-lane-spacing', 'horizontal-lane-spacing'].includes(target.id)) return;
    renderEdges();
    window.CurriculumConnectorGeometry?.request?.();
  }, true);

  renderEdges();
  window.CurriculumConnectorGeometry?.request?.();
})();
