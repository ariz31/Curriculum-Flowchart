
;(() => {
  const STORAGE_KEY = 'curriculum-flowchart:display-font-size:v1';
  const CURRICULUM_LIBRARY_KEY = 'curriculum-flowchart:curricula:v1';
  const DEFAULT_SCALE = 1;
  const MIN_SCALE = 0.8;
  const MAX_SCALE = 1.25;
  const STEP = 0.05;
  const NODE_WIDTH = 184;
  const NODE_HEIGHT = 78;

  const safeParse = value => { try { return value ? JSON.parse(value) : null; } catch { return null; } };
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const activeCurriculumId = () => String(safeParse(localStorage.getItem(CURRICULUM_LIBRARY_KEY))?.activeId || 'default');
  const normalizeScale = value => clamp(Number(value) || DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);

  function allConfigs() {
    const stored = safeParse(localStorage.getItem(STORAGE_KEY));
    return stored && typeof stored === 'object' ? stored : {};
  }

  function getScale() {
    const value = Number(allConfigs()[activeCurriculumId()]);
    return Number.isFinite(value) ? normalizeScale(value) : DEFAULT_SCALE;
  }

  function saveScale(value, options = {}) {
    const scale = normalizeScale(value);
    const configs = allConfigs();
    configs[activeCurriculumId()] = scale;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
    applyLiveScale();
    if (options.sync !== false) syncControls();
    return scale;
  }

  let rangeInput = null;
  let numberInput = null;
  let output = null;
  let resetButton = null;

  function percentage(scale = getScale()) {
    return `${Math.round(scale * 100)}%`;
  }

  function applyLiveScale() {
    const flowPanel = document.querySelector('#flow-panel');
    if (!(flowPanel instanceof HTMLElement)) return;
    const scale = getScale();
    flowPanel.style.setProperty('--curriculum-display-font-scale', String(scale));
    flowPanel.dataset.displayFontScale = String(scale);
  }

  function syncControls() {
    const scale = getScale();
    const percent = Math.round(scale * 100);
    if (rangeInput instanceof HTMLInputElement) rangeInput.value = String(percent);
    if (numberInput instanceof HTMLInputElement) numberInput.value = String(percent);
    if (output instanceof HTMLOutputElement) output.value = `${percent}%`;
    if (output instanceof HTMLElement) output.textContent = `${percent}%`;
    if (resetButton instanceof HTMLButtonElement) resetButton.disabled = Math.abs(scale - DEFAULT_SCALE) < 0.001;
    applyLiveScale();
  }

  function updateFromPercent(value, announce = true) {
    const percent = clamp(Number(value) || 100, MIN_SCALE * 100, MAX_SCALE * 100);
    const scale = saveScale(percent / 100);
    if (announce) window.CurriculumFlowchartRuntime?.setHint?.(`Flowchart text size set to ${percentage(scale)}. PNG and SVG exports will use the same diagram text scale.`);
    return scale;
  }

  function installStyles() {
    if (document.querySelector('#display-font-size-style')) return;
    const style = document.createElement('style');
    style.id = 'display-font-size-style';
    style.textContent = `
      #flow-panel{--curriculum-display-font-scale:1}
      #flow-panel .year-header{font-size:calc(.76rem * var(--curriculum-display-font-scale))}
      #flow-panel .term-header{font-size:calc(.72rem * var(--curriculum-display-font-scale))}
      #flow-panel .node-code{font-size:calc(.74rem * var(--curriculum-display-font-scale))}
      #flow-panel .node-title{font-size:calc(.68rem * var(--curriculum-display-font-scale));line-height:1.16}
      #flow-panel .node-meta{font-size:calc(.62rem * var(--curriculum-display-font-scale))}
      .display-font-size-control{display:grid;grid-template-columns:auto minmax(96px,1fr) 56px auto;align-items:center;gap:7px;width:100%;padding:2px 0}
      .display-font-size-control>span{font-size:.72rem;font-weight:750;color:#475467;white-space:nowrap}
      #display-font-size-range{width:100%;accent-color:#2557d6}
      #display-font-size-number{width:56px;min-height:34px;border:1px solid #d8deea;border-radius:7px;padding:4px 6px;background:#fff;color:#172033;font:inherit;font-size:.75rem;text-align:right}
      #display-font-size-output{min-width:42px;color:#667085;font-size:.7rem;font-weight:750;text-align:right}
      #display-font-size-reset{min-height:34px}
      @media(max-width:760px){.display-font-size-control{grid-template-columns:auto minmax(90px,1fr) 58px}.display-font-size-control>span{grid-column:1/-1}#display-font-size-reset{grid-column:1/-1;justify-self:start}}
    `;
    document.head.append(style);
  }

  function installControls() {
    if (document.querySelector('#display-font-size-range')) return;
    const panel = document.querySelector('#minimal-menu-display .minimal-tool-panel');
    const displayGroup = document.querySelector('.display-options');
    const host = panel instanceof HTMLElement ? panel : displayGroup instanceof HTMLElement ? displayGroup : null;
    if (!host) return;

    const control = document.createElement('div');
    control.className = 'display-font-size-control';
    control.setAttribute('aria-label', 'Flowchart font size');
    control.innerHTML = `
      <span>Diagram text</span>
      <input id="display-font-size-range" type="range" min="${MIN_SCALE * 100}" max="${MAX_SCALE * 100}" step="${STEP * 100}" aria-label="Flowchart text size percentage" />
      <input id="display-font-size-number" type="number" min="${MIN_SCALE * 100}" max="${MAX_SCALE * 100}" step="${STEP * 100}" inputmode="numeric" aria-label="Flowchart text size percentage" />
      <output id="display-font-size-output" aria-live="polite"></output>
      <button id="display-font-size-reset" class="toolbar-button compact" type="button">Reset text</button>`;
    host.append(control);

    rangeInput = control.querySelector('#display-font-size-range');
    numberInput = control.querySelector('#display-font-size-number');
    output = control.querySelector('#display-font-size-output');
    resetButton = control.querySelector('#display-font-size-reset');

    rangeInput?.addEventListener('input', () => updateFromPercent(rangeInput.value, false));
    rangeInput?.addEventListener('change', () => updateFromPercent(rangeInput.value, true));
    numberInput?.addEventListener('change', () => updateFromPercent(numberInput.value, true));
    numberInput?.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); numberInput.blur(); }
    });
    resetButton?.addEventListener('click', () => {
      saveScale(DEFAULT_SCALE);
      window.CurriculumFlowchartRuntime?.setHint?.('Flowchart text size reset to 100%.');
    });

    syncControls();
  }

  function numericAttribute(element, name, fallback = 0) {
    const value = Number(element.getAttribute(name));
    return Number.isFinite(value) ? value : fallback;
  }

  function scaleFontSize(text, scale) {
    const current = Number(text.getAttribute('font-size'));
    if (!Number.isFinite(current)) return;
    text.setAttribute('font-size', String(Number((current * scale).toFixed(3))));
  }

  function isCourseGroup(group) {
    const rect = [...group.children].find(child => child.tagName?.toLowerCase() === 'rect');
    if (!(rect instanceof SVGElement)) return null;
    const width = numericAttribute(rect, 'width');
    const height = numericAttribute(rect, 'height');
    if (Math.abs(width - NODE_WIDTH) > 0.01 || Math.abs(height - NODE_HEIGHT) > 0.01) return null;
    return rect;
  }

  function applyExportFontScale(svgText) {
    const scale = getScale();
    if (Math.abs(scale - DEFAULT_SCALE) < 0.001) return svgText;
    try {
      const documentXml = new DOMParser().parseFromString(svgText, 'image/svg+xml');
      const root = documentXml.documentElement;

      // Year and term headers are the only base export text nodes outside course groups.
      [...root.children].forEach(child => {
        if (child.tagName?.toLowerCase() !== 'text') return;
        const y = numericAttribute(child, 'y');
        if (Math.abs(y - 38) < 0.01 || Math.abs(y - 82) < 0.01) scaleFontSize(child, scale);
      });

      [...root.querySelectorAll('g')].forEach(group => {
        const rect = isCourseGroup(group);
        if (!rect) return;
        const top = numericAttribute(rect, 'y');
        const texts = [...group.children].filter(child => child.tagName?.toLowerCase() === 'text');
        texts.forEach(text => scaleFontSize(text, scale));

        // Keep two-line course titles readable as they grow by increasing only their
        // inter-line baseline spacing; code and unit baselines stay attached to the node.
        const titleTexts = texts.filter(text => {
          const y = numericAttribute(text, 'y');
          return y > top + 24 && y < top + 65;
        });
        titleTexts.forEach((text, index) => {
          text.setAttribute('y', String(Number((top + 38 + index * 12 * scale).toFixed(3))));
        });
      });

      return new XMLSerializer().serializeToString(root);
    } catch {
      return svgText;
    }
  }

  const baseBuildExportSvgForDisplayFontSize = buildExportSvg;
  buildExportSvg = () => applyExportFontScale(baseBuildExportSvgForDisplayFontSize());

  window.CurriculumDisplayFontSize = {
    get: getScale,
    set: value => saveScale(value),
    reset: () => saveScale(DEFAULT_SCALE),
    exportState: () => ({ scale: getScale() }),
    importState: (value, options = {}) => {
      const scale = Number(value?.scale ?? value);
      saveScale(Number.isFinite(scale) ? scale : DEFAULT_SCALE, { sync: options.sync !== false });
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
