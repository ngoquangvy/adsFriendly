import { classifyNavigationIntent } from "../shared/intent-classifier.js";

export function startIntentTracker() {
  const recordIntent = (event) => {
    if (!event.isTrusted) return;
    try {
      const link = event.target?.closest?.("a[href]");
      const sourceUrl =
        window.top === window
          ? location.href
          : document.referrer || location.href;
      const intent = classifyNavigationIntent({
        intentUrl: link?.href,
        sourceUrl,
        evidence: buildClickEvidence(link, event.target),
      });
      chrome.runtime.sendMessage({
        type: "TRUSTED_CLICK",
        intentUrl: link?.href || null,
        sourceUrl,
        frameUrl: location.href,
        intentKind: intent.likelyAd ? "promotional" : "navigation",
        intentReasons: intent.reasons,
      });
    } catch {}
  };
  const onKeydown = (event) => {
    if (event.key === "Enter") recordIntent(event);
  };

  document.addEventListener("pointerdown", recordIntent, true);
  document.addEventListener("contextmenu", recordIntent, true);
  document.addEventListener("keydown", onKeydown, true);

  return () => {
    document.removeEventListener("pointerdown", recordIntent, true);
    document.removeEventListener("contextmenu", recordIntent, true);
    document.removeEventListener("keydown", onKeydown, true);
  };
}

function buildClickEvidence(link, target) {
  return [
    link?.id,
    typeof link?.className === "string" ? link.className : "",
    link?.title,
    target?.id,
    typeof target?.className === "string" ? target.className : "",
    target?.getAttribute?.("alt"),
    target?.getAttribute?.("title"),
  ]
    .filter(Boolean)
    .join(" ");
}
