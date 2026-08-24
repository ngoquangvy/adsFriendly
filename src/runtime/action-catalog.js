import {
  CAPABILITIES,
  getCapabilityDefinition,
  getFeatureDefinition,
} from "./feature-catalog.js";

export const ACTIONS = Object.freeze({
  MEDIA_DOWNLOAD_CREATE: "media.download.create",
  VIDEO_ACCELERATE_AUTOMATIC: "video.accelerate.automatic",
  VIDEO_ACCELERATE_USER: "video.accelerate.user",
  VIDEO_RESTORE_PLAYBACK: "video.restore_playback",
  VIDEO_SKIP_AUTOMATIC: "video.skip.automatic",
});

const A = ACTIONS;
const C = CAPABILITIES;

export const ACTION_CATALOG = Object.freeze({
  [A.MEDIA_DOWNLOAD_CREATE]: action(
    A.MEDIA_DOWNLOAD_CREATE,
    "background.media-download-jobs",
    C.MEDIA_NATIVE_DOWNLOAD,
  ),
  [A.VIDEO_ACCELERATE_AUTOMATIC]: action(
    A.VIDEO_ACCELERATE_AUTOMATIC,
    "video.surgeon",
    C.VIDEO_AUTO_ACTION,
  ),
  [A.VIDEO_ACCELERATE_USER]: action(
    A.VIDEO_ACCELERATE_USER,
    "video.surgeon",
    C.VIDEO_USER_ACTION,
  ),
  [A.VIDEO_RESTORE_PLAYBACK]: action(
    A.VIDEO_RESTORE_PLAYBACK,
    "video.surgeon",
    C.VIDEO_RESTORE_STATE,
  ),
  [A.VIDEO_SKIP_AUTOMATIC]: action(
    A.VIDEO_SKIP_AUTOMATIC,
    "video.surgeon",
    C.VIDEO_AUTO_ACTION,
  ),
});

validateActionCatalog();

export function getActionDefinition(actionId) {
  const definition = ACTION_CATALOG[actionId];
  if (!definition) {
    throw new Error(
      `[ActionRegistry] Unknown action "${actionId}". Register it in action-catalog.js before use.`,
    );
  }
  return definition;
}

export function getActionsForFeature(featureId) {
  getFeatureDefinition(featureId);
  return Object.values(ACTION_CATALOG).filter(
    (definition) => definition.featureId === featureId,
  );
}

function action(id, featureId, capability) {
  return Object.freeze({ id, featureId, capability });
}

function validateActionCatalog() {
  const actionIds = Object.values(ACTIONS);
  if (new Set(actionIds).size !== actionIds.length) {
    throw new Error("[ActionRegistry] Duplicate action ID.");
  }
  for (const actionId of actionIds) {
    const definition = ACTION_CATALOG[actionId];
    if (!definition || definition.id !== actionId) {
      throw new Error(
        `[ActionRegistry] Action "${actionId}" has no metadata definition.`,
      );
    }
    const feature = getFeatureDefinition(definition.featureId);
    getCapabilityDefinition(definition.capability);
    if (!feature.capabilities.includes(definition.capability)) {
      throw new Error(
        `[ActionRegistry] Action "${actionId}" uses capability "${definition.capability}" not declared by feature "${feature.id}".`,
      );
    }
  }
}
