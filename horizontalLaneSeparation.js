(() => {
  const NativeBlob = window.Blob;
  const NODE_WIDTH = 184;
  const BASE_NODE_HEIGHT = 78;
  const COMPACT_NODE_HEIGHT = 62;
  const NODE_CLEARANCE = 10;
  const DEFAULT_SPACING = 7;
  const MIN_SPACING = 3;
  const MAX_SPACING = 30;
  const EPSILON = 0.75;
  const CURRICULUM_LIBRARY_KEY = 'curriculum-flowchart:curricula:v1';
  const HORIZONTAL_SPACING_KEY = 'curriculum-flowchart:horizontal-lane-spacing:v1';

  const number = value => Number.parseFloat(value || '0');
  const formatNumber = value => Number(value.toFixed(3)).toString();
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const safeParse = value => {
    try { return value ? JSON.parse(value) : null; }
    catch { return null; }
  };

  const activeCurriculumId = () => String(
    safeParse(localStorage.getItem(CURRICULUM_LIBRARY_KEY))?.activeId || 'default',
  );

  const spacingMap = () => {
    const stored = safeParse(localStorage.getItem(HORIZONTAL_SPACING_KEY));
    return stored && typeof stored === 'object' ? stored : {};
  };

  const horizontalSpacing = () => {
    const value = Number(spacingMap()[activeCurriculumId()]);
    return Number.isFinite(value) ? clamp(value, MIN_SPACING, MAX_SPACING) : DEFAULT_SPACING;
  };

  let spacingInput = null;

  const syncSpacingInput = () => {
    if (spacingInput instanceof HTMLInputElement) spacingInput.value = String(horizontalSpacing());
  };

  const setHorizontalSpacing = value => {
    const next = clamp(Number(value) || DEFAULT_SPACING, MIN_SPACING, MAX_SPACING);
    const map = spacingMap();
    map[activeCurriculumId()] = next;
    localStorage.setItem(HORIZONTAL_SPACING_KEY, JSON.stringify(map));
    syncSpacingInput();
    return next;
  };

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

  const intervalOverlap = (aLow, aHigh, bLow, bHigh) => Math.min(aHigh, bHigh) - Math.max(aLow, bLow);
  const pointTouchesBox = (point, box) => point.x >= box.left - 1 && point.x <= box.right + 1 && point.y >= box.top - 1 && point.y <= box.bottom + 1;

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

  function horizontalSegments(record) {
    const result = [];
    for (let index = 0; index < record.points.length - 1; index += 1) {
      const a = record.points[index];
      const b = record.points[index + 1];
      if (Math.abs(a.y - b.y) > 0.001 || Math.abs(a.x - b.x) < EPSILON) continue;
      result.push({
        record,
        segmentIndex: index,
        pathOrder: record.pathOrder,
        y: a.y,
        low: Math.min(a.x, b.x),
        high: Math.max(a.x, b.x),
      });
    }
    return result;
  }

  function buildConflictComponents(segments, spacing) {
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
      const values = groups.get(root) || [];
      values.push(segment);
      groups.set(root, values);
    });
    return [...groups.values()].filter(group => group.length > 1);
  }

  const clonePoints = points => points.map(point => ({ ...point }));

  function shiftHorizontalSegment(points, segmentIndex, targetY, boxes, spacing) {
    const lastIndex = points.length - 2;
    const originalStart = points[segmentIndex];
    const originalEnd = points[segmentIndex + 1];
    if (!originalStart || !originalEnd) return null;
    if (Math.abs(targetY - originalStart.y) < 0.25) return clonePoints(points);

    const direction = Math.sign(originalEnd.x - originalStart.x) || 1;
    const length = Math.abs(originalEnd.x - originalStart.x);
    const stub = Math.min(Math.max(10, spacing * 1.5), Math.max(10, length / 3));
    let candidate;

    if (points.length === 2) {
      if (length < stub * 2 + 4) return null;
      const sourceStubX = originalStart.x + direction * stub;
      const targetStubX = originalEnd.x - direction * stub;
      candidate = [
        { ...originalStart },
        { x: sourceStubX, y: originalStart.y },
        { x: sourceStubX, y: targetY },
        { x: targetStubX, y: targetY },
        { x: targetStubX, y: originalEnd.y },
        { ...originalEnd },
      ];
    } else if (segmentIndex === 0) {
      if (length < stub + 4) return null;
      const stubX = originalStart.x + direction * stub;
      candidate = [
        { ...originalStart },
        { x: stubX, y: originalStart.y },
        { x: stubX, y: targetY },
        { x: originalEnd.x, y: targetY },
        ...clonePoints(points.slice(2)),
      ];
    } else if (segmentIndex === lastIndex) {
      if (length < stub + 4) return null;
      const stubX = originalEnd.x - direction * stub;
      candidate = clonePoints(points.slice(0, segmentIndex));
      candidate.push(
        { x: originalStart.x, y: targetY },
        { x: stubX, y: targetY },
        { x: stubX, y: originalEnd.y },
        { ...originalEnd },
      );
    } else {
      candidate = clonePoints(points);
      candidate[segmentIndex].y = targetY;
      candidate[segmentIndex + 1].y = targetY;
    }

    const serialized = serializeOrthogonalPath(candidate);
    if (!serialized || pathBlocked(candidate, boxes)) return null;
    return candidate;
  }

  function separateHorizontalSegments(paths, boxes) {
    const spacing = horizontalSpacing();
    const records = paths.map((path, pathOrder) => ({
      path,
      pathOrder,
      points: parseOrthogonalPath(path.getAttribute('d') || ''),
    })).filter(record => record.points.length >= 2);
    const segments = records.flatMap(horizontalSegments);
    if (segments.length < 2) return;

    const assignments = new Map();
    for (const component of buildConflictComponents(segments, spacing)) {
      const ordered = [...component].sort((a, b) => a.y - b.y || a.pathOrder - b.pathOrder || a.segmentIndex - b.segmentIndex);
      const center = ordered.reduce((sum, segment) => sum + segment.y, 0) / ordered.length;
      const placed = [];

      ordered.forEach((segment, index) => {
        const desired = center + (index - (ordered.length - 1) / 2) * spacing;
        const candidates = [desired];
        for (let step = 1; step <= 8; step += 1) candidates.push(desired - step * spacing, desired + step * spacing);
        candidates.push(segment.y);

        let selected = null;
        for (const candidateY of candidates) {
          if (candidateY < 4) continue;
          if (placed.some(other => intervalOverlap(segment.low, segment.high, other.segment.low, other.segment.high) > EPSILON && Math.abs(candidateY - other.y) < spacing - 0.5)) continue;
          const shifted = shiftHorizontalSegment(segment.record.points, segment.segmentIndex, candidateY, boxes, spacing);
          if (!shifted) continue;
          selected = { y: candidateY, points: shifted };
          break;
        }

        if (!selected) return;
        placed.push({ segment, y: selected.y });
        assignments.set(`${segment.pathOrder}:${segment.segmentIndex}`, selected.y);
      });
    }

    for (const record of records) {
      const ownAssignments = [...assignments.entries()]
        .map(([key, y]) => {
          const [pathOrder, segmentIndex] = key.split(':').map(Number);
          return pathOrder === record.pathOrder ? { segmentIndex, y } : null;
        })
        .filter(Boolean)
        .sort((a, b) => b.segmentIndex - a.segmentIndex);
      if (!ownAssignments.length) continue;

      let points = clonePoints(record.points);
      let changed = false;
      for (const assignment of ownAssignments) {
        const shifted = shiftHorizontalSegment(points, assignment.segmentIndex, assignment.y, boxes, spacing);
        if (!shifted) continue;
        points = shifted;
        changed = true;
      }
      if (!changed) continue;
      const serialized = serializeOrthogonalPath(points);
      if (!serialized) continue;
      record.path.setAttribute('d', serialized);
      record.path.setAttribute('data-parallel-horizontal-lanes', 'true');
    }
  }

  function applyLiveSeparation() {
    const svg = document.querySelector('#connections-svg');
    if (!(svg instanceof SVGSVGElement)) return;
    const relationships = [...svg.querySelectorAll('path.relationship')];
    if (relationships.length < 2) return;
    separateHorizontalSegments(relationships, liveBoxes());
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

  function installSpacingControl() {
    if (document.querySelector('#horizontal-lane-spacing')) return;
    const verticalInput = document.querySelector('#vertical-lane-spacing');
    const verticalControl = verticalInput?.closest('label');
    if (!(verticalControl instanceof HTMLElement)) return;

    const verticalLabel = verticalControl.querySelector('span');
    if (verticalLabel) verticalLabel.textContent = 'Vertical lines';
    verticalControl.classList.add('connector-spacing-control');

    const horizontalControl = document.createElement('label');
    horizontalControl.className = 'horizontal-lane-spacing-control connector-spacing-control';
    horizontalControl.title = 'Set the minimum vertical spacing between overlapping or tightly packed horizontal relationship lines.';
    horizontalControl.innerHTML = `
      <span>Horizontal lines</span>
      <input id="horizontal-lane-spacing" type="number" min="${MIN_SPACING}" max="${MAX_SPACING}" step="1" inputmode="numeric" aria-label="Spacing between parallel horizontal relationship lines in pixels" />
      <span>px</span>`;
    verticalControl.insertAdjacentElement('afterend', horizontalControl);
    spacingInput = horizontalControl.querySelector('#horizontal-lane-spacing');
    syncSpacingInput();

    const apply = () => {
      if (!(spacingInput instanceof HTMLInputElement)) return;
      const next = setHorizontalSpacing(spacingInput.value);
      const runtime = window.CurriculumFlowchartRuntime;
      if (runtime?.renderFlow) runtime.renderFlow();
      scheduleLiveSeparation();
      runtime?.setHint?.(`Parallel horizontal relationship-line spacing set to ${next} px.`);
    };

    spacingInput?.addEventListener('change', apply);
    spacingInput?.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      spacingInput.blur();
    });

    const style = document.createElement('style');
    style.textContent = `
      .connector-spacing-control{display:inline-flex;align-items:center;gap:4px;color:#44516a;font-size:.76rem;font-weight:650;white-space:nowrap}
      #horizontal-lane-spacing{width:54px;min-height:34px;border:1px solid #d8deea;border-radius:7px;padding:4px 6px;background:#fff;color:#172033;font:inherit}
      @media(max-width:760px){#horizontal-lane-spacing{width:60px;min-height:42px}.connector-spacing-control{font-size:.72rem}}
    `;
    document.head.append(style);
  }

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
      separateHorizontalSegments(relationships, exportBoxes(documentXml));
      return new XMLSerializer().serializeToString(documentXml.documentElement);
    } catch {
      return svgText;
    }
  }

  class HorizontalLaneBlob extends NativeBlob {
    constructor(parts, options) {
      let nextParts = parts;
      if (
        options?.type?.startsWith('image/svg+xml') &&
        parts?.length === 1 &&
        typeof parts[0] === 'string' &&
        parts[0].includes('export-arrow')
      ) nextParts = [separateExportSvg(parts[0])];
      super(nextParts, options);
    }
  }

  const connectionsSvg = document.querySelector('#connections-svg');
  const nodesLayer = document.querySelector('#nodes-layer');
  if (connectionsSvg) new MutationObserver(scheduleLiveSeparation).observe(connectionsSvg, { childList: true, subtree: true });
  if (nodesLayer) new MutationObserver(scheduleLiveSeparation).observe(nodesLayer, { childList: true, subtree: true });
  document.querySelector('#display-units-toggle')?.addEventListener('change', scheduleLiveSeparation);

  window.CurriculumHorizontalLaneSpacing = {
    get: horizontalSpacing,
    set: value => {
      const next = setHorizontalSpacing(value);
      window.CurriculumFlowchartRuntime?.renderFlow?.();
      scheduleLiveSeparation();
      return next;
    },
    min: MIN_SPACING,
    max: MAX_SPACING,
    defaultValue: DEFAULT_SPACING,
  };

  installSpacingControl();
  window.Blob = HorizontalLaneBlob;
  scheduleLiveSeparation();
})();