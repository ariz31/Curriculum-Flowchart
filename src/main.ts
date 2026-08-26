import { createSampleCourses } from './sampleData.js';
import type { AlignmentAction, CurriculumCourse, NodePosition, PersistedState, Relationship } from './types.js';

const KEY = 'curriculum-flowchart:v1';
const W = 184, H = 78, COL = 260, TOP = 132, GAP = 20, GRID = 10;
const YEARS = ['First Year', 'Second Year', 'Third Year', 'Fourth Year'];
const TERMS = ['First Semester', 'Second Semester', 'Short Term'];

const q = <T extends Element>(s: string) => {
  const el = document.querySelector<T>(s);
  if (!el) throw new Error(`Missing ${s}`);
  return el;
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

let state = load();
let selected = new Set<string>();
let saveTimer = 0;
let dragging = false;

function load(): PersistedState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as PersistedState;
      if (Array.isArray(p.courses) && p.courses.length) return p;
    }
  } catch { /* use sample */ }
  return { courses: createSampleCourses(), positions: {}, snapToGrid: true, updatedAt: Date.now() };
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

const norm = (v: string) => v.trim().replace(/\s+/g, ' ').toLowerCase();
const list = (v: string) => v.split(',').map(x => x.trim()).filter(Boolean);
const esc = (v: string) => v.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const unique = (a: string[]) => [...new Set(a.filter(Boolean))];
const ordered = (a: string[], defaults: string[]) => [...defaults.filter(x => a.includes(x)), ...unique(a).filter(x => !defaults.includes(x)).sort()];
const years = () => ordered(state.courses.map(c => c.yearLevel), YEARS);
const terms = (year: string) => ordered(state.courses.filter(c => c.yearLevel === year).map(c => c.semester), TERMS);
const byId = (id: string) => state.courses.find(c => c.id === id);
const byCode = (code: string) => state.courses.find(c => norm(c.courseNo) === norm(code));

interface Column { year: string; term: string; x: number; }
function columns(): Column[] {
  const out: Column[] = [];
  let i = 0;
  years().forEach(year => terms(year).forEach(term => out.push({ year, term, x: 34 + i++ * COL })));
  return out;
}

function defaultPos(course: CurriculumCourse): NodePosition {
  const col = columns().find(c => c.year === course.yearLevel && c.term === course.semester);
  const peers = state.courses.filter(c => c.yearLevel === course.yearLevel && c.semester === course.semester);
  return { x: col?.x ?? 34, y: TOP + Math.max(0, peers.findIndex(c => c.id === course.id)) * (H + GAP) };
}

function ensurePositions(): void {
  const ids = new Set(state.courses.map(c => c.id));
  Object.keys(state.positions).forEach(id => { if (!ids.has(id)) delete state.positions[id]; });
  state.courses.forEach(c => { state.positions[c.id] ??= defaultPos(c); });
}

function autoLayout(): void {
  columns().forEach(col => {
    state.courses.filter(c => c.yearLevel === col.year && c.semester === col.term).forEach((c, i) => {
      state.positions[c.id] = { x: col.x, y: TOP + i * (H + GAP) };
    });
  });
  save(); renderFlow();
}

function renderTable(): void {
  const needle = norm(search.value);
  const courses = state.courses.filter(c => !needle || [c.yearLevel,c.semester,c.courseNo,c.title,...c.prerequisites,...c.corequisites,...c.otherRequirements].some(v => norm(v).includes(needle)));
  tbody.innerHTML = courses.map(c => `
    <tr data-id="${c.id}">
      <td><input class="table-input wide-input" data-f="yearLevel" list="year-options" value="${esc(c.yearLevel)}" aria-label="${esc(c.courseNo)} year level"></td>
      <td><input class="table-input wide-input" data-f="semester" list="semester-options" value="${esc(c.semester)}" aria-label="${esc(c.courseNo)} semester"></td>
      <td><input class="table-input code-input" data-f="courseNo" value="${esc(c.courseNo)}" aria-label="Course number"></td>
      <td><input class="table-input title-input" data-f="title" value="${esc(c.title)}" aria-label="${esc(c.courseNo)} descriptive title"></td>
      <td><input class="table-input units-input" data-f="units" value="${esc(c.units)}" aria-label="${esc(c.courseNo)} units"></td>
      <td><input class="table-input relation-input" data-f="prerequisites" value="${esc(c.prerequisites.join(', '))}" aria-label="${esc(c.courseNo)} prerequisites"></td>
      <td><input class="table-input relation-input" data-f="corequisites" value="${esc(c.corequisites.join(', '))}" aria-label="${esc(c.courseNo)} corequisites"></td>
      <td><input class="table-input relation-input" data-f="electivePrerequisites" value="${esc(c.electivePrerequisites.join(', '))}" aria-label="${esc(c.courseNo)} elective prerequisites"></td>
      <td><input class="table-input relation-input" data-f="otherRequirements" value="${esc(c.otherRequirements.join(', '))}" aria-label="${esc(c.courseNo)} other requirements"></td>
      <td class="row-actions"><button class="icon-button" type="button" data-act="locate">Locate</button><button class="icon-button danger" type="button" data-act="delete">Delete</button></td>
    </tr>`).join('');
  count.textContent = `${state.courses.length} courses`;
}

function updateField(id: string, field: keyof CurriculumCourse, value: string, oldCode?: string): void {
  const c = byId(id); if (!c) return;
  if (field === 'prerequisites' || field === 'corequisites' || field === 'electivePrerequisites' || field === 'otherRequirements') c[field] = list(value);
  else if (field === 'yearLevel' || field === 'semester' || field === 'courseNo' || field === 'title' || field === 'units') c[field] = value;
  if (field === 'courseNo' && oldCode && norm(oldCode) !== norm(value)) {
    const rep = (a: string[]) => a.map(x => norm(x) === norm(oldCode) ? value : x);
    state.courses.forEach(x => { x.prerequisites = rep(x.prerequisites); x.corequisites = rep(x.corequisites); x.electivePrerequisites = rep(x.electivePrerequisites); });
  }
  if (field === 'yearLevel' || field === 'semester') state.positions[id] = defaultPos(c);
  save(); renderFlow();
}

function addCourse(): void {
  const id = `course-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
  const c: CurriculumCourse = { id, yearLevel:'First Year', semester:'First Semester', courseNo:`NEW ${state.courses.length + 1}`, title:'New Course', units:'3', prerequisites:[], corequisites:[], electivePrerequisites:[], otherRequirements:[] };
  state.courses.push(c); state.positions[id] = defaultPos(c); save(); renderTable(); renderFlow();
}

function deleteCourse(id: string): void {
  const c = byId(id); if (!c || !confirm(`Delete ${c.courseNo}? Related references will also be removed.`)) return;
  state.courses = state.courses.filter(x => x.id !== id); delete state.positions[id]; selected.delete(id);
  const clean = (a: string[]) => a.filter(x => norm(x) !== norm(c.courseNo));
  state.courses.forEach(x => { x.prerequisites=clean(x.prerequisites); x.corequisites=clean(x.corequisites); x.electivePrerequisites=clean(x.electivePrerequisites); });
  save(); renderTable(); renderFlow();
}

function yearClass(year: string): string { return `year-${(years().indexOf(year) % 4) + 1}`; }

function renderFlow(): void {
  ensurePositions();
  const cols = columns();
  const maxY = Math.max(620, ...Object.values(state.positions).map(p => p.y + H + 120));
  const width = Math.max(920, cols.length * COL + 70);
  canvas.style.width = `${width}px`; canvas.style.height = `${maxY}px`;
  svg.setAttribute('viewBox', `0 0 ${width} ${maxY}`); svg.setAttribute('width', `${width}`); svg.setAttribute('height', `${maxY}`);
  headers.innerHTML = years().map(year => {
    const cs = cols.filter(c => c.year === year); if (!cs.length) return '';
    const width = cs[cs.length - 1].x - cs[0].x + W;
    return `<div class="year-header ${yearClass(year)}" style="left:${cs[0].x}px;width:${width}px">${esc(year.toUpperCase())}</div>`;
  }).join('') + cols.map(c => `<div class="term-header" style="left:${c.x}px;width:${W}px">${esc(c.term)}</div>`).join('');
  nodes.innerHTML = state.courses.map(c => {
    const p = state.positions[c.id];
    return `<article class="course-node ${yearClass(c.yearLevel)}${selected.has(c.id)?' selected':''}" data-id="${c.id}" style="left:${p.x}px;top:${p.y}px" tabindex="0" role="button" aria-label="${esc(`${c.courseNo}, ${c.title}`)}"><div class="node-code">${esc(c.courseNo||'Untitled')}</div><div class="node-title">${esc(c.title||'No descriptive title')}</div><div class="node-meta">${esc(c.units||'—')} unit${c.units==='1'?'':'s'}</div></article>`;
  }).join('');
  renderEdges(); updateSelection();
}

function rels(): Relationship[] {
  const out: Relationship[] = [], seen = new Set<string>();
  const add = (code:string,toId:string,type:Relationship['type']) => { const from=byCode(code); if(!from||from.id===toId)return; const k=`${from.id}|${toId}|${type}`; if(!seen.has(k)){seen.add(k);out.push({fromId:from.id,toId,type});} };
  state.courses.forEach(c => { c.prerequisites.forEach(x=>add(x,c.id,'prerequisite')); c.corequisites.forEach(x=>add(x,c.id,'corequisite')); c.electivePrerequisites.forEach(x=>add(x,c.id,'elective')); });
  return out;
}

function edgePath(r: Relationship): string {
  const a=state.positions[r.fromId], b=state.positions[r.toId]; if(!a||!b)return '';
  const ay=a.y+H/2, by=b.y+H/2;
  if(r.type==='corequisite' && Math.abs(a.x-b.x)<COL/2){ const lane=Math.max(a.x,b.x)+W+18; return `M ${a.x+W} ${ay} H ${lane} V ${by} H ${b.x+W}`; }
  if(b.x>=a.x){ const sx=a.x+W, mid=sx+Math.max(18,(b.x-sx)/2); return `M ${sx} ${ay} H ${mid} V ${by} H ${b.x}`; }
  const end=b.x+W, mid=end+Math.max(18,(a.x-end)/2); return `M ${a.x} ${ay} H ${mid} V ${by} H ${end}`;
}

function renderEdges(): void {
  svg.innerHTML = `<defs><marker id="arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0 0 L8 4 L0 8z" class="arrowhead-shape"></path></marker></defs>` + rels().map(r => `<path d="${edgePath(r)}" class="relationship relationship-${r.type}"${r.type==='corequisite'?'':' marker-end="url(#arrowhead)"'}></path>`).join('');
}

function updateSelection(): void {
  nodes.querySelectorAll<HTMLElement>('.course-node').forEach(n => n.classList.toggle('selected', selected.has(n.dataset.id!)));
  const n=selected.size; selectionStatus.textContent=n?`${n} course${n===1?'':'s'} selected`:'No courses selected';
  flowHint.textContent=n<2?'Shift-click to select multiple courses for alignment.':'Alignment tools apply to the selected courses.';
  document.querySelectorAll<HTMLButtonElement>('[data-align]').forEach(b => b.disabled=(b.dataset.align?.startsWith('distribute')?n<3:n<2));
}

function align(action: AlignmentAction): void {
  const items=[...selected].map(id=>({id,p:state.positions[id]})).filter(x=>x.p) as {id:string,p:NodePosition}[]; if(items.length<2)return;
  const left=Math.min(...items.map(x=>x.p.x)), right=Math.max(...items.map(x=>x.p.x+W)), top=Math.min(...items.map(x=>x.p.y)), bottom=Math.max(...items.map(x=>x.p.y+H));
  if(action.startsWith('distribute') && items.length>=3){
    const horiz=action==='distribute-horizontal'; items.sort((a,b)=>(horiz?a.p.x-b.p.x:a.p.y-b.p.y)); const first=horiz?items[0].p.x:items[0].p.y, last=horiz?items.at(-1)!.p.x:items.at(-1)!.p.y, step=(last-first)/(items.length-1); items.forEach((x,i)=>{if(horiz)x.p.x=first+step*i;else x.p.y=first+step*i;});
  } else items.forEach(x => { if(action==='left')x.p.x=left; if(action==='center')x.p.x=(left+right-W)/2; if(action==='right')x.p.x=right-W; if(action==='top')x.p.y=top; if(action==='middle')x.p.y=(top+bottom-H)/2; if(action==='bottom')x.p.y=bottom-H; if(state.snapToGrid){x.p.x=Math.round(x.p.x/GRID)*GRID;x.p.y=Math.round(x.p.y/GRID)*GRID;} });
  save(); renderFlow();
}

function alignToTerms(): void { const cols=columns(); selected.forEach(id=>{const c=byId(id),p=state.positions[id];const col=c&&cols.find(x=>x.year===c.yearLevel&&x.term===c.semester);if(p&&col)p.x=col.x;}); save();renderFlow(); }

function switchView(view:'table'|'flow'): void {
  tablePanel.hidden=view!=='table'; flowPanel.hidden=view!=='flow';
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b=>{const on=b.dataset.view===view;b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on));});
  if(view==='flow') renderFlow();
}

function locate(id:string): void { selected=new Set([id]); switchView('flow'); requestAnimationFrame(()=>nodes.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({behavior:'smooth',inline:'center',block:'center'})); }

function startDrag(e:PointerEvent,id:string,node:HTMLElement): void {
  if(e.button!==0)return; dragging=false;
  if(!selected.has(id)){ if(!(e.shiftKey||e.ctrlKey||e.metaKey))selected.clear(); selected.add(id); updateSelection(); }
  const ids=[...selected], start=new Map(ids.map(x=>[x,{...state.positions[x]}])); const sx=e.clientX,sy=e.clientY; node.setPointerCapture(e.pointerId); node.classList.add('dragging');
  const move=(m:PointerEvent)=>{const dx=m.clientX-sx,dy=m.clientY-sy;if(Math.abs(dx)+Math.abs(dy)>3)dragging=true;ids.forEach(x=>{const p=start.get(x);if(!p)return;let nx=Math.max(0,p.x+dx),ny=Math.max(108,p.y+dy);if(state.snapToGrid){nx=Math.round(nx/GRID)*GRID;ny=Math.round(ny/GRID)*GRID;}state.positions[x]={x:nx,y:ny};const el=nodes.querySelector<HTMLElement>(`[data-id="${CSS.escape(x)}"]`);if(el){el.style.left=`${nx}px`;el.style.top=`${ny}px`;}});renderEdges();};
  const up=()=>{node.classList.remove('dragging');node.removeEventListener('pointermove',move);node.removeEventListener('pointerup',up);node.removeEventListener('pointercancel',up);if(dragging)save();}; node.addEventListener('pointermove',move);node.addEventListener('pointerup',up);node.addEventListener('pointercancel',up);
}

tbody.addEventListener('focusin',e=>{const input=(e.target as HTMLElement).closest<HTMLInputElement>('input[data-f]');if(input)input.dataset.old=input.value;});
tbody.addEventListener('input',e=>{const input=(e.target as HTMLElement).closest<HTMLInputElement>('input[data-f]'),row=input?.closest<HTMLTableRowElement>('tr[data-id]');if(input&&row)updateField(row.dataset.id!,input.dataset.f as keyof CurriculumCourse,input.value);});
tbody.addEventListener('change',e=>{const input=(e.target as HTMLElement).closest<HTMLInputElement>('input[data-f]'),row=input?.closest<HTMLTableRowElement>('tr[data-id]');if(input&&row&&input.dataset.f==='courseNo'){updateField(row.dataset.id!,'courseNo',input.value,input.dataset.old);renderTable();}});
tbody.addEventListener('click',e=>{const b=(e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]'),row=b?.closest<HTMLTableRowElement>('tr[data-id]');if(!b||!row)return;if(b.dataset.act==='locate')locate(row.dataset.id!);else deleteCourse(row.dataset.id!);});

nodes.addEventListener('pointerdown',e=>{const node=(e.target as HTMLElement).closest<HTMLElement>('.course-node');if(node)startDrag(e,node.dataset.id!,node);});
nodes.addEventListener('click',e=>{if(dragging){dragging=false;return;}const node=(e.target as HTMLElement).closest<HTMLElement>('.course-node');if(!node)return;const additive=e.shiftKey||e.ctrlKey||e.metaKey;if(!additive)selected.clear();if(additive&&selected.has(node.dataset.id!))selected.delete(node.dataset.id!);else selected.add(node.dataset.id!);updateSelection();});
canvas.addEventListener('pointerdown',e=>{if(e.target===canvas||e.target===nodes){selected.clear();updateSelection();}});

document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view==='flow'?'flow':'table')));
document.querySelectorAll<HTMLButtonElement>('[data-align]').forEach(b=>b.addEventListener('click',()=>align(b.dataset.align as AlignmentAction)));
q<HTMLButtonElement>('#add-course').addEventListener('click',addCourse);
q<HTMLButtonElement>('#reset-sample').addEventListener('click',()=>{if(confirm('Replace the current curriculum and layout with the Google Sheets sample?')){state={courses:createSampleCourses(),positions:{},snapToGrid:true,updatedAt:Date.now()};selected.clear();snap.checked=true;ensurePositions();save();renderTable();renderFlow();}});
q<HTMLButtonElement>('#generate-flowchart').addEventListener('click',()=>{autoLayout();switchView('flow');});
q<HTMLButtonElement>('#auto-layout').addEventListener('click',autoLayout);
q<HTMLButtonElement>('#align-to-terms').addEventListener('click',alignToTerms);
q<HTMLButtonElement>('#clear-selection').addEventListener('click',()=>{selected.clear();updateSelection();});
search.addEventListener('input',renderTable);
snap.checked=state.snapToGrid;snap.addEventListener('change',()=>{state.snapToGrid=snap.checked;save();});
viewport.addEventListener('keydown',e=>{if(e.key==='Escape'){selected.clear();updateSelection();}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){e.preventDefault();selected=new Set(state.courses.map(c=>c.id));updateSelection();}});

ensurePositions(); renderTable(); renderFlow(); switchView('table');
status.textContent=localStorage.getItem(KEY)?'Loaded saved work':'Sample data loaded';
