export const videoState = {
  activeAds: new Set(),
  playbackSnapshots: new WeakMap(),
  cachedPatterns: [],
  currentAdDensity: 0,
  siteTrustScore: 0.5,
  initialized: false,
};
