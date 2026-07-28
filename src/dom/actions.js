export const BLOCKING_STRATEGIES = {
  STEALTH(el) {
    if (el.style.opacity === "0") return;
    el.style.setProperty("opacity", "0", "important");
    el.style.setProperty("visibility", "hidden", "important");
    el.style.setProperty("pointer-events", "none", "important");
  },
};
