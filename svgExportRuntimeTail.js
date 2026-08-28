
;(() => {
  const LIBRARY_KEY = 'curriculum-flowchart:curricula:v1';

  const safeParse = value => { try { return value ? JSON.parse(value) : null; } catch { return null; } };

  function activeTitle() {
    const configured = window.CurriculumExportSettings?.getTitle?.();
    const library = safeParse(localStorage.getItem(LIBRARY_KEY));
    const activeId = String(library?.activeId || 'default');
    const profile = Array.isArray(library?.profiles)
      ? library.profiles.find(item => String(item?.id) === activeId)
      : null;
    return String(
      configured ||
      profile?.title ||
      document.documentElement.dataset.curriculumTitle ||
      window.__CURRICULUM_TITLE__ ||
      'Curriculum Flowchart'
    ).trim() || 'Curriculum Flowchart';
  }

  function safeFilename(value) {
    const normalized = String(value || 'curriculum-flowchart')
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
    return normalized || 'curriculum-flowchart';
  }

  function ensureXmlDeclaration(svgText) {
    const text = String(svgText || '').trim();
    if (!text) return text;
    return text.startsWith('<?xml')
      ? text
      : `<?xml version="1.0" encoding="UTF-8"?>\n${text}`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1200);
  }

  function exportSvgText() {
    // buildExportSvg is already wrapped by the routing, visual-line, legend and other
    // export runtimes. Using the final function keeps SVG geometry identical to PNG export.
    return ensureXmlDeclaration(buildExportSvg());
  }

  function downloadSvg() {
    const button = document.querySelector('#download-svg');
    const previousText = button instanceof HTMLButtonElement ? button.textContent : null;
    if (button instanceof HTMLButtonElement) {
      button.disabled = true;
      button.textContent = 'Preparing…';
    }

    try {
      const svgText = exportSvgText();
      if (!svgText) throw new Error('Could not build the SVG export.');

      // Deliberately use the application's current Blob constructor. Existing export Blob
      // decorators add the title, legend and final export-time connector corrections here,
      // so the vector file matches the PNG composition without rasterization.
      const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
      const filename = `${safeFilename(activeTitle())}-${new Date().toISOString().slice(0, 10)}.svg`;
      downloadBlob(blob, filename);
      window.CurriculumFlowchartRuntime?.setHint?.('Vector SVG exported. It can be scaled without raster resolution loss.');
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : 'SVG export failed.';
      window.CurriculumFlowchartRuntime?.setHint?.(message);
      alert(message);
    } finally {
      if (button instanceof HTMLButtonElement) {
        button.disabled = false;
        button.textContent = previousText || 'SVG';
      }
    }
  }

  function installControl() {
    if (document.querySelector('#download-svg')) return;
    const png = document.querySelector('#download-image');
    const group = png?.closest('.toolbar-group');
    if (!(png instanceof HTMLButtonElement) || !(group instanceof HTMLElement)) return;

    const button = document.createElement('button');
    button.id = 'download-svg';
    button.className = 'toolbar-button';
    button.type = 'button';
    button.textContent = 'SVG';
    button.title = 'Export the complete flowchart as a resolution-independent vector SVG';
    button.setAttribute('aria-label', 'Export flowchart as SVG');
    png.insertAdjacentElement('afterend', button);
    button.addEventListener('click', downloadSvg);
  }

  window.CurriculumSvgExport = {
    download: downloadSvg,
    build: exportSvgText,
  };

  installControl();
})();
