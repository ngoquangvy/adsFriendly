const STRONG_DRM_EVIDENCE = new Set(["hls-keyformat", "eme-key-system-access"]);

export function hasStrongDrmEvidence(candidate = {}) {
  if (candidate.drm === "confirmed") return true;
  if (candidate.drm !== "suspected") return false;
  if (candidate.drmSystem) return true;
  if (
    (candidate.drmEvidence || []).some((evidence) =>
      STRONG_DRM_EVIDENCE.has(String(evidence).toLowerCase()),
    )
  ) {
    return true;
  }
  const eme = candidate.eme;
  return Boolean(
    eme?.keySystems?.length || eme?.keyStatuses?.length || eme?.licenseStatus,
  );
}

export function isWeakSampleAesSignal(candidate = {}) {
  if (candidate.drm !== "suspected") return false;
  if (candidate.encryptionScheme !== "sample-aes") return false;
  return !hasStrongDrmEvidence(candidate);
}

export function isFfmpegCompatibleSampleAes(candidate = {}) {
  if (!isWeakSampleAesSignal(candidate)) return false;
  const methods = candidate.encryptionMethods || [];
  return (
    methods.length === 0 ||
    methods.every((method) => {
      const normalized = String(method).trim().toUpperCase();
      return normalized === "AES-128" || normalized.startsWith("SAMPLE-AES");
    })
  );
}

export function normalizeHlsKeyFormat(value) {
  return String(value || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim()
    .toLowerCase()
    .slice(0, 100);
}
