export const IOS_AD_HOSTS = Object.freeze([
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "adservice.google.com",
  "adnxs.com",
  "criteo.com",
  "criteo.net",
  "taboola.com",
  "outbrain.com",
  "mgid.com",
  "popads.net",
  "popcash.net",
  "propellerads.com",
]);
export const IOS_AD_PATH = "^https?://[^/]+/(?:pagead|gampad|adsystem)/";
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function hostRegex(host) {
  return "^https?://(?:[a-z0-9-]+\\.)*" + escape(host) + "(?::[0-9]+)?/";
}
export function isKnownAdUrl(value) {
  try {
    const url = new URL(value);
    return (
      /^https?:$/.test(url.protocol) &&
      (IOS_AD_HOSTS.some(
        (host) => url.hostname === host || url.hostname.endsWith("." + host),
      ) ||
        new RegExp(IOS_AD_PATH, "i").test(url.href))
    );
  } catch {
    return false;
  }
}
export function iosNetworkRules() {
  const resources = [
    "sub_frame",
    "script",
    "image",
    "stylesheet",
    "font",
    "xmlhttprequest",
    "ping",
    "media",
    "websocket",
    "other",
  ];
  return [
    ...IOS_AD_HOSTS.map((host, index) => ({
      id: index + 1,
      priority: 1,
      action: { type: "block" },
      condition: { regexFilter: hostRegex(host), resourceTypes: resources },
    })),
    {
      id: 100,
      priority: 1,
      action: { type: "block" },
      condition: {
        regexFilter: IOS_AD_PATH,
        resourceTypes: [
          "sub_frame",
          "script",
          "image",
          "xmlhttprequest",
          "ping",
        ],
      },
    },
  ];
}
export function iosSiteAllowRules(whitelist = [], blacklist = []) {
  const normalize = (value) => {
    try {
      const raw = String(value || "")
        .replace(/^\|\|/, "")
        .replace(/\^$/, "");
      const url = new URL(raw.includes("://") ? raw : "https://" + raw);
      return /^[a-z0-9.-]+$/i.test(url.hostname) &&
        !url.username &&
        !url.password
        ? url.hostname.toLowerCase()
        : "";
    } catch {
      return "";
    }
  };
  const blocked = blacklist.map(normalize).filter(Boolean);
  const allowed = [...new Set(whitelist.map(normalize).filter(Boolean))]
    .filter(
      (host) =>
        !blocked.some((block) => host === block || host.endsWith("." + block)),
    )
    .slice(0, 250)
    .map((host, index) => ({
      id: 20000 + index,
      priority: 100,
      action: { type: "allowAllRequests" },
      condition: {
        regexFilter: hostRegex(host),
        resourceTypes: ["main_frame"],
      },
    }));
  // A more-specific Block must not inherit a parent's allowAllRequests. An
  // allow of the main request keeps typed navigation working without granting
  // its descendants a blanket request exemption.
  const resets = blocked
    .filter((host) =>
      allowed.some((rule) =>
        new RegExp(rule.condition.regexFilter).test("https://" + host + "/"),
      ),
    )
    .slice(0, 250)
    .map((host, index) => ({
      id: 21000 + index,
      priority: 200,
      action: { type: "allow" },
      condition: {
        regexFilter: hostRegex(host),
        resourceTypes: ["main_frame"],
      },
    }));
  return allowed.concat(resets);
}
