
;(() => {
  const flowPanelElement = document.querySelector('#flow-panel');
  const viewportElement = document.querySelector('#canvas-viewport');
  const fullscreenButton = document.querySelector('#fullscreen-canvas');
  if (!(flowPanelElement instanceof HTMLElement) || !(viewportElement instanceof HTMLElement) || !(fullscreenButton instanceof HTMLButtonElement)) return;

  const FALLBACK_CLASS = 'canvas-only-fallback';
  const ACTIVE_CLASS = 'canvas-only-active';
  const BODY_CLASS = 'canvas-only-body-active';
  let modeActive = false;
  let previousViewport = null;

  const nativeFullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
  const nativeActive = () => nativeFullscreenElement() === viewportElement;
  const fallbackActive = () => viewportElement.classList.contains(FALLBACK_CLASS);
  const isActive = () => nativeActive() || fallbackActive() || modeActive;

  const cloneViewport = () => ({
    scale: Number(state.viewport?.scale) || 1,
    x: Number(state.viewport?.x) || 0,
    y: Number(state.viewport?.y) || 0,
  });

  const updateButton = () => {
    const active = isActive();
    fullscreenButton.textContent = active ? 'Exit full canvas' : 'Full canvas';
    fullscreenButton.title = active
      ? 'Exit canvas-only full screen'
      : 'Show only the flowchart canvas in full screen and fit the entire canvas';
    fullscreenButton.setAttribute('aria-label', active
      ? 'Exit canvas-only full screen'
      : 'Open the entire flowchart canvas in full screen without tools');
    fullscreenButton.setAttribute('aria-pressed', String(active));
    fullscreenButton.classList.toggle('active', active);
  };

  const style = document.createElement('style');
  style.textContent = `
    #canvas-viewport.${ACTIVE_CLASS}:fullscreen,
    #canvas-viewport.${FALLBACK_CLASS} {
      width: 100vw !important;
      height: 100vh !important;
      min-width: 100vw !important;
      min-height: 100vh !important;
      max-width: none !important;
      max-height: none !important;
      margin: 0 !important;
      border: 0 !important;
      border-radius: 0 !important;
      background: #ffffff !important;
      overflow: hidden !important;
      touch-action: none;
    }
    #canvas-viewport.${ACTIVE_CLASS}:fullscreen {
      position: relative !important;
    }
    #canvas-viewport.${FALLBACK_CLASS} {
      position: fixed !important;
      inset: 0 !important;
      z-index: 2147483000 !important;
    }
    body.${BODY_CLASS} {
      overflow: hidden !important;
    }
    #canvas-viewport.${ACTIVE_CLASS} #manual-route-interaction-layer,
    #canvas-viewport.${FALLBACK_CLASS} #manual-route-interaction-layer {
      display: none !important;
    }
    #canvas-fullscreen-exit {
      display: none;
      position: fixed;
      top: max(12px, env(safe-area-inset-top));
      right: max(12px, env(safe-area-inset-right));
      z-index: 2147483646;
      min-width: 42px;
      min-height: 42px;
      padding: 0 12px;
      border: 1px solid rgba(15, 23, 42, .18);
      border-radius: 10px;
      background: rgba(255,255,255,.92);
      color: #172033;
      box-shadow: 0 5px 18px rgba(15,23,42,.15);
      font: 700 13px/1 system-ui,-apple-system,"Segoe UI",sans-serif;
      cursor: pointer;
      backdrop-filter: blur(8px);
    }
    #canvas-viewport.${ACTIVE_CLASS} #canvas-fullscreen-exit,
    #canvas-viewport.${FALLBACK_CLASS} #canvas-fullscreen-exit {
      display: block;
    }
    @media (max-width: 760px) {
      #canvas-fullscreen-exit {
        min-width: 46px;
        min-height: 46px;
        padding: 0 11px;
      }
    }
  `;
  document.head.append(style);

  const exitButton = document.createElement('button');
  exitButton.id = 'canvas-fullscreen-exit';
  exitButton.type = 'button';
  exitButton.textContent = 'Exit';
  exitButton.title = 'Exit full canvas';
  exitButton.setAttribute('aria-label', 'Exit full canvas');
  viewportElement.append(exitButton);

  function fitEntireCanvas() {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      updateCanvasSize();
      fitView();
      window.CurriculumConnectorGeometry?.request?.();
      window.CurriculumConnectorRouting?.request?.();
    }));
  }

  function restorePreviousViewport() {
    if (!previousViewport) return;
    state.viewport = { ...previousViewport };
    previousViewport = null;
    applyViewportTransform();
    save();
  }

  function activateVisualState() {
    modeActive = true;
    viewportElement.classList.add(ACTIVE_CLASS);
    document.body.classList.add(BODY_CLASS);
    updateButton();
    fitEntireCanvas();
  }

  function finishExit() {
    const wasActive = modeActive || fallbackActive();
    modeActive = false;
    viewportElement.classList.remove(ACTIVE_CLASS, FALLBACK_CLASS);
    document.body.classList.remove(BODY_CLASS);
    updateButton();
    if (wasActive) {
      requestAnimationFrame(() => {
        restorePreviousViewport();
        window.dispatchEvent(new Event('resize'));
      });
    }
  }

  async function enterCanvasOnly() {
    if (isActive()) return;
    previousViewport = cloneViewport();
    activateVisualState();

    try {
      if (viewportElement.requestFullscreen) {
        await viewportElement.requestFullscreen({ navigationUI: 'hide' });
        if (!nativeActive()) throw new Error('Fullscreen request did not activate the canvas.');
      } else if (viewportElement.webkitRequestFullscreen) {
        viewportElement.webkitRequestFullscreen();
        window.setTimeout(() => {
          if (!nativeActive() && modeActive) {
            viewportElement.classList.add(FALLBACK_CLASS);
            fitEntireCanvas();
          }
        }, 120);
      } else {
        viewportElement.classList.add(FALLBACK_CLASS);
      }
    } catch {
      viewportElement.classList.add(FALLBACK_CLASS);
    }

    updateButton();
    fitEntireCanvas();
  }

  async function exitCanvasOnly() {
    if (fallbackActive()) {
      finishExit();
      return;
    }
    if (nativeActive()) {
      try {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        else finishExit();
      } catch {
        finishExit();
      }
      return;
    }
    finishExit();
  }

  // Replace the earlier partial full-screen behavior with a true canvas-only mode.
  fullscreenButton.addEventListener('click', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (isActive()) void exitCanvasOnly();
    else void enterCanvasOnly();
  }, true);

  exitButton.addEventListener('pointerdown', event => {
    event.preventDefault();
    event.stopPropagation();
  }, true);
  exitButton.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    void exitCanvasOnly();
  }, true);

  const onFullscreenChange = () => {
    if (nativeActive()) {
      modeActive = true;
      viewportElement.classList.add(ACTIVE_CLASS);
      document.body.classList.add(BODY_CLASS);
      updateButton();
      fitEntireCanvas();
      return;
    }
    if (modeActive && !fallbackActive()) finishExit();
    else updateButton();
  };

  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && fallbackActive()) {
      event.preventDefault();
      exitCanvasOnly();
    }
  });
  window.addEventListener('orientationchange', () => { if (isActive()) fitEntireCanvas(); });
  window.addEventListener('resize', () => { if (isActive()) fitEntireCanvas(); });

  updateButton();
})();
