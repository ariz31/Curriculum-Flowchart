(() => {
  const NativeBlob = window.Blob;
  const MIN_TITLE_SIZE = 26;
  const MAX_TITLE_SIZE = 40;
  const TITLE_TOP_PADDING = 10;
  const TITLE_DIVIDER_GAP = 11;
  const TITLE_CONTENT_GAP = 14;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const titleMetrics = width => {
    const safeWidth = Math.max(1, Number(width) || 1);
    const titleSize = clamp(safeWidth * 0.012, MIN_TITLE_SIZE, MAX_TITLE_SIZE);
    const titleBaseline = TITLE_TOP_PADDING + titleSize;
    const dividerY = titleBaseline + TITLE_DIVIDER_GAP;
    const titleShift = dividerY + TITLE_CONTENT_GAP;
    return { titleSize, titleBaseline, dividerY, titleShift };
  };

  const activeTitle = () => {
    const fromSettings = window.CurriculumExportSettings?.getTitle?.();
    const fromDataset = document.documentElement.dataset.curriculumTitle;
    const fromGlobal = window.__CURRICULUM_TITLE__;
    return String(fromSettings || fromDataset || fromGlobal || 'Curriculum Flowchart').trim() || 'Curriculum Flowchart';
  };

  window.CurriculumExportTitleMetrics = {
    extraHeightForWidth: width => titleMetrics(width).titleShift,
  };

  function addExportTitle(svgText) {
    try {
      const documentXml = new DOMParser().parseFromString(svgText, 'image/svg+xml');
      const root = documentXml.documentElement;
      if (root.querySelector('#export-curriculum-title')) return svgText;

      const viewBox = (root.getAttribute('viewBox') || '').trim().split(/\s+/).map(Number);
      const originalWidth = Number(root.getAttribute('width')) || (viewBox.length === 4 ? viewBox[2] : 0);
      const originalHeight = Number(root.getAttribute('height')) || (viewBox.length === 4 ? viewBox[3] : 0);
      if (!originalWidth || !originalHeight) return svgText;

      const { titleSize, titleBaseline, dividerY, titleShift } = titleMetrics(originalWidth);
      const ns = 'http://www.w3.org/2000/svg';
      const nextHeight = originalHeight + titleShift;
      root.setAttribute('height', String(nextHeight));
      root.setAttribute('viewBox', `0 0 ${originalWidth} ${nextHeight}`);

      // Move the complete chart down as a unit. Keeping defs outside the translated group
      // preserves marker/filter coordinate behavior while creating a deliberate title gap.
      const chartGroup = documentXml.createElementNS(ns, 'g');
      chartGroup.setAttribute('id', 'export-chart-content');
      chartGroup.setAttribute('transform', `translate(0 ${titleShift})`);
      const movableChildren = [...root.children].filter(child => child.tagName.toLowerCase() !== 'defs');
      movableChildren.forEach(child => chartGroup.append(child));
      root.append(chartGroup);

      const backdrop = documentXml.createElementNS(ns, 'rect');
      backdrop.setAttribute('x', '0');
      backdrop.setAttribute('y', '0');
      backdrop.setAttribute('width', String(originalWidth));
      backdrop.setAttribute('height', String(nextHeight));
      backdrop.setAttribute('fill', '#ffffff');
      root.insertBefore(backdrop, root.firstChild);

      const group = documentXml.createElementNS(ns, 'g');
      group.setAttribute('id', 'export-curriculum-title');
      group.setAttribute('aria-label', 'Curriculum title');

      const title = documentXml.createElementNS(ns, 'text');
      title.setAttribute('x', String(originalWidth / 2));
      title.setAttribute('y', String(titleBaseline));
      title.setAttribute('text-anchor', 'middle');
      title.setAttribute('font-family', 'Inter,Segoe UI,Arial,sans-serif');
      title.setAttribute('font-size', String(Number(titleSize.toFixed(2))));
      title.setAttribute('font-weight', '800');
      title.setAttribute('letter-spacing', '-0.35');
      title.setAttribute('fill', '#172033');
      title.textContent = activeTitle();
      group.append(title);

      const divider = documentXml.createElementNS(ns, 'line');
      divider.setAttribute('x1', String(Math.max(24, originalWidth * 0.07)));
      divider.setAttribute('x2', String(Math.min(originalWidth - 24, originalWidth * 0.93)));
      divider.setAttribute('y1', String(dividerY));
      divider.setAttribute('y2', String(dividerY));
      divider.setAttribute('stroke', '#e2e8f0');
      divider.setAttribute('stroke-width', '1');
      group.append(divider);

      root.append(group);
      return new XMLSerializer().serializeToString(root);
    } catch {
      return svgText;
    }
  }

  class TitledExportBlob extends NativeBlob {
    constructor(parts, options) {
      let nextParts = parts;
      if (
        options?.type?.startsWith('image/svg+xml') &&
        parts?.length === 1 &&
        typeof parts[0] === 'string' &&
        parts[0].includes('export-arrow')
      ) {
        nextParts = [addExportTitle(parts[0])];
      }
      super(nextParts, options);
    }
  }

  window.Blob = TitledExportBlob;
})();
