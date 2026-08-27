
;(() => {
  const STORAGE_KEY = 'curriculum-flowchart:export-settings:v1';
  const CURRICULUM_LIBRARY_KEY = 'curriculum-flowchart:curricula:v1';
  const DEFAULT_SCALE = 2;
  const MAX_SCALE = 4;
  const MAX_EXPORT_DIMENSION = 16384;

  const safeParse = value => { try { return value ? JSON.parse(value) : null; } catch { return null; } };
  const clone = value => JSON.parse(JSON.stringify(value));
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const activeCurriculumId = () => String(safeParse(localStorage.getItem(CURRICULUM_LIBRARY_KEY))?.activeId || 'default');
  const curriculumTitle = () => String(document.documentElement.dataset.curriculumTitle || window.__CURRICULUM_TITLE__ || 'Curriculum Flowchart').trim() || 'Curriculum Flowchart';

  function allConfigs() {
    const stored = safeParse(localStorage.getItem(STORAGE_KEY));
    return stored && typeof stored === 'object' ? stored : {};
  }

  function normalizeConfig(value) {
    const title = typeof value?.title === 'string' ? value.title.trim() : '';
    const scale = clamp(Number(value?.scale) || DEFAULT_SCALE, 1, MAX_SCALE);
    return { title, scale };
  }

  function config() {
    return normalizeConfig(allConfigs()[activeCurriculumId()] || {});
  }

  function saveConfig(next) {
    const all = allConfigs();
    all[activeCurriculumId()] = normalizeConfig(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    syncControls();
  }

  function resolvedTitle() {
    return config().title || curriculumTitle();
  }

  function exportState() {
    return clone(config());
  }

  function importState(value, options = {}) {
    const all = allConfigs();
    all[activeCurriculumId()] = normalizeConfig(value || {});
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    syncControls();
    if (!options.silent) window.CurriculumFlowchartRuntime?.setHint?.('Export settings restored.');
  }

  let titleInput = null;
  let scaleSelect = null;
  let defaultTitleButton = null;

  function syncControls() {
    const current = config();
    if (titleInput instanceof HTMLInputElement) {
      titleInput.value = current.title || curriculumTitle();
      titleInput.placeholder = curriculumTitle();
    }
    if (scaleSelect instanceof HTMLSelectElement) scaleSelect.value = String(current.scale);
    if (defaultTitleButton instanceof HTMLButtonElement) defaultTitleButton.disabled = !current.title;
  }

  window.CurriculumExportSettings = {
    getTitle: resolvedTitle,
    getScale: () => config().scale,
    exportState,
    importState,
    setTitle: value => saveConfig({ ...config(), title: String(value || '').trim() }),
    setScale: value => saveConfig({ ...config(), scale: value }),
  };

  // The legacy export helper always prepares PNGs at 2x. Wrap its canvas factory so the
  // user's selected resolution becomes the authoritative scale while preserving the 16k cap.
  const canvasWidth = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width');
  const canvasHeight = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'height');
  const previousCreateElement = Document.prototype.createElement;
  let resolutionArmed = false;

  function prepareResolutionCanvas(canvas) {
    if (!canvasWidth?.get || !canvasWidth?.set || !canvasHeight?.get || !canvasHeight?.set) return;
    let requestedWidth = 0;
    let requestedHeight = 0;

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
        requestedHeight = Math.max(1, Number(value) || 1);
        const width = Math.max(1, requestedWidth || canvasWidth.get.call(canvas));
        const preferred = clamp(Number(window.CurriculumExportSettings?.getScale?.()) || DEFAULT_SCALE, 1, MAX_SCALE);
        const effective = Math.max(1, Math.min(preferred, MAX_EXPORT_DIMENSION / width, MAX_EXPORT_DIMENSION / requestedHeight));
        canvasWidth.set.call(canvas, Math.max(1, Math.round(width * effective)));
        canvasHeight.set.call(canvas, Math.max(1, Math.round(requestedHeight * effective)));
      },
    });
  }

  Document.prototype.createElement = function minimalExportCreateElement(tagName, options) {
    const element = previousCreateElement.call(this, tagName, options);
    if (resolutionArmed && String(tagName).toLowerCase() === 'canvas' && element instanceof HTMLCanvasElement) {
      resolutionArmed = false;
      prepareResolutionCanvas(element);
    }
    return element;
  };

  function makeMenu(id, label) {
    const details = document.createElement('details');
    details.id = id;
    details.className = 'minimal-tool-menu';
    const summary = document.createElement('summary');
    summary.textContent = label;
    const panel = document.createElement('div');
    panel.className = 'minimal-tool-panel';
    details.append(summary, panel);
    return { details, panel };
  }

  function installExportSettings(panel) {
    const settings = document.createElement('div');
    settings.className = 'minimal-export-settings';
    settings.innerHTML = `
      <label class="minimal-field minimal-title-field">
        <span>Title</span>
        <input id="export-title-text" type="text" maxlength="140" autocomplete="off" aria-label="Export title text" />
      </label>
      <button id="export-title-default" class="toolbar-button compact" type="button" title="Use the active curriculum title">Default</button>
      <label class="minimal-field minimal-resolution-field">
        <span>Resolution</span>
        <select id="export-resolution-level" aria-label="PNG export resolution">
          <option value="1">Standard · 1×</option>
          <option value="2">High · 2×</option>
          <option value="3">Ultra · 3×</option>
          <option value="4">Maximum · 4×</option>
        </select>
      </label>`;
    panel.prepend(settings);

    titleInput = settings.querySelector('#export-title-text');
    scaleSelect = settings.querySelector('#export-resolution-level');
    defaultTitleButton = settings.querySelector('#export-title-default');
    syncControls();

    titleInput?.addEventListener('change', () => {
      const value = titleInput.value.trim();
      saveConfig({ ...config(), title: value === curriculumTitle() ? '' : value });
      window.CurriculumFlowchartRuntime?.setHint?.(`Export title set to “${resolvedTitle()}”.`);
    });
    titleInput?.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); titleInput.blur(); }
    });
    defaultTitleButton?.addEventListener('click', () => {
      saveConfig({ ...config(), title: '' });
      window.CurriculumFlowchartRuntime?.setHint?.('Export title reset to the active curriculum title.');
    });
    scaleSelect?.addEventListener('change', () => {
      const scale = clamp(Number(scaleSelect.value) || DEFAULT_SCALE, 1, MAX_SCALE);
      saveConfig({ ...config(), scale });
      window.CurriculumFlowchartRuntime?.setHint?.(`PNG export resolution set to ${scale}×.`);
    });
  }

  function installMinimalToolbar() {
    const toolbar = document.querySelector('.flow-toolbar .toolbar-scroll');
    if (!(toolbar instanceof HTMLElement) || document.querySelector('#minimal-toolbar-shell')) return;

    const shell = document.createElement('div');
    shell.id = 'minimal-toolbar-shell';
    shell.className = 'minimal-toolbar-shell';
    const layout = makeMenu('minimal-menu-layout', 'Layout');
    const display = makeMenu('minimal-menu-display', 'Display');
    const routing = makeMenu('minimal-menu-routing', 'Routing');
    const view = makeMenu('minimal-menu-view', 'View');
    const exportMenu = makeMenu('minimal-menu-export', 'Export');
    const more = makeMenu('minimal-menu-more', 'More');
    shell.append(layout.details, display.details, routing.details, view.details, exportMenu.details, more.details);
    toolbar.prepend(shell);

    const moved = new Set();
    const moveGroup = (selector, panel) => {
      const element = toolbar.querySelector(selector);
      const group = element?.closest('.toolbar-group');
      if (!(group instanceof HTMLElement) || moved.has(group)) return;
      moved.add(group);
      panel.append(group);
    };
    const moveElement = (selector, panel) => {
      toolbar.querySelectorAll(selector).forEach(element => {
        if (!(element instanceof HTMLElement) || shell.contains(element)) return;
        panel.append(element);
      });
    };

    moveGroup('#auto-layout', layout.panel);
    moveGroup('#multi-select-toggle', layout.panel);
    moveGroup('[data-align]', layout.panel);
    moveGroup('#display-code-toggle', display.panel);
    moveGroup('#manual-route-toolbar', routing.panel);
    moveElement('.vertical-lane-spacing-control', routing.panel);
    moveElement('.horizontal-lane-spacing-control', routing.panel);
    moveElement('.line-visual-mode-controls', routing.panel);
    moveGroup('#zoom-out', view.panel);
    moveGroup('#download-image', exportMenu.panel);

    [...toolbar.children].forEach(child => {
      if (child === shell || !(child instanceof HTMLElement)) return;
      more.panel.append(child);
    });
    if (!more.panel.children.length) more.details.remove();

    const download = document.querySelector('#download-image');
    if (download instanceof HTMLButtonElement) {
      download.textContent = 'PNG';
      download.title = 'Download the current flowchart as PNG using the title and resolution above';
      download.addEventListener('click', () => {
        resolutionArmed = true;
        window.setTimeout(() => { resolutionArmed = false; }, 1200);
      }, true);
    }
    const saveJson = document.querySelector('#save-flow-state-json');
    const loadJson = document.querySelector('#load-flow-state-json');
    if (saveJson instanceof HTMLButtonElement) saveJson.textContent = 'Save state';
    if (loadJson instanceof HTMLButtonElement) loadJson.textContent = 'Load state';

    installExportSettings(exportMenu.panel);

    shell.querySelectorAll('.minimal-tool-menu').forEach(details => {
      details.addEventListener('toggle', () => {
        if (!(details instanceof HTMLDetailsElement) || !details.open) return;
        shell.querySelectorAll('.minimal-tool-menu[open]').forEach(other => {
          if (other !== details && other instanceof HTMLDetailsElement) other.open = false;
        });
      });
    });
    document.addEventListener('pointerdown', event => {
      if (!(event.target instanceof Node) || shell.contains(event.target)) return;
      shell.querySelectorAll('.minimal-tool-menu[open]').forEach(item => { if (item instanceof HTMLDetailsElement) item.open = false; });
    }, true);
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      shell.querySelectorAll('.minimal-tool-menu[open]').forEach(item => { if (item instanceof HTMLDetailsElement) item.open = false; });
    });
  }

  const style = document.createElement('style');
  style.id = 'minimal-export-ui-style';
  style.textContent = `
    .flow-toolbar{position:relative;z-index:30;overflow:visible!important}
    .flow-toolbar .toolbar-scroll{overflow:visible!important;padding:2px 0 5px;min-height:40px}
    .minimal-toolbar-shell{display:flex;align-items:center;gap:5px;flex-wrap:wrap;width:100%}
    .minimal-tool-menu{position:relative;margin:0}
    .minimal-tool-menu>summary{list-style:none;cursor:pointer;user-select:none;min-height:34px;display:inline-flex;align-items:center;justify-content:center;padding:6px 10px;border:1px solid #d8deea;border-radius:8px;background:#fff;color:#344054;font-size:.78rem;font-weight:750;line-height:1}
    .minimal-tool-menu>summary::-webkit-details-marker{display:none}
    .minimal-tool-menu>summary::after{content:'›';font-size:.92rem;margin-left:6px;transform:rotate(90deg);transition:transform .12s ease;color:#667085}
    .minimal-tool-menu[open]>summary{background:#f5f7fb;border-color:#b9c4d6;color:#1f3d78}
    .minimal-tool-menu[open]>summary::after{transform:rotate(-90deg)}
    .minimal-tool-menu:not([open])>.minimal-tool-panel{display:none!important}
    .minimal-tool-panel{position:absolute;top:calc(100% + 7px);left:0;z-index:200;display:grid;gap:8px;min-width:240px;max-width:min(520px,calc(100vw - 28px));max-height:68vh;overflow:auto;padding:10px;border:1px solid #dce2ec;border-radius:11px;background:rgba(255,255,255,.98);box-shadow:0 14px 36px rgba(20,34,58,.16)}
    #minimal-menu-export .minimal-tool-panel{left:auto;right:0;min-width:330px}
    .minimal-tool-panel>.toolbar-group{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:0;border:0;background:transparent}
    .minimal-tool-panel .toolbar-label{display:none!important}
    .minimal-tool-panel .toolbar-button,.minimal-tool-panel .switch{font-size:.76rem}
    .minimal-tool-panel .vertical-lane-spacing-control,.minimal-tool-panel .horizontal-lane-spacing-control,.minimal-tool-panel .line-visual-mode-controls,.minimal-tool-panel .term-layout-controls{margin:0}
    .minimal-export-settings{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px;align-items:end;padding-bottom:8px;border-bottom:1px solid #e7ebf2}
    .minimal-field{display:grid;gap:4px;color:#475467;font-size:.7rem;font-weight:750}
    .minimal-title-field{grid-column:1/2}
    .minimal-resolution-field{grid-column:1/-1}
    #export-title-text,#export-resolution-level{width:100%;min-height:36px;border:1px solid #d8deea;border-radius:8px;padding:6px 8px;background:#fff;color:#172033;font:inherit;font-size:.78rem}
    #export-title-default{align-self:end;min-height:36px}
    #minimal-menu-export .toolbar-group{justify-content:flex-start}
    @media(max-width:760px){
      .minimal-toolbar-shell{gap:4px;flex-wrap:nowrap}
      .minimal-tool-menu>summary{min-height:38px;padding:7px 8px;font-size:.72rem}
      .minimal-tool-menu>summary::after{margin-left:4px}
      .minimal-tool-panel{max-width:min(350px,calc(100vw - 24px));min-width:220px;max-height:60vh}
      #minimal-menu-export .minimal-tool-panel{min-width:min(330px,calc(100vw - 24px))}
    }
  `;
  document.head.append(style);

  installMinimalToolbar();
  syncControls();

  const titleObserver = new MutationObserver(mutations => {
    if (mutations.some(mutation => mutation.type === 'attributes' && mutation.attributeName === 'data-curriculum-title')) syncControls();
  });
  titleObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-curriculum-title'] });
})();
