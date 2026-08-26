import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPONENT_IDS,
  PRODUCT_IDS,
  isComponentOptionalForProduct,
  isComponentRequiredByProduct,
} from "../src/runtime/ecosystem-catalog.js";
import {
  CAPABILITIES,
  doesCapabilityRequireComponent,
  getCapabilitiesForProduct,
} from "../src/runtime/feature-catalog.js";
import {
  MEDIA_HELPER_EVENTS,
  MEDIA_HELPER_CAPABILITIES,
  MEDIA_HELPER_PROTOCOL_VERSION,
  MEDIA_HELPER_REQUESTS,
  createHelperEvent,
  normalizeHelperEvent,
  normalizeHelperDownloadPayload,
  normalizeHelperRequest,
} from "../src/media/helper-contract.js";
import { windowsRevealArguments } from "../packages/media-helper/src/output-action-arguments.js";
import {
  MEDIA_HELPER_STATES,
  classifyNativeMessagingError,
  getMediaHelperStatus,
} from "../src/background/media-helper-bridge.js";
import {
  getMediaAccessStrategyPreferences,
  recordMediaAccessStrategyResult,
} from "../src/background/media-access-strategy-memory.js";
import { getMediaAccessStrategy } from "../src/media/access-strategy-catalog.js";

test("Windows reveal keeps the Explorer select switch and path together", () => {
  const outputPath =
    "C:\\Users\\Example User\\Downloads\\AdsFriendly\\funny video.mp4";
  assert.deepEqual(windowsRevealArguments(outputPath), [
    `/select,${outputPath}`,
  ]);
});

test("ad protection is extension-only while the media helper stays optional", () => {
  assert.equal(
    isComponentRequiredByProduct(
      PRODUCT_IDS.AD_PROTECTION,
      COMPONENT_IDS.BROWSER_EXTENSION,
    ),
    true,
  );
  assert.equal(
    isComponentRequiredByProduct(
      PRODUCT_IDS.AD_PROTECTION,
      COMPONENT_IDS.MEDIA_HELPER,
    ),
    false,
  );
  assert.equal(
    isComponentOptionalForProduct(
      PRODUCT_IDS.MEDIA_TOOLS,
      COMPONENT_IDS.MEDIA_HELPER,
    ),
    true,
  );
});

test("browser media stays shared and only native download requires the helper", () => {
  const protectionCapabilities = getCapabilitiesForProduct(
    PRODUCT_IDS.AD_PROTECTION,
  );
  const mediaCapabilities = getCapabilitiesForProduct(PRODUCT_IDS.MEDIA_TOOLS);
  assert(protectionCapabilities.includes(CAPABILITIES.MEDIA_OBSERVE));
  assert(mediaCapabilities.includes(CAPABILITIES.MEDIA_OBSERVE));
  assert(!protectionCapabilities.includes(CAPABILITIES.MEDIA_DOWNLOAD));
  assert.equal(
    doesCapabilityRequireComponent(
      CAPABILITIES.MEDIA_DOWNLOAD,
      COMPONENT_IDS.MEDIA_HELPER,
    ),
    false,
  );
  assert.equal(
    doesCapabilityRequireComponent(
      CAPABILITIES.MEDIA_NATIVE_DOWNLOAD,
      COMPONENT_IDS.MEDIA_HELPER,
    ),
    true,
  );
  assert.equal(
    doesCapabilityRequireComponent(
      CAPABILITIES.NAVIGATION_GUARD,
      COMPONENT_IDS.MEDIA_HELPER,
    ),
    false,
  );
});

test("media helper messages are versioned and normalized", () => {
  const request = normalizeHelperRequest({
    type: MEDIA_HELPER_REQUESTS.HELLO,
    requestId: " request-1 ",
    protocolVersion: MEDIA_HELPER_PROTOCOL_VERSION,
    payload: { extensionVersion: "2.2.0" },
  });
  assert.equal(request.requestId, "request-1");
  assert.equal(request.payload.extensionVersion, "2.2.0");
  assert.throws(
    () =>
      normalizeHelperRequest({
        type: "helper.unknown",
        requestId: "request-2",
        protocolVersion: 1,
      }),
    /Unknown request type/,
  );

  const event = createHelperEvent(MEDIA_HELPER_EVENTS.READY, "request-1", {
    helperVersion: "0.1.0",
  });
  assert.equal(event.protocolVersion, MEDIA_HELPER_PROTOCOL_VERSION);
  assert.equal(event.payload.helperVersion, "0.1.0");
  assert.equal(normalizeHelperEvent(event).type, MEDIA_HELPER_EVENTS.READY);

  const openRequest = normalizeHelperRequest({
    type: MEDIA_HELPER_REQUESTS.OUTPUT_OPEN,
    requestId: "open-1",
    protocolVersion: MEDIA_HELPER_PROTOCOL_VERSION,
    payload: { outputPath: "C:\\Users\\Test\\Downloads\\video.mp4" },
  });
  assert.equal(openRequest.type, MEDIA_HELPER_REQUESTS.OUTPUT_OPEN);
  assert.equal(
    openRequest.payload.outputPath,
    "C:\\Users\\Test\\Downloads\\video.mp4",
  );
  assert.equal(
    createHelperEvent(MEDIA_HELPER_EVENTS.OUTPUT_OPENED, "open-1", {
      action: "open",
    }).type,
    MEDIA_HELPER_EVENTS.OUTPUT_OPENED,
  );
});

test("direct helper download payload is normalized at the protocol boundary", () => {
  const payload = normalizeHelperDownloadPayload({
    jobId: "direct-1",
    connections: 12,
    candidate: {
      id: "media-1",
      kind: "direct",
      pageUrl: "https://video.example/watch",
      sourceUrl: "https://cdn.example/movie.mp4",
      title: "Movie",
      mimeType: "video/mp4",
    },
  });
  assert.equal(payload.connections, 12);
  assert.equal(payload.output.profileId, "source");
  assert.equal(payload.candidate.sourceUrl, "https://cdn.example/movie.mp4");
  assert.throws(
    () =>
      normalizeHelperDownloadPayload({
        ...payload,
        candidate: { ...payload.candidate, sourceUrl: "file:///movie.mp4" },
      }),
    /HTTP\(S\)/,
  );
});

test("helper HLS context carries routing facts without arbitrary headers", () => {
  const payload = normalizeHelperDownloadPayload({
    jobId: "hls-1",
    candidate: {
      id: "media-hls",
      kind: "hls",
      pageUrl: "https://video.example/watch",
      manifestUrl: "https://cdn.example/master.m3u8",
      duration: 5163.209,
      segmentCount: 1726,
      requestContext: {
        documentUrl: "https://embed.example/player",
        referrer: "https://video.example/watch",
        credentials: "include",
        requiresBrowserSession: true,
        headers: { Cookie: "secret" },
      },
    },
  });
  assert.equal(payload.candidate.requestContext.credentials, "include");
  assert.equal(payload.candidate.requestContext.requiresBrowserSession, true);
  assert.equal(payload.candidate.duration, 5163.209);
  assert.equal(payload.candidate.segmentCount, 1726);
  assert.equal(payload.output.profileId, "video-mp4");
  assert.equal("headers" in payload.candidate.requestContext, false);
});

test("helper accepts a bounded browser user agent, key handoff, and learned scores", () => {
  const manifestUrl = "https://cdn.example/master.m3u8";
  const keyUrl = "https://cdn.example/key.bin";
  const payload = normalizeHelperDownloadPayload({
    jobId: "hls-browser-access",
    browserUserAgent: "Browser/123\r\nInjected: no",
    accessStrategyPreferences: {
      "cdn.example": { captured_referer_origin: 4.5 },
    },
    candidate: {
      id: "media-hls",
      kind: "hls",
      pageUrl: "https://video.example/watch",
      manifestUrl,
      keyHandoff: {
        kind: "hls_aes_keys",
        manifestUrl,
        keys: [
          {
            url: keyUrl,
            data: Buffer.from("0123456789abcdef").toString("base64"),
          },
        ],
      },
      keyHandoffDiagnostic: {
        framesQueried: 2,
        framesResponded: 1,
        requestedManifestCount: 2,
        matchedManifestCount: 1,
        declaredKeyCount: 1,
        capturedKeyCount: 1,
        pageFetchAttemptCount: 1,
        pageFetchSuccessCount: 1,
        pageFetchStatuses: [200, 200, 999],
        pageFetchErrorCount: 0,
      },
    },
  });
  assert.equal(payload.browserUserAgent, "Browser/123Injected: no");
  assert.equal(
    payload.accessStrategyPreferences["cdn.example"].captured_referer_origin,
    4.5,
  );
  assert.equal(payload.candidate.keyHandoff.keys[0].bytes, 16);
  assert.deepEqual(
    payload.candidate.keyHandoffDiagnostic.pageFetchStatuses,
    [200],
  );
  assert.throws(
    () =>
      normalizeHelperDownloadPayload({
        ...payload,
        candidate: {
          ...payload.candidate,
          keyHandoff: {
            ...payload.candidate.keyHandoff,
            manifestUrl: "https://cdn.example/other.m3u8",
          },
        },
      }),
    /does not match the candidate/i,
  );
});

test("media access strategy memory learns per host without retaining secrets", async () => {
  const previousChrome = globalThis.chrome;
  const local = {};
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key) => ({ [key]: local[key] }),
        set: async (value) => Object.assign(local, value),
      },
    },
  };
  try {
    await recordMediaAccessStrategyResult({
      resourceHost: "cdn.example",
      strategyId: "captured_referer_origin",
      outcome: "success",
      headers: { Cookie: "secret" },
      keyUrl: "https://cdn.example/key.bin",
    });
    await recordMediaAccessStrategyResult({
      resourceHost: "cdn.example",
      strategyId: "captured_referer",
      outcome: "rejected",
      httpStatus: 403,
    });
    const preferences = await getMediaAccessStrategyPreferences();
    assert.equal(preferences["cdn.example"].captured_referer_origin, 2);
    assert.equal(preferences["cdn.example"].captured_referer, -0.5);
    assert.doesNotMatch(JSON.stringify(local), /secret|key\.bin|Cookie/);
  } finally {
    globalThis.chrome = previousChrome;
  }
});

test("media access strategies must be registered before scoring", () => {
  assert.equal(
    getMediaAccessStrategy("browser_key_handoff").resourceKind,
    "key",
  );
  assert.throws(
    () => getMediaAccessStrategy("site_specific_magic"),
    /Register it in access-strategy-catalog\.js/,
  );
});

test("helper accepts MKV only for adaptive media", () => {
  const hls = normalizeHelperDownloadPayload({
    jobId: "hls-mkv",
    output: { profileId: "video-mkv" },
    candidate: {
      id: "media-hls",
      kind: "hls",
      pageUrl: "https://video.example/watch",
      manifestUrl: "https://cdn.example/master.m3u8",
    },
  });
  assert.deepEqual(hls.output, {
    profileId: "video-mkv",
    container: "mkv",
    extension: ".mkv",
  });
  assert.throws(
    () =>
      normalizeHelperDownloadPayload({
        jobId: "direct-mkv",
        output: { profileId: "video-mkv" },
        candidate: {
          id: "direct",
          kind: "direct",
          pageUrl: "https://video.example/watch",
          sourceUrl: "https://cdn.example/video.mp4",
        },
      }),
    /not supported for direct/i,
  );
});

test("helper accepts only an exact bounded decrypted HLS handoff", () => {
  const manifestUrl = "https://cdn.example/session/index.m3u8";
  const body = [
    "#EXTM3U",
    "#EXT-X-PLAYLIST-TYPE:VOD",
    "#EXTINF:4,",
    "segment.ts",
    "#EXT-X-ENDLIST",
  ].join("\n");
  const candidate = {
    id: "media-hls",
    kind: "hls",
    pageUrl: "https://video.example/watch",
    manifestUrl,
    probeStatus: "ready",
    playlistType: "media",
    streamType: "vod",
    segmentCount: 1,
    manifestHandoff: {
      kind: "hls",
      manifestUrl,
      body,
      revisionId: "revision-1",
    },
  };
  const payload = normalizeHelperDownloadPayload({
    jobId: "decrypted-hls-1",
    candidate,
  });
  assert.equal(payload.candidate.manifestHandoff.body, body);
  assert.equal(payload.candidate.manifestHandoff.manifestUrl, manifestUrl);
  assert.throws(
    () =>
      normalizeHelperDownloadPayload({
        jobId: "decrypted-hls-2",
        candidate: {
          ...candidate,
          manifestHandoff: {
            ...candidate.manifestHandoff,
            manifestUrl: "https://cdn.example/other.m3u8",
          },
        },
      }),
    /does not match the candidate/i,
  );
});

test("helper accepts a normalized static DASH download", () => {
  const payload = normalizeHelperDownloadPayload({
    jobId: "dash-1",
    candidate: {
      id: "media-dash",
      kind: "dash",
      pageUrl: "https://video.example/watch",
      manifestUrl: "https://cdn.example/manifest.mpd",
      duration: 120,
      requestContext: {
        documentUrl: "https://video.example/watch",
        referrer: "https://video.example/",
        credentials: "omit",
      },
    },
  });
  assert.equal(payload.candidate.kind, "dash");
  assert.equal(
    payload.candidate.manifestUrl,
    "https://cdn.example/manifest.mpd",
  );
  assert.equal(payload.candidate.duration, 120);
  assert.equal(payload.candidate.segmentCount, null);
});

test("native host errors distinguish a missing helper from a broken helper", () => {
  assert.equal(
    classifyNativeMessagingError("Specified native messaging host not found."),
    MEDIA_HELPER_STATES.NOT_INSTALLED,
  );
  assert.equal(
    classifyNativeMessagingError("Media Helper handshake timed out."),
    MEDIA_HELPER_STATES.UNAVAILABLE,
  );
});

test("helper status does not connect before optional permission is granted", async () => {
  const previousChrome = globalThis.chrome;
  let nativeCalls = 0;
  globalThis.chrome = {
    permissions: { contains: async () => false },
    runtime: {
      sendNativeMessage: async () => {
        nativeCalls += 1;
      },
    },
  };
  try {
    const status = await getMediaHelperStatus({ force: true });
    assert.equal(status.status, MEDIA_HELPER_STATES.PERMISSION_REQUIRED);
    assert.equal(nativeCalls, 0);
  } finally {
    globalThis.chrome = previousChrome;
  }
});

test("helper status exposes only declared download capabilities", async () => {
  const previousChrome = globalThis.chrome;
  globalThis.chrome = {
    permissions: { contains: async () => true },
    runtime: {
      getManifest: () => ({ version: "2.2.0" }),
      sendNativeMessage: async (_host, request) =>
        createHelperEvent(MEDIA_HELPER_EVENTS.READY, request.requestId, {
          helperVersion: "0.1.0",
          capabilities: {
            [MEDIA_HELPER_CAPABILITIES.DIRECT_HTTP_DOWNLOAD]: true,
            [MEDIA_HELPER_CAPABILITIES.HLS_DECRYPTED_MANIFEST]: true,
            [MEDIA_HELPER_CAPABILITIES.OUTPUT_CONTAINER_SELECTION]: true,
            "download.hls_vod": false,
            "download.dash_vod": true,
            "mux.ffmpeg": true,
            ignored: { nested: true },
          },
        }),
    },
  };
  try {
    const status = await getMediaHelperStatus({ force: true });
    assert.equal(status.status, MEDIA_HELPER_STATES.READY);
    assert.equal(status.canDownloadDirect, true);
    assert.equal(status.canDownloadHls, false);
    assert.equal(status.canDownloadDecryptedHls, true);
    assert.equal(status.canSelectContainer, true);
    assert.equal(status.canDownloadDash, true);
    assert.equal(status.canMuxWithFfmpeg, true);
    assert.deepEqual(status.capabilities, {
      "download.direct_http": true,
      "download.hls_vod": false,
      "download.hls_decrypted_manifest": true,
      "output.container_selection": true,
      "download.dash_vod": true,
      "mux.ffmpeg": true,
    });
  } finally {
    globalThis.chrome = previousChrome;
  }
});
