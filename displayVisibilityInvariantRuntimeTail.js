
;(() => {
  const DISPLAY_TOGGLES = [
    ['#display-code-toggle', 'hide-node-code'],
    ['#display-description-toggle', 'hide-node-description'],
    ['#display-units-toggle', 'hide-node-units'],
    ['#display-track-toggle', 'hide-node-track'],
  ];

  function installStyles() {
    if (document.querySelector('#display-visibility-invariant-style')) return;
    const style = document.createElement('style');
    style.id = 'display-visibility-invariant-style';
    style.textContent = `
      #flow-panel.hide-node-code .node-code{display:none!important}
      #flow-panel.hide-node-description .node-title{display:none!important}
      #flow-panel.hide-node-units .node-units{display:none!important}
      #flow-panel.hide-node-track .node-track,
      #flow-panel.hide-node-track .node-track-separator{display:none!important}
      #flow-panel.hide-node-units .node-track-separator{display:none!important}
      #flow-panel.hide-node-units.hide-node-track .node-meta{display:none!important}
    `;
    document.head.append(style);
  }

  function applyVisibility() {
    const panel = document.querySelector('#flow-panel');
    if (!(panel instanceof HTMLElement)) return;
    for (const [selector, className] of DISPLAY_TOGGLES) {
      const input = document.querySelector(selector);
      if (!(input instanceof HTMLInputElement)) continue;
      panel.classList.toggle(className, !input.checked);
    }
  }

  let refreshFrame = 0;
  function refreshLayout() {
    applyVisibility();
    if (refreshFrame) cancelAnimationFrame(refreshFrame);
    refreshFrame = requestAnimationFrame(() => {
      refreshFrame = 0;
      window.CurriculumNodeDimensions?.refresh?.();
      window.CurriculumConnectorInvariants?.request?.();
      window.CurriculumConnectorSemanticInvariants?.request?.();
    });
  }

  installStyles();
  applyVisibility();

  for (const [selector] of DISPLAY_TOGGLES) {
    document.querySelector(selector)?.addEventListener('change', refreshLayout);
  }

  const panel = document.querySelector('#flow-panel');
  if (panel instanceof HTMLElement) {
    new MutationObserver(mutations => {
      if (mutations.some(mutation => mutation.type === 'childList')) applyVisibility();
    }).observe(panel, { childList: true, subtree: true });
  }

  window.CurriculumDisplayVisibility = {
    apply: applyVisibility,
    refresh: refreshLayout,
  };
})();
