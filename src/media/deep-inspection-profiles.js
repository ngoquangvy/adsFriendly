import { MEDIA_DEEP_INSPECTION_STRATEGIES } from "./deep-inspection.js";

export const MEDIA_DEEP_INSPECTION_PROFILES_KEY = "mediaDeepInspectionProfiles";

const PENDING_TTL_MS = 15 * 60 * 1000;
const MAX_PROFILES = 64;

export async function stageMediaDeepInspectionProfile(
  storage,
  { pageUrl, frameUrl, suggestion, now = Date.now() },
) {
  if (
    !suggestion?.eligible ||
    suggestion.confidence < 0.9 ||
    !Object.values(MEDIA_DEEP_INSPECTION_STRATEGIES).includes(
      suggestion.strategy,
    ) ||
    typeof suggestion.mediaId !== "string" ||
    !suggestion.mediaId
  ) {
    throw new Error("Deep media inspection needs verified technical evidence.");
  }
  const topOrigin = httpOrigin(pageUrl);
  const frameOrigin = httpOrigin(frameUrl || pageUrl);
  if (!topOrigin || !frameOrigin) {
    throw new Error("Deep media inspection needs HTTP page and frame origins.");
  }
  const profiles = await readProfiles(storage, now);
  const id = `${topOrigin}|${frameOrigin}|${suggestion.strategy}`;
  const existing = profiles.find((profile) => profile.id === id);
  const next = {
    id,
    topOrigin,
    frameOrigin,
    strategy: suggestion.strategy,
    mediaId: suggestion.mediaId,
    state: "pending",
    evidenceCode: suggestion.code,
    confidence: suggestion.confidence,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    expiresAt: now + PENDING_TTL_MS,
    lastVerifiedAt: existing?.lastVerifiedAt || null,
  };
  const merged = [
    next,
    ...profiles.filter((profile) => profile.id !== id),
  ].slice(0, MAX_PROFILES);
  await storage.set({ [MEDIA_DEEP_INSPECTION_PROFILES_KEY]: merged });
  return next;
}

export async function verifyMediaDeepInspectionProfiles(
  storage,
  { pageUrl, frameUrls = [], successfulMediaIds = [], now = Date.now() },
) {
  const topOrigin = httpOrigin(pageUrl);
  if (!topOrigin) return [];
  const allowedFrames = new Set(
    [pageUrl, ...frameUrls].map(httpOrigin).filter(Boolean),
  );
  const successful = new Set(successfulMediaIds.filter(Boolean));
  const profiles = await readProfiles(storage, now);
  let changed = false;
  const next = profiles.map((profile) => {
    if (
      profile.state !== "pending" ||
      profile.topOrigin !== topOrigin ||
      !allowedFrames.has(profile.frameOrigin) ||
      !successful.has(profile.mediaId)
    ) {
      return profile;
    }
    changed = true;
    return {
      ...profile,
      state: "verified",
      updatedAt: now,
      expiresAt: null,
      lastVerifiedAt: now,
    };
  });
  if (changed)
    await storage.set({ [MEDIA_DEEP_INSPECTION_PROFILES_KEY]: next });
  return next;
}

export async function readMediaDeepInspectionProfiles(
  storage,
  now = Date.now(),
) {
  return readProfiles(storage, now);
}

async function readProfiles(storage, now) {
  const snapshot = await storage.get(MEDIA_DEEP_INSPECTION_PROFILES_KEY);
  const raw = Array.isArray(snapshot[MEDIA_DEEP_INSPECTION_PROFILES_KEY])
    ? snapshot[MEDIA_DEEP_INSPECTION_PROFILES_KEY]
    : [];
  const profiles = raw.filter(
    (profile) =>
      profile &&
      typeof profile.id === "string" &&
      ["pending", "verified"].includes(profile.state) &&
      (profile.state === "verified" || Number(profile.expiresAt) > now),
  );
  if (profiles.length !== raw.length)
    await storage.set({ [MEDIA_DEEP_INSPECTION_PROFILES_KEY]: profiles });
  return profiles.slice(0, MAX_PROFILES);
}

function httpOrigin(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}
