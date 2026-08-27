(() => {
  const NativeBlob = window.Blob;
  const NativeCreateElement = Document.prototype.createElement;
  const canvasWidth = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width');
  const canvasHeight = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'height');
  const EXPORT_EXTRA_SCALE = 2;
  const MAX_EXPORT_DIMENSION = 16384;
  let highResolutionExportArmed = false;

  function addExportLegend(svgText) {
    try {
      const documentXml = new DOMParser().parseFromString(svgText, 'image/svg+xml');
      const root = documentXml.documentElement;
      if (root.querySelector('#export-legend')) return svgText;

      const viewBox = (root.getAttribute('viewBox') || '').trim().split(/\s+/).map(Number);
      const width = Number(root.getAttribute('width')) || (viewBox.length === 4 ? viewBox[2] : 0);
      const height = Number(root.getAttribute('height')) || (viewBox.length === 4 ? viewBox[3] : 0);
      if (!width || !height) return svgText;

      const legendWidth = 236;
      const legendHeight = 92;
      const margin = 18;
      const x = Math.max(margin, width - legendWidth - margin);
      const y = Math.max(108, height - legendHeight - margin);
      const ns = 'http://www.w3.org/2000/svg';
      const group = documentXml.createElementNS(ns, 'g');
      group.setAttribute('id', 'export-legend');
      group.setAttribute('aria-label', 'Relationship legend');

      const background = documentXml.createElementNS(ns, 'rect');
      background.setAttribute('x', String(x));
      background.setAttribute('y', String(y));
      background.setAttribute('width', String(legendWidth));
      background.setAttribute('height', String(legendHeight));
      background.setAttribute('rx', '8');
      background.setAttribute('fill', '#ffffff');
      background.setAttribute('fill-opacity', '0.96');
      background.setAttribute('stroke', '#c8d0dc');
      background.setAttribute('stroke-width', '1');
      group.append(background);

      const makeText = (text, tx, ty, size = 10.5, weight = '400') => {
        const element = documentXml.createElementNS(ns, 'text');
        element.setAttribute('x', String(tx));
        element.setAttribute('y', String(ty));
        element.setAttribute('font-family', 'Arial,sans-serif');
        element.setAttribute('font-size', String(size));
        element.setAttribute('font-weight', weight);
        element.setAttribute('fill', '#172033');
        element.textContent = text;
        return element;
      };

      group.append(makeText('Legend', x + 12, y + 18, 11.5, '700'));

      const lineX1 = x + 14;
      const lineX2 = x + 67;
      const rows = [y + 38, y + 58, y + 78];

      const prerequisite = documentXml.createElementNS(ns, 'path');
      prerequisite.setAttribute('d', `M ${lineX1} ${rows[0]} H ${lineX2}`);
      prerequisite.setAttribute('fill', 'none');
      prerequisite.setAttribute('stroke', '#29384f');
      prerequisite.setAttribute('stroke-width', '1.5');
      prerequisite.setAttribute('marker-end', 'url(#export-arrow)');
      group.append(prerequisite);
      group.append(makeText('Prerequisite', x + 80, rows[0] + 3.5));

      const elective = documentXml.createElementNS(ns, 'path');
      elective.setAttribute('d', `M ${lineX1} ${rows[1]} H ${lineX2}`);
      elective.setAttribute('fill', 'none');
      elective.setAttribute('stroke', '#29384f');
      elective.setAttribute('stroke-width', '1.5');
      elective.setAttribute('stroke-dasharray', '7 5');
      elective.setAttribute('marker-end', 'url(#export-arrow)');
      group.append(elective);
      group.append(makeText('Prerequisite (elective)', x + 80, rows[1] + 3.5));

      const coreqTop = documentXml.createElementNS(ns, 'path');
      coreqTop.setAttribute('d', `M ${lineX1} ${rows[2] - 2.5} H ${lineX2}`);
      coreqTop.setAttribute('fill', 'none');
      coreqTop.setAttribute('stroke', '#d92d20');
      coreqTop.setAttribute('stroke-width', '1.8');
      group.append(coreqTop);

      const coreqBottom = documentXml.createElementNS(ns, 'path');
      coreqBottom.setAttribute('d', `M ${lineX1} ${rows[2] + 2.5} H ${lineX2}`);
      coreqBottom.setAttribute('fill', 'none');
      coreqBottom.setAttribute('stroke', '#d92d20');
      coreqBottom.setAttribute('stroke-width', '1.8');
      group.append(coreqBottom);
      group.append(makeText('Corequisite', x + 80, rows[2] + 3.5));

      root.append(group);
      return new XMLSerializer().serializeToString(root);
    } catch {
      return svgText;
    }
  }

  function prepareHighResolutionCanvas(canvas) {
    if (!canvasWidth?.get || !canvasWidth?.set || !canvasHeight?.get || !canvasHeight?.set) return;
    let requestedWidth = 0;
    let requestedHeight = 0;

    Object.defineProperty(canvas, 'width', {
      configurable: true,
      get() {
        return canvasWidth.get.call(canvas);
      },
      set(value) {
        requestedWidth = Math.max(1, Number(value) || 1);
        canvasWidth.set.call(canvas, requestedWidth);
      },
    });

    Object.defineProperty(canvas, 'height', {
      configurable: true,
      get() {
        return canvasHeight.get.call(canvas);
      },
      set(value) {
        requestedHeight = Math.max(1, Number(value) || 1);
        const width = Math.max(1, requestedWidth || canvasWidth.get.call(canvas));
        const scale = Math.max(
          1,
          Math.min(
            EXPORT_EXTRA_SCALE,
            MAX_EXPORT_DIMENSION / width,
            MAX_EXPORT_DIMENSION / requestedHeight,
          ),
        );
        canvasWidth.set.call(canvas, Math.max(1, Math.round(width * scale)));
        canvasHeight.set.call(canvas, Math.max(1, Math.round(requestedHeight * scale)));
      },
    });
  }

  Document.prototype.createElement = function patchedCreateElement(tagName, options) {
    const element = NativeCreateElement.call(this, tagName, options);
    if (highResolutionExportArmed && String(tagName).toLowerCase() === 'canvas' && element instanceof HTMLCanvasElement) {
      highResolutionExportArmed = false;
      prepareHighResolutionCanvas(element);
    }
    return element;
  };

  document.querySelector('#download-image')?.addEventListener('click', () => {
    highResolutionExportArmed = true;
    window.setTimeout(() => { highResolutionExportArmed = false; }, 1000);
  }, true);

  class LegendBlob extends NativeBlob {
    constructor(parts, options) {
      let nextParts = parts;
      if (
        options?.type?.startsWith('image/svg+xml') &&
        parts?.length === 1 &&
        typeof parts[0] === 'string' &&
        parts[0].includes('export-arrow')
      ) {
        nextParts = [addExportLegend(parts[0])];
      }
      super(nextParts, options);
    }
  }

  window.Blob = LegendBlob;

  function installFullscreenCanvas() {
    const flowPanel = document.querySelector('#flow-panel');
    const zoomGroup = document.querySelector('.zoom-group');
    if (!(flowPanel instanceof HTMLElement) || !(zoomGroup instanceof HTMLElement) || document.querySelector('#fullscreen-canvas')) return;

    const style = document.createElement('style');
    style.textContent = `
      #flow-panel:fullscreen,
      #flow-panel.flow-panel-fallback-fullscreen {
        width: 100vw !important;
        height: 100vh !important;
        max-width: none !important;
        margin: 0 !important;
        padding: 10px !important;
        background: #ffffff;
        overflow: hidden !important;
        display: flex !important;
        flex-direction: column;
      }
      #flow-panel:fullscreen .flow-toolbar,
      #flow-panel:fullscreen .flow-help,
      #flow-panel:fullscreen .semester-shade-key,
      #flow-panel.flow-panel-fallback-fullscreen .flow-toolbar,
      #flow-panel.flow-panel-fallback-fullscreen .flow-help,
      #flow-panel.flow-panel-fallback-fullscreen .semester-shade-key {
        flex: 0 0 auto;
      }
      #flow-panel:fullscreen .canvas-viewport,
      #flow-panel.flow-panel-fallback-fullscreen .canvas-viewport {
        flex: 1 1 auto;
        height: auto !important;
        min-height: 0 !important;
        max-height: none !important;
        border-radius: 8px;
      }
      #flow-panel.flow-panel-fallback-fullscreen {
        position: fixed !important;
        inset: 0 !important;
        z-index: 10000 !important;
      }
      body.flow-panel-fallback-active {
        overflow: hidden !important;
      }
      @media (max-width: 760px) {
        #flow-panel:fullscreen,
        #flow-panel.flow-panel-fallback-fullscreen {
          padding: 6px !important;
        }
        #flow-panel:fullscreen .flow-toolbar,
        #flow-panel.flow-panel-fallback-fullscreen .flow-toolbar {
          margin-left: 0 !important;
          margin-right: 0 !important;
        }
      }
    `;
    document.head.append(style);

    const button = document.createElement('button');
    button.id = 'fullscreen-canvas';
    button.className = 'toolbar-button';
    button.type = 'button';
    button.textContent = 'Full screen';
    button.title = 'Open the curriculum canvas and tools in full screen';
    button.setAttribute('aria-label', 'Open curriculum canvas in full screen');
    button.setAttribute('aria-pressed', 'false');
    zoomGroup.append(button);

    const fallbackClass = 'flow-panel-fallback-fullscreen';
    const fallbackBodyClass = 'flow-panel-fallback-active';
    const nativeFullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
    const isActive = () => nativeFullscreenElement() === flowPanel || flowPanel.classList.contains(fallbackClass);

    const notifyResize = () => {
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event('resize'));
        requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
      });
    };

    const updateButton = () => {
      const active = isActive();
      button.textContent = active ? 'Exit full screen' : 'Full screen';
      button.setAttribute('aria-label', active ? 'Exit full screen curriculum canvas' : 'Open curriculum canvas in full screen');
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('active', active);
      notifyResize();
    };

    const enterFallback = () => {
      flowPanel.classList.add(fallbackClass);
      document.body.classList.add(fallbackBodyClass);
      updateButton();
    };

    const exitFallback = () => {
      flowPanel.classList.remove(fallbackClass);
      document.body.classList.remove(fallbackBodyClass);
      updateButton();
    };

    button.addEventListener('click', async () => {
      if (flowPanel.classList.contains(fallbackClass)) {
        exitFallback();
        return;
      }

      if (nativeFullscreenElement() === flowPanel) {
        try {
          if (document.exitFullscreen) await document.exitFullscreen();
          else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        } catch {
          exitFallback();
        }
        return;
      }

      try {
        if (flowPanel.requestFullscreen) await flowPanel.requestFullscreen({ navigationUI: 'hide' });
        else if (flowPanel.webkitRequestFullscreen) flowPanel.webkitRequestFullscreen();
        else enterFallback();
      } catch {
        enterFallback();
      }
    });

    document.addEventListener('fullscreenchange', updateButton);
    document.addEventListener('webkitfullscreenchange', updateButton);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && flowPanel.classList.contains(fallbackClass)) exitFallback();
    });
    window.addEventListener('orientationchange', notifyResize);
  }

  installFullscreenCanvas();
})();
