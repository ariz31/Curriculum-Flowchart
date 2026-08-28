(() => {
  const FALLBACK_COL = 260;
  const START_X = 34;
  const YEARS = ['First Year', 'Second Year', 'Third Year', 'Fourth Year'];
  const TERMS = ['First Semester', 'Second Semester', 'Short Term'];

  const norm = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const unique = values => [...new Set(values.filter(Boolean))];
  const ordered = (values, defaults) => [
    ...defaults.filter(value => values.includes(value)),
    ...unique(values).filter(value => !defaults.includes(value)).sort(),
  ];
  const number = value => {
    const parsed = Number.parseFloat(String(value ?? ''));
    return Number.isFinite(parsed) ? parsed : null;
  };

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

  // Column identity must be derived from the complete curriculum, not only the currently
  // visible track. Otherwise hiding a track can collapse a semester out of this list while
  // the actual flowchart/header grid still retains that semester column.
  function semanticColumns(state) {
    const courses = Array.isArray(state?.courses) ? state.courses : [];
    const years = ordered(unique(courses.map(course => course.yearLevel)), YEARS);
    const columns = [];
    let index = 0;
    for (const year of years) {
      const terms = ordered(
        unique(courses.filter(course => course.yearLevel === year).map(course => course.semester)),
        TERMS,
      );
      for (const term of terms) columns.push({ year, term, index: index++ });
    }
    return columns;
  }

  function liveSemesterColumns(state) {
    const semantic = semanticColumns(state);
    const headers = [...document.querySelectorAll('#headers-layer .term-header')];

    return semantic.map((column, index) => {
      const header = headers[index];
      if (header instanceof HTMLElement) {
        const computed = getComputedStyle(header);
        const x = number(header.style.left) ?? number(computed.left) ?? header.offsetLeft;
        const width = number(header.style.width) ?? number(computed.width) ?? header.offsetWidth;
        return {
          ...column,
          x: Number.isFinite(x) ? x : START_X + column.index * FALLBACK_COL,
          width: Number.isFinite(width) && width > 0 ? width : null,
          header,
        };
      }
      return {
        ...column,
        x: START_X + column.index * FALLBACK_COL,
        width: null,
        header: null,
      };
    });
  }

  function nodeWidth(courseId) {
    const node = document.querySelector(`#nodes-layer .course-node[data-id="${CSS.escape(String(courseId))}"]`);
    if (!(node instanceof HTMLElement)) return null;
    const computed = getComputedStyle(node);
    return number(node.style.width) ?? number(computed.width) ?? node.offsetWidth;
  }

  function semesterAlignedX(course, column) {
    // Align centers, not merely hard-coded left coordinates. Under the normal layout the
    // term header and course node have identical widths, making this exactly column.x. If
    // node/header sizing differs, the course still remains visually centered under its term.
    const width = nodeWidth(course.id);
    if (Number.isFinite(column.width) && column.width > 0 && Number.isFinite(width) && width > 0) {
      return column.x + (column.width - width) / 2;
    }
    return column.x;
  }

  function installSemesterColumnAutoAlign() {
    const alignSelectedButton = document.querySelector('#align-to-terms');
    if (!(alignSelectedButton instanceof HTMLButtonElement) || document.querySelector('#auto-align-semester-columns')) return;

    alignSelectedButton.textContent = 'Align selected';
    alignSelectedButton.title = 'Move selected course nodes horizontally to their assigned year/semester column while preserving their vertical position';
    alignSelectedButton.setAttribute('aria-label', 'Align selected courses to their semester columns without changing vertical positions');

    const button = document.createElement('button');
    button.id = 'auto-align-semester-columns';
    button.className = 'toolbar-button';
    button.type = 'button';
    button.textContent = 'Auto-align columns';
    button.title = 'Center every visible course under its actual year/semester header while preserving vertical positions';
    button.setAttribute('aria-label', 'Auto-align all visible courses to the currently displayed semester columns without changing vertical positions');
    alignSelectedButton.insertAdjacentElement('afterend', button);

    let running = false;
    button.addEventListener('click', () => {
      if (running) return;
      const runtime = window.CurriculumFlowchartRuntime;
      if (!runtime) return;

      running = true;
      button.disabled = true;
      try {
        const state = runtime.getState();
        const visible = visibleCourses(state);
        const columns = liveSemesterColumns(state);
        const nextPositions = {};
        let changed = 0;

        for (const course of visible) {
          const current = state.positions?.[course.id];
          if (!current) continue;
          const column = columns.find(item => item.year === course.yearLevel && item.term === course.semester);
          if (!column) continue;
          const targetX = semesterAlignedX(course, column);
          nextPositions[course.id] = { x: targetX, y: current.y };
          if (Math.abs(current.x - targetX) > 0.01) changed += 1;
        }

        if (!Object.keys(nextPositions).length) {
          runtime.setHint('No visible courses were available to align.');
          return;
        }

        if (!changed) {
          runtime.setHint('All visible courses are already centered in their semester columns.');
          return;
        }

        runtime.applyPositions(nextPositions, {
          layoutMode: state.layoutMode,
          sortStrategy: state.sortStrategy || null,
          label: 'Auto-align columns',
          message: `Aligned ${changed} visible course${changed === 1 ? '' : 's'} to the currently displayed semester columns. Vertical positions were preserved.`,
        });
      } catch (error) {
        console.error('Auto-align columns failed safely:', error);
        window.CurriculumFlowchartRuntime?.setHint('Auto-align could not complete. The existing layout was left unchanged.');
      } finally {
        running = false;
        button.disabled = false;
      }
    });
  }

  installSemesterColumnAutoAlign();
})();
