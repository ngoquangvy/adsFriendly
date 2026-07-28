import { upsertGlobalPattern } from "../shared/pattern-store.js";

export async function handleLearnVideoAd(data) {
  const { src, hostname } = data;
  if (!src) return;
  let value = src;
  try {
    const url = new URL(src);
    value =
      url.hostname.includes("github") ||
      url.hostname.includes("s3") ||
      url.hostname.includes("cdn")
        ? url.hostname
        : url.hostname +
          (url.pathname.split("/")[1] ? "/" + url.pathname.split("/")[1] : "");
  } catch {
    value = src.split("?")[0].substring(0, 50);
  }

  await upsertGlobalPattern(
    {
      type: "video_source_marker",
      value,
      confidence: 1,
      source: hostname,
    },
    () => ({ confidence: 1, source: hostname }),
  );
}

export async function handleVideoLearning(data) {
  const classList = (data.classes || "")
    .split(" ")
    .filter(
      (token) =>
        token.includes("ad") ||
        token.includes("player") ||
        token.includes("video"),
    );
  if (!classList.length) return;

  await Promise.all(
    classList.map((cls) =>
      upsertGlobalPattern(
        {
          type: "video_marker",
          value: `.${cls}`,
          confidence: 0.5,
          source: data.hostname,
        },
        (existing) => ({
          confidence: Math.min(1, (existing.confidence || 0) + 0.1),
          source: data.hostname,
        }),
      ),
    ),
  );
}
