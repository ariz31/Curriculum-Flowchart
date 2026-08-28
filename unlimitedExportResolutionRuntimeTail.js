
;(() => {
  const STORAGE_KEY = 'curriculum-flowchart:export-output-size:v2';
  const LEGACY_SCALE_KEY = 'curriculum-flowchart:export-resolution-unlimited:v1';
  const LEGACY_SETTINGS_KEY = 'curriculum-flowchart:export-settings:v1';
  const CURRICULUM_LIBRARY_KEY = 'curriculum-flowchart:curricula:v1';
  const DEFAULT_WIDTH = 8192;
  const MIN_WIDTH = 512;
  const WIDTH_PRESETS = [4096, 8192, 12288, 16384, 24576, 32768];

  const safeParse = value => { try { return value ? JSON.parse(value) : null; } catch { return null; } };
  const activeCurriculumId = () => String(safeParse(localStorage.getItem(CURRICULUM_LIBRARY_KEY))?.activeId || 'default');
  const finitePositive = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  };
  const formatNumber = value => Math.round(Number(value) || 0).toLocaleString();

  function exportGeometry() {
    const width = Math.max(1, Number(logicalWidth) || 1);
    const baseHeight = Math.max(1, Number(logicalHeight) || 1);
    const extraHeight = Math.max(0, Number(window.CurriculumExportTitleMetrics?.extraHeightForWidth?.(width)) || 0);
    const height = baseHeight + extraHeight;
    return { width, height, aspect: width / height };
  }

  function allConfigs() {
    const stored = safeParse(localStorage.getItem(STORAGE_KEY));
    return stored && typeof stored === 'object' ? stored : {};
  }

  function legacyScale() {
    const direct = safeParse(localStorage.getItem(LEGACY_SCALE_KEY));
    const directScale = Number(direct?.[activeCurriculumId()]);
    if (Number.isFinite(directScale) && directScale >= 1) return directScale;
    const stored = safeParse(localStorage.getItem(LEGACY_SETTINGS_KEY));
    const scale = Number(stored?.[activeCurriculumId()]?.scale);
    return Number.isFinite(scale) && scale >= 1 ? scale : null;
  }

  function normalizeWidth(value) {
    return Math.max(MIN_WIDTH, Math.round(finitePositive(value, DEFAULT_WIDTH)));
  }

  function migratedWidth() {
    const scale = legacyScale();
    if (!scale) return DEFAULT_WIDTH;
    return Math.max(DEFAULT_WIDTH, Math.round(exportGeometry().width * scale));
  }

  function getWidth() {
    const entry = allConfigs()[activeCurriculumId()];
    const storedWidth = Number(entry?.width ?? entry);
    return Number.isFinite(storedWidth) && storedWidth >= MIN_WIDTH ? Math.round(storedWidth) : migratedWidth();
  }

  function getOutputSize() {
    const width = getWidth();
    const aspect = exportGeometry().aspect;
    return {
      width,
      height: Math.max(1, Math.round(width / aspect)),
    };
  }

  function saveWidth(value, options = {}) {
    const width = normalizeWidth(value);
    const all = allConfigs();
    all[activeCurriculumId()] = { width };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    if (options.sync !== false) syncControls();
    return getOutputSize();
  }

  function saveHeight(value, options = {}) {
    const height = Math.max(1, Math.round(finitePositive(value, getOutputSize().height)));
    const width = Math.max(MIN_WIDTH, Math.round(height * exportGeometry().aspect));
    return saveWidth(width, options);
  }

  function getScale() {
    return getOutputSize().width / exportGeometry().width;
  }

  const previousApi = window.CurriculumExportSettings || {};
  const previousExportState = typeof previousApi.exportState === 'function' ? previousApi.exportState.bind(previousApi) : null;
  const previousImportState = typeof previousApi.importState === 'function' ? previousApi.importState.bind(previousApi) : null;

  window.CurriculumExportSettings = {
    ...previousApi,
    getScale,
    setScale: value => saveWidth(exportGeometry().width * Math.max(1, finitePositive(value, 1))),
    getOutputSize,
    setOutputWidth: value => saveWidth(value),
    setOutputHeight: value => saveHeight(value),
    exportState: () => ({
      ...(previousExportState?.() || {}),
      outputWidth: getOutputSize().width,
      outputHeight: getOutputSize().height,
      scale: getScale(),
    }),
    importState: (value, options = {}) => {
      previousImportState?.(value, options);
      if (value && Number.isFinite(Number(value.outputWidth)) && Number(value.outputWidth) >= MIN_WIDTH) {
        saveWidth(value.outputWidth, { sync: false });
      } else if (value && Number.isFinite(Number(value.scale)) && Number(value.scale) >= 1) {
        saveWidth(exportGeometry().width * Number(value.scale), { sync: false });
      }
      syncControls();
    },
  };

  let sizeSelect = null;
  let widthInput = null;
  let heightInput = null;
  let summary = null;

  function megapixels(size) {
    return (size.width * size.height / 1_000_000).toFixed(size.width * size.height >= 100_000_000 ? 0 : 1);
  }

  function createSizeControls() {
    const oldSelect = document.querySelector('#export-resolution-level');
    if (!(oldSelect instanceof HTMLSelectElement) || oldSelect.dataset.pixelSizeControl === 'true') return;

    const field = oldSelect.closest('.minimal-resolution-field');
    const fieldTitle = field?.querySelector(':scope > span');
    if (fieldTitle) fieldTitle.textContent = 'Output size';

    const select = document.createElement('select');
    select.id = 'export-resolution-level';
    select.dataset.pixelSizeControl = 'true';
    select.setAttribute('aria-label', 'PNG output pixel width');
    select.innerHTML = `
      <option value="4096">Large · 4,096 px wide</option>
      <option value="8192">Very large · 8,192 px wide</option>
      <option value="12288">12K · 12,288 px wide</option>
      <option value="16384">16K · 16,384 px wide</option>
      <option value="24576">24K · 24,576 px wide</option>
      <option value="32768">32K · 32,768 px wide</option>
      <option value="custom">Custom dimensions…</option>`;
    oldSelect.replaceWith(select);
    sizeSelect = select;

    const dimensions = document.createElement('div');
    dimensions.className = 'export-pixel-dimensions';
    dimensions.innerHTML = `
      <label><span>Width</span><span class="export-pixel-input"><input id="export-pixel-width" type="number" min="${MIN_WIDTH}" step="1" inputmode="numeric" aria-label="PNG output width in pixels" /><em>px</em></span></label>
      <span class="export-aspect-lock" title="Width and height stay proportional to the complete exported flowchart">🔒</span>
      <label><span>Height</span><span class="export-pixel-input"><input id="export-pixel-height" type="number" min="1" step="1" inputmode="numeric" aria-label="PNG output height in pixels" /><em>px</em></span></label>
      <small id="export-pixel-summary"></small>`;
    (field || select.parentElement)?.insertAdjacentElement('afterend', dimensions);

    widthInput = dimensions.querySelector('#export-pixel-width');
    heightInput = dimensions.querySelector('#export-pixel-height');
    summary = dimensions.querySelector('#export-pixel-summary');

    select.addEventListener('change', () => {
      if (select.value === 'custom') {
        widthInput?.focus();
        widthInput?.select();
        return;
      }
      const size = saveWidth(select.value);
      window.CurriculumFlowchartRuntime?.setHint?.(`PNG output size set to ${formatNumber(size.width)} × ${formatNumber(size.height)} px.`);
    });

    widthInput?.addEventListener('change', () => {
      const size = saveWidth(widthInput.value);
      window.CurriculumFlowchartRuntime?.setHint?.(`PNG width set to ${formatNumber(size.width)} px; height adjusted proportionally to ${formatNumber(size.height)} px.`);
    });
    heightInput?.addEventListener('change', () => {
      const size = saveHeight(heightInput.value);
      window.CurriculumFlowchartRuntime?.setHint?.(`PNG height set to ${formatNumber(size.height)} px; width adjusted proportionally to ${formatNumber(size.width)} px.`);
    });
    [widthInput, heightInput].forEach(input => input?.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); input.blur(); }
    }));

    if (!document.querySelector('#unlimited-export-resolution-style')) {
      const style = document.createElement('style');
      style.id = 'unlimited-export-resolution-style';
      style.textContent = `
        .export-pixel-dimensions{display:grid;grid-template-columns:minmax(0,1fr) 24px minmax(0,1fr);align-items:end;gap:6px;padding:2px 0 7px}
        .export-pixel-dimensions>label{display:grid;gap:4px;color:#475467;font-size:.7rem;font-weight:750}
        .export-pixel-input{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;border:1px solid #d8deea;border-radius:8px;background:#fff;overflow:hidden}
        .export-pixel-input input{width:100%;min-width:0;min-height:36px;border:0;padding:6px 8px;background:transparent;color:#172033;font:inherit;font-size:.78rem;outline:none}
        .export-pixel-input em{padding-right:7px;color:#7a879c;font-size:.68rem;font-style:normal;font-weight:650}
        .export-aspect-lock{align-self:end;display:grid;place-items:center;height:36px;color:#667085;font-size:.72rem}
        #export-pixel-summary{grid-column:1/-1;color:#667085;font-size:.67rem;line-height:1.35}
      `;
      document.head.append(style);
    }

    syncControls();
  }

  function syncControls() {
    if (!(sizeSelect instanceof HTMLSelectElement)) sizeSelect = document.querySelector('#export-resolution-level');
    if (!(widthInput instanceof HTMLInputElement)) widthInput = document.querySelector('#export-pixel-width');
    if (!(heightInput instanceof HTMLInputElement)) heightInput = document.querySelector('#export-pixel-height');
    if (!(summary instanceof HTMLElement)) summary = document.querySelector('#export-pixel-summary');
    const size = getOutputSize();
    const preset = WIDTH_PRESETS.find(value => value === size.width);
    if (sizeSelect instanceof HTMLSelectElement) sizeSelect.value = preset ? String(preset) : 'custom';
    if (widthInput instanceof HTMLInputElement) widthInput.value = String(size.width);
    if (heightInput instanceof HTMLInputElement) heightInput.value = String(size.height);
    if (summary instanceof HTMLElement) {
      summary.textContent = `${formatNumber(size.width)} × ${formatNumber(size.height)} px · ${megapixels(size)} MP · aspect ratio locked · no application size cap`;
    }
  }

  // Final output-size writer. The application's earlier multiplier and 12k/16k guards are
  // intentionally superseded here: the selected pixel dimensions are applied exactly.
  // Browser/OS canvas and memory limits still apply because those are outside the application.
  const canvasWidth = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width');
  const canvasHeight = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'height');
  const previousCreateElement = Document.prototype.createElement;
  let exportArmed = false;

  function prepareExactSizeCanvas(canvas) {
    if (!canvasWidth?.get || !canvasWidth?.set || !canvasHeight?.get || !canvasHeight?.set) return;
    Object.defineProperty(canvas, 'width', {
      configurable: true,
      get() { return canvasWidth.get.call(canvas); },
      set() {
        const size = getOutputSize();
        canvasWidth.set.call(canvas, size.width);
      },
    });
    Object.defineProperty(canvas, 'height', {
      configurable: true,
      get() { return canvasHeight.get.call(canvas); },
      set() {
        const size = getOutputSize();
        canvasWidth.set.call(canvas, size.width);
        canvasHeight.set.call(canvas, size.height);
      },
    });
  }

  Document.prototype.createElement = function exactPixelSizeCreateElement(tagName, options) {
    const element = previousCreateElement.call(this, tagName, options);
    if (exportArmed && String(tagName).toLowerCase() === 'canvas' && element instanceof HTMLCanvasElement) {
      exportArmed = false;
      prepareExactSizeCanvas(element);
    }
    return element;
  };

  document.querySelector('#download-image')?.addEventListener('click', () => {
    exportArmed = true;
    window.setTimeout(() => { exportArmed = false; }, 1500);
  }, true);

  createSizeControls();
  syncControls();

  const refresh = () => syncControls();
  const curriculumObserver = new MutationObserver(mutations => {
    if (mutations.some(mutation => mutation.type === 'attributes' && mutation.attributeName === 'data-curriculum-title')) refresh();
  });
  curriculumObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-curriculum-title'] });
  window.addEventListener('resize', refresh);
})();
