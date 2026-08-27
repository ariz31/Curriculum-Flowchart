(() => {
  const NativeBlob = window.Blob;

  const activeTitle = () => {
    const fromDataset = document.documentElement.dataset.curriculumTitle;
    const fromGlobal = window.__CURRICULUM_TITLE__;
    return String(fromDataset || fromGlobal || 'Curriculum Flowchart').trim() || 'Curriculum Flowchart';
  };

  function addExportTitle(svgText) {
    try {
      const documentXml = new DOMParser().parseFromString(svgText, 'image/svg+xml');
      const root = documentXml.documentElement;
      if (root.querySelector('#export-curriculum-title')) return svgText;

      const viewBox = (root.getAttribute('viewBox') || '').trim().split(/\s+/).map(Number);
      const width = Number(root.getAttribute('width')) || (viewBox.length === 4 ? viewBox[2] : 0);
      if (!width) return svgText;

      const ns = 'http://www.w3.org/2000/svg';
      const group = documentXml.createElementNS(ns, 'g');
      group.setAttribute('id', 'export-curriculum-title');
      group.setAttribute('aria-label', 'Curriculum title');

      const background = documentXml.createElementNS(ns, 'rect');
      background.setAttribute('x', '0');
      background.setAttribute('y', '0');
      background.setAttribute('width', String(width));
      background.setAttribute('height', '17');
      background.setAttribute('fill', '#ffffff');
      background.setAttribute('fill-opacity', '0.98');
      group.append(background);

      const title = documentXml.createElementNS(ns, 'text');
      title.setAttribute('x', String(width / 2));
      title.setAttribute('y', '12.5');
      title.setAttribute('text-anchor', 'middle');
      title.setAttribute('font-family', 'Arial,sans-serif');
      title.setAttribute('font-size', '11.5');
      title.setAttribute('font-weight', '700');
      title.setAttribute('fill', '#172033');
      title.textContent = activeTitle();
      group.append(title);

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
