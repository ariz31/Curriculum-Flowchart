(() => {
  const NativeBlob = window.Blob;
  const NODE_WIDTH = 184;
  const BASE_NODE_HEIGHT = 78;
  const COMPACT_NODE_HEIGHT = 62;
  const NODE_CLEARANCE = 10;
  const LANE_SPACING = 7;
  const EPSILON = 0.75;

  const number = value => Number.parseFloat(value || '0');
  const formatNumber = value => Number(value.toFixed(3)).toString();

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
      else result += ` L ${formatNumber(point.x)} ${formatNumber(point.y)}`;
    }
    return result;
  };

  const intervalsOverlap = (a, b) => Math.min(a.high, b.high) - Math.max(a.low, b.low) > EPSILON;
  const pointTouchesBox = (point, box) => point.x >= box.left - 1 && point.x <= box.right + 1 && point.y >= box.top - 1 && point.y <= box.bottom + 1;

  const verticalBlocked = (x, y1, y2, boxes) => {
    const low = Math.min(y1, y2);
    const high = Math.max(y1, y2);
    return boxes.some(box =>
      x > box.left - NODE_CLEARANCE &&
      x < box.right + NODE_CLEARANCE &&
      low < box.bottom + NODE_CLEARANCE &&
      high > box.top - NODE_CLEARANCE
    );
  };

  const touchingBoxIndexes = (point, boxes) => new Set(
    boxes.map((box, index) => pointTouchesBox(point, box) ? index : -1).filter(index => index >= 0),
  );

  const horizontalBlocked = (y, x1, x2, boxes, ignored = new Set()) => {
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    return boxes.some((box, index) => {
      if (ignored.has(index)) return false;
      return y > box.top - NODE_CLEARANCE &&
        y < box.bottom + NODE_CLEARANCE &&
        left < box.right + NODE_CLEARANCE &&
        right > box.left - NODE_CLEARANCE;
    });
  };

  const candidateLaneXs = baseX => {
    const values = [baseX];
    for (let step = 1; step <= 28; step += 1) {
      values.push(baseX + step * LANE_SPACING, baseX - step * LANE_SPACING);
    }
    return values;
  };

  function splitOverlapComponents(segments) {
    const sorted = [...segments].sort((a, b) => a.low - b.low || a.high - b.high || a.pathOrder - b.pathOrder || a.segmentIndex - b.segmentIndex);
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
    return components;
  }

  function separateVerticalSegments(paths, boxes) {
    const records = paths.map((path, pathOrder) => ({
      path,
      pathOrder,
      points: parseOrthogonalPath(path.getAttribute('d') || ''),
      changed: false,
    })).filter(record => record.points.length >= 3);

    const groups = new Map();
    for (const record of records) {
      for (let index = 0; index < record.points.length - 1; index += 1) {
        const start = record.points[index];
        const end = record.points[index + 1];
        if (Math.abs(start.x - end.x) > 0.001 || Math.abs(start.y - end.y) < EPSILON) continue;
        const baseX = start.x;
        const key = String(Math.round(baseX * 2) / 2);
        const segment = {
          record,
          pathOrder: record.pathOrder,
          segmentIndex: index,
          baseX,
          low: Math.min(start.y, end.y),
          high: Math.max(start.y, end.y),
        };
        const group = groups.get(key) || [];
        group.push(segment);
        groups.set(key, group);
      }
    }

    for (const group of groups.values()) {
      if (group.length < 2) continue;
      for (const component of splitOverlapComponents(group)) {
        if (component.length < 2) continue;
        const ordered = [...component].sort((a, b) => a.pathOrder - b.pathOrder || a.segmentIndex - b.segmentIndex || a.low - b.low || a.high - b.high);
        const assigned = [];

        for (const segment of ordered) {
          const points = segment.record.points;
          const start = points[segment.segmentIndex];
          const end = points[segment.segmentIndex + 1];
          const previous = points[segment.segmentIndex - 1] || start;
          const next = points[segment.segmentIndex + 2] || end;
          const startIgnored = touchingBoxIndexes(previous, boxes);
          const endIgnored = touchingBoxIndexes(next, boxes);

          const candidate = candidateLaneXs(segment.baseX).find(candidateX => {
            if (verticalBlocked(candidateX, start.y, end.y, boxes)) return false;
            if (segment.segmentIndex > 0 && horizontalBlocked(start.y, previous.x, candidateX, boxes, startIgnored)) return false;
            if (segment.segmentIndex + 2 < points.length && horizontalBlocked(end.y, candidateX, next.x, boxes, endIgnored)) return false;
            return !assigned.some(other =>
              intervalsOverlap(segment, other.segment) &&
              Math.abs(candidateX - other.x) < LANE_SPACING - 0.5
            );
          });

          if (candidate === undefined) continue;
          assigned.push({ segment, x: candidate });
          if (Math.abs(candidate - start.x) > 0.001) {
            start.x = candidate;
            end.x = candidate;
            segment.record.changed = true;
          }
        }
      }
    }

    for (const record of records) {
      if (!record.changed) continue;
      record.path.setAttribute('d', serializeOrthogonalPath(record.points));
      record.path.setAttribute('data-parallel-vertical-lanes', 'true');
    }
  }

  function liveBoxes() {
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
  }

  function applyLiveSeparation() {
    const svg = document.querySelector('#connections-svg');
    if (!(svg instanceof SVGSVGElement)) return;
    const relationships = [...svg.querySelectorAll('path.relationship')];
    if (relationships.length < 2) return;
    separateVerticalSegments(relationships, liveBoxes());
  }

  let scheduled = false;
  const scheduleLiveSeparation = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      scheduled = false;
      applyLiveSeparation();
    }));
  };

  const connectionsSvg = document.querySelector('#connections-svg');
  const nodesLayer = document.querySelector('#nodes-layer');
  if (connectionsSvg) new MutationObserver(scheduleLiveSeparation).observe(connectionsSvg, { childList: true, subtree: true });
  if (nodesLayer) new MutationObserver(scheduleLiveSeparation).observe(nodesLayer, { childList: true, subtree: true });
  document.querySelector('#display-units-toggle')?.addEventListener('change', scheduleLiveSeparation);

  function exportBoxes(documentXml) {
    return [...documentXml.querySelectorAll('g')].flatMap(group => {
      const rect = group.querySelector(':scope > rect');
      if (!rect || rect.getAttribute('width') !== String(NODE_WIDTH)) return [];
      const height = number(rect.getAttribute('height'));
      if (Math.abs(height - BASE_NODE_HEIGHT) > 0.1 && Math.abs(height - COMPACT_NODE_HEIGHT) > 0.1) return [];
      const top = number(rect.getAttribute('y'));
      const left = number(rect.getAttribute('x'));
      return [{ top, bottom: top + height, left, right: left + NODE_WIDTH }];
    });
  }

  function separateExportSvg(svgText) {
    try {
      const documentXml = new DOMParser().parseFromString(svgText, 'image/svg+xml');
      const relationships = [...documentXml.querySelectorAll('path[marker-end*="export-arrow"]')]
        .filter(path => !path.closest('#export-legend'));
      if (relationships.length < 2) return svgText;
      separateVerticalSegments(relationships, exportBoxes(documentXml));
      return new XMLSerializer().serializeToString(documentXml.documentElement);
    } catch {
      return svgText;
    }
  }

  class ParallelLaneBlob extends NativeBlob {
    constructor(parts, options) {
      let nextParts = parts;
      if (
        options?.type?.startsWith('image/svg+xml') &&
        parts?.length === 1 &&
        typeof parts[0] === 'string' &&
        parts[0].includes('export-arrow')
      ) {
        nextParts = [separateExportSvg(parts[0])];
      }
      super(nextParts, options);
    }
  }

  window.Blob = ParallelLaneBlob;
})();
