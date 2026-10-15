// Presentation-only progress. Never invent a byte total from a size estimate.
export function getDownloadProgress(value = {}) {
  value ||= {};
  const pairs = [
    ["bytes", value.downloadedBytes, value.totalBytes],
    ["time", value.processedSeconds, value.duration],
    ["resources", value.completedResources, value.totalResources],
  ];
  for (const [basis, done, total] of pairs) {
    const completed = finite(done),
      maximum = finite(total);
    if (completed === null || !(maximum > 0)) continue;
    return {
      percent: Math.min(
        100,
        Math.max(0, Math.round((completed / maximum) * 100)),
      ),
      basis,
    };
  }
  return { percent: null, basis: null };
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
