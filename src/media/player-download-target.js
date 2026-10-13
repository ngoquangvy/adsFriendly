import { selectVisibleMediaItems } from "./catalog-view.js";
import { getMediaDownloadAvailability } from "./download-job-contract.js";
import { stableMediaId } from "./detection.js";

export function readPlayerSource(video) {
  if (video.error || video.networkState === 3) return "";
  // currentSrc can keep the old URL during a failed source change.
  if (video.getAttribute("src")) return video.src;
  if (video.currentSrc) return video.currentSrc;
  // preload=none players may declare a source before currentSrc is populated.
  // Multiple distinct sources are ambiguous until the browser selects one.
  const sources = [
    ...new Set(
      Array.from(video.querySelectorAll?.("source[src]") || [])
        .filter((source) => source.getAttribute?.("src") !== "")
        .map((source) => source.src)
        .filter(Boolean),
    ),
  ];
  return sources.length === 1 ? sources[0] : "";
}

// Player identity comes from an exact source or an explicit observer lineage.
// Size, duration and display order never establish a player/source association.
export function resolvePlayerDownloadTarget({
  sourceUrl,
  pageUrl,
  frameId,
  items = [],
}) {
  if (!sourceUrl) return null;
  const scoped = items.filter((item) => item.frameId === frameId);
  const displayed = selectVisibleMediaItems(scoped, Infinity);
  const raw = scoped.find((item) => sameSource(item.sourceUrl, sourceUrl));
  let matches = displayed.filter(
    (item) =>
      sameSource(item.sourceUrl, sourceUrl) ||
      item.variants?.some((track) => sameSource(track.sourceUrl, sourceUrl)),
  );
  if (!matches.length && raw?.kind === "blob") {
    const ids = new Set(
      [raw.selectedMediaId, ...(raw.blobTrace?.candidateIds || [])].filter(
        Boolean,
      ),
    );
    matches = displayed.filter(
      (item) =>
        ids.has(item.id) ||
        (item.selectedMediaId && ids.has(item.selectedMediaId)),
    );
    if (!matches.length) {
      try {
        const page = new URL(pageUrl);
        const id =
          page.searchParams.get("v") ||
          page.pathname.match(/^\/shorts\/([^/]+)/)?.[1];
        if (id && /(^|\.)youtube\.com$/.test(page.hostname)) {
          matches = displayed.filter(
            (item) =>
              item.provider === "youtube" &&
              item.id === stableMediaId("adaptive", `youtube:${id}`),
          );
        }
      } catch {}
    }
  }
  if (matches.length !== 1) return null;
  const presentation = matches[0];
  const candidate =
    scoped.find((item) => item.id === presentation.selectedMediaId) ||
    presentation;
  if (!getMediaDownloadAvailability(candidate).supported) return null;
  return { presentation, candidate };
}

function sameSource(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  try {
    const normalize = (value) => {
      const url = new URL(value);
      for (const key of ["range", "bytestart", "byteend"])
        url.searchParams.delete(key);
      url.hash = "";
      url.searchParams.sort();
      return url.href;
    };
    return normalize(left) === normalize(right);
  } catch {
    return false;
  }
}
