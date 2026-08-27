
;(() => {
  const STORAGE_KEY = 'curriculum-flowchart:line-visual-mode:v1';
  const CURRICULUM_LIBRARY_KEY = 'curriculum-flowchart:curricula:v1';
  const DEFAULT_COLORS = ['#2563eb', '#7c3aed', '#0f766e', '#b45309', '#0369a1', '#6d28d9', '#15803d', '#a16207', '#0e7490', '#4338ca'];

  const safeParse = value => { try { return value ? JSON.parse(value) : null; } catch { return null; } };
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const activeCurriculumId = () => String(safeParse(localStorage.getItem(CURRICULUM_LIBRARY_KEY))?.activeId || 'default');
  const validColor = value => /^#[0-9a-f]{6}$/i.test(String(value || ''));

  function allConfigs() {
    const stored = safeParse(localStorage.getItem(STORAGE_KEY));
    return stored && typeof stored === 'object' ? stored : {};
  }

  function normalizeConfig(value) {
    const colors = {};
    if (value?.colors && typeof value.colors === 'object') {
      for (const [span, color] of Object.entries(value.colors)) {
        const key = Math.max(1, Math.round(Number(span)));
        if (Number.isFinite(key) && validColor(color)) colors[key] = color;
      }
    }
    return { enabled: Boolean(value?.enabled), colors };
  }

  function config() {
    return normalizeConfig(allConfigs()[activeCurriculumId()]);
  }

  function saveConfig(next) {
    const configs = allConfigs();
    configs[activeCurriculumId()] = normalizeConfig(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
  }

  const defaultColor = span => DEFAULT_COLORS[(Math.max(1, span) - 1) % DEFAULT_COLORS.length];
  const colorFor = (span, current = config()) => current.colors[span] || defaultColor(span);

  function edgeSpan(edge, cols, pairs) {
    const source = edgeSourceColumn(edge, pairs, cols);
    const target = edgeTargetColumn(edge, cols);
    if (source < 0 || target < 0) return 0;
    return Math.abs(target - source);
  }

  function edgeData() {
    const cols = columns();
    const pairs = corequisitePairs();
    const edges = dependencyEdges(pairs);
    return { cols, pairs, edges, spans: edges.map(edge => edgeSpan(edge, cols, pairs)) };
  }

  function maxUsedSpan() {
    const spans = edgeData().spans.filter(span => span > 0);
    return Math.max(3, ...spans, 3);
  }

  let toggle = null;
  let colorsButton = null;
  let dialog = null;

  function updateLiveLegend(maxSpan, current) {
    const legend = document.querySelector('.legend');
    if (!(legend instanceof HTMLElement)) return;
    let host = legend.querySelector('#term-span-color-legend');
    if (!current.enabled) {
      host?.remove();
      return;
    }
    if (!(host instanceof HTMLElement)) {
      host = document.createElement('span');
      host.id = 'term-span-color-legend';
      host.className = 'term-span-color-legend';
      legend.append(host);
    }
    host.innerHTML = Array.from({ length: maxSpan }, (_, index) => {
      const span = index + 1;
      return `<span class="term-span-key"><i style="background:${escapeHtml(colorFor(span, current))}"></i>${span} term${span === 1 ? '' : 's'}</span>`;
    }).join('');
  }

  function applyLiveColors() {
    const current = config();
    if (toggle instanceof HTMLInputElement) toggle.checked = current.enabled;
    if (colorsButton instanceof HTMLButtonElement) colorsButton.disabled = !current.enabled;

    const svgElement = document.querySelector('#connections-svg');
    if (!(svgElement instanceof SVGSVGElement)) return;
    const paths = [...svgElement.querySelectorAll('path.relationship')];
    const { edges, spans } = edgeData();
    const maxSpan = Math.max(3, ...spans.filter(span => span > 0), 3);

    paths.forEach((path, index) => {
      const span = spans[index] || 0;
      path.dataset.termSpan = String(span);
      if (current.enabled && span > 0) {
        path.style.stroke = colorFor(span, current);
      } else {
        path.style.removeProperty('stroke');
      }
      path.setAttribute('aria-label', span > 0 ? `${span}-term relationship span` : 'same-term relationship');
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

    updateLiveLegend(maxSpan, current);
  }

  function buildColorRows() {
    if (!(dialog instanceof HTMLDialogElement)) return;
    const rows = dialog.querySelector('.line-color-rows');
    if (!(rows instanceof HTMLElement)) return;
    const current = config();
    const maxSpan = maxUsedSpan();
    rows.innerHTML = Array.from({ length: maxSpan }, (_, index) => {
      const span = index + 1;
      const color = colorFor(span, current);
      return `<label class="line-color-row">
        <span>${span} term${span === 1 ? '' : 's'} apart</span>
        <input type="color" data-term-span-color="${span}" value="${escapeHtml(color)}" aria-label="Color for relationships spanning ${span} term${span === 1 ? '' : 's'}" />
        <code>${escapeHtml(color.toUpperCase())}</code>
      </label>`;
    }).join('');
  }

  function ensureDialog() {
    if (dialog instanceof HTMLDialogElement) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'line-visual-color-dialog';
    dialog.className = 'line-visual-color-dialog';
    dialog.innerHTML = `
      <form method="dialog" class="line-visual-color-form">
        <div class="line-visual-color-heading">
          <div><strong>Relationship colors by term distance</strong><p>Each prerequisite/elective line is colored by the number of curriculum term columns it spans.</p></div>
          <button class="icon-button" type="submit" aria-label="Close color settings">×</button>
        </div>
        <div class="line-color-rows"></div>
        <div class="line-color-actions">
          <button type="button" class="secondary-button" data-reset-line-colors>Reset colors</button>
          <button type="submit" class="primary-button">Done</button>
        </div>
      </form>`;
    document.body.append(dialog);

    dialog.addEventListener('input', event => {
      const input = event.target instanceof HTMLInputElement ? event.target.closest('input[data-term-span-color]') : null;
      if (!(input instanceof HTMLInputElement)) return;
      const span = Number(input.dataset.termSpanColor);
      if (!Number.isFinite(span) || span < 1 || !validColor(input.value)) return;
      const current = config();
      current.colors[span] = input.value;
      saveConfig(current);
      const code = input.parentElement?.querySelector('code');
      if (code) code.textContent = input.value.toUpperCase();
      applyLiveColors();
      window.CurriculumFlowchartRuntime?.setHint?.(`Color for ${span}-term relationship spans updated.`);
    });

    dialog.querySelector('[data-reset-line-colors]')?.addEventListener('click', () => {
      const current = config();
      current.colors = {};
      saveConfig(current);
      buildColorRows();
      applyLiveColors();
      window.CurriculumFlowchartRuntime?.setHint?.('Relationship span colors reset to defaults.');
    });
    return dialog;
  }

  function installControls() {
    if (document.querySelector('#line-visual-mode-toggle')) return;
    const horizontalInput = document.querySelector('#horizontal-lane-spacing');
    const verticalInput = document.querySelector('#vertical-lane-spacing');
    const anchor = horizontalInput?.closest('label') || verticalInput?.closest('label') || document.querySelector('#snap-toggle')?.closest('label');
    if (!(anchor instanceof HTMLElement)) return;

    const group = document.createElement('span');
    group.className = 'line-visual-mode-controls';
    group.innerHTML = `
      <label class="switch line-visual-mode-switch" title="Color relationship lines by the number of term columns they span">
        <input id="line-visual-mode-toggle" type="checkbox" /> Visual lines
      </label>
      <button id="line-visual-color-settings" class="toolbar-button compact" type="button">Colors</button>`;
    anchor.insertAdjacentElement('afterend', group);
    toggle = group.querySelector('#line-visual-mode-toggle');
    colorsButton = group.querySelector('#line-visual-color-settings');

    toggle?.addEventListener('change', () => {
      const current = config();
      current.enabled = Boolean(toggle.checked);
      saveConfig(current);
      applyLiveColors();
      window.CurriculumFlowchartRuntime?.setHint?.(current.enabled
        ? 'Visual line mode enabled: relationship color now shows term-span distance.'
        : 'Visual line mode disabled: relationship lines returned to their standard styling.');
    });

    colorsButton?.addEventListener('click', () => {
      const modal = ensureDialog();
      buildColorRows();
      modal.showModal();
    });

    const style = document.createElement('style');
    style.textContent = `
      .line-visual-mode-controls{display:inline-flex;align-items:center;gap:5px}
      .line-visual-mode-switch{white-space:nowrap}
      .line-visual-color-dialog{border:0;border-radius:14px;padding:0;width:min(520px,calc(100vw - 28px));max-height:84vh;box-shadow:0 24px 70px rgba(18,31,54,.28)}
      .line-visual-color-dialog::backdrop{background:rgba(15,23,42,.45)}
      .line-visual-color-form{display:grid;gap:12px;padding:16px}
      .line-visual-color-heading{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
      .line-visual-color-heading strong{font-size:1rem;color:#172033}
      .line-visual-color-heading p{margin:4px 0 0;font-size:.76rem;color:#64748b;line-height:1.35}
      .line-color-rows{display:grid;gap:6px;max-height:52vh;overflow:auto;padding-right:3px}
      .line-color-row{display:grid;grid-template-columns:minmax(0,1fr) 44px 76px;align-items:center;gap:9px;padding:7px 8px;border:1px solid #e0e6ef;border-radius:8px;font-size:.78rem;font-weight:650;color:#334155}
      .line-color-row input[type="color"]{width:42px;height:30px;padding:1px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer}
      .line-color-row code{font-size:.7rem;color:#64748b}
      .line-color-actions{display:flex;justify-content:space-between;gap:8px}
      .term-span-color-legend{display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap;margin-left:4px}
      .term-span-key{display:inline-flex;align-items:center;gap:4px;font-size:.7rem;color:#536178;white-space:nowrap}
      .term-span-key i{width:15px;height:4px;border-radius:99px;display:inline-block}
      @media(max-width:760px){.line-visual-mode-controls{gap:4px}.line-color-row{grid-template-columns:minmax(0,1fr) 42px 70px}}
    `;
    document.head.append(style);
  }

  const baseRenderFlowForLineVisualMode = renderFlow;
  renderFlow = () => {
    baseRenderFlowForLineVisualMode();
    applyLiveColors();
  };
  if (window.CurriculumFlowchartRuntime) window.CurriculumFlowchartRuntime.renderFlow = () => renderFlow();

  const baseBuildExportSvgForLineVisualMode = buildExportSvg;
  buildExportSvg = () => {
    const svgText = baseBuildExportSvgForLineVisualMode();
    const current = config();
    if (!current.enabled) return svgText;
    try {
      const documentXml = new DOMParser().parseFromString(svgText, 'image/svg+xml');
      const paths = [...documentXml.querySelectorAll('path[marker-end*="export-arrow"]')].filter(path => !path.closest('#export-legend'));
      const { spans } = edgeData();
      paths.forEach((path, index) => {
        const span = spans[index] || 0;
        path.setAttribute('data-term-span', String(span));
        if (span > 0) path.setAttribute('stroke', colorFor(span, current));
      });
      const arrow = documentXml.querySelector('#export-arrow path');
      if (arrow) {
        arrow.setAttribute('fill', '#29384f');
        arrow.setAttribute('style', 'fill:context-stroke');
      }
      return new XMLSerializer().serializeToString(documentXml.documentElement);
    } catch {
      return svgText;
    }
  };

  installControls();
  applyLiveColors();
})();
