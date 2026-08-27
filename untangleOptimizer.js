(() => {
  const NativeBlob = window.Blob;
  const APP_STATE_KEY = 'curriculum-flowchart:v1';
  const CURRICULUM_LIBRARY_KEY = 'curriculum-flowchart:curricula:v1';
  const STRATEGY_KEY = 'curriculum-flowchart:sort-strategies:v1';
  const MESSAGE_KEY = 'curriculum-flowchart:sort-message:v1';
  const SNAPSHOT_KEY = 'curriculum-flowchart:layout-checkpoints:v1';
  const W = 184;
  const H = 78;
  const COMPACT_H = 62;
  const COL = 260;
  const TOP = 132;
  const COREQ_GAP = 34;
  const GAP = 18;
  const ROUTE_CLEARANCE = 10;
  const LANE_STEP = 7;
  const YEARS = ['First Year', 'Second Year', 'Third Year', 'Fourth Year'];
  const TERMS = ['First Semester', 'Second Semester', 'Short Term'];

  const norm = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const safeParse = value => {
    try { return value ? JSON.parse(value) : null; } catch { return null; }
  };
  const unique = values => [...new Set(values.filter(Boolean))];
  const ordered = (values, defaults) => [
    ...defaults.filter(value => values.includes(value)),
    ...unique(values).filter(value => !defaults.includes(value)).sort(),
  ];
  const clone = value => JSON.parse(JSON.stringify(value));

  function activeCurriculumId() {
    const library = safeParse(localStorage.getItem(CURRICULUM_LIBRARY_KEY));
    return String(library?.activeId || 'default');
  }

  function strategyMap() {
    const stored = safeParse(localStorage.getItem(STRATEGY_KEY));
    return stored && typeof stored === 'object' ? stored : {};
  }

  function rememberConflictStrategy() {
    const map = strategyMap();
    map[activeCurriculumId()] = 'conflicts';
    localStorage.setItem(STRATEGY_KEY, JSON.stringify(map));
  }

  function courseTrack(course) {
    const explicit = String(course.track || '').trim();
    if (explicit) return explicit;
    if (/\sS\d+/i.test(String(course.courseNo || ''))) return 'Structural';
    if (/\sG\d+/i.test(String(course.courseNo || ''))) return 'Geotechnical';
    return 'Common';
  }

  function visibleCourses(state) {
    const hidden = new Set((state.hiddenTracks || []).map(norm));
    const filter = norm(state.trackFilter || 'all');
    return (state.courses || []).filter(course => {
      const track = norm(courseTrack(course));
      if (hidden.has(track)) return false;
      return filter === 'all' || track === 'common' || track === filter;
    });
  }

  function columnsFor(courses) {
    const years = ordered(unique(courses.map(course => course.yearLevel)), YEARS);
    const result = [];
    let index = 0;
    for (const year of years) {
      const terms = ordered(unique(courses.filter(course => course.yearLevel === year).map(course => course.semester)), TERMS);
      for (const term of terms) result.push({ year, term, x: 34 + index++ * COL });
    }
    return result;
  }

  function unionFind(ids) {
    const parent = new Map(ids.map(id => [id, id]));
    const find = id => {
      let root = parent.get(id) || id;
      while ((parent.get(root) || root) !== root) root = parent.get(root);
      let current = id;
      while ((parent.get(current) || current) !== root) {
        const next = parent.get(current);
        parent.set(current, root);
        current = next;
      }
      return root;
    };
    const union = (a, b) => {
      const ar = find(a);
      const br = find(b);
      if (ar !== br) parent.set(br, ar);
    };
    return { find, union };
  }

  function buildLayout(state) {
    const courses = visibleCourses(state);
    const columns = columnsFor(courses);
    const byCode = new Map(courses.map(course => [norm(course.courseNo), course]));
    const byId = new Map(courses.map(course => [course.id, course]));
    const columnIndex = new Map(columns.map((column, index) => [`${column.year}|${column.term}`, index]));
    const uf = unionFind(courses.map(course => course.id));

    for (const course of courses) {
      for (const code of course.corequisites || []) {
        const other = byCode.get(norm(code));
        if (!other || other.id === course.id) continue;
        if (other.yearLevel === course.yearLevel && other.semester === course.semester) uf.union(course.id, other.id);
      }
    }

    const grouped = new Map();
    for (const course of courses) {
      const root = uf.find(course.id);
      const ids = grouped.get(root) || [];
      ids.push(course.id);
      grouped.set(root, ids);
    }

    const unitById = new Map();
    const layoutColumns = columns.map((column, index) => {
      const relevant = courses.filter(course => course.yearLevel === column.year && course.semester === column.term);
      const seen = new Set();
      const units = [];
      for (const course of relevant) {
        if (seen.has(course.id)) continue;
        const ids = (grouped.get(uf.find(course.id)) || [course.id])
          .filter(id => {
            const member = byId.get(id);
            return member?.yearLevel === column.year && member?.semester === column.term;
          })
          .sort((a, b) => (state.positions?.[a]?.y ?? 0) - (state.positions?.[b]?.y ?? 0));
        ids.forEach(id => seen.add(id));
        const centers = ids.map(id => (state.positions?.[id]?.y ?? TOP) + H / 2);
        const center = centers.reduce((sum, value) => sum + value, 0) / Math.max(1, centers.length);
        const unit = {
          key: [...ids].sort().join('+'),
          ids,
          columnIndex: index,
          height: ids.length * H + Math.max(0, ids.length - 1) * COREQ_GAP,
          center,
          originalCenter: center,
        };
        units.push(unit);
        ids.forEach(id => unitById.set(id, unit));
      }
      units.sort((a, b) => a.center - b.center);
      return units;
    });

    const edges = [];
    const edgeKeys = new Set();
    for (const course of courses) {
      const target = unitById.get(course.id);
      for (const code of [...(course.prerequisites || []), ...(course.electivePrerequisites || [])]) {
        const sourceCourse = byCode.get(norm(code));
        const source = sourceCourse && unitById.get(sourceCourse.id);
        if (!source || !target || source.key === target.key) continue;
        const key = `${source.key}->${target.key}`;
        if (edgeKeys.has(key)) continue;
        edgeKeys.add(key);
        edges.push({ key, source, target });
      }
    }

    const neighbors = new Map();
    const addNeighbor = (a, b) => {
      const values = neighbors.get(a.key) || new Set();
      values.add(b.key);
      neighbors.set(a.key, values);
    };
    for (const edge of edges) {
      addNeighbor(edge.source, edge.target);
      addNeighbor(edge.target, edge.source);
    }

    return { courses, columns, byId, unitById, layoutColumns, edges, neighbors, columnIndex };
  }

  function initializeCenters(layout, gap = GAP) {
    for (const units of layout.layoutColumns) {
      let top = TOP;
      for (const unit of units) {
        unit.center = top + unit.height / 2;
        top += unit.height + gap;
      }
    }
  }

  function barycentricSort(layout, passes = 32) {
    const columnOf = new Map();
    layout.layoutColumns.forEach((units, columnIndex) => units.forEach(unit => columnOf.set(unit.key, columnIndex)));
    const rankMap = () => {
      const ranks = new Map();
      layout.layoutColumns.forEach(units => units.forEach((unit, index) => ranks.set(unit.key, index)));
      return ranks;
    };

    const sweep = forward => {
      const indices = forward
        ? Array.from({ length: Math.max(0, layout.layoutColumns.length - 1) }, (_, index) => index + 1)
        : Array.from({ length: Math.max(0, layout.layoutColumns.length - 1) }, (_, index) => layout.layoutColumns.length - 2 - index);
      for (const columnIndex of indices) {
        const ranks = rankMap();
        const scored = layout.layoutColumns[columnIndex].map(unit => {
          const values = [...(layout.neighbors.get(unit.key) || [])]
            .filter(key => {
              const otherColumn = columnOf.get(key);
              return otherColumn !== undefined && (forward ? otherColumn < columnIndex : otherColumn > columnIndex);
            })
            .map(key => ranks.get(key))
            .filter(value => value !== undefined);
          return {
            unit,
            score: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : ranks.get(unit.key) || 0,
          };
        });
        scored.sort((a, b) => a.score - b.score || a.unit.originalCenter - b.unit.originalCenter || a.unit.key.localeCompare(b.unit.key));
        layout.layoutColumns[columnIndex] = scored.map(item => item.unit);
      }
    };

    for (let pass = 0; pass < passes; pass += 1) {
      sweep(true);
      sweep(false);
    }
  }

  function placeColumn(units, desired, gap = GAP) {
    if (!units.length) return;
    const tops = [];
    for (let index = 0; index < units.length; index += 1) {
      const unit = units[index];
      const preferred = (desired.get(unit.key) ?? unit.center) - unit.height / 2;
      const minimum = index === 0 ? TOP : tops[index - 1] + units[index - 1].height + gap;
      tops[index] = Math.max(preferred, minimum);
    }
    for (let index = units.length - 2; index >= 0; index -= 1) {
      const maximum = tops[index + 1] - gap - units[index].height;
      tops[index] = Math.max(TOP, Math.min(tops[index], maximum));
    }
    for (let index = 1; index < units.length; index += 1) {
      tops[index] = Math.max(tops[index], tops[index - 1] + units[index - 1].height + gap);
    }
    units.forEach((unit, index) => { unit.center = tops[index] + unit.height / 2; });
  }

  function relaxConnectedCenters(layout, passes = 18, preserveCurrent = false) {
    if (!preserveCurrent) initializeCenters(layout, GAP);
    for (let pass = 0; pass < passes; pass += 1) {
      const forward = pass % 2 === 0;
      const columns = forward ? layout.layoutColumns : [...layout.layoutColumns].reverse();
      for (const units of columns) {
        const desired = new Map();
        for (const unit of units) {
          const neighborUnits = [...(layout.neighbors.get(unit.key) || [])]
            .flatMap(key => layout.layoutColumns.flat().filter(candidate => candidate.key === key));
          if (!neighborUnits.length) continue;
          const values = neighborUnits.map(neighbor => {
            const span = Math.max(1, Math.abs(neighbor.columnIndex - unit.columnIndex));
            return { center: neighbor.center, weight: span === 1 ? 10 : span === 2 ? 4 : 1 };
          });
          const total = values.reduce((sum, item) => sum + item.weight, 0);
          const connectedCenter = values.reduce((sum, item) => sum + item.center * item.weight, 0) / Math.max(1, total);
          const anchorWeight = preserveCurrent ? 4 : 1.25;
          desired.set(unit.key, (connectedCenter * total + unit.originalCenter * anchorWeight) / (total + anchorWeight));
        }
        placeColumn(units, desired, GAP);
      }
    }
  }

  function unitBox(unit, columns) {
    const x = columns[unit.columnIndex]?.x ?? 34;
    return {
      unit,
      left: x,
      right: x + W,
      top: unit.center - unit.height / 2,
      bottom: unit.center + unit.height / 2,
    };
  }

  function projectedY(edge, boundary) {
    const sourceColumn = edge.source.columnIndex;
    const targetColumn = edge.target.columnIndex;
    if (sourceColumn === targetColumn) return (edge.source.center + edge.target.center) / 2;
    const low = Math.min(sourceColumn, targetColumn);
    const high = Math.max(sourceColumn, targetColumn);
    const t = (boundary - low) / Math.max(1, high - low);
    const leftY = sourceColumn <= targetColumn ? edge.source.center : edge.target.center;
    const rightY = sourceColumn <= targetColumn ? edge.target.center : edge.source.center;
    return leftY + (rightY - leftY) * t;
  }

  function graphCost(layout, displacementWeight) {
    let cost = 0;
    const edges = layout.edges;

    for (let firstIndex = 0; firstIndex < edges.length; firstIndex += 1) {
      const a = edges[firstIndex];
      const aLow = Math.min(a.source.columnIndex, a.target.columnIndex);
      const aHigh = Math.max(a.source.columnIndex, a.target.columnIndex);
      if (aLow === aHigh) continue;
      for (let secondIndex = firstIndex + 1; secondIndex < edges.length; secondIndex += 1) {
        const b = edges[secondIndex];
        if (a.source.key === b.source.key || a.source.key === b.target.key || a.target.key === b.source.key || a.target.key === b.target.key) continue;
        const bLow = Math.min(b.source.columnIndex, b.target.columnIndex);
        const bHigh = Math.max(b.source.columnIndex, b.target.columnIndex);
        const low = Math.max(aLow, bLow);
        const high = Math.min(aHigh, bHigh);
        if (high <= low) continue;
        const aStart = projectedY(a, low);
        const aEnd = projectedY(a, high);
        const bStart = projectedY(b, low);
        const bEnd = projectedY(b, high);
        const startDelta = aStart - bStart;
        const endDelta = aEnd - bEnd;
        if (startDelta * endDelta < -1) cost += 160;
        const closest = Math.min(Math.abs(startDelta), Math.abs(endDelta));
        if (closest < 10) cost += (10 - closest) * 8;
      }
    }

    const boxes = layout.layoutColumns.flat().map(unit => unitBox(unit, layout.columns));
    for (const edge of edges) {
      const low = Math.min(edge.source.columnIndex, edge.target.columnIndex);
      const high = Math.max(edge.source.columnIndex, edge.target.columnIndex);
      const verticalDifference = Math.abs(edge.source.center - edge.target.center);
      cost += verticalDifference * 0.07;
      for (const box of boxes) {
        if (box.unit.key === edge.source.key || box.unit.key === edge.target.key) continue;
        if (box.unit.columnIndex <= low || box.unit.columnIndex >= high) continue;
        const y = projectedY(edge, box.unit.columnIndex);
        if (y > box.top - ROUTE_CLEARANCE && y < box.bottom + ROUTE_CLEARANCE) cost += 260;
      }
    }

    let maxBottom = TOP;
    for (const unit of layout.layoutColumns.flat()) {
      cost += Math.abs(unit.center - unit.originalCenter) * displacementWeight;
      maxBottom = Math.max(maxBottom, unit.center + unit.height / 2);
    }
    cost += Math.max(0, maxBottom - TOP) * 0.012;
    return cost;
  }

  function boundsFor(units, index, gap = GAP) {
    const unit = units[index];
    const lower = index === 0
      ? TOP + unit.height / 2
      : units[index - 1].center + (units[index - 1].height + unit.height) / 2 + gap;
    const upper = index === units.length - 1
      ? Infinity
      : units[index + 1].center - (units[index + 1].height + unit.height) / 2 - gap;
    return { lower, upper };
  }

  function localUntangle(layout, { aggressive = false, reorder = false } = {}) {
    const displacementWeight = aggressive ? 0.12 : 0.55;
    const offsets = aggressive ? [-56, -36, -20, 20, 36, 56] : [-36, -20, 20, 36];
    let best = graphCost(layout, displacementWeight);

    if (reorder) {
      for (let pass = 0; pass < 2; pass += 1) {
        for (const units of layout.layoutColumns) {
          for (let index = 0; index < units.length - 1; index += 1) {
            const a = units[index];
            const b = units[index + 1];
            const centers = new Map(units.map(unit => [unit.key, unit.center]));
            [units[index], units[index + 1]] = [b, a];
            initializeColumnFromCurrent(units);
            const score = graphCost(layout, displacementWeight);
            if (score + 0.01 < best) best = score;
            else {
              [units[index], units[index + 1]] = [a, b];
              units.forEach(unit => { unit.center = centers.get(unit.key); });
            }
          }
        }
      }
    }

    for (let pass = 0; pass < (aggressive ? 5 : 3); pass += 1) {
      let improved = false;
      for (const units of layout.layoutColumns) {
        for (let index = 0; index < units.length; index += 1) {
          const unit = units[index];
          const original = unit.center;
          const neighborCenters = [...(layout.neighbors.get(unit.key) || [])]
            .map(key => layout.layoutColumns.flat().find(candidate => candidate.key === key)?.center)
            .filter(value => Number.isFinite(value));
          const average = neighborCenters.length
            ? neighborCenters.reduce((sum, value) => sum + value, 0) / neighborCenters.length
            : original;
          const { lower, upper } = boundsFor(units, index);
          const candidates = unique([
            original,
            average,
            ...offsets.map(offset => original + offset),
          ].map(value => Math.max(lower, Math.min(upper, value))).filter(Number.isFinite));

          let chosen = original;
          let chosenScore = best;
          for (const candidate of candidates) {
            unit.center = candidate;
            const score = graphCost(layout, displacementWeight);
            if (score + 0.01 < chosenScore) {
              chosen = candidate;
              chosenScore = score;
            }
          }
          unit.center = chosen;
          if (chosenScore + 0.01 < best) {
            best = chosenScore;
            improved = true;
          }
        }
      }
      if (!improved) break;
    }
    return best;
  }

  function initializeColumnFromCurrent(units) {
    let top = TOP;
    for (const unit of units) {
      const preferredTop = unit.center - unit.height / 2;
      const nextTop = Math.max(top, preferredTop);
      unit.center = nextTop + unit.height / 2;
      top = nextTop + unit.height + GAP;
    }
  }

  function writePositions(state, layout) {
    state.positions ||= {};
    for (const units of layout.layoutColumns) {
      for (const unit of units) {
        let y = unit.center - unit.height / 2;
        const x = layout.columns[unit.columnIndex]?.x ?? 34;
        for (const id of unit.ids) {
          state.positions[id] = { x, y };
          y += H + COREQ_GAP;
        }
      }
    }
  }

  function saveOptimizedState(state, strategy, message) {
    state.layoutMode = 'optimized';
    state.sortStrategy = strategy;
    state.updatedAt = Date.now();
    localStorage.setItem(APP_STATE_KEY, JSON.stringify(state));
    sessionStorage.setItem(MESSAGE_KEY, message);
    window.location.reload();
  }

  function applyLeastConflicts() {
    const state = safeParse(localStorage.getItem(APP_STATE_KEY));
    if (!state?.courses?.length) return;
    const layout = buildLayout(state);
    if (!layout.courses.length) return;

    barycentricSort(layout, 36);
    initializeCenters(layout, GAP);
    relaxConnectedCenters(layout, 14, false);
    const before = graphCost(layout, 0.12);
    const after = localUntangle(layout, { aggressive: true, reorder: true });
    writePositions(state, layout);
    rememberConflictStrategy();
    const filterLabel = state.trackFilter === 'all' ? 'all visible tracks' : `${state.trackFilter} + Common`;
    saveOptimizedState(
      state,
      'conflicts',
      `Least Line Conflicts sort applied to ${filterLabel}. Joint node placement reduced the conflict score from ${Math.round(before)} to ${Math.round(after)}, then routing lanes were re-optimized.`,
    );
  }

  function untangleCurrent() {
    const state = safeParse(localStorage.getItem(APP_STATE_KEY));
    if (!state?.courses?.length) return;
    const layout = buildLayout(state);
    if (!layout.courses.length) return;

    layout.layoutColumns.forEach(units => units.sort((a, b) => a.center - b.center));
    relaxConnectedCenters(layout, 8, true);
    const before = graphCost(layout, 0.55);
    const after = localUntangle(layout, { aggressive: false, reorder: false });
    writePositions(state, layout);
    saveOptimizedState(
      state,
      state.sortStrategy || 'untangled',
      `Untangled the current layout without changing semester columns or vertical course order. Conflict score improved from ${Math.round(before)} to ${Math.round(after)}; connector propagation lanes were also re-evaluated.`,
    );
  }

  function checkpoints() {
    const value = safeParse(localStorage.getItem(SNAPSHOT_KEY));
    return value && typeof value === 'object' ? value : {};
  }

  function saveCheckpoint() {
    const state = safeParse(localStorage.getItem(APP_STATE_KEY));
    if (!state?.positions) return;
    const map = checkpoints();
    map[activeCurriculumId()] = {
      savedAt: Date.now(),
      positions: clone(state.positions),
      viewport: state.viewport ? clone(state.viewport) : null,
      layoutMode: state.layoutMode || 'basic',
      sortStrategy: state.sortStrategy || null,
    };
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(map));
    updateRestoreButton();
    const hint = document.querySelector('#flow-hint');
    if (hint instanceof HTMLElement) hint.textContent = 'Current node positions saved for this curriculum.';
  }

  function restoreCheckpoint() {
    const map = checkpoints();
    const checkpoint = map[activeCurriculumId()];
    if (!checkpoint?.positions) return;
    if (!window.confirm('Restore the saved node positions for this curriculum?')) return;
    const state = safeParse(localStorage.getItem(APP_STATE_KEY));
    if (!state) return;
    const validIds = new Set((state.courses || []).map(course => course.id));
    const restored = {};
    for (const [id, position] of Object.entries(checkpoint.positions)) {
      if (validIds.has(id)) restored[id] = position;
    }
    state.positions = { ...(state.positions || {}), ...restored };
    if (checkpoint.viewport) state.viewport = checkpoint.viewport;
    state.layoutMode = checkpoint.layoutMode || state.layoutMode || 'basic';
    if (checkpoint.sortStrategy) state.sortStrategy = checkpoint.sortStrategy;
    state.updatedAt = Date.now();
    localStorage.setItem(APP_STATE_KEY, JSON.stringify(state));
    sessionStorage.setItem(MESSAGE_KEY, 'Saved node positions restored for this curriculum.');
    window.location.reload();
  }

  let restoreButton = null;
  function updateRestoreButton() {
    if (!(restoreButton instanceof HTMLButtonElement)) return;
    const checkpoint = checkpoints()[activeCurriculumId()];
    restoreButton.disabled = !checkpoint?.positions;
    restoreButton.title = checkpoint?.savedAt
      ? `Restore positions saved ${new Date(checkpoint.savedAt).toLocaleString()}`
      : 'No saved positions for this curriculum';
  }

  const number = value => Number.parseFloat(value || '0');
  const format = value => Number(value.toFixed(3)).toString();

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

  function serializeOrthogonalPath(points) {
    if (!points.length) return '';
    let value = `M ${format(points[0].x)} ${format(points[0].y)}`;
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const point = points[index];
      if (Math.abs(previous.y - point.y) < 0.001) value += ` H ${format(point.x)}`;
      else if (Math.abs(previous.x - point.x) < 0.001) value += ` V ${format(point.y)}`;
      else return '';
    }
    return value;
  }

  function segmentList(points) {
    const result = [];
    for (let index = 0; index < points.length - 1; index += 1) {
      const a = points[index];
      const b = points[index + 1];
      if (Math.abs(a.x - b.x) < 0.001) result.push({ kind: 'v', x: a.x, low: Math.min(a.y, b.y), high: Math.max(a.y, b.y) });
      else if (Math.abs(a.y - b.y) < 0.001) result.push({ kind: 'h', y: a.y, low: Math.min(a.x, b.x), high: Math.max(a.x, b.x) });
    }
    return result;
  }

  const overlaps = (aLow, aHigh, bLow, bHigh) => Math.min(aHigh, bHigh) - Math.max(aLow, bLow);

  function lineConflictScore(segments, accepted) {
    let score = 0;
    for (const a of segments) {
      for (const b of accepted) {
        if (a.kind === 'v' && b.kind === 'v') {
          const overlap = overlaps(a.low, a.high, b.low, b.high);
          if (overlap > 0 && Math.abs(a.x - b.x) < 0.75) score += 900 + overlap * 2;
          else if (overlap > 0 && Math.abs(a.x - b.x) < LANE_STEP - 0.5) score += 90;
        } else if (a.kind === 'h' && b.kind === 'h') {
          const overlap = overlaps(a.low, a.high, b.low, b.high);
          if (overlap > 0 && Math.abs(a.y - b.y) < 0.75) score += 420 + overlap;
          else if (overlap > 0 && Math.abs(a.y - b.y) < LANE_STEP - 0.5) score += 55;
        } else {
          const vertical = a.kind === 'v' ? a : b;
          const horizontal = a.kind === 'h' ? a : b;
          if (
            vertical.x > horizontal.low + 0.5 &&
            vertical.x < horizontal.high - 0.5 &&
            horizontal.y > vertical.low + 0.5 &&
            horizontal.y < vertical.high - 0.5
          ) score += 34;
        }
      }
    }
    return score;
  }

  function pointInBox(point, box) {
    return point.x >= box.left - 1 && point.x <= box.right + 1 && point.y >= box.top - 1 && point.y <= box.bottom + 1;
  }

  function pathBlocked(points, boxes) {
    const sourceIgnored = new Set(boxes.map((box, index) => pointInBox(points[0], box) ? index : -1).filter(index => index >= 0));
    const targetIgnored = new Set(boxes.map((box, index) => pointInBox(points.at(-1), box) ? index : -1).filter(index => index >= 0));
    for (let index = 0; index < points.length - 1; index += 1) {
      const a = points[index];
      const b = points[index + 1];
      const ignored = index === 0 ? sourceIgnored : index === points.length - 2 ? targetIgnored : new Set();
      for (let boxIndex = 0; boxIndex < boxes.length; boxIndex += 1) {
        if (ignored.has(boxIndex)) continue;
        const box = boxes[boxIndex];
        if (Math.abs(a.x - b.x) < 0.001) {
          const low = Math.min(a.y, b.y);
          const high = Math.max(a.y, b.y);
          if (
            a.x > box.left - ROUTE_CLEARANCE &&
            a.x < box.right + ROUTE_CLEARANCE &&
            low < box.bottom + ROUTE_CLEARANCE &&
            high > box.top - ROUTE_CLEARANCE
          ) return true;
        } else if (Math.abs(a.y - b.y) < 0.001) {
          const low = Math.min(a.x, b.x);
          const high = Math.max(a.x, b.x);
          if (
            a.y > box.top - ROUTE_CLEARANCE &&
            a.y < box.bottom + ROUTE_CLEARANCE &&
            low < box.right + ROUTE_CLEARANCE &&
            high > box.left - ROUTE_CLEARANCE
          ) return true;
        }
      }
    }
    return false;
  }

  function candidateXs(baseX, sourceX, targetX) {
    const result = [baseX, (sourceX + targetX) / 2];
    for (let step = 1; step <= 16; step += 1) result.push(baseX + step * LANE_STEP, baseX - step * LANE_STEP);
    return unique(result.map(value => Number(value.toFixed(3))));
  }

  function optimizePathPropagation(paths, boxes) {
    const accepted = [];
    const orderedPaths = [...paths].sort((a, b) => String(a.getAttribute('d')).localeCompare(String(b.getAttribute('d'))));
    for (const path of orderedPaths) {
      const points = parseOrthogonalPath(path.getAttribute('d') || '');
      if (points.length < 4) {
        accepted.push(...segmentList(points));
        continue;
      }

      let changed = false;
      for (let index = 0; index < points.length - 1; index += 1) {
        const a = points[index];
        const b = points[index + 1];
        if (Math.abs(a.x - b.x) > 0.001 || Math.abs(a.y - b.y) < 1) continue;
        const baseX = a.x;
        const sourceX = points[0].x;
        const targetX = points.at(-1).x;
        let bestX = baseX;
        let bestScore = Infinity;

        for (const candidateX of candidateXs(baseX, sourceX, targetX)) {
          const candidatePoints = points.map(point => ({ ...point }));
          candidatePoints[index].x = candidateX;
          candidatePoints[index + 1].x = candidateX;
          if (pathBlocked(candidatePoints, boxes)) continue;
          const outside = Math.max(0, Math.min(sourceX, targetX) - candidateX, candidateX - Math.max(sourceX, targetX));
          const score =
            lineConflictScore(segmentList(candidatePoints), accepted) +
            Math.abs(candidateX - baseX) * 0.12 +
            outside * 0.65;
          if (score < bestScore - 0.001) {
            bestScore = score;
            bestX = candidateX;
          }
        }

        if (Math.abs(bestX - baseX) > 0.001) {
          points[index].x = bestX;
          points[index + 1].x = bestX;
          changed = true;
        }
      }

      if (changed) {
        const serialized = serializeOrthogonalPath(points);
        if (serialized) {
          path.setAttribute('d', serialized);
          path.setAttribute('data-untangled-propagation', 'true');
        }
      }
      accepted.push(...segmentList(points));
    }
  }

  function liveBoxes() {
    const flowPanel = document.querySelector('#flow-panel');
    const nodesLayer = document.querySelector('#nodes-layer');
    if (!(nodesLayer instanceof HTMLElement)) return [];
    const height = flowPanel?.classList.contains('hide-node-units') ? COMPACT_H : H;
    return [...nodesLayer.querySelectorAll('.course-node')].map(node => ({
      left: number(node.style.left),
      right: number(node.style.left) + W,
      top: number(node.style.top),
      bottom: number(node.style.top) + height,
    }));
  }

  let propagationScheduled = false;
  function schedulePropagationOptimization() {
    if (propagationScheduled) return;
    propagationScheduled = true;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      propagationScheduled = false;
      const svg = document.querySelector('#connections-svg');
      if (!(svg instanceof SVGSVGElement)) return;
      const paths = [...svg.querySelectorAll('path.relationship')];
      if (paths.length) optimizePathPropagation(paths, liveBoxes());
    }));
  }

  function exportBoxes(documentXml) {
    return [...documentXml.querySelectorAll('g')].flatMap(group => {
      const rect = group.querySelector(':scope > rect');
      if (!rect || number(rect.getAttribute('width')) !== W) return [];
      const height = number(rect.getAttribute('height'));
      if (Math.abs(height - H) > 0.2 && Math.abs(height - COMPACT_H) > 0.2) return [];
      const left = number(rect.getAttribute('x'));
      const top = number(rect.getAttribute('y'));
      return [{ left, right: left + W, top, bottom: top + height }];
    });
  }

  function optimizeExportSvg(svgText) {
    try {
      const documentXml = new DOMParser().parseFromString(svgText, 'image/svg+xml');
      const paths = [...documentXml.querySelectorAll('path[marker-end*="export-arrow"]')]
        .filter(path => !path.closest('#export-legend'));
      if (!paths.length) return svgText;
      optimizePathPropagation(paths, exportBoxes(documentXml));
      return new XMLSerializer().serializeToString(documentXml.documentElement);
    } catch {
      return svgText;
    }
  }

  class UntangledExportBlob extends NativeBlob {
    constructor(parts, options) {
      let nextParts = parts;
      if (
        options?.type?.startsWith('image/svg+xml') &&
        parts?.length === 1 &&
        typeof parts[0] === 'string' &&
        parts[0].includes('export-arrow')
      ) {
        nextParts = [optimizeExportSvg(parts[0])];
      }
      super(nextParts, options);
    }
  }

  window.Blob = UntangledExportBlob;

  function installControls() {
    const sortSelect = document.querySelector('#sorting-strategy');
    const applyButton = document.querySelector('#optimize-layout');
    const alignButton = document.querySelector('#align-to-terms');
    if (!(sortSelect instanceof HTMLSelectElement) || !(applyButton instanceof HTMLButtonElement) || !(alignButton instanceof HTMLButtonElement)) return;

    if (!sortSelect.querySelector('option[value="conflicts"]')) {
      const option = document.createElement('option');
      option.value = 'conflicts';
      option.textContent = 'Least Line Conflicts';
      sortSelect.append(option);
    }

    if (strategyMap()[activeCurriculumId()] === 'conflicts') sortSelect.value = 'conflicts';

    sortSelect.addEventListener('change', () => {
      if (sortSelect.value !== 'conflicts') return;
      rememberConflictStrategy();
      const description = 'Jointly move nodes and propagation lanes to minimize line crossings, overlaps, node conflicts, and unnecessary detours.';
      sortSelect.title = description;
      applyButton.title = description;
    });

    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target.closest('#optimize-layout') : null;
      if (target !== applyButton || sortSelect.value !== 'conflicts') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      rememberConflictStrategy();
      applyLeastConflicts();
    }, true);

    const untangleButton = document.createElement('button');
    untangleButton.id = 'untangle-current-layout';
    untangleButton.className = 'toolbar-button';
    untangleButton.type = 'button';
    untangleButton.textContent = 'Untangle';
    untangleButton.title = 'Improve the current layout by moving nodes vertically only when useful and re-optimizing connector propagation lanes.';
    alignButton.insertAdjacentElement('afterend', untangleButton);
    untangleButton.addEventListener('click', untangleCurrent);

    const saveButton = document.createElement('button');
    saveButton.id = 'save-layout-checkpoint';
    saveButton.className = 'toolbar-button';
    saveButton.type = 'button';
    saveButton.textContent = 'Save layout';
    saveButton.title = 'Save the current node positions and viewport for this curriculum.';
    untangleButton.insertAdjacentElement('afterend', saveButton);
    saveButton.addEventListener('click', saveCheckpoint);

    restoreButton = document.createElement('button');
    restoreButton.id = 'restore-layout-checkpoint';
    restoreButton.className = 'toolbar-button';
    restoreButton.type = 'button';
    restoreButton.textContent = 'Restore layout';
    saveButton.insertAdjacentElement('afterend', restoreButton);
    restoreButton.addEventListener('click', restoreCheckpoint);
    updateRestoreButton();

    const message = sessionStorage.getItem(MESSAGE_KEY);
    if (message) {
      sessionStorage.removeItem(MESSAGE_KEY);
      window.setTimeout(() => {
        const hint = document.querySelector('#flow-hint');
        if (hint instanceof HTMLElement) hint.textContent = message;
      }, 160);
    }
  }

  const connectionsSvg = document.querySelector('#connections-svg');
  const nodesLayer = document.querySelector('#nodes-layer');
  if (connectionsSvg) new MutationObserver(schedulePropagationOptimization).observe(connectionsSvg, { childList: true, subtree: true });
  if (nodesLayer) new MutationObserver(schedulePropagationOptimization).observe(nodesLayer, { childList: true, subtree: true });
  document.querySelector('#display-units-toggle')?.addEventListener('change', schedulePropagationOptimization);

  installControls();
  schedulePropagationOptimization();
})();