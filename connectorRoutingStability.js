(() => {
  const NODE_WIDTH = 184;
  const BASE_NODE_HEIGHT = 78;
  const COMPACT_NODE_HEIGHT = 62;
  const NODE_CLEARANCE = 10;
  const EPSILON = 0.75;
  const DEFAULT_SPACING = 7;

  const number = value => Number.parseFloat(value || '0');
  const formatNumber = value => Number(value.toFixed(3)).toString();
  const intervalOverlap = (aLow, aHigh, bLow, bHigh) => Math.min(aHigh, bHigh) - Math.max(aLow, bLow);
  const clonePoints = points => points.map(point => ({ ...point }));

  const parseOrthogonalPath = d => {
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
  };

  const serializeOrthogonalPath = points => {
    if (!points.length) return '';
    let result = `M ${formatNumber(points[0].x)} ${formatNumber(points[0].y)}`;
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const point = points[index];
      if (Math.abs(previous.y - point.y) < 0.001) result += ` H ${formatNumber(point.x)}`;
      else if (Math.abs(previous.x - point.x) < 0.001) result += ` V ${formatNumber(point.y)}`;
      else return '';
    }
    return result;
  };

  const liveBoxes = () => {
    const flowPanel = document.querySelector('#flow-panel');
    const nodesLayer = document.querySelector('#nodes-layer');
    if (!(nodesLayer instanceof HTMLElement)) return [];
    const height = flowPanel?.classList.contains('hide-node-units') ? COMPACT_NODE_HEIGHT : BASE_NODE_HEIGHT;
    return [...nodesLayer.querySelectorAll('.course-node')].map(node => ({
      top: number(node.style.top),
      bottom: number(node.style.top) + height,
      left: number(node.style.left),
      right: number(node.style.left) + NODE_WIDTH,
    }));
  };

  const pointTouchesBox = (point, box) =>
    point.x >= box.left - 1 && point.x <= box.right + 1 && point.y >= box.top - 1 && point.y <= box.bottom + 1;

  function pathBlocked(points, boxes) {
    if (points.length < 2) return false;
    const sourceIgnored = new Set(boxes.map((box, index) => pointTouchesBox(points[0], box) ? index : -1).filter(index => index >= 0));
    const targetIgnored = new Set(boxes.map((box, index) => pointTouchesBox(points.at(-1), box) ? index : -1).filter(index => index >= 0));
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
          if (a.x > box.left - NODE_CLEARANCE && a.x < box.right + NODE_CLEARANCE && low < box.bottom + NODE_CLEARANCE && high > box.top - NODE_CLEARANCE) return true;
        } else if (Math.abs(a.y - b.y) < 0.001) {
          const low = Math.min(a.x, b.x);
          const high = Math.max(a.x, b.x);
          if (a.y > box.top - NODE_CLEARANCE && a.y < box.bottom + NODE_CLEARANCE && low < box.right + NODE_CLEARANCE && high > box.left - NODE_CLEARANCE) return true;
        } else return true;
      }
    }
    return false;
  }

  const relationships = () => {
    const svg = document.querySelector('#connections-svg');
    if (!(svg instanceof SVGSVGElement)) return [];
    return [...svg.querySelectorAll('path.relationship')];
  };

  function captureBaseRoutes() {
    relationships().forEach((path, index) => {
      const d = path.getAttribute('d') || '';
      path.setAttribute('data-stable-route-base', d);
      path.setAttribute('data-stable-route-index', String(index));
    });
  }

  function restoreBaseRoutes() {
    relationships().forEach((path, index) => {
      const base = path.getAttribute('data-stable-route-base');
      if (base == null) {
        path.setAttribute('data-stable-route-base', path.getAttribute('d') || '');
        path.setAttribute('data-stable-route-index', String(index));
      } else path.setAttribute('d', base);
      path.removeAttribute('data-parallel-vertical-lanes');
      path.removeAttribute('data-parallel-horizontal-lanes');
      path.removeAttribute('data-targeted-untangle');
    });
  }

  const stableRecords = paths => [...paths]
    .map((path, domOrder) => ({
      path,
      domOrder,
      stableOrder: Number(path.getAttribute('data-stable-route-index') ?? domOrder),
      points: parseOrthogonalPath(path.getAttribute('d') || ''),
    }))
    .filter(record => record.points.length >= 2)
    .sort((a, b) => a.stableOrder - b.stableOrder || a.domOrder - b.domOrder);

  function verticalBlocked(x, y1, y2, boxes) {
    const low = Math.min(y1, y2);
    const high = Math.max(y1, y2);
    return boxes.some(box =>
      x > box.left - NODE_CLEARANCE && x < box.right + NODE_CLEARANCE &&
      low < box.bottom + NODE_CLEARANCE && high > box.top - NODE_CLEARANCE
    );
  }

  function horizontalBlocked(y, x1, x2, boxes, ignored = new Set()) {
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    return boxes.some((box, index) => {
      if (ignored.has(index)) return false;
      return y > box.top - NODE_CLEARANCE && y < box.bottom + NODE_CLEARANCE &&
        left < box.right + NODE_CLEARANCE && right > box.left - NODE_CLEARANCE;
    });
  }

  const touchingBoxIndexes = (point, boxes) => new Set(
    boxes.map((box, index) => pointTouchesBox(point, box) ? index : -1).filter(index => index >= 0),
  );

  function applyStableVertical(paths, boxes, spacing) {
    const records = stableRecords(paths).filter(record => record.points.length >= 3);
    const groups = new Map();

    for (const record of records) {
      for (let index = 0; index < record.points.length - 1; index += 1) {
        const a = record.points[index];
        const b = record.points[index + 1];
        if (Math.abs(a.x - b.x) > 0.001 || Math.abs(a.y - b.y) < EPSILON) continue;
        const baseX = a.x;
        const key = String(Math.round(baseX * 2) / 2);
        const segment = {
          record,
          segmentIndex: index,
          baseX,
          low: Math.min(a.y, b.y),
          high: Math.max(a.y, b.y),
        };
        const list = groups.get(key) || [];
        list.push(segment);
        groups.set(key, list);
      }
    }

    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const sorted = [...group].sort((a, b) => a.low - b.low || a.high - b.high || a.record.stableOrder - b.record.stableOrder || a.segmentIndex - b.segmentIndex);
      const components = [];
      let current = [];
      let maxHigh = -Infinity;
      for (const segment of sorted) {
        if (current.length && segment.low >= maxHigh - EPSILON) {
          components.push(current);
          current = [];
          maxHigh = -Infinity;
        }
        current.push(segment);
        maxHigh = Math.max(maxHigh, segment.high);
      }
      if (current.length) components.push(current);

      for (const component of components) {
        if (component.length < 2) continue;
        const ordered = [...component].sort((a, b) => a.record.stableOrder - b.record.stableOrder || a.segmentIndex - b.segmentIndex || a.low - b.low);
        const assigned = [];
        ordered.forEach((segment, index) => {
          const points = segment.record.points;
          const start = points[segment.segmentIndex];
          const end = points[segment.segmentIndex + 1];
          const previous = points[segment.segmentIndex - 1] || start;
          const next = points[segment.segmentIndex + 2] || end;
          const startIgnored = touchingBoxIndexes(previous, boxes);
          const endIgnored = touchingBoxIndexes(next, boxes);
          const centeredRank = index - (ordered.length - 1) / 2;
          const desired = segment.baseX + centeredRank * spacing;
          const candidateXs = [desired];
          for (let step = 1; step <= 20; step += 1) {
            candidateXs.push(desired - step * spacing, desired + step * spacing);
          }
          candidateXs.push(segment.baseX);

          const chosen = candidateXs.find(candidateX => {
            if (verticalBlocked(candidateX, start.y, end.y, boxes)) return false;
            if (segment.segmentIndex > 0 && horizontalBlocked(start.y, previous.x, candidateX, boxes, startIgnored)) return false;
            if (segment.segmentIndex + 2 < points.length && horizontalBlocked(end.y, candidateX, next.x, boxes, endIgnored)) return false;
            return !assigned.some(other => intervalOverlap(segment.low, segment.high, other.low, other.high) > EPSILON && Math.abs(candidateX - other.x) < spacing - 0.5);
          });
          if (chosen == null) return;
          assigned.push({ low: segment.low, high: segment.high, x: chosen });
          if (Math.abs(chosen - start.x) > 0.001) {
            start.x = chosen;
            end.x = chosen;
            segment.record.changed = true;
          }
        });
      }
    }

    for (const record of records) {
      if (!record.changed) continue;
      const d = serializeOrthogonalPath(record.points);
      if (!d) continue;
      record.path.setAttribute('d', d);
      record.path.setAttribute('data-parallel-vertical-lanes', 'true');
    }
  }

  function horizontalSegments(record) {
    const result = [];
    for (let index = 0; index < record.points.length - 1; index += 1) {
      const a = record.points[index];
      const b = record.points[index + 1];
      if (Math.abs(a.y - b.y) > 0.001 || Math.abs(a.x - b.x) < EPSILON) continue;
      result.push({
        record,
        segmentIndex: index,
        y: a.y,
        low: Math.min(a.x, b.x),
        high: Math.max(a.x, b.x),
      });
    }
    return result;
  }

  function buildHorizontalComponents(segments, spacing) {
    const parent = segments.map((_, index) => index);
    const find = index => {
      while (parent[index] !== index) {
        parent[index] = parent[parent[index]];
        index = parent[index];
      }
      return index;
    };
    const union = (a, b) => {
      const ar = find(a);
      const br = find(b);
      if (ar !== br) parent[br] = ar;
    };
    for (let i = 0; i < segments.length; i += 1) {
      for (let j = i + 1; j < segments.length; j += 1) {
        const a = segments[i];
        const b = segments[j];
        if (a.record === b.record) continue;
        if (intervalOverlap(a.low, a.high, b.low, b.high) <= EPSILON) continue;
        if (Math.abs(a.y - b.y) < spacing - 0.5) union(i, j);
      }
    }
    const groups = new Map();
    segments.forEach((segment, index) => {
      const root = find(index);
      const list = groups.get(root) || [];
      list.push(segment);
      groups.set(root, list);
    });
    return [...groups.values()].filter(group => group.length > 1);
  }

  function shiftHorizontalSegment(points, segmentIndex, targetY, boxes, spacing) {
    const lastIndex = points.length - 2;
    const start = points[segmentIndex];
    const end = points[segmentIndex + 1];
    if (!start || !end) return null;
    if (Math.abs(targetY - start.y) < 0.25) return clonePoints(points);
    const direction = Math.sign(end.x - start.x) || 1;
    const length = Math.abs(end.x - start.x);
    const stub = Math.min(Math.max(10, spacing * 1.5), Math.max(10, length / 3));
    let candidate;

    if (points.length === 2) {
      if (length < stub * 2 + 4) return null;
      const sourceStubX = start.x + direction * stub;
      const targetStubX = end.x - direction * stub;
      candidate = [
        { ...start },
        { x: sourceStubX, y: start.y },
        { x: sourceStubX, y: targetY },
        { x: targetStubX, y: targetY },
        { x: targetStubX, y: end.y },
        { ...end },
      ];
    } else if (segmentIndex === 0) {
      if (length < stub + 4) return null;
      const stubX = start.x + direction * stub;
      candidate = [
        { ...start },
        { x: stubX, y: start.y },
        { x: stubX, y: targetY },
        { x: end.x, y: targetY },
        ...clonePoints(points.slice(2)),
      ];
    } else if (segmentIndex === lastIndex) {
      if (length < stub + 4) return null;
      const stubX = end.x - direction * stub;
      candidate = clonePoints(points.slice(0, segmentIndex));
      candidate.push(
        { x: start.x, y: targetY },
        { x: stubX, y: targetY },
        { x: stubX, y: end.y },
        { ...end },
      );
    } else {
      candidate = clonePoints(points);
      candidate[segmentIndex].y = targetY;
      candidate[segmentIndex + 1].y = targetY;
    }

    const d = serializeOrthogonalPath(candidate);
    if (!d || pathBlocked(candidate, boxes)) return null;
    return candidate;
  }

  function applyStableHorizontal(paths, boxes, spacing) {
    const records = stableRecords(paths);
    const segments = records.flatMap(horizontalSegments);
    if (segments.length < 2) return;
    const assignments = new Map();

    for (const component of buildHorizontalComponents(segments, spacing)) {
      const ordered = [...component].sort((a, b) => a.y - b.y || a.record.stableOrder - b.record.stableOrder || a.segmentIndex - b.segmentIndex);
      const center = ordered.reduce((sum, segment) => sum + segment.y, 0) / ordered.length;
      const placed = [];

      ordered.forEach((segment, index) => {
        const desired = center + (index - (ordered.length - 1) / 2) * spacing;
        const candidates = [desired];
        for (let step = 1; step <= 10; step += 1) candidates.push(desired - step * spacing, desired + step * spacing);
        candidates.push(segment.y);
        let selected = null;
        for (const candidateY of candidates) {
          if (candidateY < 4) continue;
          if (placed.some(other => intervalOverlap(segment.low, segment.high, other.low, other.high) > EPSILON && Math.abs(candidateY - other.y) < spacing - 0.5)) continue;
          const shifted = shiftHorizontalSegment(segment.record.points, segment.segmentIndex, candidateY, boxes, spacing);
          if (!shifted) continue;
          selected = { y: candidateY, points: shifted };
          break;
        }
        if (!selected) return;
        placed.push({ low: segment.low, high: segment.high, y: selected.y });
        assignments.set(`${segment.record.stableOrder}:${segment.segmentIndex}`, selected.y);
      });
    }

    for (const record of records) {
      const own = [...assignments.entries()]
        .map(([key, y]) => {
          const [stableOrder, segmentIndex] = key.split(':').map(Number);
          return stableOrder === record.stableOrder ? { segmentIndex, y } : null;
        })
        .filter(Boolean)
        .sort((a, b) => b.segmentIndex - a.segmentIndex);
      if (!own.length) continue;
      let points = clonePoints(record.points);
      let changed = false;
      for (const assignment of own) {
        const shifted = shiftHorizontalSegment(points, assignment.segmentIndex, assignment.y, boxes, spacing);
        if (!shifted) continue;
        points = shifted;
        changed = true;
      }
      if (!changed) continue;
      const d = serializeOrthogonalPath(points);
      if (!d) continue;
      record.path.setAttribute('d', d);
      record.path.setAttribute('data-parallel-horizontal-lanes', 'true');
    }
  }

  const verticalSpacing = () => Number(window.CurriculumVerticalLaneSpacing?.get?.()) || DEFAULT_SPACING;
  const horizontalSpacing = () => Number(window.CurriculumHorizontalLaneSpacing?.get?.()) || DEFAULT_SPACING;

  const hygiene = window.CurriculumUntangleV2;
  const originalHygieneRun = hygiene?.runPropagation?.bind(hygiene);
  let pipelineRunning = false;
  if (hygiene && originalHygieneRun) {
    hygiene.runPropagation = () => {
      if (!pipelineRunning) return;
      return originalHygieneRun();
    };
  }

  let scheduled = false;
  function runStablePipeline() {
    scheduled = false;
    const paths = relationships();
    if (!paths.length) return;
    restoreBaseRoutes();
    const boxes = liveBoxes();
    pipelineRunning = true;
    try {
      if (hygiene) hygiene.setActive(true);
      originalHygieneRun?.();
      applyStableVertical(paths, boxes, verticalSpacing());
      applyStableHorizontal(paths, boxes, horizontalSpacing());
    } finally {
      pipelineRunning = false;
    }
  }

  function scheduleStablePipeline() {
    captureBaseRoutes();
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => requestAnimationFrame(runStablePipeline));
  }

  const svg = document.querySelector('#connections-svg');
  if (svg) new MutationObserver(scheduleStablePipeline).observe(svg, { childList: true, subtree: true });
  document.querySelector('#display-units-toggle')?.addEventListener('change', scheduleStablePipeline);

  window.CurriculumConnectorRouting = {
    request: scheduleStablePipeline,
    applyNow: () => {
      captureBaseRoutes();
      runStablePipeline();
    },
  };

  scheduleStablePipeline();
})();
