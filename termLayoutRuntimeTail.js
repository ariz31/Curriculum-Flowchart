
;(() => {
  const termLayout = window.CurriculumTermLayout;
  const runtime = window.CurriculumFlowchartRuntime;
  if (!termLayout || !runtime) return;

  columns = () => termLayout.columnsFor(state.courses);

  const baseApplyPositions = runtime.applyPositions;
  runtime.applyPositions = (nextPositions, options = {}) => {
    let adjusted = nextPositions;
    const label = String(options.label || '');
    const shouldUseTermColumns = /sort|auto-align columns/i.test(label);
    if (shouldUseTermColumns && nextPositions && typeof nextPositions === 'object') {
      const current = runtime.getState();
      const cols = termLayout.columnsFor(current.courses);
      const byKey = new Map(cols.map(column => [`${column.year}\u0000${column.term}`, column]));
      const courseById = new Map(current.courses.map(course => [course.id, course]));
      adjusted = {};
      for (const [id, position] of Object.entries(nextPositions)) {
        if (!position) continue;
        const course = courseById.get(id);
        const column = course && byKey.get(`${course.yearLevel}\u0000${course.semester}`);
        adjusted[id] = {
          x: column ? column.x : Number(position.x),
          y: Number(position.y),
        };
      }
    }
    return baseApplyPositions(adjusted, options);
  };

  const baseRenderFlow = renderFlow;
  renderFlow = () => {
    baseRenderFlow();
    termLayout.refreshHeaders();
  };
  runtime.renderFlow = () => renderFlow();

  termLayout.attachRuntime(runtime);
  renderFlow();
})();
