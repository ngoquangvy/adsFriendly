var AF_CONFIG = {
  debug: true,
  appSettings: {
    enabled: true,
    protectionMode: "safe",
    featureOverrides: {}
  },
  blacklist: [],
  customRules: {},
  allowedDomSelectors: {},

  whitelist: [
    "google.com", "accounts.google.com",
    "bing.com", "duckduckgo.com", "yahoo.com", "search.yahoo.com",
    "baidu.com", "yandex.com",
    "github.com",
    "microsoft.com", "login.microsoftonline.com", "live.com",
    "apple.com", "appleid.apple.com",
    "facebook.com", "accounts.facebook.com",
    "cloudflare.com", "challenges.cloudflare.com"
  ],

  trustedInitiators: [
    "google.com", "accounts.google.com",
    "bing.com", "duckduckgo.com", "yahoo.com", "search.yahoo.com",
    "baidu.com", "yandex.com",
    "github.com",
    "microsoft.com", "login.microsoftonline.com", "live.com",
    "apple.com", "appleid.apple.com",
    "facebook.com", "accounts.facebook.com",
    "cloudflare.com", "challenges.cloudflare.com"
  ],

  popupBlocking: {
    popUnderClickThreshold: 3,
    popUnderTimeWindowMs: 2000
  },

  bannerDetection: {
    scanIntervalMs: 3000,
    maxScanDurationMs: 15000,

    closeSelectors: [
      ".close", ".close-btn", ".close-button", ".btn-close",
      ".dismiss", ".dismiss-btn",
      ".cls", ".ad-close",
      ".hide-btn", ".skip-btn",
      "[aria-label*='close' i]",
      "[aria-label*='dismiss' i]",
      "[title*='Close' i]"
    ],

    closeTextSignatures: [
      "\u00D7", "\u2715", "\u2716", "X", "x",
      "Close", "close", "Dong", "dong",
      "Tat", "tat", "Skip", "skip"
    ],

    adContentKeywords: [
      "sponsored by", "advertisement", "powered by",
      "qu\u1EA3ng c\u00E1o", "t\u00E0i tr\u1EE3", "qc",
      "ad feedback", "promoted by", "google ad",
      "display ad", "banner ad"
    ],

    adClassPatterns: [
      "ad-", "-ad", "ads-", "-ads",
      "sponsored-", "promoted-",
      "google_ad", "dfp_", "banner-ad"
    ],

    adLinkRatioThreshold: 0.8,
    minLinksForAdRatio: 3,
    adLinkHostPatterns: [
      "doubleclick.net", "googlesyndication.com", "googleadservices.com",
      "adservice.google.com", "adnxs.com", "taboola.com", "outbrain.com",
      "mgid.com", "criteo.com", "popads.net", "propellerads.com"
    ],
    adLinkPathPatterns: [
      "/ad/", "/ads/", "/adv/", "/advert", "/banner",
      "utm_medium=cpc", "utm_source=ad", "adclick", "clickad",
      "doubleclick", "googlesyndication", "googleadservices"
    ],

    loginTextSignatures: [
      "sign in", "log in", "sign on",
      "\u0111\u0103ng nh\u1EADp", "password",
      "forgot password", "create account",
      "sign up", "register"
    ]
  },

  mutationWatching: {
    overlayPosition: ["fixed", "sticky", "absolute"],
    suspiciousAttributes: ["style", "class"]
  }
};

AF_CONFIG.baseWhitelist = AF_CONFIG.whitelist.slice();

AF_CONFIG.ready = new Promise(function(resolve) {
  var afApi = (typeof browser !== "undefined") ? browser : chrome;
  if (!afApi.storage || !afApi.storage.local) {
    resolve(AF_CONFIG);
    return;
  }
  afApi.storage.local.get(["appSettings", "whitelist", "blacklist", "userCustomRules", "afsAllowedDomSelectors"], function(result) {
    result = result || {};
    if (result.appSettings) AF_CONFIG.appSettings = Object.assign({}, AF_CONFIG.appSettings, result.appSettings);
    if (Array.isArray(result.whitelist)) AF_CONFIG.whitelist = AF_CONFIG.baseWhitelist.concat(result.whitelist);
    AF_CONFIG.blacklist = result.blacklist || [];
    AF_CONFIG.customRules = result.userCustomRules || {};
    AF_CONFIG.allowedDomSelectors = result.afsAllowedDomSelectors || {};
    resolve(AF_CONFIG);
  });
  afApi.storage.onChanged.addListener(function(changes, areaName) {
    if (areaName !== "local") return;
    if (changes.appSettings) AF_CONFIG.appSettings = Object.assign({ enabled: true, protectionMode: "safe", featureOverrides: {} }, changes.appSettings.newValue || {});
    if (changes.whitelist) AF_CONFIG.whitelist = AF_CONFIG.baseWhitelist.concat(changes.whitelist.newValue || []);
    if (changes.blacklist) AF_CONFIG.blacklist = changes.blacklist.newValue || [];
    if (changes.userCustomRules) AF_CONFIG.customRules = changes.userCustomRules.newValue || {};
    if (changes.afsAllowedDomSelectors) AF_CONFIG.allowedDomSelectors = changes.afsAllowedDomSelectors.newValue || {};
  });
});

AF_CONFIG.whenReady = function(callback) {
  AF_CONFIG.ready.then(callback).catch(function() {});
};
