import { notifyContentScript } from "./bridge.js";
import { stableMediaId } from "../media/detection.js";
import { MEDIA_KINDS } from "../media/contracts.js";
import { parseHlsManifest } from "../media/hls-parser.js";
import { parseDashManifest } from "../media/dash-parser.js";
import { isUsableMediaProbe } from "../media/probe-gate.js";
import { EVENTS, createRegisteredEvent } from "../runtime/event-catalog.js";
import { CAPABILITIES } from "../runtime/feature-catalog.js";

const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_ENVELOPES = 16;
const ENVELOPE_MAXIMUM_AGE_MS = 20_000;
const PENDING_BLOB_MAXIMUM_AGE_MS = 5_000;
const createdBlobListeners = new Set();
const encryptedEnvelopeListeners = new Set();
const encryptedEnvelopes = [];

export function publishCreatedBlob(object, objectUrl) {
  for (const listener of createdBlobListeners) {
    try {
      const result = listener({ object, objectUrl, observedAt: Date.now() });
      result?.catch?.(() => {});
    } catch {}
  }
}

export function installDecryptedManifestObserver(policy) {
  const inspectedObjectUrls = new Set();
  const pendingBlobs = new Map();
  let stopped = false;
  const listener = async ({ object, objectUrl, observedAt }) => {
    if (
      stopped ||
      inspectedObjectUrls.has(objectUrl) ||
      !(object instanceof Blob) ||
      !policy.can(CAPABILITIES.MEDIA_OBSERVE) ||
      !shouldInspectBlob(object, observedAt)
    )
      return;
    inspectedObjectUrls.add(objectUrl);
    const matched = await inspectBlob(object, objectUrl, observedAt).catch(
      () => false,
    );
    if (!matched && isManifestMimeType(object.type)) {
      pendingBlobs.set(objectUrl, { object, objectUrl, observedAt });
      trimPendingBlobs(pendingBlobs, Date.now());
    }
  };
  const envelopeListener = () => {
    const now = Date.now();
    trimPendingBlobs(pendingBlobs, now);
    for (const pending of pendingBlobs.values()) {
      if (pending.processing) continue;
      pending.processing = true;
      inspectBlob(pending.object, pending.objectUrl, pending.observedAt)
        .then((matched) => {
          if (matched) pendingBlobs.delete(pending.objectUrl);
          else pending.processing = false;
        })
        .catch(() => {
          pending.processing = false;
        });
    }
  };
  createdBlobListeners.add(listener);
  encryptedEnvelopeListeners.add(envelopeListener);
  return () => {
    stopped = true;
    createdBlobListeners.delete(listener);
    encryptedEnvelopeListeners.delete(envelopeListener);
    inspectedObjectUrls.clear();
    pendingBlobs.clear();
  };
}

export function rememberEncryptedManifestEnvelope({
  candidate,
  manifestUrl,
  body,
  requestContext = null,
  observedAt = Date.now(),
} = {}) {
  const classification = classifyEncryptedManifestEnvelope(body);
  if (!classification || !candidate?.id || !manifestUrl) return null;
  const envelope = {
    mediaId: candidate.id,
    manifestUrl,
    kind: candidate.kind,
    scheme: classification.scheme,
    evidence: classification.evidence,
    requestContext: requestContext ? { ...requestContext } : null,
    observedAt,
  };
  encryptedEnvelopes.push(envelope);
  trimEncryptedEnvelopes(observedAt);
  for (const listener of encryptedEnvelopeListeners) {
    try {
      listener(envelope);
    } catch {}
  }
  return { ...envelope, evidence: [...envelope.evidence] };
}

export function classifyEncryptedManifestEnvelope(body) {
  const source = String(body || "")
    .replace(/^\uFEFF/, "")
    .trim();
  if (!source.startsWith("#EXTM3U")) return null;
  const lines = source.split(/\r?\n/).map((line) => line.trim());
  const encryptionTag = lines.find((line) =>
    /^#ENC-[A-Z0-9-]+(?::|;|$)/i.test(line),
  );
  const base64Tag = lines.find((line) =>
    /^#EXT-X-B(?:64|65)(?::|;|$)/i.test(line),
  );
  const payloads = lines.filter((line) => line && !line.startsWith("#"));
  if (!encryptionTag || payloads.length !== 1) return null;
  const payload = payloads[0];
  if (
    payload.length < (base64Tag ? 32 : 256) ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)
  )
    return null;
  const tagScheme = /^#ENC-([A-Z0-9-]+)/i.exec(encryptionTag)?.[1] || "";
  return {
    scheme:
      tagScheme.toLowerCase().replaceAll("-", "") === "aesgcm"
        ? "aes-gcm"
        : "unknown",
    evidence: [
      "custom-encryption-tag",
      ...(base64Tag ? ["base64-payload-tag"] : []),
      "opaque-base64-payload",
    ],
  };
}

export function clearEncryptedManifestEnvelopes() {
  encryptedEnvelopes.length = 0;
}

async function inspectBlob(blob, objectUrl, observedAt) {
  const body = await blob.text();
  if (byteLength(body) > MAX_MANIFEST_BYTES) return false;
  const kind = manifestKind(body);
  if (!kind) return false;
  const match = findRecentEncryptedEnvelope(kind, observedAt);
  if (!match) return false;

  const parsed =
    kind === MEDIA_KINDS.DASH
      ? parseDashManifest(match.envelope.manifestUrl, body)
      : parseHlsManifest(match.envelope.manifestUrl, body);
  const probe = { kind, ...parsed };
  const bodyBytes = byteLength(body);
  const manifestEnvelope = {
    scheme: match.envelope.scheme,
    observedAt: match.envelope.observedAt,
    correlationConfidence: match.confidence,
    evidence: [...match.envelope.evidence, "same-frame", "nearby-blob"],
  };

  reportDiagnostic(match.envelope, {
    phase: "response_received",
    code: "decrypted_manifest_blob_observed",
    bodyBytes,
    bodyFormat: kind,
    observationSource: "decrypted_blob",
    envelopeScheme: match.envelope.scheme,
    correlationConfidence: match.confidence,
    evidence: manifestEnvelope.evidence,
  });
  reportDiagnostic(match.envelope, {
    phase: "parsed",
    code: decryptedProbeDiagnosticCode(probe),
    bodyBytes,
    bodyFormat: kind,
    playlistType: probe.playlistType,
    segmentCount: probe.segmentCount,
    observationSource: "decrypted_blob",
    envelopeScheme: match.envelope.scheme,
    correlationConfidence: match.confidence,
    evidence: manifestEnvelope.evidence,
  });

  notifyContentScript({
    type: "REGISTERED_EVENT",
    event: createRegisteredEvent(EVENTS.MEDIA_PROBED, {
      mediaId: match.envelope.mediaId,
      pageUrl: location.href,
      manifestUrl: match.envelope.manifestUrl,
      kind,
      ...probe,
      requestContext: match.envelope.requestContext,
      probeSource: "decrypted_blob",
      manifestEnvelope,
    }),
  });
  notifyContentScript({
    type: "REGISTERED_EVENT",
    event: createRegisteredEvent(EVENTS.MEDIA_BLOB_TRACED, {
      mediaId: stableMediaId("blob", objectUrl),
      pageUrl: location.href,
      blobUrl: objectUrl,
      sourceUrls: [match.envelope.manifestUrl],
      candidateIds: [match.envelope.mediaId],
      mimeTypes: [blob.type || manifestMimeType(kind)],
      appendCount: 0,
      totalAppendedBytes: blob.size,
      observedAt,
    }),
  });

  if (isUsableMediaProbe(probe)) {
    notifyContentScript({
      type: "MEDIA_DECRYPTED_MANIFEST_READY",
      handoff: {
        mediaId: match.envelope.mediaId,
        manifestUrl: match.envelope.manifestUrl,
        kind,
        body,
      },
    });
  }

  if (!isUsableMediaProbe(probe)) {
    notifyContentScript({
      type: "MEDIA_DEBUG_MANIFEST_CAPTURE",
      capture: {
        mediaId: match.envelope.mediaId,
        manifestUrl: match.envelope.manifestUrl,
        kind,
        body,
        bodyFormat: kind,
        reason: decryptedProbeDiagnosticCode(probe),
      },
    });
  }
  // TRAINING_BACKLOG: the structured observation facts above may become model
  // features. The decrypted manifest body is deliberately not retained here.
  return true;
}

function shouldInspectBlob(blob, observedAt) {
  if (
    !Number.isFinite(blob.size) ||
    blob.size <= 0 ||
    blob.size > MAX_MANIFEST_BYTES
  )
    return false;
  const mimeType = String(blob.type || "").toLowerCase();
  if (isManifestMimeType(mimeType)) return true;
  if (
    mimeType &&
    !["application/octet-stream", "text/plain"].includes(mimeType)
  )
    return false;
  trimEncryptedEnvelopes(observedAt);
  return encryptedEnvelopes.length > 0;
}

function findRecentEncryptedEnvelope(kind, observedAt) {
  trimEncryptedEnvelopes(observedAt);
  const candidates = encryptedEnvelopes
    .filter(
      (item) =>
        item.kind === kind &&
        Math.abs(observedAt - item.observedAt) <= ENVELOPE_MAXIMUM_AGE_MS,
    )
    .sort((left, right) => right.observedAt - left.observedAt);
  if (!candidates.length) return null;
  const closest = candidates[0];
  const next = candidates[1];
  const distance = Math.max(0, observedAt - closest.observedAt);
  let confidence = distance <= 5_000 ? 0.98 : 0.9;
  if (next && Math.abs(closest.observedAt - next.observedAt) < 500)
    confidence = 0.78;
  return { envelope: closest, confidence };
}

function trimPendingBlobs(pendingBlobs, now) {
  for (const [objectUrl, pending] of pendingBlobs) {
    if (now - pending.observedAt > PENDING_BLOB_MAXIMUM_AGE_MS)
      pendingBlobs.delete(objectUrl);
  }
}

function trimEncryptedEnvelopes(now) {
  const cutoff = now - ENVELOPE_MAXIMUM_AGE_MS;
  while (
    encryptedEnvelopes.length &&
    (encryptedEnvelopes.length > MAX_ENVELOPES ||
      encryptedEnvelopes[0].observedAt < cutoff)
  ) {
    encryptedEnvelopes.shift();
  }
}

function manifestKind(body) {
  const source = String(body || "")
    .replace(/^\uFEFF/, "")
    .trimStart();
  if (source.startsWith("#EXTM3U")) return MEDIA_KINDS.HLS;
  if (/^(?:<\?xml[^>]*>\s*)?<MPD\b/i.test(source)) return MEDIA_KINDS.DASH;
  return null;
}

function isManifestMimeType(value) {
  return /(?:mpegurl|dash\+xml)/i.test(value);
}

function manifestMimeType(kind) {
  return kind === MEDIA_KINDS.DASH
    ? "application/dash+xml"
    : "application/vnd.apple.mpegurl";
}

function decryptedProbeDiagnosticCode(probe) {
  if (probe.status === "unsupported") return "decrypted_manifest_unsupported";
  if (probe.status === "failed") return "decrypted_manifest_parse_failed";
  if (probe.playlistType === "unknown") return "decrypted_manifest_no_stream";
  if (
    probe.playlistType === "media" &&
    !probe.segmentCount &&
    !probe.partialSegmentCount
  )
    return "decrypted_manifest_zero_segments";
  return "decrypted_manifest_parsed";
}

function reportDiagnostic(envelope, facts) {
  notifyContentScript({
    type: "REGISTERED_EVENT",
    event: createRegisteredEvent(EVENTS.MEDIA_PROBE_DIAGNOSTIC, {
      mediaId: envelope.mediaId,
      pageUrl: location.href,
      manifestUrl: envelope.manifestUrl,
      kind: envelope.kind,
      observedAt: Date.now(),
      ...facts,
    }),
  });
}

function byteLength(value) {
  return new TextEncoder().encode(String(value || "")).byteLength;
}
