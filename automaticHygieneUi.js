(() => {
  const removeManualUntangle = () => {
    document.querySelector('#untangle-current-layout')?.remove();
  };

  removeManualUntangle();

  const toolbar = document.querySelector('#flow-panel');
  if (toolbar) {
    new MutationObserver(removeManualUntangle).observe(toolbar, { childList: true, subtree: true });
  }
})();
