import {
  normalizeMediaCandidate,
  normalizeBlobSourceTrace,
  normalizeMediaManifestHandoff,
  normalizeMediaProbe,
  normalizeMediaProbeDiagnostic,
  normalizeEmeObservation,
  normalizeVideoAdEvidence,
} from "../media/contracts.js";

export const EVENTS = Object.freeze({
  MEDIA_DISCOVERED: "media.discovered",
  MEDIA_PROBED: "media.probed",
  MEDIA_PROBE_DIAGNOSTIC: "media.probe_diagnostic",
  MEDIA_BLOB_TRACED: "media.blob_traced",
  MEDIA_MANIFEST_HANDOFF_READY: "media.manifest_handoff_ready",
  MEDIA_EME_OBSERVED: "media.eme_observed",
  MEDIA_CATALOG_UPDATED: "media.catalog.updated",
  VIDEO_AD_EVIDENCE_FOUND: "video_ad.evidence_found",
  VIDEO_AD_LABELLED: "video_ad.labelled",
});

const E = EVENTS;

export const EVENT_CATALOG = Object.freeze({
  [E.MEDIA_DISCOVERED]: event(
    E.MEDIA_DISCOVERED,
    "media.observer",
    ["media.catalog"],
    normalizeMediaCandidate,
  ),
  [E.MEDIA_PROBED]: event(
    E.MEDIA_PROBED,
    "media.probe",
    ["media.catalog"],
    normalizeMediaProbe,
  ),
  [E.MEDIA_PROBE_DIAGNOSTIC]: event(
    E.MEDIA_PROBE_DIAGNOSTIC,
    "media.probe",
    ["media.catalog"],
    normalizeMediaProbeDiagnostic,
  ),
  [E.MEDIA_BLOB_TRACED]: event(
    E.MEDIA_BLOB_TRACED,
    "media.blob-source-tracer",
    ["media.catalog"],
    normalizeBlobSourceTrace,
  ),
  [E.MEDIA_MANIFEST_HANDOFF_READY]: event(
    E.MEDIA_MANIFEST_HANDOFF_READY,
    "media.manifest-handoff",
    ["media.catalog", "media.downloader"],
    normalizeMediaManifestHandoff,
  ),
  [E.MEDIA_EME_OBSERVED]: event(
    E.MEDIA_EME_OBSERVED,
    "media.eme-observer",
    ["media.catalog"],
    normalizeEmeObservation,
  ),
  [E.MEDIA_CATALOG_UPDATED]: event(
    E.MEDIA_CATALOG_UPDATED,
    "media.catalog",
    ["media.downloader", "video-ad.evidence-collector"],
    normalizeCatalogUpdate,
  ),
  [E.VIDEO_AD_EVIDENCE_FOUND]: event(
    E.VIDEO_AD_EVIDENCE_FOUND,
    "video-ad.evidence-collector",
    ["video-ad.classifier"],
    normalizeVideoAdEvidence,
  ),
  [E.VIDEO_AD_LABELLED]: event(
    E.VIDEO_AD_LABELLED,
    "video-ad.feedback-labeler",
    ["training.samples"],
    normalizeVideoAdEvidence,
  ),
});

validateEventCatalog();

export function getEventDefinition(eventId) {
  const definition = EVENT_CATALOG[eventId];
  if (!definition) {
    throw new Error(
      `[EventRegistry] Unknown event "${eventId}". Register it in event-catalog.js before use.`,
    );
  }
  return definition;
}

export function createRegisteredEvent(eventId, payload, metadata = {}) {
  const definition = getEventDefinition(eventId);
  return {
    eventId: randomId(),
    type: eventId,
    timestamp: Date.now(),
    producer: definition.producer,
    payload: definition.normalize(payload),
    metadata: { ...metadata },
  };
}

export function normalizeRegisteredEvent(value = {}) {
  const definition = getEventDefinition(value.type);
  return {
    eventId:
      typeof value.eventId === "string" && value.eventId
        ? value.eventId
        : randomId(),
    type: definition.id,
    timestamp: Number.isFinite(Number(value.timestamp))
      ? Number(value.timestamp)
      : Date.now(),
    producer: definition.producer,
    payload: definition.normalize(value.payload),
    metadata:
      value.metadata && typeof value.metadata === "object"
        ? { ...value.metadata }
        : {},
  };
}

function event(id, producer, consumers, normalize) {
  return Object.freeze({
    id,
    producer,
    consumers: Object.freeze([...consumers]),
    normalize,
  });
}

function normalizeCatalogUpdate(value = {}) {
  if (typeof value.mediaId !== "string" || !value.mediaId) {
    throw new Error("[EventRegistry] catalog update needs mediaId.");
  }
  const revision = Number(value.revision);
  if (!Number.isInteger(revision) || revision < 0) {
    throw new Error(
      "[EventRegistry] catalog update revision must be a non-negative integer.",
    );
  }
  return { mediaId: value.mediaId, revision };
}

function validateEventCatalog() {
  const eventIds = Object.values(EVENTS);
  if (new Set(eventIds).size !== eventIds.length) {
    throw new Error("[EventRegistry] Duplicate event ID.");
  }
  for (const eventId of eventIds) {
    const definition = EVENT_CATALOG[eventId];
    if (!definition || definition.id !== eventId) {
      throw new Error(
        `[EventRegistry] Event "${eventId}" has no metadata definition.`,
      );
    }
    if (!definition.producer || !definition.consumers.length) {
      throw new Error(
        `[EventRegistry] Event "${eventId}" needs a producer and consumers.`,
      );
    }
  }
}

function randomId() {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
