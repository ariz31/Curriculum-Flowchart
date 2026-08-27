(() => {
  const NativeMutationObserver = window.MutationObserver;
  if (!NativeMutationObserver || window.__curriculumFilteredMutationObserver) return;

  const isInteractionLayerNode = node => {
    if (!(node instanceof Element)) return false;
    return node.id === 'manual-route-interaction-layer' || Boolean(node.closest?.('#manual-route-interaction-layer'));
  };

  const interactionOnlyMutation = mutation => {
    if (mutation.type !== 'childList') return false;
    const target = mutation.target;
    if (!(target instanceof Element)) return false;
    const insideConnections = target.id === 'connections-svg' || Boolean(target.closest?.('#connections-svg'));
    if (!insideConnections) return false;
    if (target.id === 'manual-route-interaction-layer' || target.closest?.('#manual-route-interaction-layer')) return true;
    const changed = [...mutation.addedNodes, ...mutation.removedNodes];
    return changed.length > 0 && changed.every(isInteractionLayerNode);
  };

  class FilteredMutationObserver extends NativeMutationObserver {
    constructor(callback) {
      super((mutations, observer) => {
        const relevant = mutations.filter(mutation => !interactionOnlyMutation(mutation));
        if (relevant.length) callback(relevant, observer);
      });
    }
  }

  window.MutationObserver = FilteredMutationObserver;
  window.__curriculumFilteredMutationObserver = true;
})();
