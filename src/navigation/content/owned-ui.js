// composedPath includes the host of a closed shadow root. Do not inspect private
// shadow content or interpret extension controls as website navigation intent.
export function isOwnedUiEvent(event) {
  const path = event.composedPath?.() || [event.target];
  return path.some((node) =>
    node?.closest?.("[data-adsfriendly-ui], [data-afs-ui]"),
  );
}
