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
  normalizeYouTubeQualityPreflightPayload,
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

test("YouTube provider strategies are centrally registered without secrets", () => {
  assert.equal(
    getMediaAccessStrategy("youtube_mweb_po").resourceKind,
    "provider",
  );
  assert.equal(
    getMediaAccessStrategy("youtube_browser_handoff").resourceKind,
    "provider",
  );
  assert.equal(
    getMediaAccessStrategy("youtube_ytdlp_provider").resourceKind,
    "provider",
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
    videoTrackId: null,
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

test("helper accepts browser-resolved adaptive video and audio tracks", () => {
  const payload = normalizeHelperDownloadPayload({
    jobId: "adaptive-1",
    connections: 8,
    candidate: {
      id: "youtube-video-1",
      kind: "adaptive",
      pageUrl: "https://www.youtube.com/watch?v=video-1",
      sourceUrl: "https://r1.googlevideo.com/videoplayback?itag=137&sig=ok",
      title: "Example video",
      duration: 20,
      provider: "youtube",
      acquisitionProfile: "youtube_player_js_challenge",
      playerUrl:
        "https://www.youtube.com/s/player/b7457b7c/player_ias.vflset/en_US/base.js",
      variants: [
        {
          id: "youtube-video-137",
          type: "video",
          sourceUrl: "https://r1.googlevideo.com/videoplayback?itag=137&sig=ok",
          mimeType: "video/mp4",
          itag: "137",
          width: 1920,
          height: 1080,
          contentLength: 1000,
          urlResolution: "n_transform_pending",
        },
      ],
      audioTracks: [
        {
          id: "youtube-audio-140",
          type: "audio",
          sourceUrl: "https://r1.googlevideo.com/videoplayback?itag=140&sig=ok",
          mimeType: "audio/mp4",
          itag: "140",
          contentLength: 200,
        },
      ],
      requestContext: {
        documentUrl: "https://www.youtube.com/watch?v=video-1",
        referrer: "https://www.youtube.com/",
        credentials: "omit",
      },
    },
  });

  assert.equal(payload.candidate.kind, "adaptive");
  assert.equal(payload.candidate.provider, "youtube");
  assert.match(payload.candidate.playerUrl, /\/s\/player\/b7457b7c\//);
  assert.equal(payload.candidate.variants[0].height, 1080);
  assert.equal(
    payload.candidate.variants[0].urlResolution,
    "n_transform_pending",
  );
  assert.equal(payload.candidate.audioTracks[0].itag, "140");
  assert.equal(payload.output.container, "mp4");
});

test("helper accepts YouTube provider-resolvable adaptive descriptors", () => {
  const payload = normalizeHelperDownloadPayload({
    jobId: "youtube-provider-1",
    output: {
      profileId: "video-mp4",
      videoTrackId: "youtube-video-137",
    },
    candidate: {
      id: "youtube-video-1",
      kind: "adaptive",
      pageUrl: "https://www.youtube.com/watch?v=video-1",
      sourceUrl: "https://www.youtube.com/watch?v=video-1",
      provider: "youtube",
      acquisitionProfile: "youtube_player_response",
      variants: [
        {
          id: "youtube-video-137",
          type: "video",
          sourceUrl: null,
          mimeType: "video/mp4",
          codecs: "avc1.640028",
          itag: "137",
          height: 1080,
          contentLength: 80_000_000,
          urlResolution: "provider_client_pending",
          requestMode: "youtube_query_range",
          requestCpn: "AbCdEfGhIjKlMnOp",
        },
      ],
      audioTracks: [
        {
          id: "youtube-audio-140",
          type: "audio",
          sourceUrl: null,
          mimeType: "audio/mp4",
          codecs: "mp4a.40.2",
          itag: "140",
          contentLength: 4_000_000,
          urlResolution: "provider_client_pending",
          language: "vi",
          audioTrackId: "vi.original",
          audioTrackName: "Vietnamese (original)",
          audioRole: "original",
          audioIsDefault: false,
          audioSampleRate: 48000,
          audioChannels: 2,
          audioQuality: "AUDIO_QUALITY_MEDIUM",
        },
      ],
    },
  });

  assert.equal(payload.candidate.variants[0].sourceUrl, null);
  assert.equal(
    payload.candidate.variants[0].urlResolution,
    "provider_client_pending",
  );
  assert.equal(
    payload.candidate.variants[0].requestMode,
    "youtube_query_range",
  );
  assert.equal(payload.candidate.variants[0].requestCpn, "AbCdEfGhIjKlMnOp");
  assert.equal(payload.candidate.audioTracks[0].sourceUrl, null);
  assert.equal(payload.candidate.audioTracks[0].language, "vi");
  assert.equal(payload.candidate.audioTracks[0].audioRole, "original");
  assert.equal(payload.candidate.audioTracks[0].audioSampleRate, 48000);
  assert.equal(payload.candidate.audioTracks[0].audioChannels, 2);
  assert.equal(payload.output.videoTrackId, "youtube-video-137");
});

test("YouTube quality preflight accepts only a normalized provider candidate", () => {
  const payload = normalizeYouTubeQualityPreflightPayload({
    candidate: {
      id: "youtube-preflight-1",
      kind: "adaptive",
      pageUrl: "https://www.youtube.com/watch?v=preflight-1",
      sourceUrl: "https://www.youtube.com/watch?v=preflight-1",
      provider: "youtube",
      acquisitionProfile: "youtube_player_response",
      variants: [
        {
          id: "video-401",
          type: "video",
          sourceUrl: null,
          mimeType: "video/mp4",
          itag: "401",
          urlResolution: "provider_client_pending",
        },
      ],
      audioTracks: [],
    },
  });
  assert.equal(payload.candidate.provider, "youtube");
  assert.equal(payload.candidate.variants[0].sourceUrl, null);
  assert.equal(
    payload.candidate.variants[0].urlResolution,
    "provider_client_pending",
  );
});

test("YouTube adaptive output exposes an audio OGG profile", () => {
  const payload = normalizeHelperDownloadPayload({
    jobId: "youtube-audio-1",
    output: { profileId: "audio-ogg", audioTrackId: "audio-140" },
    candidate: {
      id: "youtube-audio-candidate",
      kind: "adaptive",
      pageUrl: "https://www.youtube.com/watch?v=audio-1",
      sourceUrl: "https://www.youtube.com/watch?v=audio-1",
      provider: "youtube",
      variants: [
        {
          id: "video-18",
          type: "video",
          sourceUrl: "https://video.example/video.mp4",
          mimeType: "video/mp4",
          muxed: true,
        },
      ],
      audioTracks: [
        {
          id: "audio-140",
          type: "audio",
          sourceUrl: "https://audio.example/audio.m4a",
          mimeType: "audio/mp4",
        },
      ],
    },
  });
  assert.equal(payload.output.profileId, "audio-ogg");
  assert.equal(payload.output.container, "ogg");
  assert.equal(payload.output.extension, ".ogg");
  assert.equal(payload.output.audioTrackId, "audio-140");
});

test("helper retains bounded YouTube signature cipher metadata", () => {
  const sourceUrl =
    "https://r1.googlevideo.com/videoplayback?id=asset-1&itag=137&mime=video%2Fmp4";
  const signatureCipher = new URLSearchParams({
    url: sourceUrl,
    sp: "sig",
    s: "encrypted-signature",
  }).toString();
  const payload = normalizeHelperDownloadPayload({
    jobId: "adaptive-signature-1",
    candidate: {
      id: "youtube-video-1",
      kind: "adaptive",
      pageUrl: "https://www.youtube.com/watch?v=video-1",
      sourceUrl,
      provider: "youtube",
      acquisitionProfile: "youtube_player_js_challenge",
      playerUrl:
        "https://www.youtube.com/s/player/b7457b7c/player_ias.vflset/en_US/base.js",
      variants: [
        {
          id: "youtube-video-137",
          type: "video",
          sourceUrl,
          mimeType: "video/mp4",
          itag: "137",
          urlResolution: "signature_cipher_pending",
          signatureCipher,
        },
      ],
      audioTracks: [
        {
          id: "youtube-audio-140",
          type: "audio",
          sourceUrl:
            "https://r1.googlevideo.com/videoplayback?id=asset-1&itag=140&mime=audio%2Fmp4&sig=ok",
          mimeType: "audio/mp4",
          itag: "140",
        },
      ],
    },
  });
  assert.equal(
    payload.candidate.variants[0].urlResolution,
    "signature_cipher_pending",
  );
  assert.equal(payload.candidate.variants[0].signatureCipher, signatureCipher);
});

test("helper accepts a selected muxed YouTube quality without separate audio", () => {
  const sourceUrl =
    "https://r1.googlevideo.com/videoplayback?id=asset-1&itag=18&mime=video%2Fmp4&n=pending";
  const payload = normalizeHelperDownloadPayload({
    jobId: "youtube-muxed-1",
    output: {
      profileId: "video-mp4",
      videoTrackId: "youtube-video-18",
    },
    candidate: {
      id: "youtube-video-1",
      kind: "adaptive",
      pageUrl: "https://www.youtube.com/watch?v=video-1",
      sourceUrl,
      provider: "youtube",
      acquisitionProfile: "youtube_player_js_challenge",
      playerUrl:
        "https://www.youtube.com/s/player/b7457b7c/player_ias.vflset/en_US/base.js",
      variants: [
        {
          id: "youtube-video-18",
          type: "video",
          sourceUrl,
          mimeType: "video/mp4",
          itag: "18",
          height: 360,
          muxed: true,
          urlResolution: "n_transform_pending",
        },
      ],
      audioTracks: [],
    },
  });
  assert.equal(payload.output.videoTrackId, "youtube-video-18");
  assert.equal(payload.candidate.variants[0].muxed, true);
  assert.deepEqual(payload.candidate.audioTracks, []);
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
            [MEDIA_HELPER_CAPABILITIES.YOUTUBE_PLAYER_JS_RESOLUTION]: true,
            [MEDIA_HELPER_CAPABILITIES.YOUTUBE_PROVIDER_FORMAT_RESOLUTION]: true,
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
    assert.equal(status.canResolveYouTubePlayerJs, true);
    assert.equal(status.canResolveYouTubeProviderFormats, true);
    assert.deepEqual(status.capabilities, {
      "download.direct_http": true,
      "download.hls_vod": false,
      "download.hls_decrypted_manifest": true,
      "output.container_selection": true,
      "download.dash_vod": true,
      "mux.ffmpeg": true,
      "resolve.youtube_player_js": true,
      "resolve.youtube_provider_formats": true,
    });
  } finally {
    globalThis.chrome = previousChrome;
  }
});
