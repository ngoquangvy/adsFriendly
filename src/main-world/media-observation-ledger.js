const MAXIMUM_OBSERVATIONS = 64;
const MAXIMUM_AGE_MS = 60_000;
const observations = [];

export function rememberMediaObservation(candidate, observedAt = Date.now()) {
  if (!candidate?.id || !candidate?.kind) return;
  observations.push({ candidate: { ...candidate }, observedAt });
  trim(observedAt);
}

export function findRelatedMediaObservations(
  sourceUrls = [],
  { observedAt = Date.now(), maximum = 8, allowedKinds = null } = {},
) {
  trim(observedAt);
  const sourceHosts = new Set(sourceUrls.map(hostOf).filter(Boolean));
  return observations
    .map((observation) => ({
      ...observation,
      score: observationScore(observation, sourceHosts, observedAt),
    }))
    .filter(
      (observation) =>
        !allowedKinds || allowedKinds.includes(observation.candidate.kind),
    )
    .filter((observation) => observation.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || right.observedAt - left.observedAt,
    )
    .slice(0, maximum)
    .map((observation) => ({
      id: observation.candidate.id,
      kind: observation.candidate.kind,
      sourceUrl:
        observation.candidate.manifestUrl || observation.candidate.sourceUrl,
      observedAt: observation.observedAt,
    }));
}

export function clearMediaObservations() {
  observations.length = 0;
}

function observationScore(observation, sourceHosts, now) {
  const age = Math.max(0, now - observation.observedAt);
  if (age > MAXIMUM_AGE_MS) return 0;
  const candidate = observation.candidate;
  const candidateHost = hostOf(candidate.manifestUrl || candidate.sourceUrl);
  const adaptive = ["hls", "dash"].includes(candidate.kind);
  const sameHost = candidateHost && sourceHosts.has(candidateHost);
  if (sourceHosts.size && !sameHost) return 0;
  if (!sourceHosts.size && !adaptive) return 0;
  return (sameHost ? 100 : 20) + (adaptive ? 10 : 0) - age / 10_000;
}

function trim(now) {
  const cutoff = now - MAXIMUM_AGE_MS;
  while (
    observations.length &&
    (observations.length > MAXIMUM_OBSERVATIONS ||
      observations[0].observedAt < cutoff)
  ) {
    observations.shift();
  }
}

function hostOf(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}
