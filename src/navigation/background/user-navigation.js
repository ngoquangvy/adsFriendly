// A user-owned navigation can carry intent across a bounded redirect chain, not
// across arbitrary later destinations in the same tab. Queries stay in memory.
export function createUserNavigationTracker({
  now = () => Date.now(),
  maximum = 256,
} = {}) {
  const sessions = new Map();
  const get = (tabId) => {
    const session = sessions.get(tabId);
    if (!session || session.expiresAt <= now()) {
      sessions.delete(tabId);
      return null;
    }
    return session;
  };
  const begin = (tabId, url) => {
    try {
      const target = new URL(url);
      if (!/^https?:$/.test(target.protocol)) return;
      sessions.set(tabId, {
        url: target.href,
        expiresAt: now() + 10000,
        redirects: 0,
      });
      while (sessions.size > maximum)
        sessions.delete(sessions.keys().next().value);
    } catch {}
  };
  const continueRedirect = ({ tabId, url, transitionQualifiers = [] }) => {
    const session = get(tabId);
    if (
      !session ||
      session.redirects >= 5 ||
      !transitionQualifiers.some(
        (value) => value === "server_redirect" || value === "client_redirect",
      )
    )
      return false;
    try {
      const previous = new URL(session.url),
        next = new URL(url);
      const google = (host) =>
        /(^|\.)google\.(com|[a-z]{2}|com\.[a-z]{2}|co\.[a-z]{2})$/.test(host);
      const sameHost =
        previous.hostname === next.hostname ||
        previous.hostname.endsWith(`.${next.hostname}`) ||
        next.hostname.endsWith(`.${previous.hostname}`);
      const sameGoogleSearch =
        google(previous.hostname) &&
        google(next.hostname) &&
        previous.pathname === "/search" &&
        next.pathname === "/search" &&
        previous.searchParams.has("q") &&
        previous.searchParams.get("q") === next.searchParams.get("q");
      if (
        !/^https?:$/.test(next.protocol) ||
        (!(google(previous.hostname) && google(next.hostname))
          ? !sameHost
          : !sameGoogleSearch)
      )
        return false;
      session.url = next.href;
      session.redirects++;
      return true;
    } catch {
      return false;
    }
  };
  return {
    begin,
    continueRedirect,
    removeTab: (tabId) => sessions.delete(tabId),
    clear: () => sessions.clear(),
  };
}

export const userNavigationTracker = createUserNavigationTracker();
