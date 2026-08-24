export const RESPONSIVE_LAYOUTS = Object.freeze({
  ANY: "any",
  COMPACT: "compact",
  WIDE: "wide",
});

export function getResponsiveLayout(width = globalThis.innerWidth) {
  return (Number(width) || 1024) <= 767
    ? RESPONSIVE_LAYOUTS.COMPACT
    : RESPONSIVE_LAYOUTS.WIDE;
}

export function ruleMatchesResponsiveLayout(
  rule,
  layout = getResponsiveLayout(),
) {
  if (!rule || typeof rule === "string") return true;
  return (
    !rule.layout ||
    rule.layout === RESPONSIVE_LAYOUTS.ANY ||
    rule.layout === layout
  );
}
