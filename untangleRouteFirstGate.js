(() => {
  const W = 184;
  const H = 78;
  const COMPACT_H = 62;
  const CLEARANCE = 10;
  const LANE_STEP = 7;

  const number = value => Number.parseFloat(value || '0');
  const overlaps = (aLow, aHigh, bLow, bHigh) => Math.min(aHigh, bHigh) - Math.max(aLow, bLow);

  function parsePath(d) {
    const commands = [...String(d || '').matchAll(/([MHV])\s*(-?[\d.]+)(?:\s+(-?[\d.]+))?/g)];
    if (!commands.length) return [];
    const points = [];
    let x = 0;
    let y = 0;
    for (const match of commands) {
      if (match[1] === 'M') { x = number(match[2]); y = number(match[3]); }
      else if (match[1] === 'H') x = number(match[2]);
      else if (match[1] === 'V') y = number(match[2]);
      points.push({ x, y });
    }
    return points;
  }

  function segments(points) {
    const result = [];
    for (let index = 0; index < points.length - 1; index += 1) {
      const a = points[index];
      const b = points[index + 1];
      if (Math.abs(a.x - b.x) < 0.001) result.push({ kind: 'v', x: a.x, low: Math.min(a.y, b.y), high: Math.max(a.y, b.y) });
      else if (Math.abs(a.y - b.y) < 0.001) result.push({ kind: 'h', y: a.y, low: Math.min(a.x, b.x), high: Math.max(a.x, b.x) });
    }
    return result;
  }

  function liveBoxes() {
    const flowPanel = document.querySelector('#flow-panel');
    const nodes = document.querySelector('#nodes-layer');
    if (!(nodes instanceof HTMLElement)) return [];
    const height = flowPanel?.classList.contains('hide-node-units') ? COMPACT_H : H;
    return [...nodes.querySelectorAll('.course-node')].map(node => ({
      left: number(node.style.left), right: number(node.style.left) + W,
      top: number(node.style.top), bottom: number(node.style.top) + height,
    }));
  }

  function pathHitsNode(points, boxes) {
    for (let index = 0; index < points.length - 1; index += 1) {
      const a = points[index];
      const b = points[index + 1];
      for (const box of boxes) {
        const startTouches = a.x >= box.left - 1 && a.x <= box.right + 1 && a.y >= box.top - 1 && a.y <= box.bottom + 1;
        const endTouches = b.x >= box.left - 1 && b.x <= box.right + 1 && b.y >= box.top - 1 && b.y <= box.bottom + 1;
        if ((index === 0 && startTouches) || (index === points.length - 2 && endTouches)) continue;
        if (Math.abs(a.x - b.x) < 0.001) {
          const low = Math.min(a.y, b.y); const high = Math.max(a.y, b.y);
          if (a.x > box.left - CLEARANCE && a.x < box.right + CLEARANCE && low < box.bottom + CLEARANCE && high > box.top - CLEARANCE) return true;
        } else if (Math.abs(a.y - b.y) < 0.001) {
          const low = Math.min(a.x, b.x); const high = Math.max(a.x, b.x);
          if (a.y > box.top - CLEARANCE && a.y < box.bottom + CLEARANCE && low < box.right + CLEARANCE && high > box.left - CLEARANCE) return true;
        }
      }
    }
    return false;
  }

  function residualConflictScore() {
    const svg = document.querySelector('#connections-svg');
    if (!(svg instanceof SVGSVGElement)) return 0;
    const boxes = liveBoxes();
    const paths = [...svg.querySelectorAll('path.relationship')].map(path => parsePath(path.getAttribute('d') || '')).filter(points => points.length >= 2);
    let score = 0;
    for (const points of paths) if (pathHitsNode(points, boxes)) score += 320;
    const all = paths.map(segments);
    for (let i = 0; i < all.length; i += 1) {
      for (let j = i + 1; j < all.length; j += 1) {
        for (const a of all[i]) {
          for (const b of all[j]) {
            if (a.kind === 'v' && b.kind === 'v') {
              const overlap = overlaps(a.low, a.high, b.low, b.high);
              if (overlap > 1 && Math.abs(a.x - b.x) < 0.75) score += 600;
              else if (overlap > 1 && Math.abs(a.x - b.x) < LANE_STEP - 0.5) score += 90;
            } else if (a.kind === 'h' && b.kind === 'h') {
              const overlap = overlaps(a.low, a.high, b.low, b.high);
              if (overlap > 1 && Math.abs(a.y - b.y) < 0.75) score += 420;
            } else {
              const vertical = a.kind === 'v' ? a : b;
              const horizontal = a.kind === 'h' ? a : b;
              if (vertical.x > horizontal.low + 0.5 && vertical.x < horizontal.high - 0.5 && horizontal.y > vertical.low + 0.5 && horizontal.y < vertical.high - 0.5) score += 24;
            }
          }
        }
      }
    }
    return score;
  }

  document.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest('#untangle-current-layout');
    if (!(button instanceof HTMLButtonElement)) return;
    const untangle = window.CurriculumUntangleV2;
    if (!untangle) return;

    untangle.setActive(true);
    untangle.runPropagation();
    const residual = residualConflictScore();
    if (residual >= 180) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    window.CurriculumFlowchartRuntime?.setHint(
      residual > 0
        ? 'Untangle resolved the meaningful conflict through connector routing only; node positions were preserved.'
        : 'Untangle found no severe unresolved conflict. Node positions were preserved.'
    );
  }, true);
})();
