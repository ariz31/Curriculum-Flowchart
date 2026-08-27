
;(() => {
  const STORAGE_KEY = 'curriculum-flowchart:manual-routes:v1';
  const CURRICULUM_LIBRARY_KEY = 'curriculum-flowchart:curricula:v1';
  const DEFAULT_RADIUS = 10;
  const MAX_RADIUS = 30;
  const MIN_RADIUS = 0;
  const DEFAULT_JOG = 22;
  const EPS = 0.5;

  const clone = value => JSON.parse(JSON.stringify(value));
  const safeParse = value => { try { return value ? JSON.parse(value) : null; } catch { return null; } };
  const number = value => Number.parseFloat(String(value ?? '0'));
  const fmt = value => Number(Number(value).toFixed(3)).toString();
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const activeCurriculumId = () => String(safeParse(localStorage.getItem(CURRICULUM_LIBRARY_KEY))?.activeId || 'default');

  const defaultCurriculumConfig = () => ({
    routes: {},
    appearance: { cornerStyle: 'sharp', radius: DEFAULT_RADIUS },
  });

  function allConfigs() {
    const stored = safeParse(localStorage.getItem(STORAGE_KEY));
    return stored && typeof stored === 'object' ? stored : {};
  }

  function normalizeRoute(route) {
    if (!route || typeof route !== 'object') return null;
    const points = Array.isArray(route.points)
      ? route.points
        .map(point => ({ x: Number(point?.x), y: Number(point?.y) }))
        .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
      : [];
    const sourceOrientation = route.sourceOrientation === 'V' ? 'V' : 'H';
    const targetOrientation = route.targetOrientation === 'V' ? 'V' : 'H';
    return { points, sourceOrientation, targetOrientation, updatedAt: Number(route.updatedAt) || Date.now() };
  }

  function normalizeCurriculumConfig(value) {
    const routes = {};
    if (value?.routes && typeof value.routes === 'object') {
      for (const [key, route] of Object.entries(value.routes)) {
        const normalized = normalizeRoute(route);
        if (normalized) routes[key] = normalized;
      }
    }
    const cornerStyle = value?.appearance?.cornerStyle === 'rounded' ? 'rounded' : 'sharp';
    const radiusValue = Number(value?.appearance?.radius);
    const radius = Number.isFinite(radiusValue) ? clamp(radiusValue, MIN_RADIUS, MAX_RADIUS) : DEFAULT_RADIUS;
    return { routes, appearance: { cornerStyle, radius } };
  }

  function config() {
    return normalizeCurriculumConfig(allConfigs()[activeCurriculumId()] || defaultCurriculumConfig());
  }

  function saveConfig(next) {
    const all = allConfigs();
    all[activeCurriculumId()] = normalizeCurriculumConfig(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  }

  function appearance() {
    return config().appearance;
  }

  function manualRoute(edgeKey) {
    return config().routes[edgeKey] || null;
  }

  function setManualRoute(edgeKey, route) {
    const next = config();
    if (route) next.routes[edgeKey] = normalizeRoute(route);
    else delete next.routes[edgeKey];
    saveConfig(next);
  }

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
    if (!Array.isArray(points) || points.length < 2) return false;
    return points.every((point, index) => index === 0 ||
      Math.abs(point.x - points[index - 1].x) < EPS ||
      Math.abs(point.y - points[index - 1].y) < EPS);
  }

  function simplifyPoints(points) {
    const result = [];
    for (const point of points) {
      if (!result.length || Math.abs(point.x - result.at(-1).x) > EPS || Math.abs(point.y - result.at(-1).y) > EPS) result.push({ ...point });
    }
    let changed = true;
    while (changed && result.length > 2) {
      changed = false;
      for (let index = 1; index < result.length - 1; index += 1) {
        const a = result[index - 1];
        const b = result[index];
        const c = result[index + 1];
        const sameX = Math.abs(a.x - b.x) < EPS && Math.abs(b.x - c.x) < EPS;
        const sameY = Math.abs(a.y - b.y) < EPS && Math.abs(b.y - c.y) < EPS;
        if (sameX || sameY) {
          result.splice(index, 1);
          changed = true;
          break;
        }
      }
    }
    return result;
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

  function roundedPath(points, radius) {
    if (!isOrthogonal(points) || points.length < 3 || radius <= 0) return serializeOrthogonal(points);
    let d = `M ${fmt(points[0].x)} ${fmt(points[0].y)}`;
    const lineTo = point => { d += ` L ${fmt(point.x)} ${fmt(point.y)}`; };
    for (let index = 1; index < points.length - 1; index += 1) {
      const previous = points[index - 1];
      const corner = points[index];
      const next = points[index + 1];
      const incoming = Math.hypot(corner.x - previous.x, corner.y - previous.y);
      const outgoing = Math.hypot(next.x - corner.x, next.y - corner.y);
      const effective = Math.min(radius, incoming / 2, outgoing / 2);
      if (effective < 0.5) {
        lineTo(corner);
        continue;
      }
      const before = {
        x: corner.x + (previous.x - corner.x) / incoming * effective,
        y: corner.y + (previous.y - corner.y) / incoming * effective,
      };
      const after = {
        x: corner.x + (next.x - corner.x) / outgoing * effective,
        y: corner.y + (next.y - corner.y) / outgoing * effective,
      };
      lineTo(before);
      d += ` Q ${fmt(corner.x)} ${fmt(corner.y)} ${fmt(after.x)} ${fmt(after.y)}`;
    }
    lineTo(points.at(-1));
    return d;
  }

  function currentEdges() {
    const pairs = corequisitePairs();
    const edges = dependencyEdges(pairs);
    const cols = columns();
    return { pairs, edges, cols };
  }

  function edgeByKey(key) {
    const { edges } = currentEdges();
    return edges.find(edge => edge.key === key) || null;
  }

  function routePointsForStored(edge, route, edges, pairs, cols) {
    const source = sourceAnchor(edge, edges, pairs, cols);
    const target = targetAnchor(edge, edges, pairs, cols);
    if (!source || !target || !route) return null;
    const interior = clone(route.points || []);
    if (!interior.length) return null;
    if (route.sourceOrientation === 'V') interior[0].x = source.x;
    else interior[0].y = source.y;
    const last = interior.at(-1);
    if (route.targetOrientation === 'V') last.x = target.x;
    else last.y = target.y;
    const points = simplifyPoints([{ ...source }, ...interior, { ...target }]);
    return isOrthogonal(points) ? points : null;
  }

  function routeFromPoints(points) {
    const normalized = simplifyPoints(points);
    if (!isOrthogonal(normalized) || normalized.length < 4) return null;
    const first = normalized[0];
    const second = normalized[1];
    const beforeLast = normalized.at(-2);
    const last = normalized.at(-1);
    return {
      points: normalized.slice(1, -1).map(point => ({ ...point })),
      sourceOrientation: Math.abs(first.x - second.x) < EPS ? 'V' : 'H',
      targetOrientation: Math.abs(beforeLast.x - last.x) < EPS ? 'V' : 'H',
      updatedAt: Date.now(),
    };
  }

  const originalPairBranchAnchor = pairBranchAnchor;
  pairBranchAnchor = (pair, edge, edges) => {
    const geometry = pairGeometry(pair);
    if (!geometry) return originalPairBranchAnchor(pair, edge, edges);
    const branches = edges
      .filter(item => item.sourceKind === 'pair' && item.pairKey === pair.key)
      .sort((a, b) => {
        const ay = (state.positions[a.toId]?.y ?? 0) + H / 2;
        const by = (state.positions[b.toId]?.y ?? 0) + H / 2;
        return Math.abs(ay - by) > 0.01 ? ay - by : a.key.localeCompare(b.key);
      });
    if (branches.length <= 1) return { x: geometry.x + 3.5, y: geometry.junctionY };
    const index = Math.max(0, branches.findIndex(item => item.key === edge.key));
    const requested = Number(window.CurriculumHorizontalLaneSpacing?.get?.()) || 7;
    const low = Math.min(geometry.upperBottom + 8, geometry.lowerTop - 8);
    const high = Math.max(geometry.upperBottom + 8, geometry.lowerTop - 8);
    const available = Math.max(0, high - low);
    const step = branches.length > 1 ? Math.min(requested, available / (branches.length - 1)) : 0;
    const total = step * (branches.length - 1);
    const start = geometry.junctionY - total / 2;
    return { x: geometry.x + 3.5, y: clamp(start + index * step, low, high) };
  };

  const baseEdgePathForManualRoutes = edgePath;
  edgePath = (edge, edges, pairs, cols) => {
    const route = manualRoute(edge.key);
    if (route) {
      const points = routePointsForStored(edge, route, edges, pairs, cols);
      const d = points && serializeOrthogonal(points);
      if (d) return d;
    }
    return baseEdgePathForManualRoutes(edge, edges, pairs, cols);
  };

  let selectedEdgeKey = null;
  let selectedBendIndex = null;
  let addBendMode = false;
  let dragState = null;
  let addButton = null;
  let removeButton = null;
  let resetButton = null;
  let styleSelect = null;
  let radiusInput = null;

  const relationshipPaths = () => [...svg.querySelectorAll('path.relationship')];

  function annotatePaths() {
    const { edges } = currentEdges();
    relationshipPaths().forEach((path, index) => {
      const edge = edges[index];
      if (!edge) return;
      path.dataset.edgeKey = edge.key;
      path.dataset.edgeIndex = String(index);
      if (manualRoute(edge.key)) path.dataset.manualRoute = 'true';
      else delete path.dataset.manualRoute;
      path.classList.toggle('manual-route-selected', edge.key === selectedEdgeKey);
    });
  }

  function applyManualOrthogonalRoutes() {
    const { edges, pairs, cols } = currentEdges();
    relationshipPaths().forEach((path, index) => {
      const edge = edges[index];
      if (!edge) return;
      const route = manualRoute(edge.key);
      if (!route) return;
      const points = routePointsForStored(edge, route, edges, pairs, cols);
      const d = points && serializeOrthogonal(points);
      if (!d) return;
      path.setAttribute('d', d);
      path.dataset.manualRoute = 'true';
    });
  }

  function applyAppearanceToPath(path, orthogonalD) {
    const current = appearance();
    const points = parseOrthogonalPath(orthogonalD);
    if (!isOrthogonal(points)) return orthogonalD;
    return current.cornerStyle === 'rounded'
      ? roundedPath(points, current.radius)
      : serializeOrthogonal(points);
  }

  function finaliseRelationshipGeometry() {
    annotatePaths();
    applyManualOrthogonalRoutes();
    relationshipPaths().forEach(path => {
      const currentD = path.getAttribute('d') || '';
      const currentPoints = parseOrthogonalPath(currentD);
      const orthogonal = isOrthogonal(currentPoints)
        ? serializeOrthogonal(currentPoints)
        : (path.dataset.editRoute || '');
      const orthogonalPoints = parseOrthogonalPath(orthogonal);
      if (!isOrthogonal(orthogonalPoints)) return;
      path.dataset.editRoute = serializeOrthogonal(orthogonalPoints);
      path.setAttribute('d', applyAppearanceToPath(path, path.dataset.editRoute));
    });
    updateInteractionLayer();
    window.CurriculumLineVisualPersistence?.apply?.();
  }

  let finaliseGeneration = 0;
  function scheduleFinalise() {
    const generation = ++finaliseGeneration;
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => {
      if (generation !== finaliseGeneration) return;
      finaliseRelationshipGeometry();
    }))));
  }

  function pathPointsForEdgeKey(edgeKey) {
    const path = relationshipPaths().find(item => item.dataset.edgeKey === edgeKey);
    const d = path?.dataset.editRoute || path?.getAttribute('d') || '';
    const points = parseOrthogonalPath(d);
    if (isOrthogonal(points)) return points;
    const edge = edgeByKey(edgeKey);
    if (!edge) return [];
    const { edges, pairs, cols } = currentEdges();
    const route = manualRoute(edgeKey);
    const stored = route && routePointsForStored(edge, route, edges, pairs, cols);
    if (stored) return stored;
    return parseOrthogonalPath(baseEdgePathForManualRoutes(edge, edges, pairs, cols));
  }

  function updateToolbarState() {
    const isManual = Boolean(selectedEdgeKey && manualRoute(selectedEdgeKey));
    if (removeButton instanceof HTMLButtonElement) removeButton.disabled = !isManual || selectedBendIndex == null;
    if (resetButton instanceof HTMLButtonElement) resetButton.disabled = !isManual;
    if (addButton instanceof HTMLButtonElement) addButton.classList.toggle('active', addBendMode);
  }

  function createSvgElement(name, attrs = {}) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
    return element;
  }

  function updateInteractionLayer() {
    svg.querySelector('#manual-route-interaction-layer')?.remove();
    const layer = createSvgElement('g', { id: 'manual-route-interaction-layer' });
    const relationships = relationshipPaths();
    relationships.forEach(path => {
      const key = path.dataset.edgeKey;
      if (!key) return;
      const hit = createSvgElement('path', {
        d: path.getAttribute('d') || '',
        class: 'manual-route-hit',
        'data-edge-key': key,
      });
      layer.append(hit);
    });

    if (selectedEdgeKey) {
      const points = pathPointsForEdgeKey(selectedEdgeKey);
      if (points.length >= 2) {
        layer.append(createSvgElement('circle', { cx: points[0].x, cy: points[0].y, r: 5, class: 'route-anchor-handle' }));
        layer.append(createSvgElement('circle', { cx: points.at(-1).x, cy: points.at(-1).y, r: 5, class: 'route-anchor-handle' }));
        points.slice(1, -1).forEach((point, offset) => {
          const pointIndex = offset + 1;
          const handle = createSvgElement('circle', {
            cx: point.x,
            cy: point.y,
            r: 6.5,
            class: `route-bend-handle${selectedBendIndex === pointIndex ? ' selected' : ''}`,
            'data-edge-key': selectedEdgeKey,
            'data-point-index': pointIndex,
          });
          layer.append(handle);
        });
      }
    }
    svg.append(layer);
    updateToolbarState();
  }

  function selectEdge(edgeKey, message = true) {
    selectedEdgeKey = edgeKey;
    selectedBendIndex = null;
    selected.clear();
    updateSelection();
    relationshipPaths().forEach(path => path.classList.toggle('manual-route-selected', path.dataset.edgeKey === edgeKey));
    updateInteractionLayer();
    if (message) flowHint.textContent = manualRoute(edgeKey)
      ? 'Manual route selected. Drag bend handles, use Add bend, Remove bend, or Reset route.'
      : 'Automatic route selected. Drag a bend to convert it to a manual route, or use Add bend.';
  }

  function canvasPoint(event) {
    const rect = viewport.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - state.viewport.x) / state.viewport.scale,
      y: (event.clientY - rect.top - state.viewport.y) / state.viewport.scale,
    };
  }

  function distanceToSegment(point, a, b) {
    if (Math.abs(a.y - b.y) < EPS) {
      const x = clamp(point.x, Math.min(a.x, b.x), Math.max(a.x, b.x));
      return Math.hypot(point.x - x, point.y - a.y);
    }
    if (Math.abs(a.x - b.x) < EPS) {
      const y = clamp(point.y, Math.min(a.y, b.y), Math.max(a.y, b.y));
      return Math.hypot(point.x - a.x, point.y - y);
    }
    return Infinity;
  }

  function addJog(points, segmentIndex, clickPoint) {
    const a = points[segmentIndex];
    const b = points[segmentIndex + 1];
    if (!a || !b) return null;
    const next = clone(points);
    const verticalGap = Number(window.CurriculumVerticalLaneSpacing?.get?.()) || 7;
    const horizontalGap = Number(window.CurriculumHorizontalLaneSpacing?.get?.()) || 7;

    if (Math.abs(a.y - b.y) < EPS) {
      const direction = Math.sign(b.x - a.x) || 1;
      const length = Math.abs(b.x - a.x);
      if (length < 30) return null;
      const run = Math.min(Math.max(24, verticalGap * 2), length * 0.55);
      const center = clamp(clickPoint.x, Math.min(a.x, b.x) + run / 2 + 2, Math.max(a.x, b.x) - run / 2 - 2);
      const x1 = center - direction * run / 2;
      const x2 = center + direction * run / 2;
      const offset = Math.max(DEFAULT_JOG, horizontalGap * 2);
      const preferredY = a.y + (clickPoint.y < a.y ? -offset : offset);
      next.splice(segmentIndex + 1, 0,
        { x: x1, y: a.y },
        { x: x1, y: preferredY },
        { x: x2, y: preferredY },
        { x: x2, y: a.y });
    } else if (Math.abs(a.x - b.x) < EPS) {
      const direction = Math.sign(b.y - a.y) || 1;
      const length = Math.abs(b.y - a.y);
      if (length < 30) return null;
      const run = Math.min(Math.max(24, horizontalGap * 2), length * 0.55);
      const center = clamp(clickPoint.y, Math.min(a.y, b.y) + run / 2 + 2, Math.max(a.y, b.y) - run / 2 - 2);
      const y1 = center - direction * run / 2;
      const y2 = center + direction * run / 2;
      const offset = Math.max(DEFAULT_JOG, verticalGap * 2);
      const preferredX = a.x + (clickPoint.x < a.x ? -offset : offset);
      next.splice(segmentIndex + 1, 0,
        { x: a.x, y: y1 },
        { x: preferredX, y: y1 },
        { x: preferredX, y: y2 },
        { x: a.x, y: y2 });
    } else return null;
    const simplified = simplifyPoints(next);
    return isOrthogonal(simplified) ? simplified : null;
  }

  function addBendAt(edgeKey, point) {
    const points = pathPointsForEdgeKey(edgeKey);
    if (points.length < 2) return false;
    let segmentIndex = -1;
    let best = Infinity;
    for (let index = 0; index < points.length - 1; index += 1) {
      const distance = distanceToSegment(point, points[index], points[index + 1]);
      if (distance < best) { best = distance; segmentIndex = index; }
    }
    if (segmentIndex < 0) return false;
    const nextPoints = addJog(points, segmentIndex, point);
    const route = nextPoints && routeFromPoints(nextPoints);
    if (!route) {
      flowHint.textContent = 'That segment is too short to add another orthogonal bend.';
      return false;
    }
    const before = window.CurriculumFlowchartRuntime?.snapshot?.();
    setManualRoute(edgeKey, route);
    selectedEdgeKey = edgeKey;
    selectedBendIndex = null;
    renderEdges();
    window.CurriculumFlowchartRuntime?.pushHistory?.(before, 'Add route bend');
    flowHint.textContent = 'Bend added. Drag the new handles to place the route precisely.';
    return true;
  }

  function movableLanes(points, index) {
    const last = points.length - 1;
    const lanes = [];
    const prev = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    if (!prev || !current || !next) return lanes;
    if (Math.abs(prev.x - current.x) < EPS && index - 1 > 0) lanes.push({ axis: 'x', a: index - 1, b: index });
    if (Math.abs(next.x - current.x) < EPS && index + 1 < last) lanes.push({ axis: 'x', a: index, b: index + 1 });
    if (Math.abs(prev.y - current.y) < EPS && index - 1 > 0) lanes.push({ axis: 'y', a: index - 1, b: index });
    if (Math.abs(next.y - current.y) < EPS && index + 1 < last) lanes.push({ axis: 'y', a: index, b: index + 1 });
    return lanes;
  }

  function previewPoints(edgeKey, points) {
    const path = relationshipPaths().find(item => item.dataset.edgeKey === edgeKey);
    if (!path) return;
    const orthogonal = serializeOrthogonal(points);
    if (!orthogonal) return;
    path.dataset.editRoute = orthogonal;
    path.setAttribute('d', applyAppearanceToPath(path, orthogonal));
    const hit = svg.querySelector(`.manual-route-hit[data-edge-key="${CSS.escape(edgeKey)}"]`);
    if (hit instanceof SVGPathElement) hit.setAttribute('d', path.getAttribute('d') || orthogonal);
    svg.querySelectorAll('.route-bend-handle').forEach(handle => {
      if (!(handle instanceof SVGCircleElement) || handle.dataset.edgeKey !== edgeKey) return;
      const index = Number(handle.dataset.pointIndex);
      const point = points[index];
      if (!point) return;
      handle.setAttribute('cx', String(point.x));
      handle.setAttribute('cy', String(point.y));
    });
  }

  function beginHandleDrag(event, handle) {
    const edgeKey = handle.dataset.edgeKey;
    const pointIndex = Number(handle.dataset.pointIndex);
    if (!edgeKey || !Number.isInteger(pointIndex)) return;
    const points = pathPointsForEdgeKey(edgeKey);
    if (pointIndex <= 0 || pointIndex >= points.length - 1) return;
    const lanes = movableLanes(points, pointIndex);
    if (!lanes.length) return;
    selectedEdgeKey = edgeKey;
    selectedBendIndex = pointIndex;
    dragState = {
      edgeKey,
      pointIndex,
      startClientX: event.clientX,
      startClientY: event.clientY,
      original: clone(points),
      working: clone(points),
      lanes,
      selectedLane: null,
      before: window.CurriculumFlowchartRuntime?.snapshot?.(),
      moved: false,
    };
    handle.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  function moveHandleDrag(event) {
    if (!dragState) return;
    const dx = (event.clientX - dragState.startClientX) / state.viewport.scale;
    const dy = (event.clientY - dragState.startClientY) / state.viewport.scale;
    if (!dragState.selectedLane && Math.abs(dx) + Math.abs(dy) > 2) {
      const preferredAxis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
      dragState.selectedLane = dragState.lanes.find(lane => lane.axis === preferredAxis) || dragState.lanes[0];
    }
    const lane = dragState.selectedLane;
    if (!lane) return;
    dragState.moved = true;
    dragState.working = clone(dragState.original);
    if (lane.axis === 'x') {
      const nextX = dragState.original[lane.a].x + dx;
      dragState.working[lane.a].x = nextX;
      dragState.working[lane.b].x = nextX;
    } else {
      const nextY = Math.max(4, dragState.original[lane.a].y + dy);
      dragState.working[lane.a].y = nextY;
      dragState.working[lane.b].y = nextY;
    }
    previewPoints(dragState.edgeKey, dragState.working);
    event.preventDefault();
  }

  function finishHandleDrag(cancelled = false) {
    const current = dragState;
    dragState = null;
    if (!current) return;
    if (!cancelled && current.moved) {
      const route = routeFromPoints(current.working);
      if (route) {
        setManualRoute(current.edgeKey, route);
        window.CurriculumFlowchartRuntime?.pushHistory?.(current.before, 'Manual route edit');
        flowHint.textContent = 'Manual bend position saved.';
      }
    }
    renderEdges();
  }

  function removeSelectedBend() {
    if (!selectedEdgeKey || selectedBendIndex == null || !manualRoute(selectedEdgeKey)) return;
    const points = pathPointsForEdgeKey(selectedEdgeKey);
    const index = selectedBendIndex;
    if (index <= 0 || index >= points.length - 1) return;
    const candidates = [];
    const one = clone(points); one.splice(index, 1); candidates.push(one);
    if (index + 1 < points.length - 1) { const pair = clone(points); pair.splice(index, 2); candidates.push(pair); }
    if (index - 1 > 0) { const pair = clone(points); pair.splice(index - 1, 2); candidates.push(pair); }
    const valid = candidates
      .map(simplifyPoints)
      .find(candidate => candidate.length >= 4 && isOrthogonal(candidate));
    if (!valid) {
      flowHint.textContent = 'That bend is structurally required. Add or reposition another bend before removing it.';
      return;
    }
    const route = routeFromPoints(valid);
    if (!route) return;
    const before = window.CurriculumFlowchartRuntime?.snapshot?.();
    setManualRoute(selectedEdgeKey, route);
    selectedBendIndex = null;
    renderEdges();
    window.CurriculumFlowchartRuntime?.pushHistory?.(before, 'Remove route bend');
    flowHint.textContent = 'Selected bend removed.';
  }

  function resetSelectedRoute() {
    if (!selectedEdgeKey || !manualRoute(selectedEdgeKey)) return;
    const before = window.CurriculumFlowchartRuntime?.snapshot?.();
    setManualRoute(selectedEdgeKey, null);
    selectedBendIndex = null;
    renderEdges();
    window.CurriculumFlowchartRuntime?.pushHistory?.(before, 'Reset manual route');
    flowHint.textContent = 'Relationship returned to automatic routing.';
  }

  function setAppearance(nextAppearance, label) {
    const before = window.CurriculumFlowchartRuntime?.snapshot?.();
    const next = config();
    next.appearance = {
      cornerStyle: nextAppearance.cornerStyle === 'rounded' ? 'rounded' : 'sharp',
      radius: clamp(Number(nextAppearance.radius) || 0, MIN_RADIUS, MAX_RADIUS),
    };
    saveConfig(next);
    renderEdges();
    window.CurriculumFlowchartRuntime?.pushHistory?.(before, label || 'Connector appearance');
  }

  function installControls() {
    if (document.querySelector('#manual-route-toolbar')) return;
    const toolbarScroll = document.querySelector('.flow-toolbar .toolbar-scroll');
    if (!(toolbarScroll instanceof HTMLElement)) return;
    const group = document.createElement('div');
    group.id = 'manual-route-toolbar';
    group.className = 'toolbar-group manual-route-toolbar';
    group.setAttribute('aria-label', 'Relationship route editing tools');
    group.innerHTML = `
      <span class="toolbar-label">Route</span>
      <button id="add-route-bend" class="toolbar-button compact" type="button">Add bend</button>
      <button id="remove-route-bend" class="toolbar-button compact" type="button" disabled>Remove bend</button>
      <button id="reset-manual-route" class="toolbar-button compact" type="button" disabled>Reset route</button>
      <label class="connector-corner-control">Corners
        <select id="connector-corner-style" aria-label="Connector corner style"><option value="sharp">90°</option><option value="rounded">Rounded</option></select>
      </label>
      <label class="connector-corner-control">Radius
        <input id="connector-corner-radius" type="number" min="${MIN_RADIUS}" max="${MAX_RADIUS}" step="1" inputmode="numeric" aria-label="Rounded connector corner radius in pixels" /> px
      </label>`;
    const layoutGroup = document.querySelector('.flow-toolbar .toolbar-group');
    if (layoutGroup?.parentElement) layoutGroup.insertAdjacentElement('afterend', group);
    else toolbarScroll.prepend(group);

    addButton = group.querySelector('#add-route-bend');
    removeButton = group.querySelector('#remove-route-bend');
    resetButton = group.querySelector('#reset-manual-route');
    styleSelect = group.querySelector('#connector-corner-style');
    radiusInput = group.querySelector('#connector-corner-radius');

    const current = appearance();
    if (styleSelect instanceof HTMLSelectElement) styleSelect.value = current.cornerStyle;
    if (radiusInput instanceof HTMLInputElement) {
      radiusInput.value = String(current.radius);
      radiusInput.disabled = current.cornerStyle !== 'rounded';
    }

    addButton?.addEventListener('click', () => {
      if (!selectedEdgeKey) {
        flowHint.textContent = 'Select a prerequisite/elective relationship first, then choose Add bend.';
        return;
      }
      addBendMode = !addBendMode;
      updateToolbarState();
      flowHint.textContent = addBendMode ? 'Add-bend mode: click the relationship segment where you want an orthogonal jog.' : 'Add-bend mode cancelled.';
    });
    removeButton?.addEventListener('click', removeSelectedBend);
    resetButton?.addEventListener('click', resetSelectedRoute);
    styleSelect?.addEventListener('change', () => {
      const currentAppearance = appearance();
      const style = styleSelect.value === 'rounded' ? 'rounded' : 'sharp';
      setAppearance({ ...currentAppearance, cornerStyle: style }, style === 'rounded' ? 'Rounded connector corners' : '90 degree connector corners');
      if (radiusInput instanceof HTMLInputElement) radiusInput.disabled = style !== 'rounded';
      flowHint.textContent = style === 'rounded' ? 'Connector bends now render with radial curves.' : 'Connector bends now render as sharp 90° corners.';
    });
    radiusInput?.addEventListener('change', () => {
      const currentAppearance = appearance();
      const radius = clamp(Number(radiusInput.value) || 0, MIN_RADIUS, MAX_RADIUS);
      radiusInput.value = String(radius);
      setAppearance({ ...currentAppearance, radius }, 'Connector corner radius');
      flowHint.textContent = `Rounded connector radius set to ${radius} px.`;
    });
    radiusInput?.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); radiusInput.blur(); }
    });

    const style = document.createElement('style');
    style.textContent = `
      .manual-route-toolbar{gap:6px}
      .connector-corner-control{display:inline-flex;align-items:center;gap:4px;color:#475467;font-size:.78rem;font-weight:650;white-space:nowrap}
      #connector-corner-style,#connector-corner-radius{min-height:34px;border:1px solid #d8deea;border-radius:7px;background:#fff;color:#172033;padding:4px 6px;font:inherit}
      #connector-corner-radius{width:52px}
      .connections-svg .relationship{pointer-events:none}
      .manual-route-hit{fill:none;stroke:rgba(0,0,0,0);stroke-width:14;vector-effect:non-scaling-stroke;pointer-events:stroke;cursor:pointer}
      .relationship.manual-route-selected{filter:drop-shadow(0 0 1.5px rgba(37,87,214,.75));stroke-width:2.25}
      .route-anchor-handle{fill:#fff;stroke:#2557d6;stroke-width:1.8;vector-effect:non-scaling-stroke;pointer-events:none}
      .route-bend-handle{fill:#2557d6;stroke:#fff;stroke-width:2;vector-effect:non-scaling-stroke;pointer-events:all;cursor:move}
      .route-bend-handle.selected{fill:#173f9f;stroke:#dce7ff;stroke-width:3}
      #manual-route-interaction-layer{pointer-events:none}
      #manual-route-interaction-layer .manual-route-hit,#manual-route-interaction-layer .route-bend-handle{pointer-events:stroke}
      #manual-route-interaction-layer .route-bend-handle{pointer-events:all}
      @media(max-width:760px){#connector-corner-style,#connector-corner-radius{min-height:42px}.manual-route-hit{stroke-width:20}}
    `;
    document.head.append(style);
  }

  const baseRenderEdgesForManualRouting = renderEdges;
  renderEdges = () => {
    baseRenderEdgesForManualRouting();
    annotatePaths();
    applyManualOrthogonalRoutes();
    updateInteractionLayer();
    scheduleFinalise();
  };

  if (window.CurriculumFlowchartRuntime) window.CurriculumFlowchartRuntime.renderFlow = () => renderFlow();

  svg.addEventListener('pointerdown', event => {
    const handle = event.target instanceof Element ? event.target.closest('.route-bend-handle') : null;
    if (handle instanceof SVGCircleElement) {
      beginHandleDrag(event, handle);
      return;
    }
    const hit = event.target instanceof Element ? event.target.closest('.manual-route-hit') : null;
    if (hit instanceof SVGPathElement) {
      event.preventDefault();
      event.stopPropagation();
      const key = hit.dataset.edgeKey;
      if (!key) return;
      selectEdge(key);
      if (addBendMode) {
        addBendMode = false;
        updateToolbarState();
        addBendAt(key, canvasPoint(event));
      }
    }
  }, true);

  svg.addEventListener('click', event => {
    const hit = event.target instanceof Element ? event.target.closest('.manual-route-hit') : null;
    if (!(hit instanceof SVGPathElement) || !hit.dataset.edgeKey) return;
    event.preventDefault();
    event.stopPropagation();
    selectEdge(hit.dataset.edgeKey, false);
  });

  svg.addEventListener('dblclick', event => {
    const hit = event.target instanceof Element ? event.target.closest('.manual-route-hit') : null;
    if (!(hit instanceof SVGPathElement) || !hit.dataset.edgeKey) return;
    event.preventDefault();
    event.stopPropagation();
    addBendMode = false;
    selectEdge(hit.dataset.edgeKey, false);
    addBendAt(hit.dataset.edgeKey, canvasPoint(event));
  });

  svg.addEventListener('contextmenu', event => {
    const hit = event.target instanceof Element ? event.target.closest('.manual-route-hit') : null;
    if (!(hit instanceof SVGPathElement) || !hit.dataset.edgeKey) return;
    event.preventDefault();
    selectEdge(hit.dataset.edgeKey, false);
    flowHint.textContent = 'Relationship selected. Double-click a segment to add a bend, or use the Route tools.';
  });

  document.addEventListener('pointermove', moveHandleDrag, true);
  document.addEventListener('pointerup', () => finishHandleDrag(false), true);
  document.addEventListener('pointercancel', () => finishHandleDrag(true), true);

  document.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    const handle = event.target.closest('.route-bend-handle');
    if (!(handle instanceof SVGCircleElement)) return;
    selectedBendIndex = Number(handle.dataset.pointIndex);
    updateInteractionLayer();
  }, true);

  const routeObserver = new MutationObserver(mutations => {
    const relationshipStructureChanged = mutations.some(mutation =>
      [...mutation.addedNodes, ...mutation.removedNodes].some(node => {
        if (!(node instanceof Element)) return false;
        if (node.matches?.('path.relationship')) return true;
        return Boolean(node.querySelector?.('path.relationship'));
      }));
    if (relationshipStructureChanged) scheduleFinalise();
  });
  routeObserver.observe(svg, { childList: true, subtree: true });

  const routing = window.CurriculumConnectorRouting;
  if (routing?.applyNow) {
    const originalApplyNow = routing.applyNow.bind(routing);
    routing.applyNow = () => { const result = originalApplyNow(); finaliseRelationshipGeometry(); return result; };
  }
  if (routing?.request) {
    const originalRequest = routing.request.bind(routing);
    routing.request = () => { const result = originalRequest(); scheduleFinalise(); return result; };
  }

  const baseBuildExportSvgForManualRouting = buildExportSvg;
  buildExportSvg = () => {
    renderEdges();
    window.CurriculumConnectorRouting?.applyNow?.();
    finaliseRelationshipGeometry();
    const livePaths = relationshipPaths().map(path => path.getAttribute('d') || '');
    const svgText = baseBuildExportSvgForManualRouting();
    try {
      const documentXml = new DOMParser().parseFromString(svgText, 'image/svg+xml');
      const defs = documentXml.querySelector('defs');
      const sourceMarker = documentXml.querySelector('#export-arrow');
      if (defs && sourceMarker) {
        const finalMarker = sourceMarker.cloneNode(true);
        finalMarker.setAttribute('id', 'final-route-arrow');
        defs.append(finalMarker);
      }
      const exportPaths = [...documentXml.querySelectorAll('path[marker-end*="export-arrow"]')]
        .filter(path => !path.closest('#export-legend'));
      const { edges } = currentEdges();
      exportPaths.forEach((path, index) => {
        if (livePaths[index]) path.setAttribute('d', livePaths[index]);
        path.setAttribute('marker-end', 'url(#final-route-arrow)');
        const edge = edges[index];
        if (edge && manualRoute(edge.key)) path.setAttribute('data-manual-route', 'true');
      });
      return new XMLSerializer().serializeToString(documentXml.documentElement);
    } catch {
      return svgText;
    }
  };

  const exportState = () => clone(config());
  const importState = (value, options = {}) => {
    const all = allConfigs();
    all[activeCurriculumId()] = normalizeCurriculumConfig(value || defaultCurriculumConfig());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    if (styleSelect instanceof HTMLSelectElement) styleSelect.value = appearance().cornerStyle;
    if (radiusInput instanceof HTMLInputElement) {
      radiusInput.value = String(appearance().radius);
      radiusInput.disabled = appearance().cornerStyle !== 'rounded';
    }
    if (options.render !== false) renderFlow();
  };

  window.CurriculumManualRouting = {
    exportState,
    importState,
    getAppearance: () => clone(appearance()),
    hasManualRoute: key => Boolean(manualRoute(key)),
    requestRender: () => renderEdges(),
    finalise: finaliseRelationshipGeometry,
  };

  installControls();
  renderEdges();
})();
