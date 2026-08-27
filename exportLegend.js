(() => {
  const NativeBlob = window.Blob;

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
})();
