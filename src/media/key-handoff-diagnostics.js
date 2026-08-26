export function normalizeAesKeyHandoffDiagnostic(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const count = (field, maximum = 1000) =>
    Math.max(0, Math.min(maximum, Math.trunc(Number(value[field]) || 0)));
  return {
    framesQueried: count("framesQueried"),
    framesResponded: count("framesResponded"),
    requestedManifestCount: count("requestedManifestCount"),
    matchedManifestCount: count("matchedManifestCount"),
    relatedManifestCount: count("relatedManifestCount"),
    relatedManifestBytes: count("relatedManifestBytes", 8 * 1024 * 1024),
    childManifestCount: count("childManifestCount"),
    keyDirectiveCount: count("keyDirectiveCount"),
    unsupportedKeyDirectiveCount: count("unsupportedKeyDirectiveCount"),
    segmentDirectiveCount: count("segmentDirectiveCount"),
    encryptionMethods: normalizeDiagnosticStrings(value.encryptionMethods),
    encryptionKeyFormats: normalizeDiagnosticStrings(
      value.encryptionKeyFormats,
    ),
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
  const encryption = diagnostic.encryptionMethods.length
    ? `, encryption ${diagnostic.encryptionMethods.join("+")} (${diagnostic.encryptionKeyFormats.join("+") || "no key format"})`
    : "";
  return ` Browser capture: ${diagnostic.framesResponded}/${diagnostic.framesQueried} frames responded, ${diagnostic.matchedManifestCount}/${diagnostic.requestedManifestCount} requested manifests matched, ${diagnostic.relatedManifestCount} related manifests (${diagnostic.relatedManifestBytes} bytes, ${diagnostic.childManifestCount} children, ${diagnostic.segmentDirectiveCount} segments), ${diagnostic.pageManifestFetchSuccessCount}/${diagnostic.pageManifestFetchAttemptCount} manifest fetches succeeded${manifestStatuses}, ${diagnostic.keyDirectiveCount} key directives (${diagnostic.unsupportedKeyDirectiveCount} unsupported)${encryption}, ${diagnostic.declaredKeyCount} identity keys declared, ${diagnostic.capturedKeyCount} captured, ${diagnostic.pageFetchSuccessCount}/${diagnostic.pageFetchAttemptCount} key fetches succeeded${statuses}.`;
}

function normalizeDiagnosticStrings(value) {
  return Array.isArray(value)
    ? [
        ...new Set(
          value
            .filter((item) => typeof item === "string")
            .map((item) => item.trim().slice(0, 100))
            .filter(Boolean),
        ),
      ].slice(0, 8)
    : [];
}
