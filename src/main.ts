import { createSampleCourses } from './sampleData.js';
import type { AlignmentAction, CanvasViewportState, CurriculumCourse, NodePosition, PersistedState, Relationship } from './types.js';

const KEY = 'curriculum-flowchart:v1';
const W = 184, H = 78, COL = 260, TOP = 132, GAP = 20, GRID = 10;
const MIN_SCALE = 0.15, MAX_SCALE = 2.5;
const YEARS = ['First Year', 'Second Year', 'Third Year', 'Fourth Year'];
const TERMS = ['First Semester', 'Second Semester', 'Short Term'];
const DEFAULT_VIEWPORT: CanvasViewportState = { scale: 1, x: 24, y: 24 };

type RuntimeState = PersistedState & { viewport: CanvasViewportState };
interface Column { year: string; term: string; x: number; }
interface PointerPoint { x: number; y: number; }
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

let state = load();
let selected = new Set<string>();
let saveTimer = 0;
let multiSelect = false;
let gesture: Gesture = null;
let logicalWidth = 920;
let logicalHeight = 620;
const activePointers = new Map<number, PointerPoint>();

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
        return {
          ...parsed,
          positions: parsed.positions ?? {},
          snapToGrid: parsed.snapToGrid !== false,
          viewport: sanitizeViewport(parsed.viewport),
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

function columns(): Column[] {
  const result: Column[] = [];
  let index = 0;
  years().forEach(year => terms(year).forEach(term => result.push({ year, term, x: 34 + index++ * COL })));
  return result;
}

function defaultPos(course: CurriculumCourse): NodePosition {
  const column = columns().find(item => item.year === course.yearLevel && item.term === course.semester);
  const peers = state.courses.filter(item => item.yearLevel === course.yearLevel && item.semester === course.semester);
  return { x: column?.x ?? 34, y: TOP + Math.max(0, peers.findIndex(item => item.id === course.id)) * (H + GAP) };
}

function ensurePositions(): void {
  const ids = new Set(state.courses.map(course => course.id));
  Object.keys(state.positions).forEach(id => { if (!ids.has(id)) delete state.positions[id]; });
  state.courses.forEach(course => { state.positions[course.id] ??= defaultPos(course); });
}

function autoLayout(): void {
  columns().forEach(column => {
    state.courses.filter(course => course.yearLevel === column.year && course.semester === column.term).forEach((course, index) => {
      state.positions[course.id] = { x: column.x, y: TOP + index * (H + GAP) };
    });
  });
  save();
  renderFlow();
}

function renderTable(): void {
  const needle = norm(search.value);
  const courses = state.courses.filter(course => !needle || [
    course.yearLevel,
    course.semester,
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
      <td data-label="Course No."><input class="table-input code-input" data-f="courseNo" value="${esc(course.courseNo)}" aria-label="Course number"></td>
      <td data-label="Title"><input class="table-input title-input" data-f="title" value="${esc(course.title)}" aria-label="${esc(course.courseNo)} descriptive title"></td>
      <td data-label="Units"><input class="table-input units-input" data-f="units" value="${esc(course.units)}" aria-label="${esc(course.courseNo)} units"></td>
      <td data-label="Prerequisites"><input class="table-input relation-input" data-f="prerequisites" value="${esc(course.prerequisites.join(', '))}" aria-label="${esc(course.courseNo)} prerequisites"></td>
      <td data-label="Corequisites"><input class="table-input relation-input" data-f="corequisites" value="${esc(course.corequisites.join(', '))}" aria-label="${esc(course.courseNo)} corequisites"></td>
      <td data-label="Elective prerequisites"><input class="table-input relation-input" data-f="electivePrerequisites" value="${esc(course.electivePrerequisites.join(', '))}" aria-label="${esc(course.courseNo)} elective prerequisites"></td>
      <td data-label="Other requirements"><input class="table-input relation-input" data-f="otherRequirements" value="${esc(course.otherRequirements.join(', '))}" aria-label="${esc(course.courseNo)} other requirements"></td>
      <td data-label="Actions" class="row-actions"><button class="icon-button" type="button" data-act="locate">Locate</button><button class="icon-button danger" type="button" data-act="delete">Delete</button></td>
    </tr>`).join('');
  count.textContent = `${state.courses.length} courses`;
}

function updateField(id: string, field: keyof CurriculumCourse, value: string, oldCode?: string): void {
  const course = byId(id);
  if (!course) return;

  if (field === 'prerequisites' || field === 'corequisites' || field === 'electivePrerequisites' || field === 'otherRequirements') course[field] = list(value);
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
  save();
  renderFlow();
}

function addCourse(): void {
  const id = `course-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
  const course: CurriculumCourse = {
    id,
    yearLevel: 'First Year',
    semester: 'First Semester',
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
  save();
  renderTable();
  renderFlow();
}

function deleteCourse(id: string): void {
  const course = byId(id);
  if (!course || !confirm(`Delete ${course.courseNo}? Related references will also be removed.`)) return;
  state.courses = state.courses.filter(item => item.id !== id);
  delete state.positions[id];
  selected.delete(id);
  const clean = (items: string[]): string[] => items.filter(item => norm(item) !== norm(course.courseNo));
  state.courses.forEach(item => {
    item.prerequisites = clean(item.prerequisites);
    item.corequisites = clean(item.corequisites);
    item.electivePrerequisites = clean(item.electivePrerequisites);
  });
  save();
  renderTable();
  renderFlow();
}

function yearClass(year: string): string {
  return `year-${(years().indexOf(year) % 4) + 1}`;
}

function termClass(term: string): string {
  const value = norm(term);
  if (value.includes('first')) return 'term-first';
  if (value.includes('second')) return 'term-second';
  if (value.includes('short') || value.includes('summer')) return 'term-short';
  return 'term-other';
}

function updateCanvasSize(): void {
  const cols = columns();
  const maxNodeX = Math.max(0, ...Object.values(state.positions).map(position => position.x + W + 80));
  const maxNodeY = Math.max(0, ...Object.values(state.positions).map(position => position.y + H + 120));
  logicalWidth = Math.max(920, cols.length * COL + 70, maxNodeX);
  logicalHeight = Math.max(620, maxNodeY);
  canvas.style.width = `${logicalWidth}px`;
  canvas.style.height = `${logicalHeight}px`;
  svg.setAttribute('viewBox', `0 0 ${logicalWidth} ${logicalHeight}`);
  svg.setAttribute('width', `${logicalWidth}`);
  svg.setAttribute('height', `${logicalHeight}`);
}

function renderFlow(): void {
  ensurePositions();
  const cols = columns();
  updateCanvasSize();

  headers.innerHTML = years().map(year => {
    const yearColumns = cols.filter(column => column.year === year);
    if (!yearColumns.length) return '';
    const width = yearColumns[yearColumns.length - 1].x - yearColumns[0].x + W;
    return `<div class="year-header ${yearClass(year)}" style="left:${yearColumns[0].x}px;width:${width}px">${esc(year.toUpperCase())}</div>`;
  }).join('') + cols.map(column => `<div class="term-header ${yearClass(column.year)} ${termClass(column.term)}" style="left:${column.x}px;width:${W}px">${esc(column.term)}</div>`).join('');

  nodes.innerHTML = state.courses.map(course => {
    const position = state.positions[course.id];
    return `<article class="course-node ${yearClass(course.yearLevel)} ${termClass(course.semester)}${selected.has(course.id) ? ' selected' : ''}" data-id="${course.id}" style="left:${position.x}px;top:${position.y}px" tabindex="0" role="button" aria-label="${esc(`${course.courseNo}, ${course.title}`)}"><div class="node-code">${esc(course.courseNo || 'Untitled')}</div><div class="node-title">${esc(course.title || 'No descriptive title')}</div><div class="node-meta">${esc(course.units || '—')} unit${course.units === '1' ? '' : 's'}</div></article>`;
  }).join('');

  renderEdges();
  updateSelection();
  applyViewportTransform();
}

function relationships(): Relationship[] {
  const result: Relationship[] = [];
  const seen = new Set<string>();
  const add = (code: string, toId: string, type: Relationship['type']): void => {
    const from = byCode(code);
    if (!from || from.id === toId) return;
    const key = `${from.id}|${toId}|${type}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ fromId: from.id, toId, type });
    }
  };
  state.courses.forEach(course => {
    course.prerequisites.forEach(code => add(code, course.id, 'prerequisite'));
    course.corequisites.forEach(code => add(code, course.id, 'corequisite'));
    course.electivePrerequisites.forEach(code => add(code, course.id, 'elective'));
  });
  return result;
}

function edgePath(relationship: Relationship): string {
  const from = state.positions[relationship.fromId];
  const to = state.positions[relationship.toId];
  if (!from || !to) return '';
  const fromY = from.y + H / 2;
  const toY = to.y + H / 2;

  if (relationship.type === 'corequisite' && Math.abs(from.x - to.x) < COL / 2) {
    const lane = Math.max(from.x, to.x) + W + 18;
    return `M ${from.x + W} ${fromY} H ${lane} V ${toY} H ${to.x + W}`;
  }
  if (to.x >= from.x) {
    const startX = from.x + W;
    const middle = startX + Math.max(18, (to.x - startX) / 2);
    return `M ${startX} ${fromY} H ${middle} V ${toY} H ${to.x}`;
  }
  const endX = to.x + W;
  const middle = endX + Math.max(18, (from.x - endX) / 2);
  return `M ${from.x} ${fromY} H ${middle} V ${toY} H ${endX}`;
}

function renderEdges(): void {
  svg.innerHTML = `<defs><marker id="arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0 0 L8 4 L0 8z" class="arrowhead-shape"></path></marker></defs>` + relationships().map(relationship => `<path d="${edgePath(relationship)}" class="relationship relationship-${relationship.type}"${relationship.type === 'corequisite' ? '' : ' marker-end="url(#arrowhead)"'}></path>`).join('');
}

function updateSelection(): void {
  nodes.querySelectorAll<HTMLElement>('.course-node').forEach(node => node.classList.toggle('selected', selected.has(node.dataset.id!)));
  const amount = selected.size;
  selectionStatus.textContent = amount ? `${amount} course${amount === 1 ? '' : 's'} selected` : 'No courses selected';

  if (multiSelect) flowHint.textContent = 'Multi-select is on. Tap courses to add/remove them; drag selected courses together.';
  else if (amount >= 2) flowHint.textContent = 'Alignment tools apply to the selected courses. Pinch to zoom or drag empty space to pan.';
  else flowHint.textContent = 'Tap a course to select. Drag empty space to pan. Pinch with two fingers to zoom.';

  document.querySelectorAll<HTMLButtonElement>('[data-align]').forEach(button => {
    button.disabled = button.dataset.align?.startsWith('distribute') ? amount < 3 : amount < 2;
  });
}

function align(action: AlignmentAction): void {
  const items = [...selected].map(id => ({ id, position: state.positions[id] })).filter(item => item.position) as { id: string; position: NodePosition }[];
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
    items.forEach((item, index) => {
      if (horizontal) item.position.x = first + step * index;
      else item.position.y = first + step * index;
    });
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

  if (state.snapToGrid) items.forEach(item => {
    item.position.x = Math.round(item.position.x / GRID) * GRID;
    item.position.y = Math.round(item.position.y / GRID) * GRID;
  });

  save();
  renderFlow();
}

function alignToTerms(): void {
  const cols = columns();
  selected.forEach(id => {
    const course = byId(id);
    const position = state.positions[id];
    const column = course && cols.find(item => item.year === course.yearLevel && item.term === course.semester);
    if (position && column) position.x = column.x;
  });
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
  const padding = width < 600 ? 18 : 34;
  const scale = clamp(Math.min((width - padding * 2) / logicalWidth, (height - padding * 2) / logicalHeight), MIN_SCALE, 1.2);
  state.viewport.scale = scale;
  state.viewport.x = (width - logicalWidth * scale) / 2;
  state.viewport.y = (height - logicalHeight * scale) / 2;
  applyViewportTransform();
  save();
}

function resetView(): void {
  state.viewport = { ...DEFAULT_VIEWPORT };
  applyViewportTransform();
  save();
}

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
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    state.viewport.x = width / 2 - (position.x + W / 2) * state.viewport.scale;
    state.viewport.y = height / 2 - (position.y + H / 2) * state.viewport.scale;
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

function pointDistance(a: PointerPoint, b: PointerPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

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
  const localX = middleX - rect.left;
  const localY = middleY - rect.top;
  gesture = {
    kind: 'pinch',
    pointerIds: [first[0], second[0]],
    startDistance: distance,
    startScale: state.viewport.scale,
    focalX: (localX - state.viewport.x) / state.viewport.scale,
    focalY: (localY - state.viewport.y) / state.viewport.scale,
  };
  nodes.querySelectorAll('.dragging').forEach(element => element.classList.remove('dragging'));
  viewport.classList.add('panning');
}

function pointerDown(event: PointerEvent): void {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  event.preventDefault();
  viewport.focus({ preventScroll: true });
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  try { viewport.setPointerCapture(event.pointerId); } catch { /* capture is optional */ }

  if (activePointers.size >= 2) {
    beginPinch();
    return;
  }

  const node = (event.target as HTMLElement).closest<HTMLElement>('.course-node');
  if (node) {
    const id = node.dataset.id!;
    const additive = multiSelect || event.shiftKey || event.ctrlKey || event.metaKey;
    const wasSelected = selected.has(id);
    if (!wasSelected) {
      if (!additive) selected.clear();
      selected.add(id);
      updateSelection();
    }
    const starts = new Map<string, NodePosition>();
    selected.forEach(selectedId => {
      const position = state.positions[selectedId];
      if (position) starts.set(selectedId, { ...position });
    });
    gesture = { kind: 'node', pointerId: event.pointerId, nodeId: id, startX: event.clientX, startY: event.clientY, starts, additive, wasSelected, moved: false };
  } else {
    gesture = { kind: 'pan', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startPanX: state.viewport.x, startPanY: state.viewport.y, moved: false };
  }
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
    if (state.snapToGrid) {
      x = Math.round(x / GRID) * GRID;
      y = Math.round(y / GRID) * GRID;
    }
    state.positions[id] = { x, y };
    const element = nodes.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
    if (element) {
      element.style.left = `${x}px`;
      element.style.top = `${y}px`;
      element.classList.add('dragging');
    }
  });
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
      gesture = {
        kind: 'pan',
        pointerId: remaining[0],
        startX: remaining[1].x,
        startY: remaining[1].y,
        startPanX: state.viewport.x,
        startPanY: state.viewport.y,
        moved: true,
      };
    } else gesture = null;
    return;
  }

  if (currentGesture?.kind === 'node' && currentGesture.pointerId === event.pointerId) {
    nodes.querySelectorAll('.dragging').forEach(element => element.classList.remove('dragging'));
    if (currentGesture.moved) {
      updateCanvasSize();
      renderEdges();
      save();
    } else {
      if (currentGesture.additive && currentGesture.wasSelected) selected.delete(currentGesture.nodeId);
      else if (!currentGesture.additive) selected = new Set([currentGesture.nodeId]);
      updateSelection();
    }
  }

  if (currentGesture?.kind === 'pan' && currentGesture.pointerId === event.pointerId) {
    viewport.classList.remove('panning');
    if (!currentGesture.moved && !multiSelect) {
      selected.clear();
      updateSelection();
    } else if (currentGesture.moved) save();
  }

  gesture = null;
}

function moveSelectedBy(dx: number, dy: number): void {
  if (!selected.size) return;
  selected.forEach(id => {
    const position = state.positions[id];
    if (!position) return;
    position.x = Math.max(0, position.x + dx);
    position.y = Math.max(108, position.y + dy);
    if (state.snapToGrid) {
      position.x = Math.round(position.x / GRID) * GRID;
      position.y = Math.round(position.y / GRID) * GRID;
    }
  });
  save();
  renderFlow();
}

tbody.addEventListener('focusin', event => {
  const input = (event.target as HTMLElement).closest<HTMLInputElement>('input[data-f]');
  if (input) input.dataset.old = input.value;
});

tbody.addEventListener('input', event => {
  const input = (event.target as HTMLElement).closest<HTMLInputElement>('input[data-f]');
  const row = input?.closest<HTMLTableRowElement>('tr[data-id]');
  if (input && row) updateField(row.dataset.id!, input.dataset.f as keyof CurriculumCourse, input.value);
});

tbody.addEventListener('change', event => {
  const input = (event.target as HTMLElement).closest<HTMLInputElement>('input[data-f]');
  const row = input?.closest<HTMLTableRowElement>('tr[data-id]');
  if (input && row && input.dataset.f === 'courseNo') {
    updateField(row.dataset.id!, 'courseNo', input.value, input.dataset.old);
    renderTable();
  }
});

tbody.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
  const row = button?.closest<HTMLTableRowElement>('tr[data-id]');
  if (!button || !row) return;
  if (button.dataset.act === 'locate') locate(row.dataset.id!);
  else deleteCourse(row.dataset.id!);
});

viewport.addEventListener('pointerdown', pointerDown);
viewport.addEventListener('pointermove', pointerMove);
viewport.addEventListener('pointerup', finishPointer);
viewport.addEventListener('pointercancel', finishPointer);
viewport.addEventListener('wheel', event => {
  event.preventDefault();
  if (event.ctrlKey || event.metaKey) {
    const factor = Math.exp(-event.deltaY * 0.002);
    setZoomAt(state.viewport.scale * factor, event.clientX, event.clientY);
  } else {
    if (event.shiftKey) state.viewport.x -= event.deltaY;
    else {
      state.viewport.x -= event.deltaX;
      state.viewport.y -= event.deltaY;
    }
    applyViewportTransform();
    save();
  }
}, { passive: false });

viewport.addEventListener('keydown', event => {
  const focusedNode = (event.target as HTMLElement).closest<HTMLElement>('.course-node');
  if ((event.key === 'Enter' || event.key === ' ') && focusedNode) {
    event.preventDefault();
    selected = new Set([focusedNode.dataset.id!]);
    updateSelection();
    return;
  }
  if (event.key === 'Escape') {
    selected.clear();
    updateSelection();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
    event.preventDefault();
    selected = new Set(state.courses.map(course => course.id));
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
    updatedAt: Date.now(),
  };
  selected.clear();
  setMultiSelect(false);
  snap.checked = true;
  ensurePositions();
  save();
  renderTable();
  renderFlow();
});
q<HTMLButtonElement>('#generate-flowchart').addEventListener('click', () => {
  autoLayout();
  switchView('flow');
  requestAnimationFrame(() => requestAnimationFrame(fitView));
});
q<HTMLButtonElement>('#auto-layout').addEventListener('click', autoLayout);
q<HTMLButtonElement>('#align-to-terms').addEventListener('click', alignToTerms);
q<HTMLButtonElement>('#clear-selection').addEventListener('click', () => { selected.clear(); updateSelection(); });
multiSelectButton.addEventListener('click', () => setMultiSelect(!multiSelect));
q<HTMLButtonElement>('#zoom-out').addEventListener('click', () => zoomBy(0.8));
q<HTMLButtonElement>('#zoom-in').addEventListener('click', () => zoomBy(1.25));
q<HTMLButtonElement>('#fit-view').addEventListener('click', fitView);
q<HTMLButtonElement>('#reset-view').addEventListener('click', resetView);
search.addEventListener('input', renderTable);
snap.checked = state.snapToGrid;
snap.addEventListener('change', () => { state.snapToGrid = snap.checked; save(); });
window.addEventListener('resize', () => applyViewportTransform());

ensurePositions();
renderTable();
renderFlow();
switchView('table');
status.textContent = localStorage.getItem(KEY) ? 'Loaded saved work' : 'Sample data loaded';
