
;(() => {
  const STORAGE_KEY = 'curriculum-flowchart:display-typography:v2';
  const CURRICULUM_LIBRARY_KEY = 'curriculum-flowchart:curricula:v1';
  const MIN_PX = 1;
  const NODE_WIDTH = 184;
  const NODE_HEIGHTS = [78, 62];
  const DEFAULTS = Object.freeze({
    year: 12,
    term: 11,
    code: 12,
    title: 10.5,
    meta: 9.5,
  });

  const safeParse = value => { try { return value ? JSON.parse(value) : null; } catch { return null; } };
  const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const activeCurriculumId = () => String(safeParse(localStorage.getItem(CURRICULUM_LIBRARY_KEY))?.activeId || 'default');
  const normalizePx = (value, fallback) => Math.max(MIN_PX, finite(value, fallback));
  const clone = value => JSON.parse(JSON.stringify(value));

  const previousFontApi = window.CurriculumDisplayFontSize;
  const legacyScale = Math.max(0.01, finite(previousFontApi?.get?.(), 1));

  function defaultsForLegacyScale() {
    return Object.fromEntries(Object.entries(DEFAULTS).map(([key, value]) => [key, Number((value * legacyScale).toFixed(2))]));
  }

  function allConfigs() {
    const stored = safeParse(localStorage.getItem(STORAGE_KEY));
    return stored && typeof stored === 'object' ? stored : {};
  }

  function normalizeConfig(value, fallback = DEFAULTS) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      year: normalizePx(source.year, fallback.year),
      term: normalizePx(source.term, fallback.term),
      code: normalizePx(source.code, fallback.code),
      title: normalizePx(source.title, fallback.title),
      meta: normalizePx(source.meta, fallback.meta),
    };
  }

  function getConfig() {
    const stored = allConfigs()[activeCurriculumId()];
    return normalizeConfig(stored, defaultsForLegacyScale());
  }

  function saveConfig(next, options = {}) {
    const all = allConfigs();
    const normalized = normalizeConfig(next, getConfig());
    all[activeCurriculumId()] = normalized;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    applyLiveTypography(normalized);
    if (options.sync !== false) syncControls();
    return normalized;
  }

  function setField(field, value, options = {}) {
    if (!(field in DEFAULTS)) return getConfig();
    return saveConfig({ ...getConfig(), [field]: normalizePx(value, getConfig()[field]) }, options);
  }

  function scaleAll(percent, options = {}) {
    const multiplier = Math.max(0.01, finite(percent, 100) / 100);
    const next = Object.fromEntries(Object.entries(DEFAULTS).map(([key, value]) => [key, Number((value * multiplier).toFixed(2))]));
    return saveConfig(next, options);
  }

  function resetAll(options = {}) {
    return saveConfig({ ...DEFAULTS }, options);
  }

  // The previous global scaler remains in the export wrapper chain. Reset it to neutral once
  // its current value has been migrated into the exact typography configuration above.
  try { previousFontApi?.reset?.(); } catch { /* compatibility only */ }

  let globalInput = null;
  let resetButton = null;
  const fieldInputs = new Map();

  function matchingGlobalPercent(config) {
    const ratios = Object.keys(DEFAULTS).map(key => config[key] / DEFAULTS[key]);
    const first = ratios[0];
    return ratios.every(value => Math.abs(value - first) < 0.002) ? Number((first * 100).toFixed(1)) : null;
  }

  function applyLiveTypography(config = getConfig()) {
    const panel = document.querySelector('#flow-panel');
    if (!(panel instanceof HTMLElement)) return;
    panel.style.setProperty('--curriculum-year-font-px', `${config.year}px`);
    panel.style.setProperty('--curriculum-term-font-px', `${config.term}px`);
    panel.style.setProperty('--curriculum-code-font-px', `${config.code}px`);
    panel.style.setProperty('--curriculum-title-font-px', `${config.title}px`);
    panel.style.setProperty('--curriculum-meta-font-px', `${config.meta}px`);
  }

  function syncControls() {
    const config = getConfig();
    applyLiveTypography(config);
    for (const [field, input] of fieldInputs) {
      if (input instanceof HTMLInputElement) input.value = String(Number(config[field].toFixed(2)));
    }
    const percent = matchingGlobalPercent(config);
    if (globalInput instanceof HTMLInputElement) {
      globalInput.value = percent == null ? '' : String(percent);
      globalInput.placeholder = percent == null ? 'Mixed' : '100';
    }
    if (resetButton instanceof HTMLButtonElement) {
      resetButton.disabled = Object.keys(DEFAULTS).every(key => Math.abs(config[key] - DEFAULTS[key]) < 0.001);
    }
  }

  function installStyles() {
    if (document.querySelector('#display-typography-control-style')) return;
    const style = document.createElement('style');
    style.id = 'display-typography-control-style';
    style.textContent = `
      #flow-panel .year-header{font-size:var(--curriculum-year-font-px,12px)!important}
      #flow-panel .term-header{font-size:var(--curriculum-term-font-px,11px)!important}
      #flow-panel .node-code{font-size:var(--curriculum-code-font-px,12px)!important}
      #flow-panel .node-title{font-size:var(--curriculum-title-font-px,10.5px)!important;line-height:1.16}
      #flow-panel .node-meta{font-size:var(--curriculum-meta-font-px,9.5px)!important}
      .display-typography-control{display:grid;gap:8px;padding:2px 0;width:100%}
      .display-typography-header{display:flex;align-items:center;justify-content:space-between;gap:8px}
      .display-typography-header strong{font-size:.74rem;color:#344054}
      .display-typography-global{display:grid;grid-template-columns:minmax(0,1fr) 88px;gap:7px;align-items:center;padding-bottom:7px;border-bottom:1px solid #e7ebf2}
      .display-typography-global label,.display-typography-field{display:grid;grid-template-columns:minmax(0,1fr) 82px;gap:7px;align-items:center;color:#475467;font-size:.71rem;font-weight:720}
      .display-typography-global label{grid-template-columns:minmax(0,1fr) 82px;grid-column:1/-1}
      .display-typography-input-wrap{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;border:1px solid #d8deea;border-radius:7px;background:#fff;overflow:hidden}
      .display-typography-input-wrap input{width:100%;min-width:0;min-height:34px;border:0;padding:5px 6px;background:transparent;color:#172033;font:inherit;font-size:.75rem;text-align:right;outline:none}
      .display-typography-input-wrap em{padding-right:6px;color:#7a879c;font-size:.65rem;font-style:normal;font-weight:650}
      .display-typography-fields{display:grid;gap:6px}
      .display-typography-note{margin:0;color:#667085;font-size:.65rem;line-height:1.35}
      #display-font-size-reset{display:none!important}
      .display-font-size-control{display:none!important}
    `;
    document.head.append(style);
  }

  function fieldMarkup(field, label) {
    return `<label class="display-typography-field"><span>${label}</span><span class="display-typography-input-wrap"><input data-typography-field="${field}" type="number" min="${MIN_PX}" step="0.5" inputmode="decimal" aria-label="${label} font size in pixels"/><em>px</em></span></label>`;
  }

  function installControls() {
    document.querySelector('.display-font-size-control')?.remove();
    if (document.querySelector('#display-typography-control')) return;
    const panel = document.querySelector('#minimal-menu-display .minimal-tool-panel');
    const displayGroup = document.querySelector('.display-options');
    const host = panel instanceof HTMLElement ? panel : displayGroup instanceof HTMLElement ? displayGroup : null;
    if (!host) return;

    const control = document.createElement('div');
    control.id = 'display-typography-control';
    control.className = 'display-typography-control';
    control.innerHTML = `
      <div class="display-typography-header"><strong>Typography</strong><button id="display-typography-reset" class="toolbar-button compact" type="button">Reset all</button></div>
      <div class="display-typography-global">
        <label><span>Scale all from defaults</span><span class="display-typography-input-wrap"><input id="display-typography-global" type="number" min="1" step="1" inputmode="decimal" aria-label="Scale all diagram text from default sizes"/><em>%</em></span></label>
      </div>
      <div class="display-typography-fields">
        ${fieldMarkup('year', 'Year header')}
        ${fieldMarkup('term', 'Semester header')}
        ${fieldMarkup('code', 'Course code')}
        ${fieldMarkup('title', 'Course title')}
        ${fieldMarkup('meta', 'Units / track')}
      </div>
      <p class="display-typography-note">Exact pixel values have no application-defined upper limit. PNG and SVG use these same diagram font sizes.</p>`;
    host.append(control);

    globalInput = control.querySelector('#display-typography-global');
    resetButton = control.querySelector('#display-typography-reset');
    control.querySelectorAll('input[data-typography-field]').forEach(input => {
      if (!(input instanceof HTMLInputElement)) return;
      fieldInputs.set(input.dataset.typographyField, input);
      input.addEventListener('input', () => setField(input.dataset.typographyField, input.value, { sync: false }));
      input.addEventListener('change', () => {
        const config = setField(input.dataset.typographyField, input.value);
        window.CurriculumFlowchartRuntime?.setHint?.(`${input.closest('label')?.querySelector('span')?.textContent || 'Font'} set to ${config[input.dataset.typographyField]} px.`);
      });
    });
    globalInput?.addEventListener('change', () => {
      const value = Number(globalInput.value);
      if (!Number.isFinite(value) || value <= 0) { syncControls(); return; }
      scaleAll(value);
      window.CurriculumFlowchartRuntime?.setHint?.(`All diagram typography scaled to ${value}% of defaults.`);
    });
    globalInput?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); globalInput.blur(); } });
    resetButton?.addEventListener('click', () => {
      resetAll();
      window.CurriculumFlowchartRuntime?.setHint?.('Diagram typography reset to default sizes.');
    });

    syncControls();
  }

  function numericAttribute(element, name, fallback = 0) {
    const value = Number(element.getAttribute(name));
    return Number.isFinite(value) ? value : fallback;
  }

  function isCourseGroup(group) {
    const rect = [...group.children].find(child => child.tagName?.toLowerCase() === 'rect');
    if (!(rect instanceof SVGElement)) return null;
    const width = numericAttribute(rect, 'width');
    const height = numericAttribute(rect, 'height');
    if (Math.abs(width - NODE_WIDTH) > 0.01 || !NODE_HEIGHTS.some(candidate => Math.abs(height - candidate) < 0.01)) return null;
    return rect;
  }

  function setSvgFontSize(element, size) {
    element.setAttribute('font-size', String(Number(size.toFixed(3))));
  }

  function applyExportTypography(svgText) {
    const config = getConfig();
    try {
      const documentXml = new DOMParser().parseFromString(svgText, 'image/svg+xml');
      const root = documentXml.documentElement;

      [...root.children].forEach(child => {
        if (child.tagName?.toLowerCase() !== 'text') return;
        const y = numericAttribute(child, 'y');
        if (Math.abs(y - 38) < 0.01) setSvgFontSize(child, config.year);
        else if (Math.abs(y - 82) < 0.01) setSvgFontSize(child, config.term);
      });

      [...root.querySelectorAll('g')].forEach(group => {
        const rect = isCourseGroup(group);
        if (!rect) return;
        const top = numericAttribute(rect, 'y');
        const texts = [...group.children].filter(child => child.tagName?.toLowerCase() === 'text');
        const titleTexts = [];
        texts.forEach(text => {
          const y = numericAttribute(text, 'y');
          if (y <= top + 24) setSvgFontSize(text, config.code);
          else if (y >= top + 60) setSvgFontSize(text, config.meta);
          else { setSvgFontSize(text, config.title); titleTexts.push(text); }
        });
        const lineGap = Math.max(8, config.title * 1.14);
        titleTexts.forEach((text, index) => text.setAttribute('y', String(Number((top + 38 + index * lineGap).toFixed(3)))));
      });

      return new XMLSerializer().serializeToString(root);
    } catch {
      return svgText;
    }
  }

  const baseBuildExportSvgForTypography = buildExportSvg;
  buildExportSvg = () => applyExportTypography(baseBuildExportSvgForTypography());

  window.CurriculumDisplayTypography = {
    get: field => field ? getConfig()[field] : clone(getConfig()),
    set: (field, value) => setField(field, value),
    scaleAll,
    reset: resetAll,
    exportState: () => clone(getConfig()),
    importState: (value, options = {}) => saveConfig(value || DEFAULTS, { sync: options.sync !== false }),
    defaults: () => clone(DEFAULTS),
  };

  // Compatibility API: callers that still use the earlier global font-size API continue to work.
  window.CurriculumDisplayFontSize = {
    get: () => matchingGlobalPercent(getConfig()) == null ? 1 : matchingGlobalPercent(getConfig()) / 100,
    set: value => scaleAll(Math.max(0.01, finite(value, 1)) * 100),
    reset: resetAll,
    exportState: () => ({ typography: clone(getConfig()) }),
    importState: (value, options = {}) => {
      if (value?.typography) return saveConfig(value.typography, { sync: options.sync !== false });
      const scale = finite(value?.scale ?? value, 1);
      return scaleAll(scale * 100, { sync: options.sync !== false });
    },
  };

  installStyles();
  installControls();
  syncControls();

  const curriculumObserver = new MutationObserver(mutations => {
    if (mutations.some(mutation => mutation.type === 'attributes' && mutation.attributeName === 'data-curriculum-title')) syncControls();
  });
  curriculumObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-curriculum-title'] });
})();
