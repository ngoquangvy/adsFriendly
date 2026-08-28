const PLAYBACK_EVENT_TYPES = Object.freeze([
  "initial",
  "loadedmetadata",
  "durationchange",
  "play",
  "pause",
  "ended",
  "waiting",
  "seeking",
  "seeked",
  "ratechange",
  "timeupdate",
  "visibility",
]);

const TIMEUPDATE_INTERVAL_MS = 1000;

export function createPlaybackObservationTracker({
  scopeId = randomScopeId(),
  now = () => Date.now(),
} = {}) {
  const sessions = new WeakMap();
  let nextSession = 1;

  return Object.freeze({
    observe(
      mediaElement,
      { pageUrl, mediaId = null, trigger = "initial", visible = false } = {},
    ) {
      if (!mediaElement || typeof mediaElement !== "object") return null;
      if (!PLAYBACK_EVENT_TYPES.includes(trigger)) return null;
      let session = sessions.get(mediaElement);
      if (!session) {
        session = {
          id: `${scopeId}:player-${nextSession++}`,
          lastObservedAt: 0,
          lastSignature: null,
        };
        sessions.set(mediaElement, session);
      }
      const observedAt = now();
      if (
        trigger === "timeupdate" &&
        observedAt - session.lastObservedAt < TIMEUPDATE_INTERVAL_MS
      )
        return null;
      const observation = {
        sessionId: session.id,
        pageUrl,
        mediaId,
        state: playbackState(mediaElement, trigger),
        trigger,
        currentTime: finiteOrNull(mediaElement.currentTime),
        duration: positiveFiniteOrNull(mediaElement.duration),
        playbackRate: positiveFiniteOrNull(mediaElement.playbackRate) || 1,
        muted: mediaElement.muted === true,
        visible: visible === true,
        readyState: boundedReadyState(mediaElement.readyState),
        observedAt,
      };
      const signature = [
        observation.mediaId,
        observation.state,
        observation.trigger,
        observation.visible,
        observation.muted,
        observation.playbackRate,
        Math.floor((observation.currentTime || 0) * 2),
      ].join(":");
      if (
        trigger !== "timeupdate" &&
        signature === session.lastSignature &&
        observedAt - session.lastObservedAt < 250
      )
        return null;
      session.lastObservedAt = observedAt;
      session.lastSignature = signature;
      return observation;
    },
  });
}

function playbackState(mediaElement, trigger) {
  if (trigger === "waiting") return "waiting";
  if (trigger === "seeking") return "seeking";
  if (mediaElement.ended === true || trigger === "ended") return "ended";
  if (mediaElement.paused === false) return "playing";
  if (finiteOrNull(mediaElement.currentTime) > 0) return "paused";
  return "idle";
}

function boundedReadyState(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 4 ? number : null;
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function positiveFiniteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function randomScopeId() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}
