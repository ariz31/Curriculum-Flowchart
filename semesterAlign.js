(() => {
  const COL = 260;
  const START_X = 34;
  const YEARS = ['First Year', 'Second Year', 'Third Year', 'Fourth Year'];
  const TERMS = ['First Semester', 'Second Semester', 'Short Term'];

  const norm = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const unique = values => [...new Set(values.filter(Boolean))];
  const ordered = (values, defaults) => [
    ...defaults.filter(value => values.includes(value)),
    ...unique(values).filter(value => !defaults.includes(value)).sort(),
  ];

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
      const terms = ordered(
        unique(courses.filter(course => course.yearLevel === year).map(course => course.semester)),
        TERMS,
      );
      for (const term of terms) columns.push({ year, term, x: START_X + index++ * COL });
    }
    return columns;
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
    button.title = 'Snap every visible course horizontally to its assigned year/semester column while preserving each course vertical position';
    button.setAttribute('aria-label', 'Auto-align all visible courses to their semester columns without changing vertical positions');
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
        const columns = columnsFor(visible);
        const nextPositions = {};
        let changed = 0;

        for (const course of visible) {
          const current = state.positions?.[course.id];
          if (!current) continue;
          const column = columns.find(item => item.year === course.yearLevel && item.term === course.semester);
          if (!column) continue;
          nextPositions[course.id] = { x: column.x, y: current.y };
          if (Math.abs(current.x - column.x) > 0.01) changed += 1;
        }

        if (!Object.keys(nextPositions).length) {
          runtime.setHint('No visible courses were available to align.');
          return;
        }

        if (!changed) {
          runtime.setHint('All visible courses are already aligned to their semester columns.');
          return;
        }

        runtime.applyPositions(nextPositions, {
          layoutMode: state.layoutMode,
          sortStrategy: state.sortStrategy || null,
          label: 'Auto-align columns',
          message: `Aligned ${changed} visible course${changed === 1 ? '' : 's'} horizontally to their semester columns. Vertical positions were preserved.`,
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
