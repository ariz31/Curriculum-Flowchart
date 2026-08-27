
;(() => {
  const EPS = 0.5;
  const DEFAULT_SPACING = 7;
  const SOURCE_FACE_MARGIN = 11;
  const SOURCE_LANE_STUB = 14;

  const clone = value => JSON.parse(JSON.stringify(value));
  const number = value => Number.parseFloat(String(value ?? '0'));
  const fmt = value => Number(Number(value).toFixed(3)).toString();
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
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

  function simplify(points) {
    const result = [];
    for (const point of points) {
      if (!result.length || Math.abs(point.x - result.at(-1).x) > EPS || Math.abs(point.y - result.at(-1).y) > EPS) {
        result.push({ ...point });
      }
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

  function outgoingSiblings(edge, edges, pairs, cols) {
    if (edge.sourceKind !== 'course') return [];
    const direction = edgeDirection(edge, pairs, cols);
    return edges
      .filter(item => item.sourceKind === 'course' && item.fromId === edge.fromId && edgeDirection(item, pairs, cols) === direction)
      .sort((a, b) => {
        const delta = targetCenterY(a, pairs) - targetCenterY(b, pairs);
        return Math.abs(delta) > 0.01 ? delta : a.key.localeCompare(b.key);
      });
  }

  function sourcePortY(edge, edges, pairs, cols) {
    const position = state.positions[edge.fromId];
    if (!position) return null;
    const siblings = outgoingSiblings(edge, edges, pairs, cols);
    if (siblings.length <= 1) return position.y + H / 2;
    const index = Math.max(0, siblings.findIndex(item => item.key === edge.key));
    const requested = horizontalSpacing();
    const usable = Math.max(0, H - SOURCE_FACE_MARGIN * 2);
    const step = Math.min(requested, usable / Math.max(1, siblings.length - 1));
    return position.y + H / 2 + (index - (siblings.length - 1) / 2) * step;
  }

  // Standardized source rule: every outgoing prerequisite/elective relationship from
  // a course owns a distinct source-face attachment point. Pair sources remain the
  // intentional compound-corequisite exception handled by pairBranchAnchor.
  const baseSourceAnchorForIndependentRoutes = sourceAnchor;
  sourceAnchor = (edge, edges, pairs, cols) => {
    if (edge.sourceKind !== 'course') return baseSourceAnchorForIndependentRoutes(edge, edges, pairs, cols);
    const position = state.positions[edge.fromId];
    if (!position) return baseSourceAnchorForIndependentRoutes(edge, edges, pairs, cols);
    const direction = edgeDirection(edge, pairs, cols);
    if (!direction) return baseSourceAnchorForIndependentRoutes(edge, edges, pairs, cols);
    const y = sourcePortY(edge, edges, pairs, cols);
    return {
      x: direction > 0 ? position.x + W : position.x,
      y: Number.isFinite(y) ? y : position.y + H / 2,
    };
  };

  function dedicatedFirstLane(edge, edges, pairs, cols, points) {
    if (edge.sourceKind !== 'course' || points.length < 2) return points;
    if (window.CurriculumManualRouting?.hasManualRoute?.(edge.key)) return points;

    const siblings = outgoingSiblings(edge, edges, pairs, cols);
    if (siblings.length <= 1) return points;
    const index = siblings.findIndex(item => item.key === edge.key);
    if (index < 0) return points;

    const source = points[0];
    const direction = edgeDirection(edge, pairs, cols) || 1;
    const laneX = source.x + direction * (SOURCE_LANE_STUB + index * verticalSpacing());

    // Replace only the near-source geometry. The remainder of the router's path stays
    // intact, but each dependency gets its own horizontal source stub and its own first
    // vertical lane, so no shared trunk can be formed visually.
    const next = clone(points);
    let firstVerticalIndex = -1;
    for (let i = 0; i < next.length - 1; i += 1) {
      if (Math.abs(next[i].x - next[i + 1].x) < EPS && Math.abs(next[i].y - next[i + 1].y) >= EPS) {
        firstVerticalIndex = i;
        break;
      }
    }

    if (firstVerticalIndex >= 1) {
      next[1].x = laneX;
      next[1].y = source.y;
      next[firstVerticalIndex].x = laneX;
      next[firstVerticalIndex + 1].x = laneX;
      if (firstVerticalIndex > 1) {
        // Collapse any pre-existing shared source jog into the dedicated lane.
        next.splice(2, firstVerticalIndex - 1);
      }
    } else {
      const target = next.at(-1);
      if (!target) return points;
      next.splice(1, 0,
        { x: laneX, y: source.y },
        { x: laneX, y: target.y },
      );
    }

    const normalized = simplify(next);
    return isOrthogonal(normalized) ? normalized : points;
  }

  const baseEdgePathForIndependentPrerequisites = edgePath;
  edgePath = (edge, edges, pairs, cols) => {
    const base = baseEdgePathForIndependentPrerequisites(edge, edges, pairs, cols);
    const points = parseOrthogonalPath(base);
    if (!isOrthogonal(points)) return base;
    const separated = dedicatedFirstLane(edge, edges, pairs, cols, points);
    return serializeOrthogonal(separated) || base;
  };

  // Rebuild on both spacing controls. Because sourceAnchor/edgePath are used on every
  // render, the same independent-line rule also persists after node movement, sorting,
  // layout changes, JSON restore, and normal rerenders.
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
