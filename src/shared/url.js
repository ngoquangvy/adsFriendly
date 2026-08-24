export function parseUrl(value, base) {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}
export function sameHostnameOrSubdomain(hostname, parent) {
  if (!hostname || !parent) return false;
  const h = hostname.toLowerCase();
  const p = parent.toLowerCase();
  return h === p || h.endsWith(`.${p}`);
}
