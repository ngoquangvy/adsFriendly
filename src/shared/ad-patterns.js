export const BASELINE_AD_PATTERNS = [
  { type: "alt", value: "Ad", confidence: 0.9 },
  { type: "alt", value: "Advertisement", confidence: 0.9 },
  { type: "alt", value: "Sponsored", confidence: 0.9 },
  { type: "alt", value: "Promoted", confidence: 0.9 },
  { type: "title", value: "Ads by Google", confidence: 1.0 },
  { type: "domain", value: "taboola.com", confidence: 1.0 },
  { type: "domain", value: "outbrain.com", confidence: 1.0 },
  { type: "domain", value: "mgid.com", confidence: 1.0 },
  { type: "domain", value: "adnxs.com", confidence: 1.0 },
];
export const PROTECTED_KEYWORDS = [
  "messenger",
  "chat",
  "inbox",
  "cart",
  "checkout",
  "search",
  "account",
  "login",
  "social",
  "notification",
  "swiper",
  "carousel",
  "slick",
  "owl-",
  "slide",
];
export function isProtectedPattern(value = "") {
  return PROTECTED_KEYWORDS.some((kw) => value.toLowerCase().includes(kw));
}
