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
import {
  MEDIA_HELPER_STATES,
  classifyNativeMessagingError,
  getMediaHelperStatus,
} from "../src/background/media-helper-bridge.js";

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
  assert.equal("headers" in payload.candidate.requestContext, false);
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
            "download.hls_vod": false,
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
    assert.equal(status.canMuxWithFfmpeg, true);
    assert.deepEqual(status.capabilities, {
      "download.direct_http": true,
      "download.hls_vod": false,
      "mux.ffmpeg": true,
    });
  } finally {
    globalThis.chrome = previousChrome;
  }
});
