import { PRODUCT_IDS } from "../runtime/ecosystem-catalog.js";
import { MOBILE_DIRECT_FORMATS } from "./direct-formats.js";

// Mobile composition is explicit: importing Media Tools never starts downloads
// or changes the existing Safari protection settings.
export const MOBILE_MODULES = Object.freeze({
  protection: Object.freeze({
    id: "protection",
    productId: PRODUCT_IDS.AD_PROTECTION,
    title: "Protection",
    capabilities: ["protection.settings"],
  }),
  media: Object.freeze({
    id: "media",
    productId: PRODUCT_IDS.MEDIA_TOOLS,
    title: "Media Tools",
    capabilities: ["media.inspect", "media.direct.original"],
  }),
});
export const MOBILE_PROFILES = Object.freeze({
  protection: ["protection"],
  full: ["protection", "media"],
});
export const MOBILE_BACKENDS = Object.freeze({
  "ios-safari": {
    directDownload: false,
    sourceOpen: true,
    youtubeResolve: false,
    reason: "Use the containing app for native downloads.",
  },
  "ios-app": {
    directDownload: true,
    sourceOpen: false,
    youtubeResolve: false,
    reason: "Direct HTTPS audio/video only; no desktop Helper or FFmpeg.",
  },
  "android-app": {
    directDownload: true,
    sourceOpen: false,
    youtubeResolve: false,
    reason: "Direct HTTPS audio/video only; no desktop Helper or FFmpeg.",
  },
});
export function mobileComposition(profile = "full") {
  const ids = MOBILE_PROFILES[profile];
  if (!ids) throw Error("Unknown mobile build profile.");
  const backends = structuredClone(MOBILE_BACKENDS);
  if (!ids.includes("media"))
    for (const backend of Object.values(backends)) {
      backend.directDownload = false;
      backend.sourceOpen = false;
      backend.reason = "Media module is not included in this build.";
    }
  return {
    schemaVersion: 1,
    profile,
    modules: ids.map((id) => ({
      ...MOBILE_MODULES[id],
      capabilities: [...MOBILE_MODULES[id].capabilities],
    })),
    backends,
    directFormats: ids.includes("media")
      ? structuredClone(MOBILE_DIRECT_FORMATS)
      : [],
  };
}
// A failed optional module must not prevent the protection/onboarding UI.
export function createMobileModules({
  profile = "full",
  factories,
  onError = () => {},
}) {
  const modules = mobileComposition(profile).modules;
  const created = new Map();
  return {
    list: () => modules.map((module) => ({ ...module })),
    open(id) {
      const definition = modules.find((module) => module.id === id);
      if (!definition)
        throw Error("Register/include the mobile module before opening it.");
      if (created.has(id)) return created.get(id);
      try {
        if (typeof factories[id] !== "function")
          throw Error("Mobile module implementation unavailable.");
        const instance = factories[id](definition);
        created.set(id, instance);
        return instance;
      } catch (error) {
        onError(id, error);
        return null;
      }
    },
    dispose() {
      for (const instance of created.values()) {
        try {
          instance?.dispose?.();
        } catch {}
      }
      created.clear();
    },
  };
}
