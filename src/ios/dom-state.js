// Preserve only properties changed by us; don't overwrite newer page styles.
export function createHiddenElements({ limit = 500 } = {}) {
  const hidden = new Map();
  return {
    has: (element) => hidden.has(element),
    entries: () =>
      [...hidden].map(([element, saved]) => ({
        element,
        metadata: saved.metadata,
      })),
    hide(element, metadata) {
      if (hidden.has(element) || hidden.size >= limit) return false;
      hidden.set(element, {
        value: element.style.getPropertyValue("display"),
        priority: element.style.getPropertyPriority("display"),
        metadata,
      });
      element.style.setProperty("display", "none", "important");
      return true;
    },
    restore(element) {
      const saved = hidden.get(element);
      if (!saved) return false;
      hidden.delete(element);
      if (
        element.style.getPropertyValue("display") === "none" &&
        element.style.getPropertyPriority("display") === "important"
      ) {
        if (saved.value)
          element.style.setProperty("display", saved.value, saved.priority);
        else element.style.removeProperty("display");
      }
      return true;
    },
    reconcile(keep) {
      for (const [element, saved] of hidden) {
        if (element.isConnected === false) hidden.delete(element);
        else if (!keep(element, saved.metadata)) this.restore(element);
        else if (
          element.style.getPropertyValue("display") !== "none" ||
          element.style.getPropertyPriority("display") !== "important"
        ) {
          // Keep the site's latest desired display for Undo, but enforce the
          // still-active rule when an ad script writes a new inline style.
          saved.value = element.style.getPropertyValue("display");
          saved.priority = element.style.getPropertyPriority("display");
          element.style.setProperty("display", "none", "important");
        }
      }
    },
    get size() {
      return hidden.size;
    },
  };
}
