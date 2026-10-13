// The compact launcher straddles the player edge. Measure only the launcher,
// not the expanded options panel, so opening the panel never moves the anchor.
export function playerDownloadPosition(rect, viewportWidth, launcherHeight) {
  const margin = 8;
  const width = Math.min(
    300,
    rect.width - margin * 2,
    viewportWidth - margin * 2,
  );
  const left = Math.max(
    margin,
    Math.min(
      rect.left + (rect.width - width) / 2,
      viewportWidth - width - margin,
    ),
  );
  const top = Math.max(margin, rect.top - Math.max(0, launcherHeight) * 0.7);
  return { width, left, top };
}
