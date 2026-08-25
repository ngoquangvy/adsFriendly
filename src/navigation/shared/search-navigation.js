const GOOGLE_HOST_RE =
  /^(.+\.)?google\.(com|[a-z]{2}|com\.[a-z]{2}|co\.[a-z]{2})$/i;
const EMBEDDED_HOST_RE =
  /(?:^|\s)(?:https?:\/\/)?(?:www\.)?([a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+)(?:\b|\/)/i;

export const PREFILLED_SEARCH_TRUST_TARGET = "google.com";

export function getPrefilledSearchNavigation(value) {
  let url;
  try {
    url = value instanceof URL ? value : new URL(value);
  } catch {
    return null;
  }
  const query = url.searchParams.get("q")?.trim() || "";
  if (
    !GOOGLE_HOST_RE.test(url.hostname) ||
    url.pathname !== "/search" ||
    !query
  )
    return null;
  const embeddedHost = EMBEDDED_HOST_RE.exec(query)?.[1]?.toLowerCase() || null;
  return {
    searchHost: url.hostname.toLowerCase(),
    embeddedHost,
  };
}

export function resolveNavigationDecisionTarget({ action, domain, url } = {}) {
  const search = getPrefilledSearchNavigation(url);
  if (!search) return { scope: "domain", domain };
  if (action === "BLACKLIST" && search.embeddedHost) {
    return { scope: "embedded_domain", domain: search.embeddedHost };
  }
  return { scope: "navigation_only", domain: null };
}
