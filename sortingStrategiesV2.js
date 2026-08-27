(() => {
  const CURRICULUM_LIBRARY_KEY = 'curriculum-flowchart:curricula:v1';
  const STRATEGY_KEY = 'curriculum-flowchart:sort-strategies:v1';
  const W = 184;
  const H = 78;
  const COL = 260;
  const TOP = 132;
  const BASE_GAP = 14;
  const COMPACT_GAP = 10;
  const COREQ_GAP = 34;
  const YEARS = ['First Year', 'Second Year', 'Third Year', 'Fourth Year'];
  const TERMS = ['First Semester', 'Second Semester', 'Short Term'];

  const STRATEGIES = {
    balanced: ['Balanced', 'Balance dependency order, crossings, chain alignment, and routing clearance.'],
    dependency: ['Dependency First', 'Prioritize prerequisite-free courses and increasing dependency depth.'],
    crossings: ['Minimum Crossings', 'Prioritize barycentric ordering to reduce relationship-line crossings.'],
    chains: ['Straight Chains', 'Prioritize vertical alignment of connected prerequisite chains across semesters.'],
    compact: ['Compact', 'Use dependency-aware ordering with the smallest practical vertical footprint.'],
  };

  const norm = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const safeParse = value => { try { return value ? JSON.parse(value) : null; } catch { return null; } };
  const unique = values => [...new Set(values.filter(Boolean))];
  const ordered = (values, defaults) => [...defaults.filter(value => values.includes(value)), ...unique(values).filter(value => !defaults.includes(value)).sort()];

  function activeCurriculumId() {
    return String(safeParse(localStorage.getItem(CURRICULUM_LIBRARY_KEY))?.activeId || 'default');
  }

  function strategyMap() {
    const value = safeParse(localStorage.getItem(STRATEGY_KEY));
    return value && typeof value === 'object' ? value : {};
  }

  function remember(strategy) {
    const map = strategyMap();
    map[activeCurriculumId()] = strategy;
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
    const columns = [];
    let index = 0;
    for (const year of years) {
      const terms = ordered(unique(courses.filter(course => course.yearLevel === year).map(course => course.semester)), TERMS);
      for (const term of terms) columns.push({ year, term, x: 34 + index++ * COL });
    }
    return columns;
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
        const currentCenters = ids.map(id => (state.positions?.[id]?.y ?? TOP) + H / 2);
        const center = currentCenters.reduce((sum, value) => sum + value, 0) / Math.max(1, currentCenters.length);
        const unit = {
          key: [...ids].sort().join('+'),
          ids,
          columnIndex,
          height: ids.length * H + Math.max(0, ids.length - 1) * COREQ_GAP,
          center,
        };
        units.push(unit);
        ids.forEach(id => unitById.set(id, unit));
      }
      units.sort((a, b) => a.center - b.center);
      return units;
    });

    const allUnits = layoutColumns.flat();
    const unitByKey = new Map(allUnits.map(unit => [unit.key, unit]));
    const predecessors = new Map();
    const successors = new Map();
    const addLink = (from, to) => {
      if (!from || !to || from.key === to.key) return;
      const out = successors.get(from.key) || new Set();
      out.add(to.key);
      successors.set(from.key, out);
      const incoming = predecessors.get(to.key) || new Set();
      incoming.add(from.key);
      predecessors.set(to.key, incoming);
    };

    for (const course of courses) {
      const target = unitById.get(course.id);
      for (const code of [...(course.prerequisites || []), ...(course.electivePrerequisites || [])]) {
        const sourceCourse = byCode.get(norm(code));
        if (sourceCourse) addLink(unitById.get(sourceCourse.id), target);
      }
    }

    const tableOrder = new Map((state.courses || []).map((course, index) => [course.id, index]));
    const semantic = unit => unit.ids.map(id => byId.get(id)?.courseNo || id).sort((a, b) => norm(a).localeCompare(norm(b))).join('|');
    const original = unit => Math.min(...unit.ids.map(id => tableOrder.get(id) ?? Number.MAX_SAFE_INTEGER));
    const indegree = new Map(allUnits.map(unit => [unit.key, predecessors.get(unit.key)?.size || 0]));
    const depth = new Map(allUnits.map(unit => [unit.key, 0]));
    const queue = allUnits.filter(unit => (indegree.get(unit.key) || 0) === 0).sort((a, b) => a.columnIndex - b.columnIndex || semantic(a).localeCompare(semantic(b)));
    const processed = new Set();
    while (queue.length) {
      const unit = queue.shift();
      if (processed.has(unit.key)) continue;
      processed.add(unit.key);
      for (const nextKey of successors.get(unit.key) || []) {
        const next = unitByKey.get(nextKey);
        if (!next) continue;
        depth.set(nextKey, Math.max(depth.get(nextKey) || 0, (depth.get(unit.key) || 0) + 1));
        const remaining = Math.max(0, (indegree.get(nextKey) || 0) - 1);
        indegree.set(nextKey, remaining);
        if (remaining === 0) queue.push(next);
      }
    }

    const metadata = new Map(allUnits.map(unit => [unit.key, {
      root: !(predecessors.get(unit.key)?.size),
      depth: depth.get(unit.key) || 0,
      incoming: predecessors.get(unit.key)?.size || 0,
      outgoing: successors.get(unit.key)?.size || 0,
      semantic: semantic(unit),
      original: original(unit),
    }]));

    return { courses, columns, layoutColumns, unitByKey, predecessors, successors, metadata };
  }

  function dependencyCompare(layout, a, b) {
    const am = layout.metadata.get(a.key);
    const bm = layout.metadata.get(b.key);
    if (am.root !== bm.root) return am.root ? -1 : 1;
    if (am.depth !== bm.depth) return am.depth - bm.depth;
    if (am.root && am.outgoing !== bm.outgoing) return bm.outgoing - am.outgoing;
    if (!am.root && am.incoming !== bm.incoming) return am.incoming - bm.incoming;
    return am.original - bm.original || am.semantic.localeCompare(bm.semantic);
  }

  function sortDependency(layout) {
    layout.layoutColumns.forEach(units => units.sort((a, b) => dependencyCompare(layout, a, b)));
  }

  function rankMap(columns) {
    const result = new Map();
    columns.forEach(units => units.forEach((unit, index) => result.set(unit.key, index)));
    return result;
  }

  function barycentricSweeps(layout, passes, preserveDepth) {
    const columnOf = new Map();
    layout.layoutColumns.forEach((units, index) => units.forEach(unit => columnOf.set(unit.key, index)));
    const neighbors = new Map();
    const addNeighbor = (a, b) => {
      const values = neighbors.get(a) || new Set();
      values.add(b);
      neighbors.set(a, values);
    };
    for (const [from, targets] of layout.successors) for (const to of targets) { addNeighbor(from, to); addNeighbor(to, from); }

    const sweep = forward => {
      const indices = forward
        ? Array.from({ length: Math.max(0, layout.layoutColumns.length - 1) }, (_, index) => index + 1)
        : Array.from({ length: Math.max(0, layout.layoutColumns.length - 1) }, (_, index) => layout.layoutColumns.length - 2 - index);
      for (const columnIndex of indices) {
        const ranks = rankMap(layout.layoutColumns);
        const scored = layout.layoutColumns[columnIndex].map(unit => {
          const values = [...(neighbors.get(unit.key) || [])]
            .filter(key => {
              const other = columnOf.get(key);
              return other !== undefined && (forward ? other < columnIndex : other > columnIndex);
            })
            .map(key => ranks.get(key)).filter(value => value !== undefined);
          return { unit, score: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : ranks.get(unit.key) || 0 };
        });
        scored.sort((a, b) => {
          if (preserveDepth) {
            const am = layout.metadata.get(a.unit.key);
            const bm = layout.metadata.get(b.unit.key);
            if (am.root !== bm.root) return am.root ? -1 : 1;
            if (am.depth !== bm.depth) return am.depth - bm.depth;
          }
          if (Math.abs(a.score - b.score) > 0.0001) return a.score - b.score;
          return preserveDepth ? dependencyCompare(layout, a.unit, b.unit) : layout.metadata.get(a.unit.key).original - layout.metadata.get(b.unit.key).original;
        });
        layout.layoutColumns[columnIndex] = scored.map(item => item.unit);
      }
    };
    for (let pass = 0; pass < passes; pass += 1) { sweep(true); sweep(false); }
  }

  function initializeCenters(columns, gap) {
    for (const units of columns) {
      let top = TOP;
      for (const unit of units) {
        unit.center = top + unit.height / 2;
        top += unit.height + gap;
      }
    }
  }

  function placeColumn(units, desired, gap) {
    if (!units.length) return;
    const tops = [];
    for (let index = 0; index < units.length; index += 1) {
      const unit = units[index];
      const preferred = (desired.get(unit.key) ?? unit.center) - unit.height / 2;
      const minimum = index === 0 ? TOP : tops[index - 1] + units[index - 1].height + gap;
      tops[index] = Math.max(preferred, minimum);
    }
    for (let index = units.length - 2; index >= 0; index -= 1) {
      tops[index] = Math.max(TOP, Math.min(tops[index], tops[index + 1] - gap - units[index].height));
    }
    for (let index = 1; index < units.length; index += 1) tops[index] = Math.max(tops[index], tops[index - 1] + units[index - 1].height + gap);
    units.forEach((unit, index) => { unit.center = tops[index] + unit.height / 2; });
  }

  function alignChains(layout, passes = 24) {
    initializeCenters(layout.layoutColumns, BASE_GAP);
    const connected = new Map();
    const push = (a, b, weight) => {
      const values = connected.get(a) || [];
      values.push({ key: b, weight });
      connected.set(a, values);
    };
    for (const [from, targets] of layout.successors) {
      const source = layout.unitByKey.get(from);
      for (const to of targets) {
        const target = layout.unitByKey.get(to);
        if (!source || !target) continue;
        const span = Math.abs(source.columnIndex - target.columnIndex);
        const weight = span === 1 ? 14 : span === 2 ? 4 : 1;
        push(from, to, weight); push(to, from, weight);
      }
    }
    for (let pass = 0; pass < passes; pass += 1) {
      const columns = pass % 2 === 0 ? layout.layoutColumns : [...layout.layoutColumns].reverse();
      for (const units of columns) {
        const desired = new Map();
        for (const unit of units) {
          const links = connected.get(unit.key) || [];
          let weighted = 0;
          let total = 0;
          for (const link of links) {
            const other = layout.unitByKey.get(link.key);
            if (!other) continue;
            weighted += other.center * link.weight;
            total += link.weight;
          }
          if (total) desired.set(unit.key, weighted / total);
        }
        placeColumn(units, desired, BASE_GAP);
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

  function applyStrategy(strategy) {
    const runtime = window.CurriculumFlowchartRuntime;
    if (!runtime) return;
    const state = runtime.getState();
    const layout = buildLayout(state);
    if (!layout.courses.length) return;

    if (strategy === 'dependency') {
      sortDependency(layout);
      initializeCenters(layout.layoutColumns, BASE_GAP);
    } else if (strategy === 'crossings') {
      sortDependency(layout);
      barycentricSweeps(layout, 28, false);
      initializeCenters(layout.layoutColumns, BASE_GAP);
    } else if (strategy === 'chains') {
      sortDependency(layout);
      barycentricSweeps(layout, 10, true);
      alignChains(layout, 24);
    } else if (strategy === 'compact') {
      sortDependency(layout);
      initializeCenters(layout.layoutColumns, COMPACT_GAP);
    } else return;

    remember(strategy);
    window.CurriculumUntangleV2?.setActive(false);
    runtime.applyPositions(positionsFrom(layout), {
      layoutMode: 'basic',
      sortStrategy: strategy,
      label: `${STRATEGIES[strategy][0]} sort`,
      message: `${STRATEGIES[strategy][0]} sort applied. Semester columns were preserved and the flowchart remained open.`,
    });
  }

  function install() {
    const optimizeButton = document.querySelector('#optimize-layout');
    if (!(optimizeButton instanceof HTMLButtonElement) || document.querySelector('#sorting-strategy')) return;

    const select = document.createElement('select');
    select.id = 'sorting-strategy';
    select.className = 'toolbar-select';
    select.setAttribute('aria-label', 'Sorting strategy');
    select.innerHTML = Object.entries(STRATEGIES).map(([value, [label]]) => `<option value="${value}">${label}</option>`).join('');
    const remembered = strategyMap()[activeCurriculumId()];
    select.value = Object.prototype.hasOwnProperty.call(STRATEGIES, remembered) ? remembered : 'balanced';
    optimizeButton.insertAdjacentElement('beforebegin', select);
    optimizeButton.textContent = 'Apply sort';

    const style = document.createElement('style');
    style.textContent = '#sorting-strategy{min-height:34px;max-width:180px;border:1px solid #d8deea;border-radius:7px;background:#fff;color:#172033;padding:5px 8px;font:inherit;font-size:.78rem;font-weight:650}@media(max-width:760px){#sorting-strategy{min-height:42px;max-width:160px}}';
    document.head.append(style);

    const updateTitle = () => {
      const entry = STRATEGIES[select.value];
      if (!entry) return;
      select.title = entry[1];
      optimizeButton.title = entry[1];
    };
    updateTitle();

    select.addEventListener('change', () => {
      if (STRATEGIES[select.value]) remember(select.value);
      updateTitle();
    });

    optimizeButton.addEventListener('click', event => {
      const strategy = select.value;
      if (strategy === 'balanced') {
        remember('balanced');
        window.CurriculumUntangleV2?.setActive(false);
        return;
      }
      if (!STRATEGIES[strategy]) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      applyStrategy(strategy);
    }, true);
  }

  install();
})();
