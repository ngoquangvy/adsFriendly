export const BLOCKING_STRATEGIES = {
  STEALTH(el) {
    if (el.style.opacity === "0") return;
    el.style.setProperty("opacity", "0", "important");
    el.style.setProperty("visibility", "hidden", "important");
    el.style.setProperty("pointer-events", "none", "important");
  },
};

const VISIBILITY_PROPERTIES = ["opacity", "visibility", "pointer-events"];

export function captureInlineVisibility(element) {
  return Object.fromEntries(
    VISIBILITY_PROPERTIES.map((property) => [
      property,
      {
        value: element.style.getPropertyValue(property),
        priority: element.style.getPropertyPriority(property),
      },
    ]),
  );
}

export function restoreInlineVisibility(element, snapshot) {
  if (!element || !snapshot) return;
  for (const property of VISIBILITY_PROPERTIES) {
    const previous = snapshot[property];
    if (previous?.value) {
      element.style.setProperty(property, previous.value, previous.priority);
    } else {
      element.style.removeProperty(property);
    }
  }
}
