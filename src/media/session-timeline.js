const DEFAULT_MAXIMUM_SESSIONS = 16;
const DEFAULT_MAXIMUM_OBSERVATIONS = 64;

export function createMediaSessionTimeline({
  maximumSessions = DEFAULT_MAXIMUM_SESSIONS,
  maximumObservations = DEFAULT_MAXIMUM_OBSERVATIONS,
} = {}) {
  const sessions = new Map();

  return Object.freeze({
    add(observation, { frameId = null, frameUrl = null } = {}) {
      const existing = sessions.get(observation.sessionId);
      const session = existing || {
        id: observation.sessionId,
        lineageId: lineageId(frameId, observation.sessionId),
        pageUrl: observation.pageUrl,
        frameId: normalizedFrameId(frameId),
        frameUrl: normalizedHttpUrl(frameUrl),
        mediaIds: [],
        firstSeenAt: observation.observedAt,
        lastSeenAt: observation.observedAt,
        current: null,
        timeline: [],
      };
      if (
        observation.mediaId &&
        !session.mediaIds.includes(observation.mediaId)
      )
        session.mediaIds = [...session.mediaIds, observation.mediaId].slice(
          -16,
        );
      session.frameId = session.frameId ?? normalizedFrameId(frameId);
      session.frameUrl = session.frameUrl || normalizedHttpUrl(frameUrl);
      session.lastSeenAt = Math.max(session.lastSeenAt, observation.observedAt);
      const point = timelinePoint(observation);
      const previous = session.timeline.at(-1);
      if (canCoalesce(previous, point))
        session.timeline[session.timeline.length - 1] = point;
      else session.timeline.push(point);
      session.timeline = session.timeline.slice(-maximumObservations);
      session.current = point;
      sessions.set(session.id, session);
      trimSessions(sessions, maximumSessions);
      return cloneSession(session);
    },
    list() {
      return [...sessions.values()]
        .sort((left, right) => right.lastSeenAt - left.lastSeenAt)
        .map(cloneSession);
    },
    forMedia(mediaId) {
      return [...sessions.values()]
        .filter((session) => session.mediaIds.includes(mediaId))
        .sort((left, right) => right.lastSeenAt - left.lastSeenAt)
        .map(cloneSession);
    },
    clear() {
      sessions.clear();
    },
  });
}

function timelinePoint(observation) {
  return {
    mediaId: observation.mediaId,
    state: observation.state,
    trigger: observation.trigger,
    currentTime: observation.currentTime,
    duration: observation.duration,
    playbackRate: observation.playbackRate,
    muted: observation.muted,
    visible: observation.visible,
    readyState: observation.readyState,
    observedAt: observation.observedAt,
  };
}

function canCoalesce(previous, next) {
  return (
    previous?.trigger === "timeupdate" &&
    next.trigger === "timeupdate" &&
    previous.mediaId === next.mediaId &&
    previous.state === next.state &&
    previous.visible === next.visible &&
    previous.muted === next.muted &&
    previous.playbackRate === next.playbackRate
  );
}

function cloneSession(session) {
  return {
    ...session,
    mediaIds: [...session.mediaIds],
    current: session.current ? { ...session.current } : null,
    timeline: session.timeline.map((point) => ({ ...point })),
  };
}

function trimSessions(sessions, maximum) {
  while (sessions.size > maximum) {
    const oldest = [...sessions.values()].sort(
      (left, right) => left.lastSeenAt - right.lastSeenAt,
    )[0];
    if (!oldest) return;
    sessions.delete(oldest.id);
  }
}

function lineageId(frameId, sessionId) {
  return `frame-${normalizedFrameId(frameId) ?? "unknown"}:${sessionId}`;
}

function normalizedFrameId(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function normalizedHttpUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
