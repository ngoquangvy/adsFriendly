export const BLOCKING_STRATEGIES = {
  STEALTH(el) {
    el.setAttribute(HIDDEN_MARKER, "true");
    if (
      el.style.getPropertyValue("opacity") === "0" &&
      el.style.getPropertyValue("visibility") === "hidden"
    )
      return;
    el.style.setProperty("opacity", "0", "important");
    el.style.setProperty("visibility", "hidden", "important");
    el.style.setProperty("pointer-events", "none", "important");
  },
};

const HIDDEN_MARKER = "data-adsfriendly-rule-hidden";
const VISIBILITY_PROPERTIES = ["opacity", "visibility", "pointer-events"];

export function captureInlineVisibility(element) {
  return {
    marker: element.getAttribute(HIDDEN_MARKER),
    properties: Object.fromEntries(
      VISIBILITY_PROPERTIES.map((property) => [
        property,
        {
          value: element.style.getPropertyValue(property),
          priority: element.style.getPropertyPriority(property),
        },
      ]),
    ),
  };
}

export function restoreInlineVisibility(element, snapshot) {
  if (!element || !snapshot) return;
  // Accept snapshots captured before the marker was introduced.
  const properties = snapshot.properties || snapshot;
  for (const property of VISIBILITY_PROPERTIES) {
    const previous = properties[property];
    if (previous?.value) {
      element.style.setProperty(property, previous.value, previous.priority);
    } else {
      element.style.removeProperty(property);
    }
  }
  if (snapshot.marker == null) element.removeAttribute(HIDDEN_MARKER);
  else element.setAttribute(HIDDEN_MARKER, snapshot.marker);
}

export function isHiddenByAdsFriendly(element) {
  if (!element?.closest) return false;
  return !!(
    element.closest(`[${HIDDEN_MARKER}]`) ||
    element.querySelector?.(`[${HIDDEN_MARKER}]`)
  );
}
