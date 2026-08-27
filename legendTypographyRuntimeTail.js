
;(() => {
  const ensureLegendLabel = () => {
    const host = document.querySelector('#term-span-color-legend');
    if (!(host instanceof HTMLElement)) return;
    if (!host.querySelector('.term-span-legend-label')) {
      const label = document.createElement('strong');
      label.className = 'term-span-legend-label';
      label.textContent = 'Line color:';
      host.prepend(label);
    }
  };

  const style = document.createElement('style');
  style.textContent = `
    #term-span-color-legend{
      margin-left:8px !important;
      padding-left:10px;
      border-left:1px solid #d8deea;
      column-gap:9px !important;
      row-gap:5px !important;
    }
    .term-span-legend-label{
      font-size:.7rem;
      font-weight:800;
      color:#344054;
      letter-spacing:.01em;
      white-space:nowrap;
    }
    @media(max-width:760px){
      #term-span-color-legend{margin-left:0 !important;padding-left:0;border-left:0;width:100%;}
    }
  `;
  document.head.append(style);

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      ensureLegendLabel();
    });
  };

  const legend = document.querySelector('.legend');
  if (legend) new MutationObserver(schedule).observe(legend, { childList: true, subtree: true });
  schedule();
})();
