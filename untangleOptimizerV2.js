(() => {
  const NativeBlob = window.Blob;
  const CURRICULUM_LIBRARY_KEY = 'curriculum-flowchart:curricula:v1';
  const STRATEGY_KEY = 'curriculum-flowchart:sort-strategies:v1';
  const SNAPSHOT_KEY = 'curriculum-flowchart:layout-checkpoints:v1';
  const W = 184;
  const H = 78;
  const COMPACT_H = 62;
  const COL = 260;
  const TOP = 132;
  const GAP = 18;
  const COREQ_GAP = 34;
  const ROUTE_CLEARANCE = 10;
  const LANE_STEP = 7;
  const YEARS = ['First Year', 'Second Year', 'Third Year', 'Fourth Year'];
  const TERMS = ['First Semester', 'Second Semester', 'Short Term'];

  const norm = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const safeParse = value => { try { return value ? JSON.parse(value) : null; } catch { return null; } };
  const clone = value => JSON.parse(JSON.stringify(value));
  const unique = values => [...new Set(values.filter(Boolean))];
  const ordered = (values, defaults) => [...defaults.filter(value => values.includes(value)), ...unique(values).filter(value => !defaults.includes(value)).sort()];

  function activeCurriculumId() {
    return String(safeParse(localStorage.getItem(CURRICULUM_LIBRARY_KEY))?.activeId || 'default');
  }

  function activeKey() {
    return `curriculum-flowchart:untangle-route-active:v2:${activeCurriculumId()}`;
  }

  function setActive(active) {
    if (active) sessionStorage.setItem(activeKey(), '1');
    else sessionStorage.removeItem(activeKey());
  }

  function isActive() {
    return sessionStorage.getItem(activeKey()) === '1';
  }

  function rememberConflictStrategy() {
    const stored = safeParse(localStorage.getItem(STRATEGY_KEY));
    const map = stored && typeof stored === 'object' ? stored : {};
    map[activeCurriculumId()] = 'conflicts';
    localStorage.setItem(STRATEGY_KEY, JSON.stringify(map));
  }

  function courseTrack(course) {
    const explicit = String(course.track || '').trim();
    if (explicit) return explicit;
    if (/\sS\d+$/i.test(String(course.courseNo || ''))) return 'Structural';
    if (/\sG\d+$/i.test(String(course.courseNo || ''))) return 'Geotechnical';
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
    const uf = unionFind(courses.map(course => course.id));

    for (const course of courses) {
      for (const code of course.corequisites || []) {
        const other = byCode.get(norm(code));
        if (other && other.id !== course.id && other.yearLevel === course.yearLevel && other.semester === course.semester) uf.union(course.id, other.id);
      }
    }

    const groups = new Map();
    for (const course of courses) {
      const root = uf.find(course.id);
      const ids = groups.get(root) || [];
      ids.push(course.id);
      groups.set(root, ids);
    }

    const unitById = new Map();
    const layoutColumns = columns.map((column, columnIndex) => {
      const relevant = courses.filter(course => course.yearLevel === column.year && course.semester === column.term);
      const seen = new Set();
      const units = [];
      for (const course of relevant) {
        if (seen.has(course.id)) continue;
        const ids = (groups.get(uf.find(course.id)) || [course.id])
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
          columnIndex,
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
    const seenEdges = new Set();
    for (const course of courses) {
      const target = unitById.get(course.id);
      for (const code of [...(course.prerequisites || []), ...(course.electivePrerequisites || [])]) {
        const sourceCourse = byCode.get(norm(code));
        const source = sourceCourse && unitById.get(sourceCourse.id);
        if (!source || !target || source.key === target.key) continue;
        const key = `${source.key}->${target.key}`;
        if (seenEdges.has(key)) continue;
        seenEdges.add(key);
        edges.push({ key, source, target });
      }
    }

    const neighbors = new Map();
    const addNeighbor = (a, b) => {
      const values = neighbors.get(a.key) || new Set();
      values.add(b.key);
      neighbors.set(a.key, values);
    };
    for (const edge of edges) { addNeighbor(edge.source, edge.target); addNeighbor(edge.target, edge.source); }
    return { courses, columns, byId, layoutColumns, edges, neighbors };
  }

  function unitBox(unit, columns) {
    const x = columns[unit.columnIndex]?.x ?? 34;
    return { unit, left: x, right: x + W, top: unit.center - unit.height / 2, bottom: unit.center + unit.height / 2 };
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

  function conflictMap(layout) {
    const severity = new Map(layout.layoutColumns.flat().map(unit => [unit.key, 0]));
    const add = (unit, amount) => severity.set(unit.key, (severity.get(unit.key) || 0) + amount);
    const edges = layout.edges;

    for (let i = 0; i < edges.length; i += 1) {
      const a = edges[i];
      const aLow = Math.min(a.source.columnIndex, a.target.columnIndex);
      const aHigh = Math.max(a.source.columnIndex, a.target.columnIndex);
      for (let j = i + 1; j < edges.length; j += 1) {
        const b = edges[j];
        if (a.source.key === b.source.key || a.source.key === b.target.key || a.target.key === b.source.key || a.target.key === b.target.key) continue;
        const bLow = Math.min(b.source.columnIndex, b.target.columnIndex);
        const bHigh = Math.max(b.source.columnIndex, b.target.columnIndex);
        const low = Math.max(aLow, bLow);
        const high = Math.min(aHigh, bHigh);
        if (high <= low) continue;
        const startDelta = projectedY(a, low) - projectedY(b, low);
        const endDelta = projectedY(a, high) - projectedY(b, high);
        if (startDelta * endDelta < -1) {
          add(a.source, 160); add(a.target, 160); add(b.source, 160); add(b.target, 160);
        }
      }
    }

    const boxes = layout.layoutColumns.flat().map(unit => unitBox(unit, layout.columns));
    for (const edge of edges) {
      const low = Math.min(edge.source.columnIndex, edge.target.columnIndex);
      const high = Math.max(edge.source.columnIndex, edge.target.columnIndex);
      for (const box of boxes) {
        if (box.unit.key === edge.source.key || box.unit.key === edge.target.key) continue;
        if (box.unit.columnIndex <= low || box.unit.columnIndex >= high) continue;
        const y = projectedY(edge, box.unit.columnIndex);
        if (y > box.top - ROUTE_CLEARANCE && y < box.bottom + ROUTE_CLEARANCE) {
          add(edge.source, 220); add(edge.target, 220); add(box.unit, 260);
        }
      }
    }
    return severity;
  }

  function graphCost(layout, displacementWeight = 1.1) {
    const severity = conflictMap(layout);
    let cost = [...severity.values()].reduce((sum, value) => sum + value, 0) / 2;
    for (const edge of layout.edges) cost += Math.abs(edge.source.center - edge.target.center) * 0.04;
    let maxBottom = TOP;
    for (const unit of layout.layoutColumns.flat()) {
      cost += Math.abs(unit.center - unit.originalCenter) * displacementWeight;
      maxBottom = Math.max(maxBottom, unit.center + unit.height / 2);
    }
    cost += Math.max(0, maxBottom - TOP) * 0.015;
    return cost;
  }

  function boundsFor(units, index) {
    const unit = units[index];
    const lower = index === 0 ? TOP + unit.height / 2 : units[index - 1].center + (units[index - 1].height + unit.height) / 2 + GAP;
    const upper = index === units.length - 1 ? Infinity : units[index + 1].center - (units[index + 1].height + unit.height) / 2 - GAP;
    return { lower, upper };
  }

  function conservativeNodeUntangle(layout, options = {}) {
    const maxMoves = options.maxMoves ?? 6;
    const minSeverity = options.minSeverity ?? 160;
    const minGain = options.minGain ?? 70;
    const displacementWeight = options.displacementWeight ?? 1.1;
    const offsets = options.offsets || [-28, -20, -12, 12, 20, 28];
    let best = graphCost(layout, displacementWeight);
    let moves = 0;

    for (let pass = 0; pass < 2 && moves < maxMoves; pass += 1) {
      const severity = conflictMap(layout);
      const candidates = layout.layoutColumns.flat()
        .filter(unit => (severity.get(unit.key) || 0) >= minSeverity)
        .sort((a, b) => (severity.get(b.key) || 0) - (severity.get(a.key) || 0) || a.key.localeCompare(b.key));
      let improved = false;

      for (const unit of candidates) {
        if (moves >= maxMoves) break;
        const units = layout.layoutColumns[unit.columnIndex];
        const index = units.indexOf(unit);
        if (index < 0) continue;
        const original = unit.center;
        const { lower, upper } = boundsFor(units, index);
        let chosen = original;
        let chosenScore = best;

        for (const offset of offsets) {
          const candidate = Math.max(lower, Math.min(upper, original + offset));
          if (!Number.isFinite(candidate) || Math.abs(candidate - original) < 0.5) continue;
          unit.center = candidate;
          const score = graphCost(layout, displacementWeight);
          if (score < chosenScore) { chosen = candidate; chosenScore = score; }
        }
        unit.center = chosen;
        if (best - chosenScore >= minGain) {
          best = chosenScore;
          moves += 1;
          improved = true;
        } else unit.center = original;
      }
      if (!improved) break;
    }
    return { score: best, moves };
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
              const other = columnOf.get(key);
              return other !== undefined && (forward ? other < columnIndex : other > columnIndex);
            })
            .map(key => ranks.get(key)).filter(value => value !== undefined);
          return { unit, score: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : ranks.get(unit.key) || 0 };
        });
        scored.sort((a, b) => a.score - b.score || a.unit.originalCenter - b.unit.originalCenter || a.unit.key.localeCompare(b.unit.key));
        layout.layoutColumns[columnIndex] = scored.map(item => item.unit);
      }
    };
    for (let pass = 0; pass < passes; pass += 1) { sweep(true); sweep(false); }
  }

  function initializeCenters(layout) {
    for (const units of layout.layoutColumns) {
      let top = TOP;
      for (const unit of units) {
        unit.center = top + unit.height / 2;
        top += unit.height + GAP;
      }
    }
  }

  function positionsFrom(layout) {
    const result = {};
    for (const units of layout.layoutColumns) {
      for (const unit of units) {
        let y = unit.center - unit.height / 2;
        const x = layout.columns[unit.columnIndex]?.x ?? 34;
        for (const id of unit.ids) {
          result[id] = { x, y };
          y += H + COREQ_GAP;
        }
      }
    }
    return result;
  }

  function runUntangle() {
    const runtime = window.CurriculumFlowchartRuntime;
    if (!runtime) return;
    const state = runtime.getState();
    const layout = buildLayout(state);
    if (!layout.courses.length) return;
    layout.layoutColumns.forEach(units => units.sort((a, b) => a.center - b.center));
    const before = graphCost(layout, 1.1);
    const result = conservativeNodeUntangle(layout, { maxMoves: 6, minSeverity: 160, minGain: 70, displacementWeight: 1.1 });
    setActive(true);
    runtime.applyPositions(positionsFrom(layout), {
      layoutMode: state.layoutMode,
      sortStrategy: state.sortStrategy || null,
      label: 'Untangle',
      message: result.moves
        ? `Untangle made ${result.moves} targeted node adjustment${result.moves === 1 ? '' : 's'} only where conflicts materially improved. Connector lanes were checked locally.`
        : 'Untangle found no severe node conflict that justified moving courses; only local connector conflicts were checked.',
    });
    window.setTimeout(runPropagation, 60);
  }

  function runLeastConflicts() {
    const runtime = window.CurriculumFlowchartRuntime;
    if (!runtime) return;
    const state = runtime.getState();
    const layout = buildLayout(state);
    if (!layout.courses.length) return;
    barycentricSort(layout, 34);
    initializeCenters(layout);
    const before = graphCost(layout, 0.45);
    const result = conservativeNodeUntangle(layout, { maxMoves: 10, minSeverity: 120, minGain: 45, displacementWeight: 0.45, offsets: [-28, -20, -12, 12, 20, 28] });
    rememberConflictStrategy();
    setActive(true);
    runtime.applyPositions(positionsFrom(layout), {
      layoutMode: 'basic',
      sortStrategy: 'conflicts',
      label: 'Least Line Conflicts sort',
      message: `Least Line Conflicts reordered courses to reduce collisions, then made ${result.moves} targeted local adjustment${result.moves === 1 ? '' : 's'}. External corridor forcing was not enabled.`,
    });
    window.setTimeout(runPropagation, 60);
  }

  const number = value => Number.parseFloat(value || '0');
  const format = value => Number(value.toFixed(3)).toString();
  const overlaps = (aLow, aHigh, bLow, bHigh) => Math.min(aHigh, bHigh) - Math.max(aLow, bLow);

  function parseOrthogonalPath(d) {
    const commands = [...String(d || '').matchAll(/([MHV])\s*(-?[\d.]+)(?:\s+(-?[\d.]+))?/g)];
    if (!commands.length) return [];
    const points = [];
    let x = 0;
    let y = 0;
    for (const match of commands) {
      if (match[1] === 'M') { x = number(match[2]); y = number(match[3]); }
      else if (match[1] === 'H') x = number(match[2]);
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

  function segments(points) {
    const result = [];
    for (let index = 0; index < points.length - 1; index += 1) {
      const a = points[index];
      const b = points[index + 1];
      if (Math.abs(a.x - b.x) < 0.001) result.push({ kind: 'v', x: a.x, low: Math.min(a.y, b.y), high: Math.max(a.y, b.y) });
      else if (Math.abs(a.y - b.y) < 0.001) result.push({ kind: 'h', y: a.y, low: Math.min(a.x, b.x), high: Math.max(a.x, b.x) });
    }
    return result;
  }

  function conflictScore(ownSegments, accepted) {
    let score = 0;
    for (const a of ownSegments) {
      for (const b of accepted) {
        if (a.kind === 'v' && b.kind === 'v') {
          const overlap = overlaps(a.low, a.high, b.low, b.high);
          if (overlap > 0 && Math.abs(a.x - b.x) < 0.75) score += 900 + overlap * 2;
          else if (overlap > 0 && Math.abs(a.x - b.x) < LANE_STEP - 0.5) score += 90;
        } else if (a.kind === 'h' && b.kind === 'h') {
          const overlap = overlaps(a.low, a.high, b.low, b.high);
          if (overlap > 0 && Math.abs(a.y - b.y) < 0.75) score += 420 + overlap;
        } else {
          const vertical = a.kind === 'v' ? a : b;
          const horizontal = a.kind === 'h' ? a : b;
          if (vertical.x > horizontal.low + 0.5 && vertical.x < horizontal.high - 0.5 && horizontal.y > vertical.low + 0.5 && horizontal.y < vertical.high - 0.5) score += 34;
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
          const low = Math.min(a.y, b.y); const high = Math.max(a.y, b.y);
          if (a.x > box.left - ROUTE_CLEARANCE && a.x < box.right + ROUTE_CLEARANCE && low < box.bottom + ROUTE_CLEARANCE && high > box.top - ROUTE_CLEARANCE) return true;
        } else if (Math.abs(a.y - b.y) < 0.001) {
          const low = Math.min(a.x, b.x); const high = Math.max(a.x, b.x);
          if (a.y > box.top - ROUTE_CLEARANCE && a.y < box.bottom + ROUTE_CLEARANCE && low < box.right + ROUTE_CLEARANCE && high > box.left - ROUTE_CLEARANCE) return true;
        }
      }
    }
    return false;
  }

  function candidateXs(baseX) {
    return [baseX, baseX + 7, baseX - 7, baseX + 14, baseX - 14, baseX + 21, baseX - 21, baseX + 28, baseX - 28];
  }

  function conservativePropagate(paths, boxes) {
    const accepted = [];
    const orderedPaths = [...paths].sort((a, b) => String(a.getAttribute('d')).localeCompare(String(b.getAttribute('d'))));
    for (const path of orderedPaths) {
      const points = parseOrthogonalPath(path.getAttribute('d') || '');
      if (points.length < 3) { accepted.push(...segments(points)); continue; }
      const baseSegments = segments(points);
      const blocked = pathBlocked(points, boxes);
      const baseScore = conflictScore(baseSegments, accepted) + (blocked ? 1000 : 0);
      if (!blocked && baseScore < 120) { accepted.push(...baseSegments); continue; }

      let bestPoints = points;
      let bestScore = baseScore;
      for (let index = 0; index < points.length - 1; index += 1) {
        const a = points[index]; const b = points[index + 1];
        if (Math.abs(a.x - b.x) > 0.001 || Math.abs(a.y - b.y) < 1) continue;
        for (const x of candidateXs(a.x)) {
          if (Math.abs(x - a.x) < 0.001) continue;
          const candidate = points.map(point => ({ ...point }));
          candidate[index].x = x;
          candidate[index + 1].x = x;
          if (pathBlocked(candidate, boxes)) continue;
          const score = conflictScore(segments(candidate), accepted) + Math.abs(x - a.x) * 0.4;
          if (score < bestScore) { bestScore = score; bestPoints = candidate; }
        }
      }

      if (baseScore - bestScore >= 100 && bestPoints !== points) {
        const serialized = serializeOrthogonalPath(bestPoints);
        if (serialized) {
          path.setAttribute('d', serialized);
          path.setAttribute('data-targeted-untangle', 'true');
        }
      }
      accepted.push(...segments(bestPoints));
    }
  }

  function liveBoxes() {
    const flowPanel = document.querySelector('#flow-panel');
    const nodesLayer = document.querySelector('#nodes-layer');
    if (!(nodesLayer instanceof HTMLElement)) return [];
    const height = flowPanel?.classList.contains('hide-node-units') ? COMPACT_H : H;
    return [...nodesLayer.querySelectorAll('.course-node')].map(node => ({
      left: number(node.style.left), right: number(node.style.left) + W,
      top: number(node.style.top), bottom: number(node.style.top) + height,
    }));
  }

  function runPropagation() {
    if (!isActive()) return;
    const svg = document.querySelector('#connections-svg');
    if (!(svg instanceof SVGSVGElement)) return;
    const paths = [...svg.querySelectorAll('path.relationship')];
    if (paths.length) conservativePropagate(paths, liveBoxes());
  }

  let scheduled = false;
  function schedulePropagation() {
    if (!isActive() || scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => requestAnimationFrame(() => { scheduled = false; runPropagation(); }));
  }

  function exportBoxes(documentXml) {
    return [...documentXml.querySelectorAll('g')].flatMap(group => {
      const rect = group.querySelector(':scope > rect');
      if (!rect || number(rect.getAttribute('width')) !== W) return [];
      const height = number(rect.getAttribute('height'));
      if (Math.abs(height - H) > 0.2 && Math.abs(height - COMPACT_H) > 0.2) return [];
      const left = number(rect.getAttribute('x')); const top = number(rect.getAttribute('y'));
      return [{ left, right: left + W, top, bottom: top + height }];
    });
  }

  function optimizeExportSvg(svgText) {
    if (!isActive()) return svgText;
    try {
      const documentXml = new DOMParser().parseFromString(svgText, 'image/svg+xml');
      const paths = [...documentXml.querySelectorAll('path[marker-end*="export-arrow"]')].filter(path => !path.closest('#export-legend'));
      if (paths.length) conservativePropagate(paths, exportBoxes(documentXml));
      return new XMLSerializer().serializeToString(documentXml.documentElement);
    } catch { return svgText; }
  }

  class TargetedUntangleBlob extends NativeBlob {
    constructor(parts, options) {
      let nextParts = parts;
      if (options?.type?.startsWith('image/svg+xml') && parts?.length === 1 && typeof parts[0] === 'string' && parts[0].includes('export-arrow')) nextParts = [optimizeExportSvg(parts[0])];
      super(nextParts, options);
    }
  }
  window.Blob = TargetedUntangleBlob;

  function checkpoints() {
    const stored = safeParse(localStorage.getItem(SNAPSHOT_KEY));
    return stored && typeof stored === 'object' ? stored : {};
  }

  let restoreButton = null;
  function updateRestoreButton() {
    if (!(restoreButton instanceof HTMLButtonElement)) return;
    const checkpoint = checkpoints()[activeCurriculumId()];
    restoreButton.disabled = !checkpoint?.positions;
    restoreButton.title = checkpoint?.savedAt ? `Restore positions saved ${new Date(checkpoint.savedAt).toLocaleString()}` : 'No saved positions for this curriculum';
  }

  function saveCheckpoint() {
    const runtime = window.CurriculumFlowchartRuntime;
    if (!runtime) return;
    const state = runtime.getState();
    const map = checkpoints();
    map[activeCurriculumId()] = {
      savedAt: Date.now(), positions: clone(state.positions), viewport: clone(state.viewport),
      layoutMode: state.layoutMode || 'basic', sortStrategy: state.sortStrategy || null,
    };
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(map));
    updateRestoreButton();
    runtime.setHint('Current node positions saved for this curriculum.');
  }

  function restoreCheckpoint() {
    const runtime = window.CurriculumFlowchartRuntime;
    if (!runtime) return;
    const checkpoint = checkpoints()[activeCurriculumId()];
    if (!checkpoint?.positions || !window.confirm('Restore the saved node positions for this curriculum?')) return;
    setActive(false);
    runtime.applyPositions(checkpoint.positions, {
      viewport: checkpoint.viewport,
      layoutMode: checkpoint.layoutMode || 'basic',
      sortStrategy: checkpoint.sortStrategy || null,
      label: 'Restore layout',
      message: 'Saved node positions restored for this curriculum.',
    });
  }

  function installControls() {
    const sortSelect = document.querySelector('#sorting-strategy');
    const applyButton = document.querySelector('#optimize-layout');
    const alignButton = document.querySelector('#align-to-terms');
    if (!(sortSelect instanceof HTMLSelectElement) || !(applyButton instanceof HTMLButtonElement) || !(alignButton instanceof HTMLButtonElement)) return;

    if (!sortSelect.querySelector('option[value="conflicts"]')) {
      const option = document.createElement('option');
      option.value = 'conflicts'; option.textContent = 'Least Line Conflicts'; sortSelect.append(option);
    }
    const remembered = safeParse(localStorage.getItem(STRATEGY_KEY))?.[activeCurriculumId()];
    if (remembered === 'conflicts') sortSelect.value = 'conflicts';

    sortSelect.addEventListener('change', () => {
      if (sortSelect.value === 'conflicts') {
        sortSelect.title = 'Reduce line collisions primarily through ordering, then make only targeted local node or connector adjustments.';
        applyButton.title = sortSelect.title;
      }
    });

    document.addEventListener('click', event => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest('#optimize-layout');
      if (button !== applyButton || sortSelect.value !== 'conflicts') return;
      event.preventDefault(); event.stopImmediatePropagation(); runLeastConflicts();
    }, true);

    const untangleButton = document.createElement('button');
    untangleButton.id = 'untangle-current-layout'; untangleButton.className = 'toolbar-button'; untangleButton.type = 'button';
    untangleButton.textContent = 'Untangle';
    untangleButton.title = 'Target only severe local conflicts. Route changes are attempted first; node movement is limited and only accepted when it materially improves the layout.';
    alignButton.insertAdjacentElement('afterend', untangleButton);
    untangleButton.addEventListener('click', runUntangle);

    const saveButton = document.createElement('button');
    saveButton.id = 'save-layout-checkpoint'; saveButton.className = 'toolbar-button'; saveButton.type = 'button'; saveButton.textContent = 'Save layout';
    saveButton.title = 'Save the current node positions and viewport for this curriculum.';
    untangleButton.insertAdjacentElement('afterend', saveButton);
    saveButton.addEventListener('click', saveCheckpoint);

    restoreButton = document.createElement('button');
    restoreButton.id = 'restore-layout-checkpoint'; restoreButton.className = 'toolbar-button'; restoreButton.type = 'button'; restoreButton.textContent = 'Restore layout';
    saveButton.insertAdjacentElement('afterend', restoreButton);
    restoreButton.addEventListener('click', restoreCheckpoint);
    updateRestoreButton();
  }

  const connectionsSvg = document.querySelector('#connections-svg');
  const nodesLayer = document.querySelector('#nodes-layer');
  if (connectionsSvg) new MutationObserver(schedulePropagation).observe(connectionsSvg, { childList: true, subtree: true });
  if (nodesLayer) new MutationObserver(schedulePropagation).observe(nodesLayer, { childList: true, subtree: true });
  document.querySelector('#display-units-toggle')?.addEventListener('change', schedulePropagation);

  window.CurriculumUntangleV2 = { setActive, isActive, runPropagation };
  installControls();
  if (isActive()) schedulePropagation();
})();
