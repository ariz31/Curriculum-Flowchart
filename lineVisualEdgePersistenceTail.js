
;(() => {
  const STORAGE_KEY = 'curriculum-flowchart:line-visual-mode:v1';
  const CURRICULUM_LIBRARY_KEY = 'curriculum-flowchart:curricula:v1';
  const DEFAULT_COLORS = ['#2563eb', '#7c3aed', '#0f766e', '#b45309', '#0369a1', '#6d28d9', '#15803d', '#a16207', '#0e7490', '#4338ca'];

  const safeParse = value => { try { return value ? JSON.parse(value) : null; } catch { return null; } };
  const activeCurriculumId = () => String(safeParse(localStorage.getItem(CURRICULUM_LIBRARY_KEY))?.activeId || 'default');
  const defaultColor = span => DEFAULT_COLORS[(Math.max(1, span) - 1) % DEFAULT_COLORS.length];

  function config() {
    const all = safeParse(localStorage.getItem(STORAGE_KEY));
    const value = all && typeof all === 'object' ? all[activeCurriculumId()] : null;
    const colors = value?.colors && typeof value.colors === 'object' ? value.colors : {};
    return { enabled: Boolean(value?.enabled), colors };
  }

  const colorFor = (span, current) => current.colors?.[span] || defaultColor(span);

  function applyPersistentVisualLines() {
    const svgElement = document.querySelector('#connections-svg');
    if (!(svgElement instanceof SVGSVGElement)) return;
    const paths = [...svgElement.querySelectorAll('path.relationship')];
    if (!paths.length) return;

    const current = config();
    const cols = columns();
    const pairs = corequisitePairs();
    const edges = dependencyEdges(pairs);

    paths.forEach((path, index) => {
      const edge = edges[index];
      const sourceColumn = edge ? edgeSourceColumn(edge, pairs, cols) : -1;
      const targetColumn = edge ? edgeTargetColumn(edge, cols) : -1;
      const span = sourceColumn >= 0 && targetColumn >= 0 ? Math.abs(targetColumn - sourceColumn) : 0;
      path.dataset.termSpan = String(span);
      if (current.enabled && span > 0) path.style.stroke = colorFor(span, current);
      else path.style.removeProperty('stroke');
    });

    const arrow = svgElement.querySelector('#arrowhead .arrowhead-shape');
    if (arrow instanceof SVGElement) {
      if (current.enabled) {
        arrow.setAttribute('fill', '#29384f');
        arrow.style.fill = 'context-stroke';
      } else {
        arrow.style.removeProperty('fill');
        arrow.removeAttribute('fill');
      }
    }
  }

  const baseRenderEdgesForStableVisualLines = renderEdges;
  renderEdges = () => {
    baseRenderEdgesForStableVisualLines();
    applyPersistentVisualLines();
  };

  window.CurriculumLineVisualPersistence = { apply: applyPersistentVisualLines };
  applyPersistentVisualLines();
})();
