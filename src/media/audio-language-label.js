const ROLE_LABELS = Object.freeze({
  original: "Original",
  dubbed: "Dubbed",
  auto_dubbed: "Auto-dubbed",
  descriptive: "Audio Description",
  secondary: "Secondary",
});

const LOCALIZED_LANGUAGE_NAMES = Object.freeze({
  "tiếng việt": "Vietnamese",
  "tiếng anh": "English",
  "tiếng trung": "Chinese",
  "tiếng trung quốc": "Chinese",
  "tiếng nhật": "Japanese",
  "tiếng hàn": "Korean",
});

/**
 * @param {{
 *   language?: string | null,
 *   name?: string | null,
 *   role?: "original" | "dubbed" | "auto_dubbed" | "descriptive" | "secondary" | null,
 *   isDefault?: boolean
 * }} [options]
 */
export function formatAudioLanguageLabel({
  language = null,
  name = null,
  role = null,
  isDefault = false,
} = {}) {
  const locale = normalizedLocale(language);
  const baseName =
    englishLanguageName(locale?.language) || normalizedSourceName(name);
  const region = normalizedRegion(
    locale?.region || regionFromName(name),
    locale?.language,
  );
  const effectiveRole = role || roleFromName(name);
  const qualifiers = [region, ROLE_LABELS[effectiveRole]].filter(Boolean);
  const identity = baseName || (isDefault ? "Default Audio" : "Audio");
  return qualifiers.length
    ? `${identity} (${qualifiers.join(", ")})`
    : identity;
}

function normalizedLocale(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return new Intl.Locale(value.replace(/_/g, "-"));
  } catch {
    return null;
  }
}

function englishLanguageName(value) {
  if (!value) return null;
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(value);
  } catch {
    return null;
  }
}

function normalizedSourceName(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const withoutQualifiers = value.replace(/\s*\([^)]*\)\s*$/u, "").trim();
  return (
    LOCALIZED_LANGUAGE_NAMES[withoutQualifiers.toLowerCase()] ||
    withoutQualifiers
  );
}

function regionFromName(value) {
  if (typeof value !== "string") return null;
  return (
    value.match(/\((US|UK|GB|United States|United Kingdom)\b/i)?.[1] || null
  );
}

function normalizedRegion(value, language) {
  if (!value) return null;
  const region = String(value).toUpperCase();
  if (
    (language === "vi" && region === "VN") ||
    (language === "zh" && region === "CN") ||
    (language === "ja" && region === "JP") ||
    (language === "ko" && region === "KR")
  )
    return null;
  if (region === "UNITED STATES") return "US";
  if (region === "UNITED KINGDOM") return "UK";
  return region === "GB" ? "UK" : region;
}

function roleFromName(value) {
  if (typeof value !== "string") return null;
  const qualifier = value.match(/\(([^)]*)\)\s*$/u)?.[1]?.toLowerCase() || "";
  if (/\boriginal\b/.test(qualifier)) return "original";
  if (/\bauto[- ]?dubbed\b/.test(qualifier)) return "auto_dubbed";
  if (/\bdubbed\b/.test(qualifier)) return "dubbed";
  return null;
}
