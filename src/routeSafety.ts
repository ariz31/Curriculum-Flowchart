const BASE_NODE_HEIGHT = 78;
const COMPACT_NODE_HEIGHT = 62;
const NODE_WIDTH = 184;
const ROUTE_NODE_CLEARANCE = 10;
const ROUTE_LANE_STEP = 12;
const ROUTE_OUTER_PADDING = 18;

interface RoutePoint { x: number; y: number }
interface NodeBox {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const flowPanel = document.querySelector<HTMLElement>('#flow-panel');
const nodesLayer = document.querySelector<HTMLElement>('#nodes-layer');
const connectionsSvg = document.querySelector<SVGSVGElement>('#connections-svg');
const downloadButton = document.querySelector<HTMLButtonElement>('#download-image');

const numberValue = (value: string | null | undefined): number => Number.parseFloat(value || '0');
const currentNodeHeight = (): number => flowPanel?.classList.contains('hide-node-units') ? COMPACT_NODE_HEIGHT : BASE_NODE_HEIGHT;

function nodeBoxesFromDom(): NodeBox[] {
  if (!nodesLayer) return [];
  const height = currentNodeHeight();
  return [...nodesLayer.querySelectorAll<HTMLElement>('.course-node')].map(node => {
    const top = numberValue(node.style.top);
    const left = numberValue(node.style.left);
    return { top, bottom: top + height, left, right: left + NODE_WIDTH };
  });
}

function parseOrthogonalPath(d: string): RoutePoint[] {
  const commands = [...d.matchAll(/([MHVL])\s*(-?[\d.]+)(?:\s+(-?[\d.]+))?/g)];
  if (!commands.length) return [];
  const points: RoutePoint[] = [];
  let x = 0;
  let y = 0;
  for (const match of commands) {
    const command = match[1];
    if (command === 'M' || command === 'L') {
      x = numberValue(match[2]);
      y = numberValue(match[3]);
    } else if (command === 'H') x = numberValue(match[2]);
    else if (command === 'V') y = numberValue(match[2]);
    points.push({ x, y });
  }
  return points;
}

const formatNumber = (value: number): string => Number(value.toFixed(3)).toString();

function serializeOrthogonalPath(points: RoutePoint[]): string {
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
}

function pointTouchesBox(point: RoutePoint, box: NodeBox): boolean {
  return point.x >= box.left - 1 && point.x <= box.right + 1 && point.y >= box.top - 1 && point.y <= box.bottom + 1;
}

function endpointColumnKeys(points: RoutePoint[], boxes: NodeBox[]): Set<number> {
  const result = new Set<number>();
  const endpoints = [points[0], points.at(-1)].filter((point): point is RoutePoint => Boolean(point));
  for (const endpoint of endpoints) {
    boxes.forEach(box => {
      if (pointTouchesBox(endpoint, box)) result.add(Math.round(box.left));
    });
  }
  return result;
}

function columnGroups(boxes: NodeBox[]): Map<number, NodeBox[]> {
  const groups = new Map<number, NodeBox[]>();
  boxes.forEach(box => {
    const key = Math.round(box.left);
    const values = groups.get(key) ?? [];
    values.push(box);
    groups.set(key, values);
  });
  return groups;
}

function horizontalPassesThroughCourseStack(
  start: RoutePoint,
  end: RoutePoint,
  boxes: NodeBox[],
  endpointColumns: Set<number>,
): boolean {
  if (Math.abs(start.y - end.y) > 0.001 || Math.abs(start.x - end.x) < 0.001) return false;
  const left = Math.min(start.x, end.x) + 1;
  const right = Math.max(start.x, end.x) - 1;
  const groups = columnGroups(boxes);

  for (const [columnKey, columnBoxes] of groups) {
    if (endpointColumns.has(columnKey)) continue;
    const columnLeft = Math.min(...columnBoxes.map(box => box.left)) - ROUTE_NODE_CLEARANCE;
    const columnRight = Math.max(...columnBoxes.map(box => box.right)) + ROUTE_NODE_CLEARANCE;
    if (right <= columnLeft || left >= columnRight) continue;

    const stackTop = Math.min(...columnBoxes.map(box => box.top)) - ROUTE_NODE_CLEARANCE;
    const stackBottom = Math.max(...columnBoxes.map(box => box.bottom)) + ROUTE_NODE_CLEARANCE;
    if (start.y > stackTop && start.y < stackBottom) return true;
  }
  return false;
}

function globalOuterCorridors(boxes: NodeBox[], requestedY: number, reserved: number[]): number[] {
  if (!boxes.length) return [requestedY];
  const top = Math.min(...boxes.map(box => box.top)) - ROUTE_NODE_CLEARANCE - ROUTE_OUTER_PADDING;
  const bottom = Math.max(...boxes.map(box => box.bottom)) + ROUTE_NODE_CLEARANCE + ROUTE_OUTER_PADDING;
  const candidates: number[] = [];
  for (let step = 0; step < 48; step += 1) {
    candidates.push(top - step * ROUTE_LANE_STEP, bottom + step * ROUTE_LANE_STEP);
  }
  return candidates
    .filter(candidate => !reserved.some(value => Math.abs(value - candidate) < ROUTE_LANE_STEP - 1))
    .sort((a, b) => Math.abs(a - requestedY) - Math.abs(b - requestedY));
}

function detourDirectHorizontal(start: RoutePoint, end: RoutePoint, safeY: number): RoutePoint[] {
  const direction = end.x >= start.x ? 1 : -1;
  const offset = ROUTE_NODE_CLEARANCE + ROUTE_LANE_STEP;
  let exitX = start.x + direction * offset;
  let entryX = end.x - direction * offset;
  if ((direction > 0 && exitX > entryX) || (direction < 0 && exitX < entryX)) {
    const midpoint = (start.x + end.x) / 2;
    exitX = midpoint;
    entryX = midpoint;
  }
  return [
    { ...start },
    { x: exitX, y: start.y },
    { x: exitX, y: safeY },
    { x: entryX, y: safeY },
    { x: entryX, y: end.y },
    { ...end },
  ];
}

function avoidHorizontalBetweenNodes(path: SVGPathElement, boxes: NodeBox[], reserved: number[]): void {
  let points = parseOrthogonalPath(path.getAttribute('d') || '');
  if (points.length < 2 || !boxes.length) return;
  const endpointColumns = endpointColumnKeys(points, boxes);
  let changed = false;

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (!horizontalPassesThroughCourseStack(start, end, boxes, endpointColumns)) continue;

    const safeY = globalOuterCorridors(boxes, start.y, reserved)[0];
    if (safeY === undefined) continue;
    reserved.push(safeY);

    const previous = points[index - 1];
    const next = points[index + 2];
    const hasVerticalNeighbors = previous && next
      && Math.abs(previous.x - start.x) < 0.001
      && Math.abs(end.x - next.x) < 0.001;

    if (hasVerticalNeighbors) {
      start.y = safeY;
      end.y = safeY;
    } else {
      const detour = detourDirectHorizontal(start, end, safeY);
      points = [...points.slice(0, index), ...detour, ...points.slice(index + 2)];
      index += detour.length - 2;
    }
    changed = true;
  }

  if (changed) {
    path.setAttribute('d', serializeOrthogonalPath(points));
    path.setAttribute('data-horizontal-sequence-safe', 'true');
  } else path.removeAttribute('data-horizontal-sequence-safe');
}

function processLiveRelationships(): void {
  if (!connectionsSvg) return;
  const boxes = nodeBoxesFromDom();
  const reserved: number[] = [];
  connectionsSvg.querySelectorAll<SVGPathElement>('.relationship').forEach(path => {
    avoidHorizontalBetweenNodes(path, boxes, reserved);
  });
}

let scheduled = 0;
function scheduleProcessing(): void {
  if (scheduled) cancelAnimationFrame(scheduled);
  scheduled = requestAnimationFrame(() => {
    scheduled = 0;
    processLiveRelationships();
  });
}

if (nodesLayer) new MutationObserver(scheduleProcessing).observe(nodesLayer, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
if (connectionsSvg) new MutationObserver(scheduleProcessing).observe(connectionsSvg, { childList: true, subtree: true });
flowPanel?.addEventListener('change', scheduleProcessing);
window.addEventListener('resize', scheduleProcessing);
scheduleProcessing();

function exportNodeBoxes(documentXml: Document): NodeBox[] {
  return [...documentXml.querySelectorAll<SVGGElement>('g')]
    .map(group => group.querySelector<SVGRectElement>(':scope > rect'))
    .filter((rect): rect is SVGRectElement => rect !== null)
    .filter(rect => rect.getAttribute('width') === '184' && rect.getAttribute('height') === '78')
    .map(rect => {
      const top = numberValue(rect.getAttribute('y'));
      const left = numberValue(rect.getAttribute('x'));
      return { top, bottom: top + BASE_NODE_HEIGHT, left, right: left + NODE_WIDTH };
    });
}

function makeExportHorizontalSequenceSafe(svgText: string): string {
  try {
    const documentXml = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const boxes = exportNodeBoxes(documentXml);
    const reserved: number[] = [];
    documentXml.querySelectorAll<SVGPathElement>('path[marker-end*="export-arrow"]').forEach(path => {
      avoidHorizontalBetweenNodes(path, boxes, reserved);
    });
    return new XMLSerializer().serializeToString(documentXml.documentElement);
  } catch {
    return svgText;
  }
}

downloadButton?.addEventListener('click', () => {
  const ParentBlob = window.Blob;
  class SequenceSafeBlob extends ParentBlob {
    constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
      let nextParts = parts;
      if (options?.type?.startsWith('image/svg+xml') && parts?.length === 1 && typeof parts[0] === 'string' && parts[0].includes('export-arrow')) {
        nextParts = [makeExportHorizontalSequenceSafe(parts[0])];
      }
      super(nextParts, options);
    }
  }
  window.Blob = SequenceSafeBlob;
  setTimeout(() => {
    if (window.Blob === SequenceSafeBlob) window.Blob = ParentBlob;
  }, 0);
}, true);

export {};
