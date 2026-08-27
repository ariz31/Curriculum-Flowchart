
;(() => {
  const DEFAULT_SPACING = 7;
  const EPS = 0.5;
  const clampValue = (value, min, max) => Math.min(max, Math.max(min, value));
  const horizontalSpacing = () => clampValue(Number(window.CurriculumHorizontalLaneSpacing?.get?.()) || DEFAULT_SPACING, 3, 30);

  const baseDependencyEdgesForCompoundTargets = dependencyEdges;

  const sourceIdentity = edge => edge.sourceKind === 'pair'
    ? `pair:${edge.pairKey}`
    : `course:${edge.fromId}`;

  dependencyEdges = (pairs = corequisitePairs()) => {
    const raw = baseDependencyEdgesForCompoundTargets(pairs);
    if (raw.length < 2 || !pairs.length) return raw;

    const replacementAt = new Map();
    const consumed = new Set();

    for (const pair of pairs) {
      for (const type of ['prerequisite', 'elective']) {
        const toA = raw
          .map((edge, index) => ({ edge, index }))
          .filter(item => item.edge.type === type && item.edge.toId === pair.aId && !consumed.has(item.index));
        const toB = raw
          .map((edge, index) => ({ edge, index }))
          .filter(item => item.edge.type === type && item.edge.toId === pair.bId && !consumed.has(item.index));

        for (const a of toA) {
          if (consumed.has(a.index)) continue;
          const identity = sourceIdentity(a.edge);
          const b = toB.find(item => !consumed.has(item.index) && sourceIdentity(item.edge) === identity);
          if (!b) continue;

          const firstIndex = Math.min(a.index, b.index);
          const secondIndex = Math.max(a.index, b.index);
          const representative = raw[firstIndex];
          replacementAt.set(firstIndex, {
            ...representative,
            key: `${identity}->target-pair:${pair.key}:${type}`,
            targetKind: 'pair',
            targetPairKey: pair.key,
            // Keep a real member id so existing layout/topology code continues to resolve
            // this relationship to the compound layout unit.
            toId: pair.aId,
          });
          consumed.add(firstIndex);
          consumed.add(secondIndex);
        }
      }
    }

    if (!replacementAt.size) return raw;
    const result = [];
    raw.forEach((edge, index) => {
      const replacement = replacementAt.get(index);
      if (replacement) result.push(replacement);
      else if (!consumed.has(index)) result.push(edge);
    });
    return result;
  };

  const baseTargetAnchorForCompoundTargets = targetAnchor;
  targetAnchor = (edge, edges, pairs, cols) => {
    if (edge.targetKind !== 'pair' || !edge.targetPairKey) {
      return baseTargetAnchorForCompoundTargets(edge, edges, pairs, cols);
    }

    const pair = pairByKey(edge.targetPairKey, pairs);
    const geometry = pair ? pairGeometry(pair) : null;
    if (!pair || !geometry) return baseTargetAnchorForCompoundTargets(edge, edges, pairs, cols);

    const sourceColumn = edgeSourceColumn(edge, pairs, cols);
    const targetCourse = byId(pair.aId) || byId(pair.bId);
    const targetColumn = targetCourse ? columnIndexForCourse(targetCourse, cols) : sourceColumn;
    const forward = targetColumn >= sourceColumn;

    const incoming = edges
      .filter(item => item.targetKind === 'pair' && item.targetPairKey === pair.key)
      .sort((a, b) => {
        const sourceY = item => {
          if (item.sourceKind === 'course') return (state.positions[item.fromId]?.y ?? 0) + H / 2;
          const sourcePair = pairByKey(item.pairKey, pairs);
          return sourcePair ? (pairGeometry(sourcePair)?.junctionY ?? 0) : 0;
        };
        const delta = sourceY(a) - sourceY(b);
        return Math.abs(delta) > 0.01 ? delta : a.key.localeCompare(b.key);
      });

    const index = Math.max(0, incoming.findIndex(item => item.key === edge.key));
    const low = Math.min(geometry.upperBottom + 8, geometry.lowerTop - 8);
    const high = Math.max(geometry.upperBottom + 8, geometry.lowerTop - 8);
    const available = Math.max(0, high - low);
    const requested = horizontalSpacing();
    const step = incoming.length > 1 ? Math.min(requested, available / Math.max(1, incoming.length - 1)) : 0;
    const start = geometry.junctionY - step * (incoming.length - 1) / 2;
    const y = incoming.length > 1 ? clampValue(start + index * step, low, high) : geometry.junctionY;

    // Terminate directly on the corequisite connector: left stroke when coming from
    // earlier columns and right stroke when the dependency runs backwards.
    return { x: geometry.x + (forward ? -3.5 : 3.5), y };
  };

  const baseExcludedIdsForCompoundTargets = edgeExcludedIds;
  edgeExcludedIds = (edge, pairs) => {
    const result = baseExcludedIdsForCompoundTargets(edge, pairs);
    if (edge.targetKind === 'pair' && edge.targetPairKey) {
      const pair = pairByKey(edge.targetPairKey, pairs);
      if (pair) {
        result.add(pair.aId);
        result.add(pair.bId);
      }
    }
    return result;
  };

  // A synthetic target-pair edge must not consume a normal node-face port on either
  // member. Filter those edges before the current global port-spacing implementation.
  const baseCourseIncidentOffsetForCompoundTargets = courseIncidentOffset;
  courseIncidentOffset = (nodeId, edge, edges) => {
    const filtered = edges.filter(item => !(item.targetKind === 'pair' && item.targetPairKey));
    return baseCourseIncidentOffsetForCompoundTargets(nodeId, edge, filtered);
  };

  // Ensure every renderer/runtime sees the collapsed semantic edge set immediately.
  renderEdges();
  window.CurriculumConnectorGeometry?.request?.();
})();
