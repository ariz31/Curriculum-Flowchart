
;(() => {
  const STORAGE_KEY = 'curriculum-flowchart:export-resolution-unlimited:v1';
  const LEGACY_SETTINGS_KEY = 'curriculum-flowchart:export-settings:v1';
  const CURRICULUM_LIBRARY_KEY = 'curriculum-flowchart:curricula:v1';
  const DEFAULT_SCALE = 4;
  const PRESETS = [1, 2, 3, 4, 6, 8, 12, 16];

  const safeParse = value => { try { return value ? JSON.parse(value) : null; } catch { return null; } };
  const activeCurriculumId = () => String(safeParse(localStorage.getItem(CURRICULUM_LIBRARY_KEY))?.activeId || 'default');
  const validScale = value => {
    const number = Number(value);
    return Number.isFinite(number) && number >= 1 ? number : DEFAULT_SCALE;
  };

  function allScales() {
    const stored = safeParse(localStorage.getItem(STORAGE_KEY));
    return stored && typeof stored === 'object' ? stored : {};
  }

  function legacyScale() {
    const stored = safeParse(localStorage.getItem(LEGACY_SETTINGS_KEY));
    const entry = stored && typeof stored === 'object' ? stored[activeCurriculumId()] : null;
    const scale = Number(entry?.scale);
    return Number.isFinite(scale) && scale >= 1 ? scale : null;
  }

  function getScale() {
    const stored = Number(allScales()[activeCurriculumId()]);
    if (Number.isFinite(stored) && stored >= 1) return stored;
    return legacyScale() || DEFAULT_SCALE;
  }

  function saveScale(value, options = {}) {
    const scale = validScale(value);
    const all = allScales();
    all[activeCurriculumId()] = scale;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    if (options.sync !== false) syncControls();
    return scale;
  }

  const previousApi = window.CurriculumExportSettings || {};
  const previousExportState = typeof previousApi.exportState === 'function' ? previousApi.exportState.bind(previousApi) : null;
  const previousImportState = typeof previousApi.importState === 'function' ? previousApi.importState.bind(previousApi) : null;

  window.CurriculumExportSettings = {
    ...previousApi,
    getScale,
    setScale: value => saveScale(value),
    exportState: () => ({ ...(previousExportState?.() || {}), scale: getScale() }),
    importState: (value, options = {}) => {
      previousImportState?.(value, options);
      if (value && Number.isFinite(Number(value.scale)) && Number(value.scale) >= 1) saveScale(value.scale, { sync: false });
      syncControls();
    },
  };

  let scaleSelect = null;
  let customInput = null;

  function createResolutionControls() {
    const oldSelect = document.querySelector('#export-resolution-level');
    if (!(oldSelect instanceof HTMLSelectElement) || oldSelect.dataset.unlimitedResolution === 'true') return;

    const select = document.createElement('select');
    select.id = 'export-resolution-level';
    select.dataset.unlimitedResolution = 'true';
    select.setAttribute('aria-label', 'PNG export resolution');
    select.innerHTML = `
      <option value="1">Standard · 1×</option>
      <option value="2">High · 2×</option>
      <option value="3">Ultra · 3×</option>
      <option value="4">4K+ · 4×</option>
      <option value="6">Very high · 6×</option>
      <option value="8">Extreme · 8×</option>
      <option value="12">Maximum+ · 12×</option>
      <option value="16">Extreme+ · 16×</option>
      <option value="custom">Custom…</option>`;

    const custom = document.createElement('input');
    custom.id = 'export-resolution-custom';
    custom.type = 'number';
    custom.min = '1';
    custom.step = '0.5';
    custom.inputMode = 'decimal';
    custom.setAttribute('aria-label', 'Custom PNG export scale multiplier');
    custom.placeholder = 'Scale multiplier';
    custom.hidden = true;

    oldSelect.replaceWith(select);
    select.insertAdjacentElement('afterend', custom);
    scaleSelect = select;
    customInput = custom;

    select.addEventListener('change', () => {
      if (select.value === 'custom') {
        custom.hidden = false;
        custom.value = String(getScale());
        custom.focus();
        custom.select();
        return;
      }
      custom.hidden = true;
      const scale = saveScale(select.value);
      window.CurriculumFlowchartRuntime?.setHint?.(`PNG export resolution set to ${scale}× with no application dimension cap.`);
    });

    custom.addEventListener('change', () => {
      const scale = saveScale(custom.value);
      custom.value = String(scale);
      window.CurriculumFlowchartRuntime?.setHint?.(`Custom PNG export resolution set to ${scale}× with no application dimension cap.`);
    });
    custom.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        custom.blur();
      }
    });

    if (!document.querySelector('#unlimited-export-resolution-style')) {
      const style = document.createElement('style');
      style.id = 'unlimited-export-resolution-style';
      style.textContent = `
        #export-resolution-custom{width:100%;min-height:36px;border:1px solid #d8deea;border-radius:8px;padding:6px 8px;background:#fff;color:#172033;font:inherit;font-size:.78rem;margin-top:5px}
        #export-resolution-custom[hidden]{display:none!important}
      `;
      document.head.append(style);
    }

    syncControls();
  }

  function syncControls() {
    if (!(scaleSelect instanceof HTMLSelectElement)) scaleSelect = document.querySelector('#export-resolution-level');
    if (!(customInput instanceof HTMLInputElement)) customInput = document.querySelector('#export-resolution-custom');
    if (!(scaleSelect instanceof HTMLSelectElement)) return;
    const scale = getScale();
    const preset = PRESETS.find(value => Math.abs(value - scale) < 0.0001);
    if (preset) {
      scaleSelect.value = String(preset);
      if (customInput instanceof HTMLInputElement) customInput.hidden = true;
    } else {
      scaleSelect.value = 'custom';
      if (customInput instanceof HTMLInputElement) {
        customInput.hidden = false;
        customInput.value = String(scale);
      }
    }
  }

  // Final export scaler: it deliberately replaces the earlier 16,384 px application cap.
  // The requested multiplier is applied directly. Browser/OS canvas and memory limits remain
  // implementation-defined and are no longer pre-emptively constrained by this application.
  const canvasWidth = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width');
  const canvasHeight = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'height');
  const previousCreateElement = Document.prototype.createElement;
  let exportArmed = false;

  function prepareUnlimitedCanvas(canvas) {
    if (!canvasWidth?.get || !canvasWidth?.set || !canvasHeight?.get || !canvasHeight?.set) return;
    let requestedWidth = 0;

    Object.defineProperty(canvas, 'width', {
      configurable: true,
      get() { return canvasWidth.get.call(canvas); },
      set(value) {
        requestedWidth = Math.max(1, Number(value) || 1);
        canvasWidth.set.call(canvas, requestedWidth);
      },
    });

    Object.defineProperty(canvas, 'height', {
      configurable: true,
      get() { return canvasHeight.get.call(canvas); },
      set(value) {
        const requestedHeight = Math.max(1, Number(value) || 1);
        const width = Math.max(1, requestedWidth || canvasWidth.get.call(canvas));
        const scale = getScale();
        canvasWidth.set.call(canvas, Math.max(1, Math.round(width * scale)));
        canvasHeight.set.call(canvas, Math.max(1, Math.round(requestedHeight * scale)));
      },
    });
  }

  Document.prototype.createElement = function unlimitedResolutionCreateElement(tagName, options) {
    const element = previousCreateElement.call(this, tagName, options);
    if (exportArmed && String(tagName).toLowerCase() === 'canvas' && element instanceof HTMLCanvasElement) {
      exportArmed = false;
      prepareUnlimitedCanvas(element);
    }
    return element;
  };

  document.querySelector('#download-image')?.addEventListener('click', () => {
    exportArmed = true;
    window.setTimeout(() => { exportArmed = false; }, 1500);
  }, true);

  createResolutionControls();
  syncControls();

  const curriculumObserver = new MutationObserver(mutations => {
    if (mutations.some(mutation => mutation.type === 'attributes' && mutation.attributeName === 'data-curriculum-title')) syncControls();
  });
  curriculumObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-curriculum-title'] });
})();
