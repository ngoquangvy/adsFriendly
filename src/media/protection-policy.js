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
  const keyFormats = candidate.encryptionKeyFormats || [];
  return (
    methods.length > 0 &&
    methods.every((method) =>
      String(method).toUpperCase().startsWith("SAMPLE-AES"),
    ) &&
    keyFormats.every(
      (format) => !format || String(format).toLowerCase() === "identity",
    )
  );
}
