import { BLOCKING_STRATEGIES } from "./actions.js";
export function hidePredictedAds(patterns = []) {
  if (!patterns.length) return;
  document.querySelectorAll("img, div, a").forEach((el) => {
    if (el.style.opacity === "0" || el.id?.includes("adsfriendly")) return;
    const result = scoreElement(el, patterns);
    if (result.score >= 0.8) {
      console.log(
        `[AdsFriendly AI] Hiding predicted ad (${(result.score * 100).toFixed(0)}%)`,
        result.reasons,
        el,
      );
      BLOCKING_STRATEGIES.STEALTH(el);
    }
  });
}
function scoreElement(el, patterns) {
  const reasons = [];
  let score = scoreTarget(el, patterns, reasons);
  if (score < 0.7 && el.children.length > 0) {
    let childAdCount = 0;
    const children = el.querySelectorAll("img, a");
    children.forEach((child) => {
      if (scoreTarget(child, patterns, reasons) >= 0.7) childAdCount++;
    });
    if (children.length >= 2 && childAdCount / children.length >= 0.6) {
      score = 1;
      reasons.push("Ad Cluster identified via children analysis");
    }
  }
  const link = el.closest("a");
  try {
    if (link?.href && new URL(link.href).hostname === location.hostname)
      score -= 1;
  } catch {}
  return { score, reasons };
}
function scoreTarget(target, patterns, reasons) {
  let score = 0;
  patterns.forEach((p) => {
    if (p.type === "alt" && target.alt === p.value) {
      score += p.confidence;
      reasons.push(`alt=${p.value}`);
    }
    if (p.type === "title" && target.title === p.value) {
      score += p.confidence;
      reasons.push(`title=${p.value}`);
    }
    if (p.type === "domain") {
      const link = target.closest("a");
      if (link?.href?.includes(p.value)) {
        score += p.confidence;
        reasons.push(`domain=${p.value}`);
      }
    }
    if (p.type === "class" && target.className === p.value) {
      score += p.confidence;
      reasons.push(`class=${p.value}`);
    }
    if (p.type === "id" && target.id === p.value) {
      score += p.confidence;
      reasons.push(`id=${p.value}`);
    }
    if (p.type === "srcHost" && target.src?.includes(p.value)) {
      score += p.confidence;
      reasons.push(`srcHost=${p.value}`);
    }
    if (
      p.type === "classToken" &&
      typeof target.className === "string" &&
      target.className.toLowerCase().split(/\s+/).includes(p.value)
    ) {
      score += p.confidence;
      reasons.push(`classToken=${p.value}`);
    }
    if (
      p.type === "idToken" &&
      target.id
        ?.toLowerCase()
        .split(/[^a-z0-9]+/i)
        .includes(p.value)
    ) {
      score += p.confidence;
      reasons.push(`idToken=${p.value}`);
    }
  });
  return score;
}
