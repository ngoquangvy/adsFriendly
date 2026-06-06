const AF_CONFIG = {
  debug: true,

  whitelist: [
    "google.com", "accounts.google.com",
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
    ]
  },

  mutationWatching: {
    overlayPosition: ["fixed", "sticky", "absolute"],
    suspiciousAttributes: ["style", "class"]
  }
};
