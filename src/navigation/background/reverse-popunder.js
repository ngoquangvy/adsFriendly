import { parseUrl, sameHostnameOrSubdomain } from "../../shared/url.js";

export const REVERSE_POPUNDER_WINDOW_MS = 7000;

export function isSelfCloneNavigation(originalUrl, cloneUrl) {
  const original = parseUrl(originalUrl);
  const clone = parseUrl(cloneUrl);
  if (!isHttpUrl(original) || !isHttpUrl(clone)) return false;
  return (
    original.hostname.toLowerCase() === clone.hostname.toLowerCase() &&
    normalizePath(original.pathname) === normalizePath(clone.pathname)
  );
}

export function isReversePopunderSequence({
  originalUrl,
  cloneUrl,
  redirectedUrl,
  elapsedMs,
}) {
  if (elapsedMs < 0 || elapsedMs > REVERSE_POPUNDER_WINDOW_MS) return false;
  if (!isSelfCloneNavigation(originalUrl, cloneUrl)) return false;

  const original = parseUrl(originalUrl);
  const redirected = parseUrl(redirectedUrl);
  if (!isHttpUrl(redirected)) return false;
  return !(
    sameHostnameOrSubdomain(original.hostname, redirected.hostname) ||
    sameHostnameOrSubdomain(redirected.hostname, original.hostname)
  );
}

function isHttpUrl(url) {
  return url?.protocol === "http:" || url?.protocol === "https:";
}

function normalizePath(pathname) {
  const normalized = pathname.replace(/\/+$/, "");
  return normalized || "/";
}
