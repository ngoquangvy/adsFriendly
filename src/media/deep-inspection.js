import { getMediaDownloadAvailability } from "./download-job-contract.js";
import {
  hasStrongDrmEvidence,
  hasUnsupportedHlsKeyFormat,
} from "./protection-policy.js";

export const MEDIA_DEEP_INSPECTION_STRATEGIES = Object.freeze({
  EARLY_MSE_LINEAGE: "early_mse_lineage",
});

const MIN_APPEND_COUNT = 3;
const MIN_APPENDED_BYTES = 256 * 1024;
const RETRYABLE_REASONS = new Set([
  "Manifest is not ready.",
  "HLS endpoint has not exposed a media playlist yet.",
  "HLS media playlist is waiting for segments.",
]);

export function evaluateMediaDeepInspection(item, items = []) {
  if (item?.kind !== "blob") return closed("not_blob");
  const trace = item.blobTrace;
  if (!trace) return closed("no_mse_trace");

  const related = relatedCandidates(item, items);
  const protectedCandidate = [item, ...related].find(isProtectedMedia);
  if (protectedCandidate) return blocked("protected_media");

  if (!["interactive", "complete"].includes(trace.observerDocumentState)) {
    return closed(
      trace.observerDocumentState === "loading"
        ? "observer_already_early"
        : "observer_start_unknown",
    );
  }
  if (
    trace.appendCount < MIN_APPEND_COUNT ||
    trace.totalAppendedBytes < MIN_APPENDED_BYTES
  ) {
    return closed("playback_not_proven");
  }
  if (!trace.sourceUrls?.length || !trace.candidateIds?.length) {
    return closed("source_lineage_not_proven");
  }

  const retryable = related.find((candidate) => {
    if (candidate.kind !== "hls") return false;
    const availability = getMediaDownloadAvailability(candidate);
    return (
      !availability.supported && RETRYABLE_REASONS.has(availability.reason)
    );
  });
  if (!retryable) return closed("no_known_early_hook_gap");

  return Object.freeze({
    eligible: true,
    blocked: false,
    code: "observer_started_late",
    confidence: 0.95,
    strategy: MEDIA_DEEP_INSPECTION_STRATEGIES.EARLY_MSE_LINEAGE,
    mediaId: retryable.id,
    evidence: Object.freeze({
      appendCount: trace.appendCount,
      totalAppendedBytes: trace.totalAppendedBytes,
      sourceCount: trace.sourceUrls.length,
      observerDocumentState: trace.observerDocumentState,
    }),
  });
}

function relatedCandidates(item, items) {
  const ids = new Set([
    item.selectedMediaId,
    ...(item.resolvedMediaIds || []),
    ...(item.blobTrace?.candidateIds || []),
  ]);
  ids.delete(null);
  ids.delete(undefined);
  ids.delete(item.id);
  return items.filter((candidate) => ids.has(candidate.id));
}

function isProtectedMedia(candidate) {
  if (hasStrongDrmEvidence(candidate)) return true;
  if (hasUnsupportedHlsKeyFormat(candidate)) return true;
  if (candidate?.drm && candidate.drm !== "none") return true;
  if (candidate?.encryptionMethods?.length) return true;
  if (
    candidate?.encryptionScheme &&
    !["none", "unknown"].includes(candidate.encryptionScheme)
  ) {
    return true;
  }
  const eme = candidate?.eme;
  return Boolean(
    eme?.keySystems?.length || eme?.keyStatuses?.length || eme?.licenseStatus,
  );
}

function closed(code) {
  return Object.freeze({ eligible: false, blocked: false, code });
}

function blocked(code) {
  return Object.freeze({ eligible: false, blocked: true, code });
}
