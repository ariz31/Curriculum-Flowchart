(() => {
  const MAX_SPACING = 30;
  const MIN_SPACING = 3;
  const CURRICULUM_LIBRARY_KEY = 'curriculum-flowchart:curricula:v1';
  const VERTICAL_KEY = 'curriculum-flowchart:vertical-lane-spacing:v1';
  const HORIZONTAL_KEY = 'curriculum-flowchart:horizontal-lane-spacing:v1';

  const safeParse = value => {
    try { return value ? JSON.parse(value) : null; }
    catch { return null; }
  };

  const activeCurriculumId = () => String(
    safeParse(localStorage.getItem(CURRICULUM_LIBRARY_KEY))?.activeId || 'default',
  );

  const clamp = value => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 7;
    return Math.min(MAX_SPACING, Math.max(MIN_SPACING, numeric));
  };

  function normalizeStoredValue(storageKey) {
    const stored = safeParse(localStorage.getItem(storageKey));
    const map = stored && typeof stored === 'object' ? stored : {};
    const id = activeCurriculumId();
    if (!Object.prototype.hasOwnProperty.call(map, id)) return false;
    const next = clamp(map[id]);
    if (Number(map[id]) === next) return false;
    map[id] = next;
    localStorage.setItem(storageKey, JSON.stringify(map));
    return true;
  }

  function patchControl(inputId, apiName) {
    const input = document.querySelector(inputId);
    if (input instanceof HTMLInputElement) {
      input.max = String(MAX_SPACING);
      input.min = String(MIN_SPACING);
      input.value = String(clamp(input.value));
      input.title = `Connector spacing: ${MIN_SPACING}–${MAX_SPACING} px`;
    }

    const api = window[apiName];
    if (api && typeof api === 'object') {
      const originalSet = typeof api.set === 'function' ? api.set.bind(api) : null;
      const originalGet = typeof api.get === 'function' ? api.get.bind(api) : null;
      if (originalSet) api.set = value => originalSet(clamp(value));
      if (originalGet) api.get = () => clamp(originalGet());
      api.min = MIN_SPACING;
      api.max = MAX_SPACING;
    }
  }

  const migratedVertical = normalizeStoredValue(VERTICAL_KEY);
  const migratedHorizontal = normalizeStoredValue(HORIZONTAL_KEY);
  patchControl('#vertical-lane-spacing', 'CurriculumVerticalLaneSpacing');
  patchControl('#horizontal-lane-spacing', 'CurriculumHorizontalLaneSpacing');

  document.addEventListener('change', event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (input.id !== 'vertical-lane-spacing' && input.id !== 'horizontal-lane-spacing') return;
    input.value = String(clamp(input.value));
  }, true);

  if (migratedVertical || migratedHorizontal) {
    requestAnimationFrame(() => {
      window.CurriculumFlowchartRuntime?.renderFlow?.();
      window.CurriculumConnectorRouting?.request?.();
    });
  }
})();
