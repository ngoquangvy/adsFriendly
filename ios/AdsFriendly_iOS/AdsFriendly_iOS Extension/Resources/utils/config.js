var AF_CONFIG = {
  debug: true,

  whitelist: [
    "google.com", "accounts.google.com",
    "bing.com", "duckduckgo.com", "yahoo.com", "search.yahoo.com",
    "baidu.com", "yandex.com",
    "github.com",
    "microsoft.com", "login.microsoftonline.com", "live.com",
    "apple.com", "appleid.apple.com",
    "facebook.com", "accounts.facebook.com"
  ],

  trustedInitiators: [
    "google.com", "accounts.google.com",
    "bing.com", "duckduckgo.com", "yahoo.com", "search.yahoo.com",
    "baidu.com", "yandex.com",
    "github.com",
    "microsoft.com", "login.microsoftonline.com", "live.com",
    "apple.com", "appleid.apple.com",
    "facebook.com", "accounts.facebook.com"
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
