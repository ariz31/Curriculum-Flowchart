import { createSampleCourses } from './sampleData.js';
import type { AlignmentAction, CanvasViewportState, CurriculumCourse, NodePosition, PersistedState } from './types.js';

const KEY = 'curriculum-flowchart:v1';
const W = 184;
const H = 78;
const COL = 260;
const TOP = 132;
const GAP = 20;
const GRID = 10;
const MIN_SCALE = 0.15;
const MAX_SCALE = 2.5;
const BASE_UNIT_GAP = 14;
const COREQ_GAP = 34;
const ROUTE_CLEARANCE = 9;
const ROUTE_TRACK_SPACING = 9;
const BALANCED_LOCAL_MARGIN = 80;
const BALANCED_MAX_BOUNDARY_LANES = 5;
const BALANCED_MAX_ROW_EXTRA = 56;
const BALANCED_PREFERRED_DETOUR = 1.25;
const BALANCED_NORMAL_DETOUR = 1.5;
const BALANCED_MAX_DETOUR = 1.75;
const BALANCED_CROSSING_PENALTY = 100;
const BALANCED_OVERLAP_PENALTY = 1200;
const BALANCED_OUTSIDE_ENVELOPE_PENALTY = 900;
const BALANCED_BEND_PENALTY = 250;
const YEARS = ['First Year', 'Second Year', 'Third Year', 'Fourth Year'];
const TERMS = ['First Semester', 'Second Semester', 'Short Term'];
const DEFAULT_TRACKS = ['Common', 'Structural', 'Geotechnical'];
const DEFAULT_VIEWPORT: CanvasViewportState = { scale: 1, x: 24, y: 24 };

type LayoutMode = 'basic' | 'optimized';
type RuntimeState = PersistedState & {
  viewport: CanvasViewportState;
  layoutMode: LayoutMode;
  trackFilter: string;
  hiddenTracks: string[];
};
interface Column { year: string; term: string; x: number; }
interface PointerPoint { x: number; y: number; }
interface CorequisitePair { key: string; aId: string; bId: string; }
interface LayoutUnit { key: string; ids: string[]; columnIndex: number; height: number; center: number; }
type DependencyType = 'prerequisite' | 'elective';
type DependencyEdge =
  | { key: string; sourceKind: 'course'; fromId: string; toId: string; type: DependencyType }
  | { key: string; sourceKind: 'pair'; pairKey: string; toId: string; type: DependencyType };
interface RoutePlan {
  kind: 'straight' | 'adjacent' | 'corridor';
  laneX?: number;
  sourceLaneX?: number;
  targetLaneX?: number;
  corridorY?: number;
}
interface Anchor { x: number; y: number; }
interface RouteSegment {
  axis: 'h' | 'v';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
interface PlannedRoute {
  edgeKey: string;
  bundleKey: string;
  segments: RouteSegment[];
}
interface PairGeometry {
  pair: CorequisitePair;
  upperId: string;
  lowerId: string;
  x: number;
  upperBottom: number;
  lowerTop: number;
  junctionY: number;
}

type Gesture =
  | { kind: 'node'; pointerId: number; nodeId: string; startX: number; startY: number; starts: Map<string, NodePosition>; additive: boolean; wasSelected: boolean; moved: boolean }
  | { kind: 'pan'; pointerId: number; startX: number; startY: number; startPanX: number; startPanY: number; moved: boolean }
  | { kind: 'pinch'; pointerIds: [number, number]; startDistance: number; startScale: number; focalX: number; focalY: number }
  | null;

const q = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
};

const tablePanel = q<HTMLElement>('#table-panel');
const flowPanel = q<HTMLElement>('#flow-panel');
const tbody = q<HTMLTableSectionElement>('#curriculum-table-body');
const count = q<HTMLElement>('#course-count');
const status = q<HTMLElement>('#save-status');
const search = q<HTMLInputElement>('#course-search');
const viewport = q<HTMLElement>('#canvas-viewport');
const canvas = q<HTMLElement>('#flow-canvas');
const svg = q<SVGSVGElement>('#connections-svg');
const nodes = q<HTMLElement>('#nodes-layer');
const headers = q<HTMLElement>('#headers-layer');
const selectionStatus = q<HTMLElement>('#selection-status');
const flowHint = q<HTMLElement>('#flow-hint');
const snap = q<HTMLInputElement>('#snap-toggle');
const multiSelectButton = q<HTMLButtonElement>('#multi-select-toggle');
const zoomDisplay = q<HTMLOutputElement>('#zoom-display');
const downloadButton = q<HTMLButtonElement>('#download-image');
const trackFilterControl = q<HTMLSelectElement>('#track-filter');
const trackVisibility = q<HTMLElement>('#track-visibility');
const showAllTracksButton = q<HTMLButtonElement>('#show-all-tracks');
const trackDatalist = q<HTMLDataListElement>('#track-options');

let state = load();
let selected = new Set<string>();
let saveTimer = 0;
let multiSelect = false;
let gesture: Gesture = null;
let logicalWidth = 920;
let logicalHeight = 620;
let routePlans: Map<string, RoutePlan> | null = null;
const activePointers = new Map<number, PointerPoint>();

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function inferTrackFromCode(courseNo: string): string {
  const value = courseNo.trim();
  if (/\sS\d+$/i.test(value)) return 'Structural';
  if (/\sG\d+$/i.test(value)) return 'Geotechnical';
  return 'Common';
}

function normalizeTrackName(value?: string): string {
  const normalized = (value ?? '').trim().replace(/\s+/g, ' ');
  return normalized || 'Common';
}

function sanitizeViewport(value?: CanvasViewportState): CanvasViewportState {
  return {
    scale: clamp(Number.isFinite(value?.scale) ? Number(value?.scale) : DEFAULT_VIEWPORT.scale, MIN_SCALE, MAX_SCALE),
    x: Number.isFinite(value?.x) ? Number(value?.x) : DEFAULT_VIEWPORT.x,
    y: Number.isFinite(value?.y) ? Number(value?.y) : DEFAULT_VIEWPORT.y,
  };
}

function load(): RuntimeState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedState;
      if (Array.isArray(parsed.courses) && parsed.courses.length) {
        const migratedCourses = parsed.courses.map(course => ({
          ...course,
          track: normalizeTrackName(course.track || inferTrackFromCode(course.courseNo)),
        }));
        return {
          ...parsed,
          courses: migratedCourses,
          positions: parsed.positions ?? {},
          snapToGrid: parsed.snapToGrid !== false,
          viewport: sanitizeViewport(parsed.viewport),
          layoutMode: parsed.layoutMode === 'optimized' ? 'optimized' : 'basic',
          trackFilter: typeof parsed.trackFilter === 'string' && parsed.trackFilter.trim() ? parsed.trackFilter : 'all',
          hiddenTracks: Array.isArray(parsed.hiddenTracks) ? parsed.hiddenTracks.map(normalizeTrackName) : [],
          updatedAt: parsed.updatedAt ?? Date.now(),
        };
      }
    }
  } catch { /* fall back to sample */ }
  return {
    courses: createSampleCourses(),
    positions: {},
    snapToGrid: true,
    viewport: { ...DEFAULT_VIEWPORT },
    layoutMode: 'basic',
    trackFilter: 'all',
    hiddenTracks: [],
    updatedAt: Date.now(),
  };
}

function save(): void {
  status.textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    state.updatedAt = Date.now();
    localStorage.setItem(KEY, JSON.stringify(state));
    status.textContent = 'Saved locally';
  }, 150);
}

const norm = (value: string): string => value.trim().replace(/\s+/g, ' ').toLowerCase();
const list = (value: string): string[] => value.split(',').map(part => part.trim()).filter(Boolean);
const esc = (value: string): string => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const unique = (values: string[]): string[] => [...new Set(values.filter(Boolean))];
const ordered = (values: string[], defaults: string[]): string[] => [...defaults.filter(value => values.includes(value)), ...unique(values).filter(value => !defaults.includes(value)).sort()];
const years = (): string[] => ordered(state.courses.map(course => course.yearLevel), YEARS);
const terms = (year: string): string[] => ordered(state.courses.filter(course => course.yearLevel === year).map(course => course.semester), TERMS);
const byId = (id: string): CurriculumCourse | undefined => state.courses.find(course => course.id === id);
const byCode = (code: string): CurriculumCourse | undefined => state.courses.find(course => norm(course.courseNo) === norm(code));

function courseTrack(course: CurriculumCourse): string {
  return normalizeTrackName(course.track || inferTrackFromCode(course.courseNo));
}

function trackNames(): string[] {
  const found = unique(state.courses.map(courseTrack));
  return ordered(found, DEFAULT_TRACKS.filter(track => found.some(value => norm(value) === norm(track))));
}

function hiddenTrackKeys(): Set<string> {
  return new Set(state.hiddenTracks.map(norm));
}

function visibleCourses(): CurriculumCourse[] {
  const hidden = hiddenTrackKeys();
  const filter = norm(state.trackFilter || 'all');
  return state.courses.filter(course => {
    const track = courseTrack(course);
    const key = norm(track);
    if (hidden.has(key)) return false;
    if (filter === 'all') return true;
    return key === 'common' || key === filter;
  });
}

function visibleCourseIds(): Set<string> {
  return new Set(visibleCourses().map(course => course.id));
}

function renderTrackControls(): void {
  const tracks = trackNames();
  const available = new Set(tracks.map(norm));
  if (state.trackFilter !== 'all' && !available.has(norm(state.trackFilter))) state.trackFilter = 'all';
  const hidden = hiddenTrackKeys();
  state.hiddenTracks = tracks.filter(track => hidden.has(norm(track)));

  trackFilterControl.innerHTML = [
    '<option value="all">All tracks</option>',
    ...tracks.map(track => {
      const label = norm(track) === 'common' ? 'Common only' : `${track} + Common`;
      return `<option value="${esc(track)}">${esc(label)}</option>`;
    }),
  ].join('');
  trackFilterControl.value = state.trackFilter === 'all' ? 'all' : tracks.find(track => norm(track) === norm(state.trackFilter)) ?? 'all';

  trackVisibility.innerHTML = tracks.map(track => `
    <label class="switch">
      <input type="checkbox" data-track="${esc(track)}"${hidden.has(norm(track)) ? '' : ' checked'} />
      ${esc(track)}
    </label>`).join('');

  trackDatalist.innerHTML = tracks.map(track => `<option value="${esc(track)}"></option>`).join('');
}

function applyTrackViewChange(): void {
  const visible = visibleCourseIds();
  selected = new Set([...selected].filter(id => visible.has(id)));
  if (state.layoutMode === 'optimized') rebuildOptimizedRoutes();
  else routePlans = null;
  renderTrackControls();
  renderTable();
  renderFlow();
  save();
}

function columns(): Column[] {
  const result: Column[] = [];
  let index = 0;
  years().forEach(year => terms(year).forEach(term => result.push({ year, term, x: 34 + index++ * COL })));
  return result;
}

function columnIndexForCourse(course: CurriculumCourse, cols = columns()): number {
  return cols.findIndex(column => column.year === course.yearLevel && column.term === course.semester);
}

function defaultPos(course: CurriculumCourse): NodePosition {
  const cols = columns();
  const column = cols.find(item => item.year === course.yearLevel && item.term === course.semester);
  const peers = state.courses.filter(item => item.yearLevel === course.yearLevel && item.semester === course.semester);
  return { x: column?.x ?? 34, y: TOP + Math.max(0, peers.findIndex(item => item.id === course.id)) * (H + GAP) };
}

function corequisitePairs(): CorequisitePair[] {
  const pairs = new Map<string, CorequisitePair>();
  const visible = visibleCourseIds();
  for (const course of visibleCourses()) {
    for (const code of course.corequisites) {
      const other = byCode(code);
      if (!other || other.id === course.id || !visible.has(other.id)) continue;
      if (other.yearLevel !== course.yearLevel || other.semester !== course.semester) continue;
      const [aId, bId] = [course.id, other.id].sort();
      const key = `${aId}|${bId}`;
      pairs.set(key, { key, aId, bId });
    }
  }
  return [...pairs.values()];
}

function corequisiteComponentIds(seedId: string, pairs = corequisitePairs()): Set<string> {
  const result = new Set([seedId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const pair of pairs) {
      if (result.has(pair.aId) || result.has(pair.bId)) {
        if (!result.has(pair.aId)) { result.add(pair.aId); changed = true; }
        if (!result.has(pair.bId)) { result.add(pair.bId); changed = true; }
      }
    }
  }
  return result;
}

function ensurePositions(): void {
  const ids = new Set(state.courses.map(course => course.id));
  Object.keys(state.positions).forEach(id => { if (!ids.has(id)) delete state.positions[id]; });
  state.courses.forEach(course => { state.positions[course.id] ??= defaultPos(course); });
  const pairs = corequisitePairs();
  for (const pair of pairs) {
    const a = state.positions[pair.aId];
    const b = state.positions[pair.bId];
    if (!a || !b) continue;
    if (Math.abs(a.x - b.x) > 0.5) b.x = a.x;
  }
}

function setBasicRouting(): void {
  state.layoutMode = 'basic';
  routePlans = null;
}

function dependencyEdges(pairs = corequisitePairs()): DependencyEdge[] {
  const edges: DependencyEdge[] = [];
  const visible = visibleCourseIds();
  const pairCourses = new Map(pairs.map(pair => {
    const a = byId(pair.aId);
    const b = byId(pair.bId);
    return [pair.key, a && b ? [norm(a.courseNo), norm(b.courseNo)] as const : null] as const;
  }));
  const addFor = (course: CurriculumCourse, codes: string[], type: DependencyType): void => {
    const remaining = new Set(codes.map(norm));
    for (const pair of pairs) {
      const normalized = pairCourses.get(pair.key);
      if (!normalized) continue;
      const [aCode, bCode] = normalized;
      if (remaining.has(aCode) && remaining.has(bCode)) {
        edges.push({ key: `pair:${pair.key}->${course.id}:${type}`, sourceKind: 'pair', pairKey: pair.key, toId: course.id, type });
        remaining.delete(aCode);
        remaining.delete(bCode);
      }
    }
    for (const code of codes) {
      if (!remaining.has(norm(code))) continue;
      const from = byCode(code);
      if (!from || from.id === course.id || !visible.has(from.id)) continue;
      edges.push({ key: `course:${from.id}->${course.id}:${type}`, sourceKind: 'course', fromId: from.id, toId: course.id, type });
      remaining.delete(norm(code));
    }
  };
  for (const course of visibleCourses()) {
    addFor(course, course.prerequisites, 'prerequisite');
    addFor(course, course.electivePrerequisites, 'elective');
  }
  return edges;
}

function pairByKey(key: string, pairs = corequisitePairs()): CorequisitePair | undefined {
  return pairs.find(pair => pair.key === key);
}

function pairGeometry(pair: CorequisitePair): PairGeometry | null {
  const a = state.positions[pair.aId];
  const b = state.positions[pair.bId];
  if (!a || !b) return null;
  const aAbove = a.y <= b.y;
  const upperId = aAbove ? pair.aId : pair.bId;
  const lowerId = aAbove ? pair.bId : pair.aId;
  const upper = state.positions[upperId];
  const lower = state.positions[lowerId];
  const x = upper.x + W / 2;
  const upperBottom = upper.y + H;
  const lowerTop = lower.y;
  return { pair, upperId, lowerId, x, upperBottom, lowerTop, junctionY: (upperBottom + lowerTop) / 2 };
}

function buildLayoutUnits(cols: Column[], pairs: CorequisitePair[]): { columns: LayoutUnit[][]; unitByNode: Map<string, LayoutUnit> } {
  const activeCourses = visibleCourses();
  const activeIds = new Set(activeCourses.map(course => course.id));
  const pairMap = new Map<string, Set<string>>();
  for (const course of activeCourses) pairMap.set(course.id, new Set([course.id]));
  for (const pair of pairs) {
    const merged = new Set([...(pairMap.get(pair.aId) ?? [pair.aId]), ...(pairMap.get(pair.bId) ?? [pair.bId])]);
    for (const id of merged) if (activeIds.has(id)) pairMap.set(id, merged);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const pair of pairs) {
      const union = new Set([...(pairMap.get(pair.aId) ?? []), ...(pairMap.get(pair.bId) ?? [])]);
      for (const id of union) {
        if (!activeIds.has(id)) continue;
        const current = pairMap.get(id) ?? new Set<string>();
        if (current.size !== union.size || [...union].some(value => !current.has(value))) {
          pairMap.set(id, new Set(union));
          changed = true;
        }
      }
    }
  }
  const unitByNode = new Map<string, LayoutUnit>();
  const layoutColumns = cols.map((column, columnIndex) => {
    const courses = activeCourses.filter(course => course.yearLevel === column.year && course.semester === column.term);
    const seen = new Set<string>();
    const units: LayoutUnit[] = [];
    for (const course of courses) {
      if (seen.has(course.id)) continue;
      const ids = [...(pairMap.get(course.id) ?? new Set([course.id]))]
        .filter(id => {
          const member = byId(id);
          return activeIds.has(id) && member?.yearLevel === column.year && member?.semester === column.term;
        })
        .sort((a, b) => (state.positions[a]?.y ?? 0) - (state.positions[b]?.y ?? 0));
      ids.forEach(id => seen.add(id));
      const height = ids.length * H + Math.max(0, ids.length - 1) * COREQ_GAP;
      const currentCenters = ids.map(id => (state.positions[id]?.y ?? TOP) + H / 2);
      const center = currentCenters.reduce((sum, value) => sum + value, 0) / Math.max(1, currentCenters.length);
      const unit: LayoutUnit = { key: ids.slice().sort().join('+'), ids, columnIndex, height, center };
      units.push(unit);
      ids.forEach(id => unitByNode.set(id, unit));
    }
    units.sort((a, b) => a.center - b.center);
    return units;
  });
  return { columns: layoutColumns, unitByNode };
}

function sourceNodeIds(edge: DependencyEdge, pairs: CorequisitePair[]): string[] {
  if (edge.sourceKind === 'course') return [edge.fromId];
  const pair = pairByKey(edge.pairKey, pairs);
  return pair ? [pair.aId, pair.bId] : [];
}

function edgeSourceUnit(edge: DependencyEdge, unitByNode: Map<string, LayoutUnit>, pairs: CorequisitePair[]): LayoutUnit | undefined {
  return sourceNodeIds(edge, pairs).map(id => unitByNode.get(id)).find(Boolean);
}

function barycentricSortUnits(layoutColumns: LayoutUnit[][], edges: DependencyEdge[], unitByNode: Map<string, LayoutUnit>, pairs: CorequisitePair[]): void {
  const neighborKeys = new Map<string, Set<string>>();
  const addNeighbor = (a: string, b: string): void => {
    const values = neighborKeys.get(a) ?? new Set<string>();
    values.add(b);
    neighborKeys.set(a, values);
  };
  for (const edge of edges) {
    const source = edgeSourceUnit(edge, unitByNode, pairs);
    const target = unitByNode.get(edge.toId);
    if (!source || !target || source.key === target.key) continue;
    addNeighbor(source.key, target.key);
    addNeighbor(target.key, source.key);
  }
  const unitColumn = new Map<string, number>();
  layoutColumns.forEach((units, columnIndex) => units.forEach(unit => unitColumn.set(unit.key, columnIndex)));
  const ranks = (): Map<string, number> => {
    const result = new Map<string, number>();
    layoutColumns.forEach(units => units.forEach((unit, index) => result.set(unit.key, index)));
    return result;
  };
  const sweep = (forward: boolean): void => {
    const indices = forward
      ? Array.from({ length: Math.max(0, layoutColumns.length - 1) }, (_, index) => index + 1)
      : Array.from({ length: Math.max(0, layoutColumns.length - 1) }, (_, index) => layoutColumns.length - 2 - index);
    for (const columnIndex of indices) {
      const rank = ranks();
      const units = layoutColumns[columnIndex];
      const scored = units.map((unit, fallback) => {
        const values = [...(neighborKeys.get(unit.key) ?? [])]
          .filter(key => {
            const neighborColumn = unitColumn.get(key);
            return neighborColumn !== undefined && (forward ? neighborColumn < columnIndex : neighborColumn > columnIndex);
          })
          .map(key => rank.get(key))
          .filter((value): value is number => value !== undefined);
        const score = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
        return { unit, score, fallback };
      });
      scored.sort((a, b) => a.score - b.score || a.fallback - b.fallback);
      layoutColumns[columnIndex] = scored.map(item => item.unit);
    }
  };
  for (let pass = 0; pass < 10; pass += 1) {
    sweep(true);
    sweep(false);
  }
}

function initializeCompactCenters(layoutColumns: LayoutUnit[][]): void {
  for (const units of layoutColumns) {
    let top = TOP;
    for (const unit of units) {
      unit.center = top + unit.height / 2;
      top += unit.height + BASE_UNIT_GAP;
    }
  }
}

function placeColumnByDesired(units: LayoutUnit[], desired: Map<string, number>): void {
  if (!units.length) return;
  const tops: number[] = [];
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index];
    const preferred = (desired.get(unit.key) ?? unit.center) - unit.height / 2;
    const minimum = index === 0 ? TOP : tops[index - 1] + units[index - 1].height + BASE_UNIT_GAP;
    tops[index] = Math.max(preferred, minimum);
  }
  for (let index = units.length - 2; index >= 0; index -= 1) {
    const maximum = tops[index + 1] - BASE_UNIT_GAP - units[index].height;
    const preferred = (desired.get(units[index].key) ?? units[index].center) - units[index].height / 2;
    tops[index] = Math.max(TOP, Math.min(tops[index], maximum, Math.max(TOP, preferred)));
  }
  for (let index = 1; index < units.length; index += 1) {
    tops[index] = Math.max(tops[index], tops[index - 1] + units[index - 1].height + BASE_UNIT_GAP);
  }
  units.forEach((unit, index) => { unit.center = tops[index] + unit.height / 2; });
}

function alignUnitCenters(layoutColumns: LayoutUnit[][], edges: DependencyEdge[], unitByNode: Map<string, LayoutUnit>, pairs: CorequisitePair[]): void {
  const connected = new Map<string, { unit: LayoutUnit; weight: number }[]>();
  const push = (from: LayoutUnit, to: LayoutUnit, weight: number): void => {
    const values = connected.get(from.key) ?? [];
    values.push({ unit: to, weight });
    connected.set(from.key, values);
  };
  for (const edge of edges) {
    const source = edgeSourceUnit(edge, unitByNode, pairs);
    const target = unitByNode.get(edge.toId);
    if (!source || !target || source.key === target.key) continue;
    const span = Math.abs(source.columnIndex - target.columnIndex);
    const weight = span === 1 ? 5 : span === 2 ? 2.5 : 1;
    push(source, target, weight);
    push(target, source, weight);
  }
  initializeCompactCenters(layoutColumns);
  for (let pass = 0; pass < 12; pass += 1) {
    const forward = pass % 2 === 0;
    const columnsToPlace = forward ? layoutColumns : [...layoutColumns].reverse();
    for (const units of columnsToPlace) {
      const desired = new Map<string, number>();
      for (const unit of units) {
        const neighbors = connected.get(unit.key) ?? [];
        if (!neighbors.length) continue;
        let weighted = 0;
        let weightTotal = 0;
        for (const neighbor of neighbors) {
          weighted += neighbor.unit.center * neighbor.weight;
          weightTotal += neighbor.weight;
        }
        if (weightTotal) desired.set(unit.key, weighted / weightTotal);
      }
      placeColumnByDesired(units, desired);
    }
  }
  const allUnits = layoutColumns.flat();
  if (!allUnits.length) return;
  const minimumTop = Math.min(TOP, ...allUnits.map(unit => unit.center - unit.height / 2));
  const shift = TOP - minimumTop;
  if (Math.abs(shift) > 0.01) allUnits.forEach(unit => { unit.center += shift; });
}

function applyUnitPositions(layoutColumns: LayoutUnit[][], cols: Column[]): void {
  for (const units of layoutColumns) {
    for (const unit of units) {
      const top = unit.center - unit.height / 2;
      let y = top;
      for (const id of unit.ids) {
        state.positions[id] = { x: cols[unit.columnIndex].x, y };
        y += H + COREQ_GAP;
      }
    }
  }
}

function unitLevels(layoutColumns: LayoutUnit[][]): { levels: number[]; levelByUnit: Map<string, number> } {
  const allUnits = layoutColumns.flat().sort((a, b) => a.center - b.center);
  const levels: number[] = [];
  const levelByUnit = new Map<string, number>();
  for (const unit of allUnits) {
    let index = levels.findIndex(value => Math.abs(value - unit.center) <= 5);
    if (index < 0) {
      levels.push(unit.center);
      levels.sort((a, b) => a - b);
      index = levels.findIndex(value => Math.abs(value - unit.center) <= 5);
    }
  }
  layoutColumns.flat().forEach(unit => {
    let best = 0;
    let distance = Infinity;
    levels.forEach((value, index) => {
      const current = Math.abs(value - unit.center);
      if (current < distance) { distance = current; best = index; }
    });
    levelByUnit.set(unit.key, best);
  });
  return { levels, levelByUnit };
}

function expandAdaptiveVerticalGaps(layoutColumns: LayoutUnit[][], edges: DependencyEdge[], unitByNode: Map<string, LayoutUnit>, pairs: CorequisitePair[]): void {
  const { levels, levelByUnit } = unitLevels(layoutColumns);
  if (levels.length < 2) return;
  const demand = Array.from({ length: levels.length - 1 }, () => 0);
  for (const edge of edges) {
    const source = edgeSourceUnit(edge, unitByNode, pairs);
    const target = unitByNode.get(edge.toId);
    if (!source || !target || source.key === target.key) continue;
    const sourceLevel = levelByUnit.get(source.key) ?? 0;
    const targetLevel = levelByUnit.get(target.key) ?? 0;
    const span = Math.abs(source.columnIndex - target.columnIndex);
    if (sourceLevel === targetLevel && span === 1) continue;
    let boundary: number;
    if (sourceLevel === targetLevel) boundary = clamp(sourceLevel, 0, demand.length - 1);
    else {
      const low = Math.min(sourceLevel, targetLevel);
      const high = Math.max(sourceLevel, targetLevel);
      boundary = low;
      for (let index = low; index < high; index += 1) if (demand[index] < demand[boundary]) boundary = index;
    }
    demand[boundary] += span > 1 ? 2 : 1;
  }
  const extra = demand.map(value => value ? Math.min(BALANCED_MAX_ROW_EXTRA, 6 + value * 6) : 0);
  for (const unit of layoutColumns.flat()) {
    const level = levelByUnit.get(unit.key) ?? 0;
    let shift = 0;
    for (let boundary = 0; boundary < level; boundary += 1) shift += extra[boundary];
    unit.center += shift;
  }
}

function optimizeLayout(): void {
  ensurePositions();
  const cols = columns();
  const pairs = corequisitePairs();
  const edges = dependencyEdges(pairs);
  const layout = buildLayoutUnits(cols, pairs);
  barycentricSortUnits(layout.columns, edges, layout.unitByNode, pairs);
  alignUnitCenters(layout.columns, edges, layout.unitByNode, pairs);
  expandAdaptiveVerticalGaps(layout.columns, edges, layout.unitByNode, pairs);
  applyUnitPositions(layout.columns, cols);
  state.layoutMode = 'optimized';
  rebuildOptimizedRoutes();
  selected.clear();
  save();
  renderFlow();
  requestAnimationFrame(() => requestAnimationFrame(fitView));
  const activeFilter = state.trackFilter === 'all' ? 'all visible tracks' : `${state.trackFilter} + Common`;
  flowHint.textContent = `Balanced routing optimized ${activeFilter}: short local paths are preferred, node crossings are forbidden, and clean line crossings are allowed when they avoid excessive detours.`;
}

function edgeTargetColumn(edge: DependencyEdge, cols = columns()): number {
  const target = byId(edge.toId);
  return target ? columnIndexForCourse(target, cols) : -1;
}

function edgeSourceColumn(edge: DependencyEdge, pairs = corequisitePairs(), cols = columns()): number {
  if (edge.sourceKind === 'course') {
    const source = byId(edge.fromId);
    return source ? columnIndexForCourse(source, cols) : -1;
  }
  const pair = pairByKey(edge.pairKey, pairs);
  const source = pair && byId(pair.aId);
  return source ? columnIndexForCourse(source, cols) : -1;
}

function courseIncidentOffset(nodeId: string, edge: DependencyEdge, edges: DependencyEdge[]): number {
  const incident = edges.filter(item => (item.sourceKind === 'course' && item.fromId === nodeId) || item.toId === nodeId).sort((a, b) => a.key.localeCompare(b.key));
  if (incident.length <= 1) return 0;
  const index = Math.max(0, incident.findIndex(item => item.key === edge.key));
  const available = Math.min(44, H - 22);
  const step = Math.min(7, available / Math.max(1, incident.length - 1));
  return (index - (incident.length - 1) / 2) * step;
}

function pairBranchAnchor(pair: CorequisitePair, edge: DependencyEdge, edges: DependencyEdge[]): Anchor | null {
  const geometry = pairGeometry(pair);
  if (!geometry) return null;
  const branches = edges.filter(item => item.sourceKind === 'pair' && item.pairKey === pair.key).sort((a, b) => a.key.localeCompare(b.key));
  if (branches.length <= 1) return { x: geometry.x + 4, y: geometry.junctionY };
  const index = Math.max(0, branches.findIndex(item => item.key === edge.key));
  const low = geometry.upperBottom + 9;
  const high = geometry.lowerTop - 9;
  const usableLow = Math.min(low, high);
  const usableHigh = Math.max(low, high);
  const y = usableLow + (index + 1) * ((usableHigh - usableLow) / (branches.length + 1));
  return { x: geometry.x + 4, y };
}

function sourceAnchor(edge: DependencyEdge, edges: DependencyEdge[], pairs: CorequisitePair[], cols: Column[]): Anchor | null {
  const sourceColumn = edgeSourceColumn(edge, pairs, cols);
  const targetColumn = edgeTargetColumn(edge, cols);
  const forward = targetColumn >= sourceColumn;
  if (edge.sourceKind === 'pair') {
    const pair = pairByKey(edge.pairKey, pairs);
    return pair ? pairBranchAnchor(pair, edge, edges) : null;
  }
  const position = state.positions[edge.fromId];
  if (!position) return null;
  return { x: forward ? position.x + W : position.x, y: position.y + H / 2 + courseIncidentOffset(edge.fromId, edge, edges) };
}

function targetAnchor(edge: DependencyEdge, edges: DependencyEdge[], pairs: CorequisitePair[], cols: Column[]): Anchor | null {
  const target = state.positions[edge.toId];
  if (!target) return null;
  const sourceColumn = edgeSourceColumn(edge, pairs, cols);
  const targetColumn = edgeTargetColumn(edge, cols);
  const forward = targetColumn >= sourceColumn;
  const sameColumn = targetColumn === sourceColumn;
  return { x: sameColumn ? target.x + W : (forward ? target.x : target.x + W), y: target.y + H / 2 + courseIncidentOffset(edge.toId, edge, edges) };
}

function horizontalClear(y: number, x1: number, x2: number, excludedIds: Set<string>): boolean {
  const left = Math.min(x1, x2) + 2;
  const right = Math.max(x1, x2) - 2;
  for (const course of visibleCourses()) {
    if (excludedIds.has(course.id)) continue;
    const position = state.positions[course.id];
    if (!position) continue;
    const overlapsX = position.x - ROUTE_CLEARANCE < right && position.x + W + ROUTE_CLEARANCE > left;
    const overlapsY = y > position.y - ROUTE_CLEARANCE && y < position.y + H + ROUTE_CLEARANCE;
    if (overlapsX && overlapsY) return false;
  }
  return true;
}

function edgeExcludedIds(edge: DependencyEdge, pairs: CorequisitePair[]): Set<string> {
  const result = new Set<string>([edge.toId]);
  if (edge.sourceKind === 'course') result.add(edge.fromId);
  else {
    const pair = pairByKey(edge.pairKey, pairs);
    if (pair) { result.add(pair.aId); result.add(pair.bId); }
  }
  return result;
}

function routePoints(plan: RoutePlan, source: Anchor, target: Anchor): Anchor[] {
  if (plan.kind === 'straight') return [source, target];
  if (plan.kind === 'adjacent') {
    const laneX = plan.laneX ?? (source.x + target.x) / 2;
    return [source, { x: laneX, y: source.y }, { x: laneX, y: target.y }, target];
  }
  const sourceLaneX = plan.sourceLaneX ?? source.x;
  const targetLaneX = plan.targetLaneX ?? target.x;
  const corridorY = plan.corridorY ?? (source.y + target.y) / 2;
  return [
    source,
    { x: sourceLaneX, y: source.y },
    { x: sourceLaneX, y: corridorY },
    { x: targetLaneX, y: corridorY },
    { x: targetLaneX, y: target.y },
    target,
  ];
}

function routeSegments(points: Anchor[]): RouteSegment[] {
  const segments: RouteSegment[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5) continue;
    segments.push({
      axis: Math.abs(a.y - b.y) < 0.5 ? 'h' : 'v',
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
    });
  }
  return segments;
}

function segmentLength(segment: RouteSegment): number {
  return Math.abs(segment.x2 - segment.x1) + Math.abs(segment.y2 - segment.y1);
}

function routeClearOfNodes(segments: RouteSegment[], excludedIds: Set<string>): boolean {
  for (const segment of segments) {
    const left = Math.min(segment.x1, segment.x2);
    const right = Math.max(segment.x1, segment.x2);
    const top = Math.min(segment.y1, segment.y2);
    const bottom = Math.max(segment.y1, segment.y2);
    for (const course of visibleCourses()) {
      if (excludedIds.has(course.id)) continue;
      const position = state.positions[course.id];
      if (!position) continue;
      const rectLeft = position.x - ROUTE_CLEARANCE;
      const rectRight = position.x + W + ROUTE_CLEARANCE;
      const rectTop = position.y - ROUTE_CLEARANCE;
      const rectBottom = position.y + H + ROUTE_CLEARANCE;
      if (segment.axis === 'h') {
        if (segment.y1 > rectTop && segment.y1 < rectBottom && right > rectLeft && left < rectRight) return false;
      } else if (segment.x1 > rectLeft && segment.x1 < rectRight && bottom > rectTop && top < rectBottom) return false;
    }
  }
  return true;
}

function segmentInteractionCost(a: RouteSegment, b: RouteSegment, compatibleBundle: boolean): number {
  const epsilon = 1.5;
  if (a.axis === b.axis) {
    if (a.axis === 'h') {
      const separation = Math.abs(a.y1 - b.y1);
      const overlap = Math.min(Math.max(a.x1, a.x2), Math.max(b.x1, b.x2))
        - Math.max(Math.min(a.x1, a.x2), Math.min(b.x1, b.x2));
      if (overlap > 2 && separation <= epsilon) {
        return compatibleBundle ? 30 : BALANCED_OVERLAP_PENALTY + overlap * 1.5;
      }
      if (overlap > 8 && separation < ROUTE_TRACK_SPACING * 0.6) return compatibleBundle ? 10 : 90;
    } else {
      const separation = Math.abs(a.x1 - b.x1);
      const overlap = Math.min(Math.max(a.y1, a.y2), Math.max(b.y1, b.y2))
        - Math.max(Math.min(a.y1, a.y2), Math.min(b.y1, b.y2));
      if (overlap > 2 && separation <= epsilon) {
        return compatibleBundle ? 30 : BALANCED_OVERLAP_PENALTY + overlap * 1.5;
      }
      if (overlap > 8 && separation < ROUTE_TRACK_SPACING * 0.6) return compatibleBundle ? 10 : 90;
    }
    return 0;
  }

  const horizontal = a.axis === 'h' ? a : b;
  const vertical = a.axis === 'v' ? a : b;
  const hLeft = Math.min(horizontal.x1, horizontal.x2);
  const hRight = Math.max(horizontal.x1, horizontal.x2);
  const vTop = Math.min(vertical.y1, vertical.y2);
  const vBottom = Math.max(vertical.y1, vertical.y2);
  const crosses = vertical.x1 > hLeft + 1 && vertical.x1 < hRight - 1
    && horizontal.y1 > vTop + 1 && horizontal.y1 < vBottom - 1;
  return crosses ? (compatibleBundle ? 20 : BALANCED_CROSSING_PENALTY) : 0;
}

function edgeBundleKey(edge: DependencyEdge): string {
  return edge.sourceKind === 'pair' ? `pair:${edge.pairKey}` : `course:${edge.fromId}`;
}

function routeInteractionCost(segments: RouteSegment[], planned: PlannedRoute[], bundleKey: string): number {
  let cost = 0;
  for (const current of segments) {
    for (const previous of planned) {
      const compatibleBundle = previous.bundleKey === bundleKey;
      for (const other of previous.segments) cost += segmentInteractionCost(current, other, compatibleBundle);
    }
  }
  return cost;
}

function routeScore(
  plan: RoutePlan,
  source: Anchor,
  target: Anchor,
  excludedIds: Set<string>,
  planned: PlannedRoute[],
  bundleKey: string,
): { score: number; segments: RouteSegment[] } | null {
  const points = routePoints(plan, source, target);
  const segments = routeSegments(points);
  if (!routeClearOfNodes(segments, excludedIds)) return null;

  const length = segments.reduce((sum, segment) => sum + segmentLength(segment), 0);
  const direct = Math.max(1, Math.abs(target.x - source.x) + Math.abs(target.y - source.y));
  const detour = length / direct;
  const bends = Math.max(0, segments.length - 1);
  const envelopeTop = Math.min(source.y, target.y) - BALANCED_LOCAL_MARGIN;
  const envelopeBottom = Math.max(source.y, target.y) + BALANCED_LOCAL_MARGIN;
  let outside = 0;
  for (const point of points) {
    if (point.y < envelopeTop) outside = Math.max(outside, envelopeTop - point.y);
    if (point.y > envelopeBottom) outside = Math.max(outside, point.y - envelopeBottom);
  }

  let score = length * 0.08;
  if (plan.kind === 'straight') score -= 120;
  if (bends > 2) score += (bends - 2) * BALANCED_BEND_PENALTY;
  if (detour > BALANCED_PREFERRED_DETOUR) score += (detour - BALANCED_PREFERRED_DETOUR) * 350;
  if (detour > BALANCED_NORMAL_DETOUR) score += (detour - BALANCED_NORMAL_DETOUR) * 900;
  if (detour > BALANCED_MAX_DETOUR) score += 4000 + (detour - BALANCED_MAX_DETOUR) * 1800;
  if (outside > 0) score += BALANCED_OUTSIDE_ENVELOPE_PENALTY + outside * 8;

  const verticalLength = segments
    .filter(segment => segment.axis === 'v')
    .reduce((sum, segment) => sum + segmentLength(segment), 0);
  score += Math.max(0, verticalLength - Math.abs(target.y - source.y) - BALANCED_LOCAL_MARGIN) * 0.35;
  score += routeInteractionCost(segments, planned, bundleKey);
  return { score, segments };
}

function boundaryLaneXs(leftColumnIndex: number, cols: Column[]): number[] {
  const left = clamp(leftColumnIndex, 0, Math.max(0, cols.length - 2));
  const gapStart = cols[left].x + W + 7;
  const gapEnd = cols[left + 1].x - 7;
  if (gapEnd <= gapStart) return [(gapStart + gapEnd) / 2];
  return Array.from({ length: BALANCED_MAX_BOUNDARY_LANES }, (_, index) =>
    gapStart + (index + 1) * ((gapEnd - gapStart) / (BALANCED_MAX_BOUNDARY_LANES + 1)));
}

function sameColumnLaneXs(columnIndex: number, cols: Column[]): number[] {
  if (columnIndex < cols.length - 1) return boundaryLaneXs(columnIndex, cols);
  return Array.from({ length: BALANCED_MAX_BOUNDARY_LANES }, (_, index) => cols[columnIndex].x + W + 18 + index * ROUTE_TRACK_SPACING);
}

function balancedCorridorYs(
  edge: DependencyEdge,
  edges: DependencyEdge[],
  pairs: CorequisitePair[],
  cols: Column[],
): number[] {
  const source = sourceAnchor(edge, edges, pairs, cols);
  const target = targetAnchor(edge, edges, pairs, cols);
  if (!source || !target) return [];
  const excluded = edgeExcludedIds(edge, pairs);
  const midpoint = (source.y + target.y) / 2;
  const envelopeTop = Math.min(source.y, target.y) - BALANCED_LOCAL_MARGIN;
  const envelopeBottom = Math.max(source.y, target.y) + BALANCED_LOCAL_MARGIN;
  const visiblePositions = visibleCourses()
    .filter(course => !excluded.has(course.id))
    .map(course => state.positions[course.id])
    .filter((position): position is NodePosition => Boolean(position));
  const maxBottom = Math.max(TOP + H, ...visiblePositions.map(position => position.y + H));
  const candidates = [
    source.y,
    target.y,
    midpoint,
    TOP - 18,
    maxBottom + 24,
    ...visiblePositions.flatMap(position => [
      position.y - ROUTE_CLEARANCE - 3,
      position.y + H + ROUTE_CLEARANCE + 3,
    ]),
  ];
  const uniqueCandidates = [...new Set(candidates.map(value => Math.round(value * 2) / 2))]
    .filter(value => horizontalClear(value, source.x, target.x, excluded));
  uniqueCandidates.sort((a, b) => {
    const aOutside = a < envelopeTop ? envelopeTop - a : a > envelopeBottom ? a - envelopeBottom : 0;
    const bOutside = b < envelopeTop ? envelopeTop - b : b > envelopeBottom ? b - envelopeBottom : 0;
    if ((aOutside === 0) !== (bOutside === 0)) return aOutside === 0 ? -1 : 1;
    return aOutside - bOutside || Math.abs(a - midpoint) - Math.abs(b - midpoint) || a - b;
  });
  return uniqueCandidates.slice(0, 10);
}

function chooseBalancedPlan(
  edge: DependencyEdge,
  candidates: RoutePlan[],
  edges: DependencyEdge[],
  pairs: CorequisitePair[],
  cols: Column[],
  planned: PlannedRoute[],
): { plan: RoutePlan; segments: RouteSegment[] } | null {
  const source = sourceAnchor(edge, edges, pairs, cols);
  const target = targetAnchor(edge, edges, pairs, cols);
  if (!source || !target) return null;
  const excluded = edgeExcludedIds(edge, pairs);
  const bundleKey = edgeBundleKey(edge);
  let best: { plan: RoutePlan; segments: RouteSegment[]; score: number; index: number } | null = null;
  for (let index = 0; index < candidates.length; index += 1) {
    const plan = candidates[index];
    const result = routeScore(plan, source, target, excluded, planned, bundleKey);
    if (!result) continue;
    if (!best || result.score < best.score - 0.001 || (Math.abs(result.score - best.score) <= 0.001 && index < best.index)) {
      best = { plan, segments: result.segments, score: result.score, index };
    }
  }
  return best ? { plan: best.plan, segments: best.segments } : null;
}

function rebuildOptimizedRoutes(): void {
  if (state.layoutMode !== 'optimized') { routePlans = null; return; }
  const cols = columns();
  const pairs = corequisitePairs();
  const edges = dependencyEdges(pairs);
  const plans = new Map<string, RoutePlan>();
  const planned: PlannedRoute[] = [];

  const planningOrder = [...edges].sort((a, b) => {
    const aSpan = Math.abs(edgeTargetColumn(a, cols) - edgeSourceColumn(a, pairs, cols));
    const bSpan = Math.abs(edgeTargetColumn(b, cols) - edgeSourceColumn(b, pairs, cols));
    return aSpan - bSpan || a.key.localeCompare(b.key);
  });

  for (const edge of planningOrder) {
    const source = sourceAnchor(edge, edges, pairs, cols);
    const target = targetAnchor(edge, edges, pairs, cols);
    const sourceColumn = edgeSourceColumn(edge, pairs, cols);
    const targetColumn = edgeTargetColumn(edge, cols);
    if (!source || !target || sourceColumn < 0 || targetColumn < 0) continue;

    const candidates: RoutePlan[] = [];
    if (Math.abs(source.y - target.y) <= 1.5) candidates.push({ kind: 'straight' });

    const span = Math.abs(targetColumn - sourceColumn);
    if (span === 0) {
      for (const laneX of sameColumnLaneXs(sourceColumn, cols)) candidates.push({ kind: 'adjacent', laneX });
    } else if (span === 1) {
      const boundary = Math.min(sourceColumn, targetColumn);
      for (const laneX of boundaryLaneXs(boundary, cols)) candidates.push({ kind: 'adjacent', laneX });
    } else {
      const forward = targetColumn > sourceColumn;
      const sourceBoundary = clamp(forward ? sourceColumn : sourceColumn - 1, 0, cols.length - 2);
      const targetBoundary = clamp(forward ? targetColumn - 1 : targetColumn, 0, cols.length - 2);
      const sourceLanes = boundaryLaneXs(sourceBoundary, cols);
      const targetLanes = boundaryLaneXs(targetBoundary, cols);
      const corridorYs = balancedCorridorYs(edge, edges, pairs, cols);
      const lanePairs = sourceLanes.map((sourceLaneX, index) => ({
        sourceLaneX,
        targetLaneX: targetLanes[index % targetLanes.length],
      }));
      for (const corridorY of corridorYs) {
        for (const pair of lanePairs) candidates.push({
          kind: 'corridor',
          sourceLaneX: pair.sourceLaneX,
          targetLaneX: pair.targetLaneX,
          corridorY,
        });
      }
    }

    const selectedPlan = chooseBalancedPlan(edge, candidates, edges, pairs, cols, planned);
    if (selectedPlan) {
      plans.set(edge.key, selectedPlan.plan);
      planned.push({ edgeKey: edge.key, bundleKey: edgeBundleKey(edge), segments: selectedPlan.segments });
      continue;
    }

    // Last-resort fallback: preserve node avoidance over compactness. This is the only
    // case where Balanced Routing deliberately leaves the local source/target envelope.
    const fallbackY = Math.max(
      source.y,
      target.y,
      ...visibleCourses().map(course => (state.positions[course.id]?.y ?? TOP) + H),
    ) + 24;
    const forward = targetColumn > sourceColumn;
    let sourceLaneX: number;
    let targetLaneX: number;
    if (span === 0 || cols.length < 2) {
      const lanes = sameColumnLaneXs(sourceColumn, cols);
      sourceLaneX = lanes[Math.floor(lanes.length / 2)];
      targetLaneX = sourceLaneX;
    } else {
      const sourceBoundary = clamp(forward ? sourceColumn : sourceColumn - 1, 0, cols.length - 2);
      const targetBoundary = clamp(forward ? targetColumn - 1 : targetColumn, 0, cols.length - 2);
      const sourceLanes = boundaryLaneXs(sourceBoundary, cols);
      const targetLanes = boundaryLaneXs(targetBoundary, cols);
      sourceLaneX = sourceLanes[Math.floor(sourceLanes.length / 2)];
      targetLaneX = targetLanes[Math.floor(targetLanes.length / 2)];
    }
    const fallback: RoutePlan = { kind: 'corridor', sourceLaneX, targetLaneX, corridorY: fallbackY };
    const fallbackResult = chooseBalancedPlan(edge, [fallback], edges, pairs, cols, planned);
    if (fallbackResult) {
      plans.set(edge.key, fallbackResult.plan);
      planned.push({ edgeKey: edge.key, bundleKey: edgeBundleKey(edge), segments: fallbackResult.segments });
    }
  }

  routePlans = plans;
}

function genericEdgePath(edge: DependencyEdge, edges: DependencyEdge[], pairs: CorequisitePair[], cols: Column[]): string {
  const source = sourceAnchor(edge, edges, pairs, cols);
  const target = targetAnchor(edge, edges, pairs, cols);
  if (!source || !target) return '';
  const middle = source.x + (target.x - source.x) / 2;
  return `M ${source.x} ${source.y} H ${middle} V ${target.y} H ${target.x}`;
}

function edgePath(edge: DependencyEdge, edges: DependencyEdge[], pairs: CorequisitePair[], cols: Column[]): string {
  const source = sourceAnchor(edge, edges, pairs, cols);
  const target = targetAnchor(edge, edges, pairs, cols);
  if (!source || !target) return '';
  const plan = routePlans?.get(edge.key);
  if (!plan) return genericEdgePath(edge, edges, pairs, cols);
  if (plan.kind === 'straight') return `M ${source.x} ${source.y} H ${target.x}`;
  if (plan.kind === 'adjacent') return `M ${source.x} ${source.y} H ${plan.laneX} V ${target.y} H ${target.x}`;
  return `M ${source.x} ${source.y} H ${plan.sourceLaneX} V ${plan.corridorY} H ${plan.targetLaneX} V ${target.y} H ${target.x}`;
}

function autoLayout(): void {
  setBasicRouting();
  const cols = columns();
  const visible = visibleCourses();
  cols.forEach(column => {
    visible.filter(course => course.yearLevel === column.year && course.semester === column.term).forEach((course, index) => {
      state.positions[course.id] = { x: column.x, y: TOP + index * (H + GAP) };
    });
  });
  const pairs = corequisitePairs();
  const layout = buildLayoutUnits(cols, pairs);
  initializeCompactCenters(layout.columns);
  applyUnitPositions(layout.columns, cols);
  save();
  renderFlow();
}

function renderTable(): void {
  const needle = norm(search.value);
  const courses = visibleCourses().filter(course => !needle || [
    course.yearLevel,
    course.semester,
    courseTrack(course),
    course.courseNo,
    course.title,
    ...course.prerequisites,
    ...course.corequisites,
    ...course.electivePrerequisites,
    ...course.otherRequirements,
  ].some(value => norm(value).includes(needle)));
  tbody.innerHTML = courses.map(course => `
    <tr data-id="${course.id}">
      <td data-label="Year Level"><input class="table-input wide-input" data-f="yearLevel" list="year-options" value="${esc(course.yearLevel)}" aria-label="${esc(course.courseNo)} year level"></td>
      <td data-label="Semester"><input class="table-input wide-input" data-f="semester" list="semester-options" value="${esc(course.semester)}" aria-label="${esc(course.courseNo)} semester"></td>
      <td data-label="Track"><input class="table-input wide-input" data-f="track" list="track-options" value="${esc(courseTrack(course))}" aria-label="${esc(course.courseNo)} track distinction"></td>
      <td data-label="Course No."><input class="table-input code-input" data-f="courseNo" value="${esc(course.courseNo)}" aria-label="Course number"></td>
      <td data-label="Title"><input class="table-input title-input" data-f="title" value="${esc(course.title)}" aria-label="${esc(course.courseNo)} descriptive title"></td>
      <td data-label="Units"><input class="table-input units-input" data-f="units" value="${esc(course.units)}" aria-label="${esc(course.courseNo)} units"></td>
      <td data-label="Prerequisites"><input class="table-input relation-input" data-f="prerequisites" value="${esc(course.prerequisites.join(', '))}" aria-label="${esc(course.courseNo)} prerequisites"></td>
      <td data-label="Corequisites"><input class="table-input relation-input" data-f="corequisites" value="${esc(course.corequisites.join(', '))}" aria-label="${esc(course.courseNo)} corequisites"></td>
      <td data-label="Elective prerequisites"><input class="table-input relation-input" data-f="electivePrerequisites" value="${esc(course.electivePrerequisites.join(', '))}" aria-label="${esc(course.courseNo)} elective prerequisites"></td>
      <td data-label="Other requirements"><input class="table-input relation-input" data-f="otherRequirements" value="${esc(course.otherRequirements.join(', '))}" aria-label="${esc(course.courseNo)} other requirements"></td>
      <td data-label="Actions" class="row-actions"><button class="icon-button" type="button" data-act="locate">Locate</button><button class="icon-button danger" type="button" data-act="delete">Delete</button></td>
    </tr>`).join('');
  count.textContent = courses.length === state.courses.length ? `${state.courses.length} courses` : `${courses.length} shown · ${state.courses.length} total`;
}

function updateField(id: string, field: keyof CurriculumCourse, value: string, oldCode?: string): void {
  const course = byId(id);
  if (!course) return;
  const topologyChanged = field === 'prerequisites' || field === 'corequisites' || field === 'electivePrerequisites' || field === 'yearLevel' || field === 'semester' || field === 'courseNo' || field === 'track';
  if (topologyChanged) setBasicRouting();
  if (field === 'prerequisites' || field === 'corequisites' || field === 'electivePrerequisites' || field === 'otherRequirements') course[field] = list(value);
  else if (field === 'track') course.track = normalizeTrackName(value);
  else if (field === 'yearLevel' || field === 'semester' || field === 'courseNo' || field === 'title' || field === 'units') course[field] = value;
  if (field === 'courseNo' && oldCode && norm(oldCode) !== norm(value)) {
    const replace = (items: string[]): string[] => items.map(item => norm(item) === norm(oldCode) ? value : item);
    state.courses.forEach(item => {
      item.prerequisites = replace(item.prerequisites);
      item.corequisites = replace(item.corequisites);
      item.electivePrerequisites = replace(item.electivePrerequisites);
    });
  }
  if (field === 'yearLevel' || field === 'semester') state.positions[id] = defaultPos(course);
  ensurePositions();
  renderTrackControls();
  save();
  renderFlow();
}

function addCourse(): void {
  setBasicRouting();
  const id = `course-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
  const course: CurriculumCourse = {
    id,
    yearLevel: 'First Year',
    semester: 'First Semester',
    track: 'Common',
    courseNo: `NEW ${state.courses.length + 1}`,
    title: 'New Course',
    units: '3',
    prerequisites: [],
    corequisites: [],
    electivePrerequisites: [],
    otherRequirements: [],
  };
  state.courses.push(course);
  state.positions[id] = defaultPos(course);
  renderTrackControls();
  save();
  renderTable();
  renderFlow();
}

function deleteCourse(id: string): void {
  const course = byId(id);
  if (!course || !confirm(`Delete ${course.courseNo}? Related references will also be removed.`)) return;
  setBasicRouting();
  state.courses = state.courses.filter(item => item.id !== id);
  delete state.positions[id];
  selected.delete(id);
  const clean = (items: string[]): string[] => items.filter(item => norm(item) !== norm(course.courseNo));
  state.courses.forEach(item => {
    item.prerequisites = clean(item.prerequisites);
    item.corequisites = clean(item.corequisites);
    item.electivePrerequisites = clean(item.electivePrerequisites);
  });
  renderTrackControls();
  save();
  renderTable();
  renderFlow();
}

function yearClass(year: string): string { return `year-${(years().indexOf(year) % 4) + 1}`; }
function termClass(term: string): string {
  const value = norm(term);
  if (value.includes('first')) return 'term-first';
  if (value.includes('second')) return 'term-second';
  if (value.includes('short') || value.includes('summer')) return 'term-short';
  return 'term-other';
}

function updateCanvasSize(): void {
  const cols = columns();
  const positions = visibleCourses().map(course => state.positions[course.id]).filter((position): position is NodePosition => Boolean(position));
  const maxNodeX = Math.max(0, ...positions.map(position => position.x + W + 100));
  const maxNodeY = Math.max(0, ...positions.map(position => position.y + H + 120));
  const routeMaxY = routePlans ? Math.max(0, ...[...routePlans.values()].map(plan => plan.corridorY ?? 0)) + 70 : 0;
  logicalWidth = Math.max(920, cols.length * COL + 70, maxNodeX);
  logicalHeight = Math.max(620, maxNodeY, routeMaxY);
  canvas.style.width = `${logicalWidth}px`;
  canvas.style.height = `${logicalHeight}px`;
  svg.setAttribute('viewBox', `0 0 ${logicalWidth} ${logicalHeight}`);
  svg.setAttribute('width', `${logicalWidth}`);
  svg.setAttribute('height', `${logicalHeight}`);
}

function renderFlow(): void {
  ensurePositions();
  if (state.layoutMode === 'optimized') rebuildOptimizedRoutes();
  const cols = columns();
  const visible = visibleCourses();
  updateCanvasSize();
  headers.innerHTML = years().map(year => {
    const yearColumns = cols.filter(column => column.year === year);
    if (!yearColumns.length) return '';
    const width = yearColumns[yearColumns.length - 1].x - yearColumns[0].x + W;
    return `<div class="year-header ${yearClass(year)}" style="left:${yearColumns[0].x}px;width:${width}px">${esc(year.toUpperCase())}</div>`;
  }).join('') + cols.map(column => `<div class="term-header ${yearClass(column.year)} ${termClass(column.term)}" style="left:${column.x}px;width:${W}px">${esc(column.term)}</div>`).join('');
  nodes.innerHTML = visible.map(course => {
    const position = state.positions[course.id];
    const track = courseTrack(course);
    const trackSuffix = norm(track) === 'common' ? '' : ` · ${esc(track)}`;
    return `<article class="course-node ${yearClass(course.yearLevel)} ${termClass(course.semester)}${selected.has(course.id) ? ' selected' : ''}" data-id="${course.id}" data-track="${esc(track)}" style="left:${position.x}px;top:${position.y}px" tabindex="0" role="button" aria-label="${esc(`${course.courseNo}, ${course.title}, ${track}`)}"><div class="node-code">${esc(course.courseNo || 'Untitled')}</div><div class="node-title">${esc(course.title || 'No descriptive title')}</div><div class="node-meta">${esc(course.units || '—')} unit${course.units === '1' ? '' : 's'}${trackSuffix}</div></article>`;
  }).join('');
  renderEdges();
  updateSelection();
  applyViewportTransform();
}

function corequisiteMarkup(pair: CorequisitePair, exportMode = false): string {
  const geometry = pairGeometry(pair);
  if (!geometry) return '';
  const xLeft = geometry.x - 3.5;
  const xRight = geometry.x + 3.5;
  const marker = exportMode ? 'export-coreq-arrow' : 'coreq-arrow';
  const className = exportMode ? '' : ' class="corequisite-line"';
  const stroke = exportMode ? ' stroke="#58677d" stroke-width="1.8"' : '';
  const upperToLower = `<path d="M ${xLeft} ${geometry.upperBottom} V ${geometry.lowerTop}"${className}${stroke} marker-end="url(#${marker})"/>`;
  const lowerToUpper = `<path d="M ${xRight} ${geometry.lowerTop} V ${geometry.upperBottom}"${className}${stroke} marker-end="url(#${marker})"/>`;
  return upperToLower + lowerToUpper;
}

function renderEdges(): void {
  const pairs = corequisitePairs();
  const edges = dependencyEdges(pairs);
  const cols = columns();
  const defs = `<defs><marker id="arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0 0 L8 4 L0 8z" class="arrowhead-shape"></path></marker><marker id="coreq-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="strokeWidth"><path d="M0 0 L7 3.5 L0 7z" class="coreq-arrowhead-shape"></path></marker></defs>`;
  const coreq = pairs.map(pair => corequisiteMarkup(pair)).join('');
  const deps = edges.map(edge => `<path d="${edgePath(edge, edges, pairs, cols)}" class="relationship relationship-${edge.type}${edge.sourceKind === 'pair' ? ' relationship-from-coreq' : ''}" marker-end="url(#arrowhead)"></path>`).join('');
  svg.innerHTML = defs + coreq + deps;
}

function updateSelection(): void {
  nodes.querySelectorAll<HTMLElement>('.course-node').forEach(node => node.classList.toggle('selected', selected.has(node.dataset.id!)));
  const amount = selected.size;
  selectionStatus.textContent = amount ? `${amount} course${amount === 1 ? '' : 's'} selected` : 'No courses selected';
  if (multiSelect) flowHint.textContent = 'Multi-select is on. Tap courses to add/remove them; corequisite partners move together.';
  else if (state.layoutMode === 'optimized') flowHint.textContent = 'Balanced routing stays active while you move nodes. Short local paths are preferred and corequisite pairs remain vertically coupled.';
  else if (amount >= 2) flowHint.textContent = 'Alignment tools apply to selected courses. Pinch to zoom or drag empty space to pan.';
  else flowHint.textContent = 'Tap a course to select. Drag empty space to pan. Pinch with two fingers to zoom.';
  document.querySelectorAll<HTMLButtonElement>('[data-align]').forEach(button => { button.disabled = button.dataset.align?.startsWith('distribute') ? amount < 3 : amount < 2; });
}

function expandedSelectionForCorequisites(ids: Iterable<string>): Set<string> {
  const result = new Set(ids);
  const pairs = corequisitePairs();
  for (const id of [...result]) corequisiteComponentIds(id, pairs).forEach(member => result.add(member));
  return result;
}

function afterManualPositionChange(): void {
  if (state.layoutMode === 'optimized') rebuildOptimizedRoutes();
  else routePlans = null;
}

function align(action: AlignmentAction): void {
  const workingSelection = state.layoutMode === 'optimized' ? expandedSelectionForCorequisites(selected) : new Set(selected);
  const items = [...workingSelection].map(id => ({ id, position: state.positions[id] })).filter(item => item.position) as { id: string; position: NodePosition }[];
  if (items.length < 2) return;
  const left = Math.min(...items.map(item => item.position.x));
  const right = Math.max(...items.map(item => item.position.x + W));
  const top = Math.min(...items.map(item => item.position.y));
  const bottom = Math.max(...items.map(item => item.position.y + H));
  if (action.startsWith('distribute') && items.length >= 3) {
    const horizontal = action === 'distribute-horizontal';
    items.sort((a, b) => horizontal ? a.position.x - b.position.x : a.position.y - b.position.y);
    const first = horizontal ? items[0].position.x : items[0].position.y;
    const last = horizontal ? items.at(-1)!.position.x : items.at(-1)!.position.y;
    const step = (last - first) / (items.length - 1);
    items.forEach((item, index) => { if (horizontal) item.position.x = first + step * index; else item.position.y = first + step * index; });
  } else {
    items.forEach(item => {
      if (action === 'left') item.position.x = left;
      if (action === 'center') item.position.x = (left + right - W) / 2;
      if (action === 'right') item.position.x = right - W;
      if (action === 'top') item.position.y = top;
      if (action === 'middle') item.position.y = (top + bottom - H) / 2;
      if (action === 'bottom') item.position.y = bottom - H;
    });
  }
  if (state.snapToGrid) items.forEach(item => { item.position.x = Math.round(item.position.x / GRID) * GRID; item.position.y = Math.round(item.position.y / GRID) * GRID; });
  afterManualPositionChange();
  save();
  renderFlow();
}

function alignToTerms(): void {
  const cols = columns();
  const workingSelection = state.layoutMode === 'optimized' ? expandedSelectionForCorequisites(selected) : new Set(selected);
  workingSelection.forEach(id => {
    const course = byId(id);
    const position = state.positions[id];
    const column = course && cols.find(item => item.year === course.yearLevel && item.term === course.semester);
    if (position && column) position.x = column.x;
  });
  afterManualPositionChange();
  save();
  renderFlow();
}

function applyViewportTransform(): void {
  const view = state.viewport;
  canvas.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  zoomDisplay.value = `${Math.round(view.scale * 100)}%`;
  zoomDisplay.textContent = zoomDisplay.value;
}

function setZoomAt(nextScale: number, clientX: number, clientY: number, persist = true): void {
  const rect = viewport.getBoundingClientRect();
  const oldScale = state.viewport.scale;
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  const canvasX = (localX - state.viewport.x) / oldScale;
  const canvasY = (localY - state.viewport.y) / oldScale;
  const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
  state.viewport.scale = scale;
  state.viewport.x = localX - canvasX * scale;
  state.viewport.y = localY - canvasY * scale;
  applyViewportTransform();
  if (persist) save();
}

function zoomBy(factor: number): void {
  const rect = viewport.getBoundingClientRect();
  setZoomAt(state.viewport.scale * factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
}

function fitView(): void {
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  if (!width || !height) return;
  updateCanvasSize();
  const padding = width < 600 ? 18 : 34;
  const scale = clamp(Math.min((width - padding * 2) / logicalWidth, (height - padding * 2) / logicalHeight), MIN_SCALE, 1.2);
  state.viewport.scale = scale;
  state.viewport.x = (width - logicalWidth * scale) / 2;
  state.viewport.y = (height - logicalHeight * scale) / 2;
  applyViewportTransform();
  save();
}

function resetView(): void { state.viewport = { ...DEFAULT_VIEWPORT }; applyViewportTransform(); save(); }

function switchView(view: 'table' | 'flow'): void {
  tablePanel.hidden = view !== 'table';
  flowPanel.hidden = view !== 'flow';
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  if (view === 'flow') requestAnimationFrame(() => renderFlow());
}

function locate(id: string): void {
  selected = new Set([id]);
  switchView('flow');
  requestAnimationFrame(() => {
    const position = state.positions[id];
    if (!position) return;
    state.viewport.x = viewport.clientWidth / 2 - (position.x + W / 2) * state.viewport.scale;
    state.viewport.y = viewport.clientHeight / 2 - (position.y + H / 2) * state.viewport.scale;
    applyViewportTransform();
    updateSelection();
    save();
  });
}

function setMultiSelect(enabled: boolean): void {
  multiSelect = enabled;
  multiSelectButton.classList.toggle('active', enabled);
  multiSelectButton.setAttribute('aria-pressed', String(enabled));
  updateSelection();
}

function pointDistance(a: PointerPoint, b: PointerPoint): number { return Math.hypot(a.x - b.x, a.y - b.y); }

function beginPinch(): void {
  const entries = [...activePointers.entries()].slice(0, 2);
  if (entries.length < 2) return;
  const [first, second] = entries;
  const p1 = first[1];
  const p2 = second[1];
  const distance = Math.max(1, pointDistance(p1, p2));
  const middleX = (p1.x + p2.x) / 2;
  const middleY = (p1.y + p2.y) / 2;
  const rect = viewport.getBoundingClientRect();
  gesture = { kind: 'pinch', pointerIds: [first[0], second[0]], startDistance: distance, startScale: state.viewport.scale, focalX: (middleX - rect.left - state.viewport.x) / state.viewport.scale, focalY: (middleY - rect.top - state.viewport.y) / state.viewport.scale };
  nodes.querySelectorAll('.dragging').forEach(element => element.classList.remove('dragging'));
  viewport.classList.add('panning');
}

function pointerDown(event: PointerEvent): void {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  event.preventDefault();
  viewport.focus({ preventScroll: true });
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  try { viewport.setPointerCapture(event.pointerId); } catch { /* optional */ }
  if (activePointers.size >= 2) { beginPinch(); return; }
  const node = (event.target as HTMLElement).closest<HTMLElement>('.course-node');
  if (!node) {
    gesture = { kind: 'pan', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startPanX: state.viewport.x, startPanY: state.viewport.y, moved: false };
    return;
  }
  const id = node.dataset.id!;
  const additive = multiSelect || event.shiftKey || event.ctrlKey || event.metaKey;
  const wasSelected = selected.has(id);
  if (!wasSelected) {
    if (!additive) selected.clear();
    selected.add(id);
    updateSelection();
  }
  const dragIds = expandedSelectionForCorequisites(selected.has(id) ? selected : [id]);
  const starts = new Map<string, NodePosition>();
  dragIds.forEach(dragId => { const position = state.positions[dragId]; if (position) starts.set(dragId, { ...position }); });
  gesture = { kind: 'node', pointerId: event.pointerId, nodeId: id, startX: event.clientX, startY: event.clientY, starts, additive, wasSelected, moved: false };
}

function pointerMove(event: PointerEvent): void {
  if (!activePointers.has(event.pointerId)) return;
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (activePointers.size >= 2) {
    if (gesture?.kind !== 'pinch') beginPinch();
    if (gesture?.kind !== 'pinch') return;
    const first = activePointers.get(gesture.pointerIds[0]);
    const second = activePointers.get(gesture.pointerIds[1]);
    if (!first || !second) return;
    const distance = Math.max(1, pointDistance(first, second));
    const scale = clamp(gesture.startScale * (distance / gesture.startDistance), MIN_SCALE, MAX_SCALE);
    const middleX = (first.x + second.x) / 2;
    const middleY = (first.y + second.y) / 2;
    const rect = viewport.getBoundingClientRect();
    state.viewport.scale = scale;
    state.viewport.x = middleX - rect.left - gesture.focalX * scale;
    state.viewport.y = middleY - rect.top - gesture.focalY * scale;
    applyViewportTransform();
    return;
  }
  if (!gesture || gesture.kind === 'pinch' || gesture.pointerId !== event.pointerId) return;
  const deltaX = event.clientX - gesture.startX;
  const deltaY = event.clientY - gesture.startY;
  if (Math.abs(deltaX) + Math.abs(deltaY) > 4) gesture.moved = true;
  if (gesture.kind === 'pan') {
    state.viewport.x = gesture.startPanX + deltaX;
    state.viewport.y = gesture.startPanY + deltaY;
    viewport.classList.toggle('panning', gesture.moved);
    applyViewportTransform();
    return;
  }
  if (!gesture.moved) return;
  const canvasDeltaX = deltaX / state.viewport.scale;
  const canvasDeltaY = deltaY / state.viewport.scale;
  gesture.starts.forEach((start, id) => {
    let x = Math.max(0, start.x + canvasDeltaX);
    let y = Math.max(108, start.y + canvasDeltaY);
    if (state.snapToGrid) { x = Math.round(x / GRID) * GRID; y = Math.round(y / GRID) * GRID; }
    state.positions[id] = { x, y };
    const element = nodes.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
    if (element) { element.style.left = `${x}px`; element.style.top = `${y}px`; element.classList.add('dragging'); }
  });
  afterManualPositionChange();
  renderEdges();
}

function finishPointer(event: PointerEvent): void {
  const currentGesture = gesture;
  activePointers.delete(event.pointerId);
  try { viewport.releasePointerCapture(event.pointerId); } catch { /* no active capture */ }
  if (currentGesture?.kind === 'pinch') {
    viewport.classList.remove('panning');
    save();
    if (activePointers.size === 1) {
      const remaining = [...activePointers.entries()][0];
      gesture = { kind: 'pan', pointerId: remaining[0], startX: remaining[1].x, startY: remaining[1].y, startPanX: state.viewport.x, startPanY: state.viewport.y, moved: true };
    } else gesture = null;
    return;
  }
  if (currentGesture?.kind === 'node' && currentGesture.pointerId === event.pointerId) {
    nodes.querySelectorAll('.dragging').forEach(element => element.classList.remove('dragging'));
    if (currentGesture.moved) { afterManualPositionChange(); updateCanvasSize(); renderEdges(); save(); }
    else {
      if (currentGesture.additive && currentGesture.wasSelected) selected.delete(currentGesture.nodeId);
      else if (!currentGesture.additive) selected = new Set([currentGesture.nodeId]);
      updateSelection();
    }
  }
  if (currentGesture?.kind === 'pan' && currentGesture.pointerId === event.pointerId) {
    viewport.classList.remove('panning');
    if (!currentGesture.moved && !multiSelect) { selected.clear(); updateSelection(); }
    else if (currentGesture.moved) save();
  }
  gesture = null;
}

function moveSelectedBy(dx: number, dy: number): void {
  if (!selected.size) return;
  const workingSelection = expandedSelectionForCorequisites(selected);
  workingSelection.forEach(id => {
    const position = state.positions[id];
    if (!position) return;
    position.x = Math.max(0, position.x + dx);
    position.y = Math.max(108, position.y + dy);
    if (state.snapToGrid) { position.x = Math.round(position.x / GRID) * GRID; position.y = Math.round(position.y / GRID) * GRID; }
  });
  afterManualPositionChange();
  save();
  renderFlow();
}

function svgPalette(year: string): { base: string; border: string; first: string; second: string; short: string } {
  const palettes = [
    { base: '#e5bd25', border: '#ac870b', first: '#f1d258', second: '#f7e387', short: '#fff1ba' },
    { base: '#42a958', border: '#297f3b', first: '#70ca80', second: '#a5dfae', short: '#d7f1dc' },
    { base: '#438ed3', border: '#2e6da8', first: '#78b4e9', second: '#abd0f3', short: '#dceafa' },
    { base: '#7185c2', border: '#5669a2', first: '#9caada', second: '#bec8e7', short: '#e1e5f4' },
  ];
  return palettes[(years().indexOf(year) % palettes.length + palettes.length) % palettes.length];
}

function svgTermFill(year: string, term: string): string {
  const palette = svgPalette(year);
  const type = termClass(term);
  if (type === 'term-first') return palette.first;
  if (type === 'term-second') return palette.second;
  if (type === 'term-short') return palette.short;
  return '#f1f3f7';
}

function titleLines(title: string): string[] {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return ['No descriptive title'];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= 30 || !current) current = next;
    else { lines.push(current); current = word; if (lines.length === 2) break; }
  }
  if (lines.length < 2 && current) lines.push(current);
  if (lines.length === 2 && words.join(' ').length > lines.join(' ').length) lines[1] = `${lines[1].slice(0, 27)}…`;
  return lines.slice(0, 2);
}

function buildExportSvg(): string {
  if (state.layoutMode === 'optimized') rebuildOptimizedRoutes();
  updateCanvasSize();
  const cols = columns();
  const pairs = corequisitePairs();
  const edges = dependencyEdges(pairs);
  const visible = visibleCourses();
  const marker = `<defs><marker id="export-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0 0 L8 4 L0 8z" fill="#29384f"/></marker><marker id="export-coreq-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="strokeWidth"><path d="M0 0 L7 3.5 L0 7z" fill="#58677d"/></marker></defs>`;
  const background = `<rect width="${logicalWidth}" height="${logicalHeight}" fill="#ffffff"/>`;
  const yearHeaders = years().map(year => {
    const yearColumns = cols.filter(column => column.year === year);
    if (!yearColumns.length) return '';
    const x = yearColumns[0].x;
    const width = yearColumns[yearColumns.length - 1].x - x + W;
    const palette = svgPalette(year);
    const textColor = years().indexOf(year) === 0 ? '#172033' : '#ffffff';
    return `<rect x="${x}" y="18" width="${width}" height="30" rx="7" fill="${palette.base}" stroke="${palette.border}"/><text x="${x + width / 2}" y="38" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" font-weight="700" fill="${textColor}">${esc(year.toUpperCase())}</text>`;
  }).join('');
  const termHeaders = cols.map(column => `<rect x="${column.x}" y="62" width="${W}" height="30" rx="7" fill="${svgTermFill(column.year, column.term)}" stroke="${svgPalette(column.year).border}"/><text x="${column.x + W / 2}" y="82" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" font-weight="700" fill="#344054">${esc(column.term)}</text>`).join('');
  const coreqMarkup = pairs.map(pair => corequisiteMarkup(pair, true)).join('');
  const edgeMarkup = edges.map(edge => {
    const dash = edge.type === 'elective' ? ' stroke-dasharray="7 5"' : '';
    return `<path d="${edgePath(edge, edges, pairs, cols)}" fill="none" stroke="#29384f" stroke-width="1.5"${dash} marker-end="url(#export-arrow)"/>`;
  }).join('');
  const nodeMarkup = visible.map(course => {
    const position = state.positions[course.id];
    const palette = svgPalette(course.yearLevel);
    const fill = svgTermFill(course.yearLevel, course.semester);
    const lines = titleLines(course.title);
    const title = lines.map((line, index) => `<text x="${position.x + 9}" y="${position.y + 38 + index * 12}" font-family="Arial,sans-serif" font-size="10.5" fill="#172033">${esc(line)}</text>`).join('');
    const track = courseTrack(course);
    const trackSuffix = norm(track) === 'common' ? '' : ` · ${track}`;
    return `<g><rect x="${position.x}" y="${position.y}" width="${W}" height="${H}" rx="8" fill="${fill}" stroke="${palette.border}" stroke-width="1.5"/><text x="${position.x + 9}" y="${position.y + 19}" font-family="Arial,sans-serif" font-size="12" font-weight="700" fill="#172033">${esc(course.courseNo || 'Untitled')}</text>${title}<text x="${position.x + 9}" y="${position.y + 69}" font-family="Arial,sans-serif" font-size="9.5" font-weight="600" fill="#344054">${esc(`${course.units || '—'} unit${course.units === '1' ? '' : 's'}${trackSuffix}`)}</text></g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${logicalWidth}" height="${logicalHeight}" viewBox="0 0 ${logicalWidth} ${logicalHeight}">${marker}${background}${yearHeaders}${termHeaders}${coreqMarkup}${edgeMarkup}${nodeMarkup}</svg>`;
}

async function downloadImage(): Promise<void> {
  downloadButton.disabled = true;
  const previousText = downloadButton.textContent;
  downloadButton.textContent = 'Preparing…';
  try {
    const svgText = buildExportSvg();
    const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);
    const image = new Image();
    const loaded = new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Could not render the flowchart image.')); });
    image.src = svgUrl;
    await loaded;
    const renderScale = Math.max(0.25, Math.min(2, 12000 / logicalWidth, 12000 / logicalHeight));
    const output = document.createElement('canvas');
    output.width = Math.max(1, Math.round(logicalWidth * renderScale));
    output.height = Math.max(1, Math.round(logicalHeight * renderScale));
    const context = output.getContext('2d');
    if (!context) throw new Error('Canvas export is unavailable in this browser.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, output.width, output.height);
    context.drawImage(image, 0, 0, output.width, output.height);
    URL.revokeObjectURL(svgUrl);
    const pngBlob = await new Promise<Blob>((resolve, reject) => output.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG export failed.')), 'image/png'));
    const pngUrl = URL.createObjectURL(pngBlob);
    const link = document.createElement('a');
    link.href = pngUrl;
    link.download = `curriculum-flowchart-${new Date().toISOString().slice(0, 10)}.png`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(pngUrl), 1000);
    status.textContent = 'PNG downloaded';
  } catch (error) {
    console.error(error);
    status.textContent = error instanceof Error ? error.message : 'Image export failed';
  } finally {
    downloadButton.disabled = false;
    downloadButton.textContent = previousText;
  }
}

tbody.addEventListener('focusin', event => {
  const input = (event.target as HTMLElement).closest<HTMLInputElement>('input[data-f]');
  if (input) input.dataset.old = input.value;
});
tbody.addEventListener('input', event => {
  const input = (event.target as HTMLElement).closest<HTMLInputElement>('input[data-f]');
  const row = input?.closest<HTMLTableRowElement>('tr[data-id]');
  if (input && row && input.dataset.f !== 'track') updateField(row.dataset.id!, input.dataset.f as keyof CurriculumCourse, input.value);
});
tbody.addEventListener('change', event => {
  const input = (event.target as HTMLElement).closest<HTMLInputElement>('input[data-f]');
  const row = input?.closest<HTMLTableRowElement>('tr[data-id]');
  if (!input || !row) return;
  if (input.dataset.f === 'courseNo') {
    updateField(row.dataset.id!, 'courseNo', input.value, input.dataset.old);
    renderTable();
  } else if (input.dataset.f === 'track') {
    updateField(row.dataset.id!, 'track', input.value);
    renderTable();
  }
});
tbody.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
  const row = button?.closest<HTMLTableRowElement>('tr[data-id]');
  if (!button || !row) return;
  if (button.dataset.act === 'locate') locate(row.dataset.id!); else deleteCourse(row.dataset.id!);
});

trackFilterControl.addEventListener('change', () => {
  state.trackFilter = trackFilterControl.value || 'all';
  applyTrackViewChange();
});
trackVisibility.addEventListener('change', event => {
  const input = (event.target as HTMLElement).closest<HTMLInputElement>('input[data-track]');
  if (!input?.dataset.track) return;
  const hidden = hiddenTrackKeys();
  const key = norm(input.dataset.track);
  if (input.checked) hidden.delete(key); else hidden.add(key);
  state.hiddenTracks = trackNames().filter(track => hidden.has(norm(track)));
  applyTrackViewChange();
});
showAllTracksButton.addEventListener('click', () => {
  state.hiddenTracks = [];
  state.trackFilter = 'all';
  applyTrackViewChange();
});

viewport.addEventListener('pointerdown', pointerDown);
viewport.addEventListener('pointermove', pointerMove);
viewport.addEventListener('pointerup', finishPointer);
viewport.addEventListener('pointercancel', finishPointer);
viewport.addEventListener('wheel', event => {
  event.preventDefault();
  if (event.ctrlKey || event.metaKey) setZoomAt(state.viewport.scale * Math.exp(-event.deltaY * 0.002), event.clientX, event.clientY);
  else {
    if (event.shiftKey) state.viewport.x -= event.deltaY;
    else { state.viewport.x -= event.deltaX; state.viewport.y -= event.deltaY; }
    applyViewportTransform();
    save();
  }
}, { passive: false });

viewport.addEventListener('keydown', event => {
  const focusedNode = (event.target as HTMLElement).closest<HTMLElement>('.course-node');
  if ((event.key === 'Enter' || event.key === ' ') && focusedNode) { event.preventDefault(); selected = new Set([focusedNode.dataset.id!]); updateSelection(); return; }
  if (event.key === 'Escape') { selected.clear(); updateSelection(); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
    event.preventDefault();
    selected = new Set(visibleCourses().map(course => course.id));
    updateSelection();
    return;
  }
  const step = event.shiftKey ? 20 : (state.snapToGrid ? GRID : 1);
  if (event.key === 'ArrowLeft') { event.preventDefault(); moveSelectedBy(-step, 0); }
  if (event.key === 'ArrowRight') { event.preventDefault(); moveSelectedBy(step, 0); }
  if (event.key === 'ArrowUp') { event.preventDefault(); moveSelectedBy(0, -step); }
  if (event.key === 'ArrowDown') { event.preventDefault(); moveSelectedBy(0, step); }
});

document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view === 'flow' ? 'flow' : 'table')));
document.querySelectorAll<HTMLButtonElement>('[data-align]').forEach(button => button.addEventListener('click', () => align(button.dataset.align as AlignmentAction)));
q<HTMLButtonElement>('#add-course').addEventListener('click', addCourse);
q<HTMLButtonElement>('#reset-sample').addEventListener('click', () => {
  if (!confirm('Replace the current curriculum and layout with the Google Sheets sample?')) return;
  state = {
    courses: createSampleCourses(),
    positions: {},
    snapToGrid: true,
    viewport: { ...DEFAULT_VIEWPORT },
    layoutMode: 'basic',
    trackFilter: 'all',
    hiddenTracks: [],
    updatedAt: Date.now(),
  };
  routePlans = null;
  selected.clear();
  setMultiSelect(false);
  snap.checked = true;
  ensurePositions();
  renderTrackControls();
  save();
  renderTable();
  renderFlow();
});
q<HTMLButtonElement>('#generate-flowchart').addEventListener('click', () => { autoLayout(); switchView('flow'); requestAnimationFrame(() => requestAnimationFrame(fitView)); });
q<HTMLButtonElement>('#auto-layout').addEventListener('click', autoLayout);
q<HTMLButtonElement>('#optimize-layout').addEventListener('click', optimizeLayout);
q<HTMLButtonElement>('#align-to-terms').addEventListener('click', alignToTerms);
q<HTMLButtonElement>('#clear-selection').addEventListener('click', () => { selected.clear(); updateSelection(); });
multiSelectButton.addEventListener('click', () => setMultiSelect(!multiSelect));
q<HTMLButtonElement>('#zoom-out').addEventListener('click', () => zoomBy(0.8));
q<HTMLButtonElement>('#zoom-in').addEventListener('click', () => zoomBy(1.25));
q<HTMLButtonElement>('#fit-view').addEventListener('click', fitView);
q<HTMLButtonElement>('#reset-view').addEventListener('click', resetView);
downloadButton.addEventListener('click', () => { void downloadImage(); });
search.addEventListener('input', renderTable);
snap.checked = state.snapToGrid;
snap.addEventListener('change', () => { state.snapToGrid = snap.checked; save(); });
window.addEventListener('resize', () => applyViewportTransform());

ensurePositions();
renderTrackControls();
if (state.layoutMode === 'optimized') rebuildOptimizedRoutes();
renderTable();
renderFlow();
switchView('table');
status.textContent = localStorage.getItem(KEY) ? 'Loaded saved work' : 'Sample data loaded';
