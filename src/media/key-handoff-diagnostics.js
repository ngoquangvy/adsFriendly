export function normalizeAesKeyHandoffDiagnostic(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const count = (field) =>
    Math.max(0, Math.min(1000, Math.trunc(Number(value[field]) || 0)));
  return {
    framesQueried: count("framesQueried"),
    framesResponded: count("framesResponded"),
    requestedManifestCount: count("requestedManifestCount"),
    matchedManifestCount: count("matchedManifestCount"),
    declaredKeyCount: count("declaredKeyCount"),
    capturedKeyCount: count("capturedKeyCount"),
    pageFetchAttemptCount: count("pageFetchAttemptCount"),
    pageFetchSuccessCount: count("pageFetchSuccessCount"),
    pageFetchStatuses: [
      ...new Set(
        Array.isArray(value.pageFetchStatuses) ? value.pageFetchStatuses : [],
      ),
    ]
      .map(Number)
      .filter(
        (status) => Number.isInteger(status) && status >= 0 && status <= 599,
      )
      .slice(0, 8),
    pageFetchErrorCount: count("pageFetchErrorCount"),
  };
}

export function formatAesKeyHandoffDiagnostic(value) {
  const diagnostic = normalizeAesKeyHandoffDiagnostic(value);
  if (!diagnostic) return "";
  const statuses = diagnostic.pageFetchStatuses.length
    ? `; page fetch status ${diagnostic.pageFetchStatuses.join(", ")}`
    : "";
  return ` Browser capture: ${diagnostic.framesResponded}/${diagnostic.framesQueried} frames responded, ${diagnostic.matchedManifestCount}/${diagnostic.requestedManifestCount} manifest checks matched, ${diagnostic.declaredKeyCount} keys declared, ${diagnostic.capturedKeyCount} captured, ${diagnostic.pageFetchSuccessCount}/${diagnostic.pageFetchAttemptCount} page fetches succeeded${statuses}.`;
}
