export function chooseMediaTitle(candidateTitle, pageTitle, pageUrl = "") {
  const candidate = cleanMediaTitle(candidateTitle, pageUrl);
  if (candidate && !isGenericMediaTitle(candidate, pageUrl)) return candidate;
  return cleanMediaTitle(pageTitle, pageUrl) || candidate || null;
}

export function cleanMediaTitle(value, pageUrl = "") {
  let title =
    typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!title) return null;
  title = title
    .replace(/^(?:xem\s+phim|watch)\s+/i, "")
    .replace(/\s+(?:vietsub|thuyết\s+minh)(?:\s*[-|].*)?$/i, "")
    .trim();
  const hostname = safeHostname(pageUrl);
  if (hostname) {
    const site = hostname.replace(/^www\./, "").split(".", 1)[0];
    title = title.replace(
      new RegExp(`\\s*[-|]\\s*${escapeRegex(site)}.*$`, "i"),
      "",
    );
  }
  return title.slice(0, 180).trim() || null;
}

function isGenericMediaTitle(value, pageUrl) {
  if (/^(?:player|video|media|blob|blob media stream)$/i.test(value))
    return true;
  if (/^[a-f0-9_-]{24,}$/i.test(value)) return true;
  const hostname = safeHostname(pageUrl);
  return Boolean(hostname && value.toLowerCase() === hostname.toLowerCase());
}

function safeHostname(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
