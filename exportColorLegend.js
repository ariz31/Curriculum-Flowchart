(() => {
  const NativeBlob = window.Blob;

  function addColorLegend(svgText) {
    try {
      const documentXml = new DOMParser().parseFromString(svgText, 'image/svg+xml');
      const root = documentXml.documentElement;
      if (root.querySelector('#export-line-color-legend')) return svgText;

      const colored = [...root.querySelectorAll('path[data-term-span]')]
        .map(path => ({
          span: Number(path.getAttribute('data-term-span')),
          color: path.getAttribute('stroke') || path.style?.stroke || '',
        }))
        .filter(item => Number.isFinite(item.span) && item.span > 0 && /^#[0-9a-f]{6}$/i.test(item.color));
      if (!colored.length) return svgText;

      const bySpan = new Map();
      colored.forEach(item => { if (!bySpan.has(item.span)) bySpan.set(item.span, item.color); });
      const items = [...bySpan.entries()].sort((a, b) => a[0] - b[0]);
      if (!items.length) return svgText;

      const viewBox = (root.getAttribute('viewBox') || '').trim().split(/\s+/).map(Number);
      const width = Number(root.getAttribute('width')) || (viewBox.length === 4 ? viewBox[2] : 0);
      const height = Number(root.getAttribute('height')) || (viewBox.length === 4 ? viewBox[3] : 0);
      if (!width || !height) return svgText;

      const ns = 'http://www.w3.org/2000/svg';
      const margin = 18;
      const legendWidth = 244;
      const rowHeight = 18;
      const legendHeight = 42 + items.length * rowHeight;
      const x = margin;
      const y = Math.max(108, height - legendHeight - margin);

      const group = documentXml.createElementNS(ns, 'g');
      group.setAttribute('id', 'export-line-color-legend');
      group.setAttribute('aria-label', 'Relationship line color legend');

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

      const makeText = (text, tx, ty, size = 10.2, weight = '400', fill = '#172033') => {
        const element = documentXml.createElementNS(ns, 'text');
        element.setAttribute('x', String(tx));
        element.setAttribute('y', String(ty));
        element.setAttribute('font-family', 'Inter,Segoe UI,Arial,sans-serif');
        element.setAttribute('font-size', String(size));
        element.setAttribute('font-weight', weight);
        element.setAttribute('fill', fill);
        element.textContent = text;
        return element;
      };

      group.append(makeText('Line color', x + 12, y + 17, 11.5, '700'));
      group.append(makeText('Relationship distance by curriculum term', x + 12, y + 31, 8.8, '400', '#667085'));

      items.forEach(([span, color], index) => {
        const rowY = y + 47 + index * rowHeight;
        const swatch = documentXml.createElementNS(ns, 'path');
        swatch.setAttribute('d', `M ${x + 14} ${rowY - 3} H ${x + 60}`);
        swatch.setAttribute('fill', 'none');
        swatch.setAttribute('stroke', color);
        swatch.setAttribute('stroke-width', '3');
        swatch.setAttribute('stroke-linecap', 'round');
        group.append(swatch);
        group.append(makeText(`${span} term${span === 1 ? '' : 's'} apart`, x + 74, rowY, 9.8, '600', '#344054'));
      });

      root.append(group);
      return new XMLSerializer().serializeToString(root);
    } catch {
      return svgText;
    }
  }

  class ColorLegendBlob extends NativeBlob {
    constructor(parts, options) {
      let nextParts = parts;
      if (
        options?.type?.startsWith('image/svg+xml') &&
        parts?.length === 1 &&
        typeof parts[0] === 'string' &&
        parts[0].includes('data-term-span')
      ) nextParts = [addColorLegend(parts[0])];
      super(nextParts, options);
    }
  }

  window.Blob = ColorLegendBlob;
})();
