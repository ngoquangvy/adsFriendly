export function normalizeAesKeyHandoffDiagnostic(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const count = (field) =>
    Math.max(0, Math.min(1000, Math.trunc(Number(value[field]) || 0)));
  return {
    framesQueried: count("framesQueried"),
    framesResponded: count("framesResponded"),
    requestedManifestCount: count("requestedManifestCount"),
    matchedManifestCount: count("matchedManifestCount"),
    relatedManifestCount: count("relatedManifestCount"),
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
    pageManifestFetchAttemptCount: count("pageManifestFetchAttemptCount"),
    pageManifestFetchSuccessCount: count("pageManifestFetchSuccessCount"),
    pageManifestFetchStatuses: [
      ...new Set(
        Array.isArray(value.pageManifestFetchStatuses)
          ? value.pageManifestFetchStatuses
          : [],
      ),
    ]
      .map(Number)
      .filter(
        (status) => Number.isInteger(status) && status >= 0 && status <= 599,
      )
      .slice(0, 8),
    pageManifestFetchErrorCount: count("pageManifestFetchErrorCount"),
  };
}

export function formatAesKeyHandoffDiagnostic(value) {
  const diagnostic = normalizeAesKeyHandoffDiagnostic(value);
  if (!diagnostic) return "";
  const statuses = diagnostic.pageFetchStatuses.length
    ? `; key fetch status ${diagnostic.pageFetchStatuses.join(", ")}`
    : "";
  const manifestStatuses = diagnostic.pageManifestFetchStatuses.length
    ? `; manifest fetch status ${diagnostic.pageManifestFetchStatuses.join(", ")}`
    : "";
  return ` Browser capture: ${diagnostic.framesResponded}/${diagnostic.framesQueried} frames responded, ${diagnostic.matchedManifestCount}/${diagnostic.requestedManifestCount} requested manifests matched, ${diagnostic.relatedManifestCount} related manifests found, ${diagnostic.pageManifestFetchSuccessCount}/${diagnostic.pageManifestFetchAttemptCount} manifest fetches succeeded${manifestStatuses}, ${diagnostic.declaredKeyCount} keys declared, ${diagnostic.capturedKeyCount} captured, ${diagnostic.pageFetchSuccessCount}/${diagnostic.pageFetchAttemptCount} key fetches succeeded${statuses}.`;
}
