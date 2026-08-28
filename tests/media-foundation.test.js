import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyMediaSource,
  createMediaCandidateFromSource,
  isLikelyMediaSegment,
} from "../src/media/detection.js";
import { createMediaCatalog } from "../src/media/catalog.js";
import {
  parseHlsAttributeList,
  parseHlsManifest,
} from "../src/media/hls-parser.js";
import { createHlsProbeAttempts } from "../src/media/hls-probe-adapters.js";
import {
  createMediaProbeGate,
  isUsableMediaProbe,
  normalizeHttpMediaUrl,
} from "../src/media/probe-gate.js";
import { createMediaObserverReportKey } from "../src/content/media-observer.js";
import { createMediaProbeRefererRule } from "../src/background/media-probe-context.js";
import { createMediaRequestObservation } from "../src/background/media-request-observer.js";
import { normalizeDebugCapture } from "../src/background/media-debug-capture.js";
import { normalizeMediaManifestHandoff as normalizeStoredManifestHandoff } from "../src/background/media-manifest-handoff.js";
import {
  createContextualProbeInit,
  readXhrResponseBody,
  shouldRequestContextualProbeRetry,
  tryHlsProbeAttempts,
} from "../src/main-world/network-capture.js";
import { createRequestContextRegistry } from "../src/main-world/request-context-registry.js";
import { extractJwPlayerSources } from "../src/main-world/player-source-observer.js";
import { createHlsDownloadPlan } from "../src/media/hls-download-plan.js";
import { parseDashManifest } from "../src/media/dash-parser.js";
import { downloadResourcesInParallel } from "../src/media/parallel-downloader.js";
import {
  getMediaDownloadAvailability,
  normalizeMediaDownloadJob,
} from "../src/media/download-job-contract.js";
import {
  classifyDirectMediaContainer,
  getMediaAudioTrackOptions,
  getMediaDownloadEstimate,
  getMediaDownloadProfiles,
  getMediaVideoQualityOptions,
} from "../src/media/download-options.js";
import { formatAudioLanguageLabel } from "../src/media/audio-language-label.js";
import {
  createMediaCatalogViewSignature,
  formatMediaDetails,
  formatMediaHelperSummary,
  formatMediaName,
  getMediaCatalogDownloadState,
  helperSetupPresentation,
  selectVisibleMediaItems,
} from "../src/media/catalog-view.js";
import {
  formatCompactMediaJobDetails,
  formatMediaJobDetails,
  getMediaJobPauseAvailability,
  getMediaJobPrimaryAction,
  getMediaJobProgress,
  selectCompactMediaJobs,
} from "../src/media/download-job-view.js";
import { EVENTS, createRegisteredEvent } from "../src/runtime/event-catalog.js";
import { normalizeMediaRequestContext } from "../src/media/contracts.js";
import { evaluateMediaDeepInspection } from "../src/media/deep-inspection.js";
import {
  MEDIA_DEEP_INSPECTION_PROFILES_KEY,
  stageMediaDeepInspectionProfile,
  verifyMediaDeepInspectionProfiles,
} from "../src/media/deep-inspection-profiles.js";
import { installBlobSourceTracer } from "../src/main-world/blob-source-tracer.js";
import {
  classifyEncryptedManifestEnvelope,
  clearEncryptedManifestEnvelopes,
  installDecryptedManifestObserver,
  rememberEncryptedManifestEnvelope,
} from "../src/main-world/decrypted-manifest-observer.js";
import {
  clearMediaObservations,
  findRelatedMediaObservations,
  rememberMediaObservation,
} from "../src/main-world/media-observation-ledger.js";
import {
  MEDIA_RESOLUTION_STRATEGIES,
  MEDIA_RESOLUTION_STRATEGY_CATALOG,
} from "../src/media/resolution-strategy-catalog.js";
import {
  MEDIA_RESOLUTION_STAGE_CATALOG,
  MEDIA_RESOLUTION_STAGES,
  diagnoseMediaResolution,
} from "../src/media/resolution-diagnostics.js";
import { chooseMediaTitle } from "../src/media/media-title.js";
import {
  createYouTubeAdaptiveCandidate,
  createYouTubeCandidateFromObservedSource,
  parseYouTubePlaybackTrack,
} from "../src/media/youtube-track-profile.js";
import {
  YOUTUBE_PLAYER_STAGES,
  parseYouTubePlayerResponse,
} from "../src/media/youtube-player-response.js";
import {
  findYouTubePlayerUrl,
  observationFingerprint,
} from "../src/main-world/youtube-player-response-adapter.js";
import {
  beginHlsManifestInspection,
  captureFetchAesKey,
  clearAesKeyHandoffs,
  getAesKeyHandoff,
  recoverAesKeyHandoffs,
  rememberHlsKeyUris,
} from "../src/main-world/aes-key-handoff.js";
import {
  collectAesKeyHandoffTargets,
  shouldRequestAesKeyHandoff,
} from "../src/background/media-download-jobs.js";
import {
  formatAesKeyHandoffDiagnostic,
  normalizeAesKeyHandoffDiagnostic,
} from "../src/media/key-handoff-diagnostics.js";

test("parses browser-resolved YouTube playback tracks without retaining the playback range", () => {
  const track = parseYouTubePlaybackTrack(
    "https://rr1---sn.example.googlevideo.com/videoplayback?id=asset-1&itag=137&mime=video%2Fmp4%3B+codecs%3D%5C%22avc1.640028%5C%22&dur=19.021&clen=123456&size=1920x1080&range=0-65535&sig=browser-resolved",
    { mimeType: "video/mp4" },
  );

  assert.equal(track.type, "video");
  assert.equal(track.itag, "137");
  assert.equal(track.duration, 19.021);
  assert.equal(track.contentLength, 123456);
  assert.deepEqual(track.resolution, { width: 1920, height: 1080 });
  assert.equal(new URL(track.sourceUrl).searchParams.has("range"), false);
  assert.equal(
    new URL(track.sourceUrl).searchParams.get("sig"),
    "browser-resolved",
  );
});

test("creates the same YouTube adaptive candidate from page-network and resource timing observations", () => {
  const pageUrl = "https://www.youtube.com/watch?v=video-1";
  const sourceUrl =
    "https://rr1---sn.example.googlevideo.com/videoplayback?id=asset-1&itag=137&mime=video%2Fmp4&dur=19.021&clen=123456&size=1920x1080&range=0-65535&sig=browser-resolved";
  const fromFetch = createYouTubeCandidateFromObservedSource({
    pageUrl,
    sourceUrl,
    title: "Example - YouTube",
    mimeType: "video/mp4",
    responseHeaders: [{ name: "content-length", value: "65536" }],
  });
  const fromResourceTiming = createYouTubeCandidateFromObservedSource({
    pageUrl,
    sourceUrl,
    title: "Example - YouTube",
  });

  assert.equal(fromFetch.kind, "adaptive");
  assert.equal(fromFetch.id, fromResourceTiming.id);
  assert.equal(fromResourceTiming.variants[0].itag, "137");
  assert.equal(fromResourceTiming.variants[0].contentLength, 123456);
});

test("groups resolved YouTube video and audio observations into one ready adaptive asset", () => {
  const catalog = createMediaCatalog();
  const pageUrl = "https://www.youtube.com/watch?v=video-1";
  const createTrack = (itag, mimeType, extra = "") =>
    parseYouTubePlaybackTrack(
      `https://r1.googlevideo.com/videoplayback?id=asset-1&itag=${itag}&mime=${encodeURIComponent(mimeType)}&dur=20&clen=1000&sig=ok${extra}`,
      { mimeType },
    );
  const video = createYouTubeAdaptiveCandidate({
    pageUrl,
    title: "Example - YouTube",
    track: createTrack("137", "video/mp4", "&size=1920x1080"),
  });
  const audio = createYouTubeAdaptiveCandidate({
    pageUrl,
    title: "Example - YouTube",
    track: createTrack("140", "audio/mp4"),
  });

  catalog.add(7, createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, video));
  catalog.add(7, createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, audio));
  const [item] = catalog.list(7);

  assert.equal(item.id, video.id);
  assert.equal(item.kind, "adaptive");
  assert.equal(item.provider, "youtube");
  assert.equal(item.probeStatus, "ready");
  assert.equal(item.variants.length, 1);
  assert.equal(item.audioTracks.length, 1);
  assert.equal(item.sourceUrl, item.variants[0].sourceUrl);
  assert.deepEqual(getMediaDownloadAvailability(item), {
    supported: true,
    reason: null,
  });
  assert.match(formatMediaDetails(item), /YouTube · 1080p · 1 audio · 0:20/);
  assert.equal(getMediaDownloadEstimate(item).estimatedBytes, 2000);
  const job = normalizeMediaDownloadJob({
    id: "youtube-job-1",
    createdAt: Date.now(),
    sourceTabId: 7,
    candidate: item,
  });
  assert.equal(job.candidate.kind, "adaptive");
  assert.equal(job.candidate.variants.length, 1);
  assert.equal(job.candidate.audioTracks.length, 1);
});

test("media observer reports separate YouTube video and audio tracks before catalog merging", () => {
  const pageUrl = "https://www.youtube.com/watch?v=video-1";
  const candidate = (itag, mimeType) =>
    createYouTubeCandidateFromObservedSource({
      pageUrl,
      sourceUrl: `https://r1.googlevideo.com/videoplayback?id=asset-1&itag=${itag}&mime=${encodeURIComponent(mimeType)}&dur=20&clen=1000&sig=ok`,
      mimeType,
    });
  const videoKey = createMediaObserverReportKey(
    createRegisteredEvent(
      EVENTS.MEDIA_DISCOVERED,
      candidate("137", "video/mp4"),
    ),
  );
  const audioKey = createMediaObserverReportKey(
    createRegisteredEvent(
      EVENTS.MEDIA_DISCOVERED,
      candidate("140", "audio/mp4"),
    ),
  );

  assert.notEqual(videoKey, audioKey);
  assert.match(videoKey, /video=youtube-video-137/);
  assert.match(audioKey, /audio=youtube-audio-140/);
});

test("YouTube SABR descriptors become provider-resolvable adaptive tracks", () => {
  const observation = parseYouTubePlayerResponse(
    {
      playabilityStatus: { status: "OK" },
      videoDetails: {
        videoId: "video-1",
        title: "Example",
        lengthSeconds: "1085",
      },
      streamingData: {
        serverAbrStreamingUrl:
          "https://r1.googlevideo.com/videoplayback?id=asset-1&sabr=1&sig=ok&n=pending",
        adaptiveFormats: [
          {
            itag: 137,
            mimeType: 'video/mp4; codecs="avc1.640028"',
            width: 1920,
            height: 1080,
            qualityLabel: "1080p",
            contentLength: "54621642",
          },
          {
            itag: 140,
            mimeType: 'audio/mp4; codecs="mp4a.40.2"',
            bitrate: 128000,
            audioSampleRate: "44100",
            audioChannels: 2,
            contentLength: "1730021",
          },
        ],
      },
    },
    {
      pageUrl: "https://www.youtube.com/watch?v=video-1",
      input: "ytInitialPlayerResponse",
    },
  );

  assert.equal(
    observation.diagnostic.stage,
    YOUTUBE_PLAYER_STAGES.SABR_RESOLVER_PENDING,
  );
  assert.equal(observation.diagnostic.descriptorCount, 2);
  assert.equal(observation.candidates.length, 1);
  assert.equal(observation.candidates[0].probeStatus, "discovered");
  assert.equal(observation.candidates[0].variants[0].sourceUrl, null);
  assert.equal(
    observation.candidates[0].variants[0].urlResolution,
    "provider_client_pending",
  );
  const catalog = createMediaCatalog();
  catalog.add(
    7,
    createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, observation.candidates[0]),
  );
  const [item] = catalog.list(7);
  assert.equal(item.probeStatus, "ready");
  assert.equal(getMediaDownloadAvailability(item).supported, true);
  const state = getMediaCatalogDownloadState([item]);
  assert.equal(state.downloadableCount, 1);
  assert.match(formatMediaDetails(item), /1080p.*1 audio/i);
  assert.match(formatMediaDetails(item), /Helper resolves qualities/i);
});

test("YouTube player response merges direct video and audio formats into a ready asset", () => {
  const mediaUrl = (itag, mimeType, extra = "") =>
    `https://r1.googlevideo.com/videoplayback?id=asset-1&itag=${itag}&mime=${encodeURIComponent(mimeType)}&dur=20&clen=1000&sig=ok${extra}`;
  const observation = parseYouTubePlayerResponse(
    {
      playabilityStatus: { status: "OK" },
      videoDetails: { videoId: "video-1", title: "Example" },
      streamingData: {
        adaptiveFormats: [
          {
            itag: 137,
            mimeType: "video/mp4",
            width: 1920,
            height: 1080,
            url: mediaUrl("137", "video/mp4", "&size=1920x1080"),
          },
          {
            itag: 140,
            mimeType: "audio/mp4",
            url: mediaUrl("140", "audio/mp4"),
          },
        ],
      },
    },
    { pageUrl: "https://www.youtube.com/watch?v=video-1" },
  );
  assert.equal(
    observation.diagnostic.stage,
    YOUTUBE_PLAYER_STAGES.RESOLVED_TRACKS,
  );
  assert.equal(observation.candidates.length, 3);

  const catalog = createMediaCatalog();
  for (const candidate of observation.candidates)
    catalog.add(7, createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, candidate));
  const [item] = catalog.list(7);
  assert.equal(item.probeStatus, "ready");
  assert.equal(item.variants.filter((track) => track.sourceUrl).length, 1);
  assert.equal(item.audioTracks.filter((track) => track.sourceUrl).length, 1);
});

test("YouTube keeps same-itag language tracks distinct and prefers original audio", () => {
  const xtags = (entries) => {
    const pair = (key, value) => {
      const keyBytes = Buffer.from(key);
      const valueBytes = Buffer.from(value);
      const body = Buffer.concat([
        Buffer.from([10, keyBytes.length]),
        keyBytes,
        Buffer.from([18, valueBytes.length]),
        valueBytes,
      ]);
      return Buffer.concat([Buffer.from([10, body.length]), body]);
    };
    return Buffer.concat(
      Object.entries(entries).map(([key, value]) => pair(key, value)),
    ).toString("base64url");
  };
  const observation = parseYouTubePlayerResponse(
    {
      playabilityStatus: { status: "OK" },
      videoDetails: { videoId: "video-1", title: "Languages" },
      streamingData: {
        adaptiveFormats: [
          {
            itag: 137,
            mimeType: 'video/mp4; codecs="avc1.640028"',
            width: 1920,
            height: 1080,
            qualityLabel: "1080p",
          },
          {
            itag: 140,
            mimeType: 'audio/mp4; codecs="mp4a.40.2"',
            bitrate: 128000,
            audioSampleRate: "44100",
            audioChannels: 2,
            audioTrack: {
              id: "en.dubbed",
              displayName: "English",
              audioIsDefault: true,
            },
            xtags: xtags({ lang: "en", acont: "dubbed" }),
          },
          {
            itag: 251,
            mimeType: 'audio/webm; codecs="opus"',
            bitrate: 160000,
            audioSampleRate: "48000",
            audioChannels: 2,
            audioTrack: {
              id: "vi.original",
              displayName: "Vietnamese (original)",
              audioIsDefault: false,
            },
            xtags: xtags({ lang: "vi", acont: "original" }),
          },
        ],
      },
    },
    { pageUrl: "https://www.youtube.com/watch?v=video-1" },
  );
  const candidate = observation.candidates[0];
  assert.equal(candidate.audioTracks.length, 2);
  assert.notEqual(candidate.audioTracks[0].id, candidate.audioTracks[1].id);
  const options = getMediaAudioTrackOptions(candidate);
  assert.equal(options[0].role, "original");
  assert.equal(options[0].language, "vi");
  assert.match(
    options[0].label,
    /Vietnamese \(Original\).*160 kbps.*Opus.*Stereo.*48 kHz/i,
  );

  const job = normalizeMediaDownloadJob({
    id: "youtube-original-audio-job",
    createdAt: Date.now(),
    sourceTabId: 7,
    output: {
      profileId: "video-mp4",
      audioTrackId: options[0].id,
    },
    candidate: { ...candidate, probeStatus: "ready" },
  });
  assert.equal(job.output.audioTrackId, options[0].id);
  assert.equal(job.candidate.audioTracks[1].audioRole, "original");
  assert.equal(job.candidate.audioTracks[1].audioSampleRate, 48000);
  assert.equal(job.candidate.audioTracks[1].audioChannels, 2);
});

test("audio labels use English language names and compact region codes", () => {
  assert.equal(
    formatAudioLanguageLabel({
      language: "vi",
      name: "Tiếng Việt",
      role: "original",
    }),
    "Vietnamese (Original)",
  );
  assert.equal(
    formatAudioLanguageLabel({ language: "en-US" }),
    "English (US)",
  );
  assert.equal(
    formatAudioLanguageLabel({ language: "en-GB", role: "dubbed" }),
    "English (UK, Dubbed)",
  );
  assert.equal(
    formatAudioLanguageLabel({ language: "zh-CN" }),
    "Chinese",
  );
  assert.equal(
    formatAudioLanguageLabel({ language: "vi", name: "Vietnamese (original)" }),
    "Vietnamese (Original)",
  );
});

test("YouTube progressive 360p format is ready because audio is already muxed", () => {
  const playerUrl =
    "https://www.youtube.com/s/player/b7457b7c/player_ias.vflset/en_US/base.js";
  const observation = parseYouTubePlayerResponse(
    {
      playabilityStatus: { status: "OK" },
      videoDetails: {
        videoId: "video-1",
        title: "Progressive example",
        lengthSeconds: "193",
      },
      streamingData: {
        formats: [
          {
            itag: 18,
            mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
            width: 640,
            height: 360,
            qualityLabel: "360p",
            contentLength: "1234567",
            url: "https://r1.googlevideo.com/videoplayback?id=asset-1&itag=18&mime=video%2Fmp4&dur=193&clen=1234567&size=640x360&n=unresolved",
          },
        ],
      },
    },
    { pageUrl: "https://www.youtube.com/watch?v=video-1", playerUrl },
  );
  const catalog = createMediaCatalog();
  for (const candidate of observation.candidates)
    catalog.add(7, createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, candidate));
  const [item] = catalog.list(7);

  assert.equal(item.probeStatus, "ready");
  assert.equal(item.variants[0].muxed, true);
  assert.equal(item.audioTracks.length, 0);
  assert.match(formatMediaDetails(item), /360p · audio included/i);
  assert.equal(getMediaDownloadAvailability(item).supported, true);
  assert.match(
    getMediaVideoQualityOptions(item)[0].label,
    /360p.*audio included/i,
  );

  const job = normalizeMediaDownloadJob({
    id: "youtube-progressive-job",
    createdAt: Date.now(),
    sourceTabId: 7,
    output: { videoTrackId: item.variants[0].id },
    candidate: item,
  });
  assert.equal(job.output.videoTrackId, item.variants[0].id);
  assert.equal(job.candidate.playerUrl, playerUrl);
  assert.equal(job.candidate.variants[0].urlResolution, "n_transform_pending");
  assert.equal(job.candidate.variants[0].muxed, true);
});

test("YouTube quality descriptors coexist with a muxed fallback track", () => {
  const mediaUrl =
    "https://r1.googlevideo.com/videoplayback?id=asset-1&itag=18&mime=video%2Fmp4&dur=193&clen=1234567&size=640x360";
  const observation = parseYouTubePlayerResponse(
    {
      playabilityStatus: { status: "OK" },
      videoDetails: {
        videoId: "video-1",
        title: "Partially exposed formats",
        lengthSeconds: "193",
      },
      streamingData: {
        formats: [
          {
            itag: 18,
            mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
            width: 640,
            height: 360,
            qualityLabel: "360p",
            signatureCipher: new URLSearchParams({
              url: mediaUrl,
              sp: "sig",
              s: "encrypted-progressive-signature",
            }).toString(),
          },
        ],
        adaptiveFormats: [
          {
            itag: 137,
            mimeType: 'video/mp4; codecs="avc1.640028"',
            width: 1920,
            height: 1080,
            qualityLabel: "1080p",
            contentLength: "953000000",
          },
          {
            itag: 140,
            mimeType: 'audio/mp4; codecs="mp4a.40.2"',
          },
        ],
      },
    },
    {
      pageUrl: "https://www.youtube.com/watch?v=video-1",
      playerUrl:
        "https://www.youtube.com/s/player/b7457b7c/player_ias.vflset/en_US/base.js",
    },
  );
  const catalog = createMediaCatalog();
  for (const candidate of observation.candidates)
    catalog.add(7, createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, candidate));
  const [item] = catalog.list(7);

  assert.equal(item.probeStatus, "ready");
  assert.equal(item.variants.length, 2);
  assert.equal(item.audioTracks.length, 1);
  assert.equal(getMediaDownloadAvailability(item).supported, true);
  assert.deepEqual(
    getMediaVideoQualityOptions(item).map((quality) => quality.label),
    ["1080p · MP4 · H.264", "360p · MP4 · audio included"],
  );
  assert.deepEqual(
    getMediaVideoQualityOptions(item).map((quality) => [
      quality.groupLabel,
      quality.optionLabel,
    ]),
    [
      ["1080p", "MP4 · H.264"],
      ["360p", "MP4 · audio included"],
    ],
  );
  const estimate = getMediaDownloadEstimate(item, null, {
    videoTrackId: "youtube-video-18",
  });
  assert.deepEqual(estimate.resolution, { width: 640, height: 360 });
  assert.equal(estimate.estimatedBytes, 1_234_567);

  const job = normalizeMediaDownloadJob({
    id: "youtube-partial-descriptor-job",
    createdAt: Date.now(),
    sourceTabId: 7,
    output: {},
    candidate: item,
  });
  assert.equal(job.candidate.variants.length, 2);
  assert.equal(
    job.candidate.variants.find((track) => track.id === "youtube-video-137")
      .urlResolution,
    "provider_client_pending",
  );
  assert.equal(job.candidate.audioTracks.length, 1);
});

test("YouTube quality choices group by resolution and prefer compatible codecs", () => {
  const candidate = {
    kind: "adaptive",
    provider: "youtube",
    audioTracks: [
      {
        id: "audio-140",
        type: "audio",
        itag: "140",
        urlResolution: "provider_client_pending",
      },
    ],
    variants: [
      {
        id: "video-vp9",
        type: "video",
        itag: "248",
        qualityLabel: "1080p",
        height: 1080,
        mimeType: "video/webm",
        codecs: "vp9",
        urlResolution: "provider_client_pending",
      },
      {
        id: "video-av1",
        type: "video",
        itag: "399",
        qualityLabel: "1080p",
        height: 1080,
        mimeType: "video/mp4",
        codecs: "av01.0.08M.08",
        urlResolution: "provider_client_pending",
      },
      {
        id: "video-h264",
        type: "video",
        itag: "137",
        qualityLabel: "1080p",
        height: 1080,
        mimeType: "video/mp4",
        codecs: "avc1.640028",
        urlResolution: "provider_client_pending",
      },
    ],
  };

  assert.deepEqual(
    getMediaVideoQualityOptions(candidate).map((quality) => ({
      id: quality.id,
      group: quality.groupLabel,
      option: quality.optionLabel,
    })),
    [
      { id: "video-h264", group: "1080p", option: "MP4 · H.264" },
      { id: "video-av1", group: "1080p", option: "MP4 · AV1" },
      { id: "video-vp9", group: "1080p", option: "WebM · VP9" },
    ],
  );
});

test("YouTube n challenge tracks become Helper-ready when Player JS is known", () => {
  const mediaUrl = (itag, mimeType, extra = "") =>
    `https://r1.googlevideo.com/videoplayback?id=asset-1&itag=${itag}&mime=${encodeURIComponent(mimeType)}&dur=20&clen=1000&sig=ok&n=unresolved${extra}`;
  const playerUrl =
    "https://www.youtube.com/s/player/b7457b7c/player_ias.vflset/en_US/base.js";
  const observation = parseYouTubePlayerResponse(
    {
      playabilityStatus: { status: "OK" },
      videoDetails: { videoId: "video-1", title: "Example" },
      streamingData: {
        adaptiveFormats: [
          {
            itag: 137,
            mimeType: "video/mp4",
            width: 1920,
            height: 1080,
            url: mediaUrl("137", "video/mp4", "&size=1920x1080"),
          },
          {
            itag: 140,
            mimeType: "audio/mp4",
            url: mediaUrl("140", "audio/mp4"),
          },
        ],
      },
    },
    {
      pageUrl: "https://www.youtube.com/watch?v=video-1",
      playerUrl,
    },
  );

  assert.equal(
    observation.diagnostic.stage,
    YOUTUBE_PLAYER_STAGES.N_TRANSFORM_PENDING,
  );
  assert.equal(observation.candidates.length, 3);
  const catalog = createMediaCatalog();
  for (const candidate of observation.candidates)
    catalog.add(7, createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, candidate));
  const [item] = catalog.list(7);
  assert.equal(item.playerUrl, playerUrl);
  assert.equal(item.probeStatus, "ready");
  assert.equal(item.variants[0].urlResolution, "n_transform_pending");
  assert.equal(item.audioTracks[0].urlResolution, "n_transform_pending");
  assert.match(formatMediaDetails(item), /Helper resolves n/i);
  assert.equal(getMediaDownloadAvailability(item).supported, true);
});

test("YouTube signatureCipher video and audio tracks use the same Player JS resolver", () => {
  const mediaUrl = (itag, mimeType, extra = "") =>
    `https://r1.googlevideo.com/videoplayback?id=asset-1&itag=${itag}&mime=${encodeURIComponent(mimeType)}&dur=20&clen=1000${extra}`;
  const cipher = (url, signature) =>
    new URLSearchParams({ url, sp: "sig", s: signature }).toString();
  const playerUrl =
    "https://www.youtube.com/s/player/b7457b7c/player_ias.vflset/en_US/base.js";
  const observation = parseYouTubePlayerResponse(
    {
      playabilityStatus: { status: "OK" },
      videoDetails: { videoId: "video-1", title: "Cipher example" },
      streamingData: {
        adaptiveFormats: [
          {
            itag: 137,
            mimeType: "video/mp4",
            width: 1920,
            height: 1080,
            signatureCipher: cipher(
              mediaUrl("137", "video/mp4", "&size=1920x1080&n=pending"),
              "encrypted-video-signature",
            ),
          },
          {
            itag: 140,
            mimeType: "audio/mp4",
            signatureCipher: cipher(
              mediaUrl("140", "audio/mp4"),
              "encrypted-audio-signature",
            ),
          },
        ],
      },
    },
    { pageUrl: "https://www.youtube.com/watch?v=video-1", playerUrl },
  );

  assert.equal(
    observation.diagnostic.stage,
    YOUTUBE_PLAYER_STAGES.SIGNATURE_CIPHER_PENDING,
  );
  assert.equal(observation.candidates.length, 3);
  const catalog = createMediaCatalog();
  for (const candidate of observation.candidates)
    catalog.add(7, createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, candidate));
  const [item] = catalog.list(7);
  assert.equal(item.probeStatus, "ready");
  assert.equal(item.variants[0].urlResolution, "signature_cipher_pending");
  assert.equal(item.audioTracks[0].urlResolution, "signature_cipher_pending");
  assert.match(formatMediaDetails(item), /Helper resolves signature/i);
  assert.equal(getMediaDownloadAvailability(item).supported, true);
});

test("a direct YouTube video track merges with signatureCipher audio", () => {
  const pageUrl = "https://www.youtube.com/watch?v=video-1";
  const observation = parseYouTubePlayerResponse(
    {
      playabilityStatus: { status: "OK" },
      videoDetails: { videoId: "video-1", title: "Mixed example" },
      streamingData: {
        adaptiveFormats: [
          {
            itag: 18,
            mimeType: "video/mp4",
            width: 640,
            height: 360,
            url: "https://r1.googlevideo.com/videoplayback?id=asset-1&itag=18&mime=video%2Fmp4&dur=20&clen=1000&sig=ok",
          },
          {
            itag: 140,
            mimeType: "audio/mp4",
            signatureCipher: new URLSearchParams({
              url: "https://r1.googlevideo.com/videoplayback?id=asset-1&itag=140&mime=audio%2Fmp4&dur=20&clen=200",
              sp: "sig",
              s: "encrypted-audio-signature",
            }).toString(),
          },
        ],
      },
    },
    {
      pageUrl,
      playerUrl:
        "https://www.youtube.com/s/player/b7457b7c/player_ias.vflset/en_US/base.js",
    },
  );
  const catalog = createMediaCatalog();
  for (const candidate of observation.candidates)
    catalog.add(7, createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, candidate));
  const [item] = catalog.list(7);
  assert.equal(item.probeStatus, "ready");
  assert.equal(item.variants.filter((track) => track.sourceUrl).length, 1);
  assert.equal(item.audioTracks.filter((track) => track.sourceUrl).length, 1);
});

test("YouTube Player JS URL is discovered from page configuration or scripts", () => {
  const configured = findYouTubePlayerUrl({
    windowObject: {
      ytcfg: {
        get: (key) =>
          key === "PLAYER_JS_URL"
            ? "/s/player/b7457b7c/player_ias.vflset/en_US/base.js"
            : null,
      },
    },
    documentObject: { querySelectorAll: () => [] },
  });
  assert.equal(
    configured,
    "https://www.youtube.com/s/player/b7457b7c/player_ias.vflset/en_US/base.js",
  );

  const scripted = findYouTubePlayerUrl({
    windowObject: {},
    documentObject: {
      querySelectorAll: () => [
        {
          src: "https://www.youtube.com/s/player/1234abcd/player_ias.vflset/en_US/base.js",
        },
      ],
    },
  });
  assert.match(scripted, /\/s\/player\/1234abcd\//);

  const fromResponse = findYouTubePlayerUrl({
    windowObject: {},
    documentObject: { querySelectorAll: () => [] },
    responseObject: {
      assets: {
        js: "/s/player/response1/player_ias.vflset/en_US/base.js",
      },
    },
  });
  assert.match(fromResponse, /\/s\/player\/response1\//);
});

test("YouTube observation fingerprint permits a later Player JS upgrade", () => {
  const response = {
    playabilityStatus: { status: "OK" },
    videoDetails: { videoId: "video-1", title: "Example" },
    streamingData: {
      formats: [
        {
          itag: 18,
          mimeType: "video/mp4",
          width: 640,
          height: 360,
          url: "https://r1.googlevideo.com/videoplayback?id=asset-1&itag=18&mime=video%2Fmp4&n=pending",
        },
      ],
    },
  };
  const withoutPlayer = parseYouTubePlayerResponse(response, {
    pageUrl: "https://www.youtube.com/watch?v=video-1",
  });
  const withPlayer = parseYouTubePlayerResponse(response, {
    pageUrl: "https://www.youtube.com/watch?v=video-1",
    playerUrl:
      "https://www.youtube.com/s/player/b7457b7c/player_ias.vflset/en_US/base.js",
  });
  assert.notEqual(
    observationFingerprint(withoutPlayer),
    observationFingerprint(withPlayer),
  );
});

test("YouTube format descriptors cannot erase a resolved network track", () => {
  const pageUrl = "https://www.youtube.com/watch?v=video-1";
  const resolved = createYouTubeCandidateFromObservedSource({
    pageUrl,
    sourceUrl:
      "https://r1.googlevideo.com/videoplayback?id=asset-1&itag=137&mime=video%2Fmp4&dur=20&clen=1000&size=1920x1080&sig=ok",
    mimeType: "video/mp4",
  });
  const diagnostic = parseYouTubePlayerResponse(
    {
      playabilityStatus: { status: "OK" },
      videoDetails: { videoId: "video-1" },
      streamingData: {
        serverAbrStreamingUrl:
          "https://r1.googlevideo.com/videoplayback?id=asset-1&sabr=1&sig=ok&n=pending",
        adaptiveFormats: [
          {
            itag: 137,
            mimeType: "video/mp4",
            width: 1920,
            height: 1080,
          },
        ],
      },
    },
    { pageUrl },
  ).candidates[0];
  const catalog = createMediaCatalog();
  catalog.add(7, createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, resolved));
  catalog.add(7, createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, diagnostic));

  const [item] = catalog.list(7);
  assert.match(item.variants[0].sourceUrl, /googlevideo\.com\/videoplayback/);
  assert.equal(
    new URL(item.variants[0].sourceUrl).searchParams.get("itag"),
    "137",
  );
});

test("YouTube popup diagnostics expose the exact unresolved acquisition stage", () => {
  const blob = createMediaCandidateFromSource({
    pageUrl: "https://www.youtube.com/watch?v=video-1",
    sourceUrl: "blob:https://www.youtube.com/player-1",
    title: "Example - YouTube",
    detectedBy: "player",
  });
  const blobState = getMediaCatalogDownloadState([blob]);
  assert.equal(blobState.diagnosticCode, "youtube_network_track_missing");
  assert.match(
    formatMediaHelperSummary({ status: "ready" }, blobState),
    /no googlevideo playback URL was visible/i,
  );
  assert.match(formatMediaDetails(blob), /page hook\/resource timing/i);

  const videoTrack = parseYouTubePlaybackTrack(
    "https://r1.googlevideo.com/videoplayback?id=asset-1&itag=137&mime=video%2Fmp4&dur=20&clen=1000&sig=ok",
    { mimeType: "video/mp4" },
  );
  const adaptive = createYouTubeAdaptiveCandidate({
    pageUrl: "https://www.youtube.com/watch?v=video-1",
    title: "Example - YouTube",
    track: videoTrack,
  });
  const trackState = getMediaCatalogDownloadState([adaptive]);
  assert.equal(trackState.diagnosticCode, "youtube_audio_pending");
  assert.match(trackState.diagnosticMessage, /waiting for an audio track/i);
});

test("offers a helper setup action independently from downloadable media", () => {
  assert.deepEqual(helperSetupPresentation({ status: "permission_required" }), {
    label: "Allow helper connection",
    title: "Allow AdsFriendly to communicate with the installed Media Helper.",
  });
  assert.equal(helperSetupPresentation({ status: "ready" }), null);
  assert.equal(
    helperSetupPresentation({ status: "not_installed" }).label,
    "Install helper",
  );
  assert.equal(
    helperSetupPresentation({ status: "error", error: "Host unavailable" })
      .label,
    "Retry helper",
  );
  assert.equal(
    helperSetupPresentation(
      { status: "permission_required" },
      { hasDownloadableMedia: false },
    ),
    null,
  );
  assert.equal(
    formatMediaHelperSummary(
      {
        status: "unavailable",
        error: "Media Helper handshake timed out.",
      },
      { downloadableCount: 1, drmBlockedCount: 0 },
    ),
    "Media found · Media Helper took too long to start.",
  );
});

test("browser AES handoff captures only keys declared by an identity HLS manifest", async () => {
  const manifestUrl = "https://cdn.example/video/index.m3u8";
  const keyUrl = "https://cdn.example/video/key.bin";
  clearAesKeyHandoffs();
  try {
    assert.deepEqual(
      rememberHlsKeyUris(
        manifestUrl,
        '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:4,\nsegment.ts',
      ),
      [keyUrl],
    );
    assert.equal(
      await captureFetchAesKey(
        keyUrl,
        new Response(Buffer.from("0123456789abcdef")),
      ),
      true,
    );
    const handoff = getAesKeyHandoff(manifestUrl);
    assert.equal(handoff.length, 1);
    assert.deepEqual(
      {
        url: handoff[0].url,
        data: handoff[0].data,
        bytes: handoff[0].bytes,
      },
      {
        url: keyUrl,
        data: Buffer.from("0123456789abcdef").toString("base64"),
        bytes: 16,
      },
    );
    assert.equal(typeof handoff[0].capturedAt, "number");

    const drmManifest = "https://cdn.example/drm/index.m3u8";
    assert.deepEqual(
      rememberHlsKeyUris(
        drmManifest,
        '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,KEYFORMAT="com.widevine",URI="license"',
      ),
      [],
    );
    assert.deepEqual(getAesKeyHandoff(drmManifest), []);
  } finally {
    clearAesKeyHandoffs();
  }
});

test("browser AES handoff survives a key response that wins the manifest parse race", async () => {
  const manifestUrl = "https://cdn.example/video/child.m3u8";
  const keyUrl = "https://cdn.example/video/racing-key.bin";
  const keyBytes = Buffer.from("0123456789abcdef");
  clearAesKeyHandoffs();
  try {
    const responseWithoutLength = () =>
      new Response(keyBytes, {
        headers: { "content-type": "application/octet-stream" },
      });
    assert.equal(responseWithoutLength().headers.get("content-length"), null);
    assert.equal(
      await captureFetchAesKey(keyUrl, responseWithoutLength()),
      false,
    );
    const finishManifestInspection = beginHlsManifestInspection();
    const captured = await captureFetchAesKey(keyUrl, responseWithoutLength());
    finishManifestInspection();
    assert.equal(captured, true);
    assert.deepEqual(getAesKeyHandoff(manifestUrl), []);
    rememberHlsKeyUris(
      manifestUrl,
      '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="racing-key.bin"\n#EXTINF:4,\nsegment.ts',
    );
    assert.equal(
      getAesKeyHandoff(manifestUrl)[0].data,
      keyBytes.toString("base64"),
    );

    const finishOversizedInspection = beginHlsManifestInspection();
    const oversizedCaptured = await captureFetchAesKey(
      "https://cdn.example/video/not-a-key.bin",
      new Response(Buffer.alloc(64), {
        headers: { "content-type": "application/octet-stream" },
      }),
    );
    finishOversizedInspection();
    assert.equal(oversizedCaptured, false);
  } finally {
    clearAesKeyHandoffs();
  }
});

test("browser AES handoff retries a declared key inside the player page context", async () => {
  const manifestUrl = "https://cdn.example/video/child.m3u8";
  const keyUrl = "https://cdn.example/video/key.bin";
  const keyBytes = Buffer.from("0123456789abcdef");
  clearAesKeyHandoffs();
  try {
    rememberHlsKeyUris(
      manifestUrl,
      '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key.bin"\n#EXTINF:4,\nsegment.ts',
    );
    const calls = [];
    const result = await recoverAesKeyHandoffs(
      [manifestUrl],
      async (url, init) => {
        calls.push({ url, init });
        return new Response(keyBytes, {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        });
      },
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, keyUrl);
    assert.equal(calls[0].init.credentials, "include");
    assert.equal(result.keys[0].data, keyBytes.toString("base64"));
    assert.equal(result.diagnostic.requestedManifestCount, 1);
    assert.equal(result.diagnostic.matchedManifestCount, 1);
    assert.equal(result.diagnostic.relatedManifestCount, 1);
    assert.equal(result.diagnostic.keyDirectiveCount, 1);
    assert.equal(result.diagnostic.declaredKeyCount, 1);
    assert.equal(result.diagnostic.capturedKeyCount, 1);
    assert.equal(result.diagnostic.pageManifestFetchAttemptCount, 0);
    assert.equal(result.diagnostic.pageFetchAttemptCount, 1);
    assert.equal(result.diagnostic.pageFetchSuccessCount, 1);
    assert.deepEqual(result.diagnostic.pageFetchStatuses, [200]);
  } finally {
    clearAesKeyHandoffs();
  }
});

test("browser AES handoff follows declared HLS master children before fetching a key", async () => {
  const masterUrl = "https://cdn.example/video/master.m3u8";
  const childUrl = "https://cdn.example/video/720p/index.m3u8";
  const keyUrl = "https://cdn.example/video/720p/key.bin";
  const keyBytes = Buffer.from("0123456789abcdef");
  clearAesKeyHandoffs();
  try {
    assert.deepEqual(
      rememberHlsKeyUris(
        masterUrl,
        "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000000\n720p/index.m3u8",
      ),
      [],
    );
    const calls = [];
    const result = await recoverAesKeyHandoffs([masterUrl], async (url) => {
      calls.push(url);
      if (url === childUrl) {
        return new Response(
          '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key.bin"\n#EXTINF:4,\nsegment.ts',
          { status: 200 },
        );
      }
      if (url === keyUrl) return new Response(keyBytes, { status: 200 });
      return new Response("Not found", { status: 404 });
    });
    assert.deepEqual(calls, [childUrl, keyUrl]);
    assert.equal(result.keys[0].url, keyUrl);
    assert.equal(result.diagnostic.matchedManifestCount, 1);
    assert.equal(result.diagnostic.relatedManifestCount, 2);
    assert.equal(result.diagnostic.pageManifestFetchSuccessCount, 1);
    assert.equal(result.diagnostic.pageFetchSuccessCount, 1);
  } finally {
    clearAesKeyHandoffs();
  }
});

test("browser AES handoff reports a rejected page-context key retry", async () => {
  const manifestUrl = "https://cdn.example/video/child.m3u8";
  clearAesKeyHandoffs();
  try {
    rememberHlsKeyUris(
      manifestUrl,
      '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:4,\nsegment.ts',
    );
    const result = await recoverAesKeyHandoffs(
      [manifestUrl],
      async () => new Response("Forbidden", { status: 403 }),
    );
    assert.deepEqual(result.keys, []);
    assert.equal(result.diagnostic.declaredKeyCount, 1);
    assert.equal(result.diagnostic.pageFetchAttemptCount, 1);
    assert.equal(result.diagnostic.pageFetchSuccessCount, 0);
    assert.deepEqual(result.diagnostic.pageFetchStatuses, [403]);
  } finally {
    clearAesKeyHandoffs();
  }
});

test("browser AES diagnostics distinguish an unsupported key directive from a missing key", async () => {
  const manifestUrl = "https://cdn.example/video/drm.m3u8";
  clearAesKeyHandoffs();
  try {
    rememberHlsKeyUris(
      manifestUrl,
      '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,KEYFORMAT="com.widevine",URI="license"\n#EXTINF:4,\nsegment.ts',
    );
    const result = await recoverAesKeyHandoffs([manifestUrl], null);
    assert.equal(result.diagnostic.keyDirectiveCount, 1);
    assert.equal(result.diagnostic.unsupportedKeyDirectiveCount, 1);
    assert.deepEqual(result.diagnostic.encryptionMethods, ["SAMPLE-AES"]);
    assert.deepEqual(result.diagnostic.encryptionKeyFormats, ["com.widevine"]);
    assert.equal(result.diagnostic.declaredKeyCount, 0);
  } finally {
    clearAesKeyHandoffs();
  }
});

test("AES key diagnostics are bounded and explain a page-context rejection", () => {
  const diagnostic = normalizeAesKeyHandoffDiagnostic({
    framesQueried: 2,
    framesResponded: 1,
    requestedManifestCount: 4,
    matchedManifestCount: 1,
    relatedManifestCount: 1,
    relatedManifestBytes: 1200,
    childManifestCount: 0,
    keyDirectiveCount: 1,
    unsupportedKeyDirectiveCount: 0,
    segmentDirectiveCount: 200,
    encryptionMethods: ["SAMPLE-AES"],
    encryptionKeyFormats: ["identity"],
    declaredKeyCount: 1,
    capturedKeyCount: 0,
    pageFetchAttemptCount: 1,
    pageFetchSuccessCount: 0,
    pageFetchStatuses: [403, 403, 999],
    pageFetchErrorCount: 0,
    pageManifestFetchAttemptCount: 0,
    pageManifestFetchSuccessCount: 0,
    pageManifestFetchStatuses: [],
    pageManifestFetchErrorCount: 0,
  });
  assert.deepEqual(diagnostic.pageFetchStatuses, [403]);
  assert.match(
    formatAesKeyHandoffDiagnostic(diagnostic),
    /1\/2 frames responded.*1 key directives.*1 identity keys declared.*key fetch status 403/i,
  );
});

test("AES handoff targets retain validated master-child URLs and iframe IDs", () => {
  const child = {
    id: "child",
    kind: "hls",
    manifestUrl: "https://cdn.example/720p/index.m3u8",
    frameId: 7,
    parentManifestIds: ["master"],
  };
  const targets = collectAesKeyHandoffTargets(child, [
    {
      id: "master",
      kind: "hls",
      manifestUrl: "https://embed.example/master.m3u8",
      frameId: 7,
      childManifestIds: ["child"],
      variants: [{ url: "https://cdn.example/720p/index.m3u8" }],
    },
    {
      id: "unrelated",
      kind: "hls",
      manifestUrl: "https://ads.example/ad.m3u8",
      frameId: 9,
    },
  ]);
  assert.deepEqual(targets, {
    manifestUrls: [
      "https://cdn.example/720p/index.m3u8",
      "https://embed.example/master.m3u8",
    ],
    frameIds: [7],
  });
});

test("AES handoff inspects an HLS master even before child encryption metadata arrives", () => {
  assert.equal(
    shouldRequestAesKeyHandoff({
      kind: "hls",
      playlistType: "master",
      encryptionMethods: [],
    }),
    true,
  );
  assert.equal(
    shouldRequestAesKeyHandoff({
      kind: "blob",
      selectedMediaId: "resolved-hls-child",
    }),
    false,
  );
});

test("download job view exposes speed, connections, and resumable actions", () => {
  const active = {
    id: "job-1",
    status: "downloading",
    connections: 12,
    progress: {
      downloadedBytes: 5 * 1024 * 1024,
      totalBytes: 20 * 1024 * 1024,
      bytesPerSecond: 2 * 1024 * 1024,
      resumable: true,
      resumedBytes: 1024,
    },
  };
  assert.deepEqual(getMediaJobProgress(active), {
    percent: 25,
    downloadedBytes: 5 * 1024 * 1024,
    totalBytes: 20 * 1024 * 1024,
    bytesPerSecond: 2 * 1024 * 1024,
    processedSeconds: null,
    duration: null,
    resumedBytes: 1024,
    resumable: true,
    connections: 12,
  });
  assert.equal(
    formatMediaJobDetails(active),
    "25% · 5.0 MB / 20.0 MB · Speed 2.0 MB/s · resumed 1 KB · 12 connections",
  );
  assert.equal(getMediaJobPrimaryAction(active).type, "pause");
  assert.equal(getMediaJobPauseAvailability(active).supported, true);
  assert.equal(
    getMediaJobPrimaryAction({ ...active, status: "paused" }).type,
    "resume",
  );
  assert.equal(
    getMediaJobPrimaryAction({ ...active, status: "cancelled" }).type,
    "retry",
  );
  assert.equal(
    getMediaJobPrimaryAction({
      ...active,
      progress: { ...active.progress, resumable: false },
    }).type,
    "cancel",
  );
  assert.equal(
    getMediaJobPrimaryAction({
      ...active,
      status: "cancelled",
      historyOnly: true,
    }),
    null,
  );
  const hls = {
    status: "downloading",
    kind: "hls",
    connections: 8,
    progress: { bytesPerSecond: null, resumable: false },
  };
  assert.equal(formatMediaJobDetails(hls), "Speed 0 KB/s · 8 connections");
  assert.deepEqual(getMediaJobPauseAvailability(hls), {
    supported: false,
    label: "Pause unavailable",
    reason:
      "HLS downloads run through FFmpeg and cannot resume partial output yet.",
  });
  assert.equal(
    formatMediaJobDetails({
      status: "probing",
      connections: 12,
      progress: { stage: "ffmpeg_start", bytesPerSecond: 0 },
    }),
    "Starting FFmpeg…",
  );
});

test("popup download history stays compact and prioritizes active jobs", () => {
  const completed = {
    id: "completed",
    status: "completed",
    progress: { totalBytes: 70 * 1024 * 1024 },
  };
  const cancelled = {
    id: "cancelled",
    status: "cancelled",
    progress: { downloadedBytes: 11 * 1024 * 1024 },
  };
  assert.equal(formatCompactMediaJobDetails(completed), "Completed · 70.0 MB");
  assert.equal(formatCompactMediaJobDetails(cancelled), "Cancelled");
  assert.deepEqual(
    selectCompactMediaJobs(
      [completed, cancelled, { id: "active", status: "downloading" }],
      2,
    ).map((job) => job.id),
    ["active", "completed"],
  );
});

test("classifies direct, HLS, DASH, and blob media without treating segments as videos", () => {
  assert.equal(
    classifyMediaSource("https://cdn.example/movie.mp4?token=1"),
    "direct",
  );
  assert.equal(
    classifyMediaSource("https://cdn.example/master.M3U8#live"),
    "hls",
  );
  assert.equal(
    classifyMediaSource("/manifest", "application/dash+xml"),
    "dash",
  );
  assert.equal(classifyMediaSource("blob:https://video.example/id"), "blob");
  assert.equal(classifyMediaSource("https://cdn.example/segment.ts"), null);
  assert.equal(
    classifyMediaSource("https://cdn.example/random.ts", "video/mp2t"),
    null,
  );
  assert.equal(
    classifyMediaSource("https://cdn.example/42.m4s", "video/mp4"),
    null,
  );
  assert.equal(
    classifyMediaSource("https://cdn.example/no-extension", "video/mp2t"),
    null,
  );
  assert.equal(
    isLikelyMediaSegment("https://cdn.example/movie.mp4", "video/mp4"),
    false,
  );
});

test("background request observation exposes a bounded catalog input", () => {
  const observation = createMediaRequestObservation({
    requestId: "42",
    tabId: 7,
    frameId: 3,
    parentFrameId: 0,
    initiator: "https://embed.streamc.xyz/player",
    url: "https://cdn.streamc.example/token",
    method: "GET",
    statusCode: 200,
    timeStamp: 1234,
    responseHeaders: [
      { name: "Content-Type", value: "application/vnd.apple.mpegurl" },
    ],
  });
  assert.deepEqual(
    {
      tabId: observation.tabId,
      frameId: observation.frameId,
      kind: observation.kind,
      initiator: observation.initiator,
      input: observation.input,
      output: observation.output,
    },
    {
      tabId: 7,
      frameId: 3,
      kind: "hls",
      initiator: "https://embed.streamc.xyz",
      input: "chrome.webRequest.onHeadersReceived",
      output: "media.catalog.candidate",
    },
  );
  assert.equal(
    createMediaRequestObservation({
      tabId: 7,
      frameId: 3,
      url: "https://cdn.example/segment.ts",
      statusCode: 200,
      responseHeaders: [{ name: "content-type", value: "video/mp2t" }],
    }),
    null,
  );
});

test("temporary manifest capture is bounded and expires without entering the catalog", () => {
  const capture = normalizeDebugCapture(
    {
      mediaId: "child",
      manifestUrl: "https://cdn.example/child.m3u8?token=secret",
      kind: "hls",
      body: "#EXTM3U\n#EXTINF:4,\nsegment.ts",
      bodyFormat: "hls",
      reason: "manifest_parsed_no_stream",
    },
    1000,
  );
  assert.equal(capture.bodyBytes, 29);
  assert.equal(capture.capturedAt, 1000);
  assert.equal(capture.expiresAt, 901000);
  assert.throws(
    () =>
      normalizeDebugCapture({
        ...capture,
        body: "x".repeat(512 * 1024 + 1),
      }),
    /512 KB session limit/,
  );
});

test("resolution diagnostics identify a failed master with no observed child", () => {
  const master = {
    id: "master",
    kind: "hls",
    frameId: 3,
    probeStatus: "failed",
    probeError: "manifest_http_403",
  };
  const result = diagnoseMediaResolution(master, [master]);
  assert.equal(result.stage, MEDIA_RESOLUTION_STAGES.CHILD_DISCOVERY);
  assert.equal(result.status, "failed");
  assert.equal(result.code, "master_failed_child_not_observed");
  assert.deepEqual(MEDIA_RESOLUTION_STAGE_CATALOG[result.stage], {
    input: "Master or playback request",
    output: "Observed child playlist",
  });
  assert.equal(result.input, "Master or playback request");
  assert.equal(result.output, "Observed child playlist");
  assert.equal(
    result.message,
    "Child discovery · 0 child playlists · master probe 403",
  );
});

test("resolution diagnostics distinguish child probing from source matching", () => {
  const master = {
    id: "master",
    kind: "hls",
    frameId: 3,
    probeStatus: "failed",
    probeError: "manifest_http_403",
    firstSeenAt: 1000,
  };
  const pendingChild = {
    id: "child",
    kind: "hls",
    frameId: 3,
    probeStatus: "discovered",
    firstSeenAt: 1010,
  };
  assert.equal(
    diagnoseMediaResolution(master, [master, pendingChild]).stage,
    MEDIA_RESOLUTION_STAGES.CHILD_PROBE,
  );
  const readyChild = {
    ...pendingChild,
    probeStatus: "ready",
    playlistType: "media",
    streamType: "vod",
    segmentCount: 20,
  };
  const result = diagnoseMediaResolution(master, [master, readyChild]);
  assert.equal(result.stage, MEDIA_RESOLUTION_STAGES.SOURCE_MATCHING);
  assert.equal(result.code, "child_ready_not_matched");
});

test("resolution diagnostics expose the exact child probe outcome", () => {
  const master = {
    id: "master",
    kind: "hls",
    frameId: 3,
    probeStatus: "failed",
    firstSeenAt: 1000,
  };
  const child = {
    id: "child",
    kind: "hls",
    frameId: 3,
    probeStatus: "discovered",
    firstSeenAt: 1010,
    probeDiagnostics: [
      {
        phase: "failed",
        code: "manifest_http_403",
        httpStatus: 403,
        observedAt: 2000,
      },
    ],
  };
  assert.equal(
    diagnoseMediaResolution(master, [master, child]).message,
    "Child probe · HTTP 403",
  );
  child.probeDiagnostics = [
    {
      phase: "parsed",
      code: "manifest_parsed_zero_segments",
      bodyBytes: 2048,
      bodyFormat: "hls",
      observedAt: 3000,
    },
  ];
  assert.equal(
    diagnoseMediaResolution(master, [master, child]).message,
    "Child probe · 2.0 KB hls parsed · 0 segments",
  );
});

test("resolution diagnostics stop at the explicit decrypted-manifest handoff", () => {
  const result = diagnoseMediaResolution({
    id: "decrypted-hls",
    kind: "hls",
    probeStatus: "ready",
    probeSource: "decrypted_blob",
    playlistType: "media",
    streamType: "vod",
    segmentCount: 20,
    drm: "none",
  });
  assert.equal(result.stage, MEDIA_RESOLUTION_STAGES.PLAYER_DECRYPTION);
  assert.equal(result.code, "decrypted_manifest_handoff_pending");
  assert.equal(result.status, "unhandled");
  assert.deepEqual(MEDIA_RESOLUTION_STAGE_CATALOG[result.stage], {
    input: "Encrypted manifest + player Blob",
    output: "Parsed plaintext manifest",
  });
});

test("resolution diagnostics wait for an unsupported mixed SAMPLE-AES method", () => {
  const result = diagnoseMediaResolution({
    id: "sample-aes-hls",
    kind: "hls",
    probeStatus: "ready",
    playlistType: "media",
    streamType: "vod",
    segmentCount: 20,
    drm: "suspected",
    encryptionScheme: "sample-aes",
    encryptionMethods: ["SAMPLE-AES", "VENDOR-CIPHER"],
    encryptionKeyFormats: ["identity"],
    drmEvidence: ["hls-sample-aes"],
  });
  assert.equal(result.stage, MEDIA_RESOLUTION_STAGES.PLAYER_SEGMENT_RESOLUTION);
  assert.equal(result.status, "waiting");
  assert.equal(result.code, "sample_aes_player_segments_pending");
  assert.deepEqual(MEDIA_RESOLUTION_STAGE_CATALOG[result.stage], {
    input: "SAMPLE-AES candidate + player playback",
    output: "Resolved media segment sequence",
  });
  assert.equal(
    result.message,
    "Player URL resolution · waiting for resolved media segments",
  );
});

test("custom SAMPLE-AES key formats are playback only without an adapter", () => {
  const availability = getMediaDownloadAvailability({
    kind: "hls",
    probeStatus: "ready",
    playlistType: "media",
    streamType: "vod",
    segmentCount: 20,
    drm: "suspected",
    encryptionScheme: "sample-aes",
    encryptionMethods: ["SAMPLE-AES-CTR"],
    encryptionKeyFormats: ["urn:avs:shield:v3"],
    drmEvidence: ["hls-sample-aes"],
  });
  assert.equal(availability.supported, false);
  assert.match(
    availability.reason,
    /Custom protected HLS · urn:avs:shield:v3 · Playback only/i,
  );
  const diagnostic = diagnoseMediaResolution({
    id: "avs-shield",
    kind: "hls",
    probeStatus: "ready",
    playlistType: "media",
    streamType: "vod",
    segmentCount: 310,
    drm: "suspected",
    encryptionScheme: "sample-aes",
    encryptionMethods: ["SAMPLE-AES-CTR"],
    encryptionKeyFormats: ["urn:avs:shield:v3"],
  });
  assert.equal(diagnostic.stage, MEDIA_RESOLUTION_STAGES.PLAYBACK_ONLY);
  assert.equal(diagnostic.code, "custom_hls_protection_playback_only");
});

test("HLS key formats are canonicalized before protection classification", () => {
  const parsed = parseHlsManifest(
    "https://media.example.test/video/index.m3u8",
    '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,KEYFORMAT=" Identity ",URI="key.bin"\n#EXTINF:6,\nsegment.ts\n#EXT-X-ENDLIST',
  );

  assert.deepEqual(parsed.encryptionKeyFormats, ["identity"]);
  assert.equal(parsed.drm, "suspected");
  assert.deepEqual(
    getMediaDownloadAvailability({
      kind: "hls",
      probeStatus: "ready",
      ...parsed,
    }),
    {
      supported: true,
      reason: null,
    },
  );
});

test("resolution diagnostics report probe state before SAMPLE-AES resolution", () => {
  const result = diagnoseMediaResolution({
    id: "sample-aes-discovered",
    kind: "hls",
    probeStatus: "discovered",
    playlistType: "unknown",
    streamType: "unknown",
    drm: "suspected",
    encryptionScheme: "sample-aes",
    drmEvidence: ["hls-sample-aes"],
  });
  assert.equal(result.stage, MEDIA_RESOLUTION_STAGES.MANIFEST_PROBE);
  assert.equal(result.status, "waiting");
  assert.equal(result.code, "hls_probe_pending");
  assert.equal(result.message, "Manifest probe · HLS response not parsed yet");
});

test("resolution diagnostics expose contextual probe preparation", () => {
  const result = diagnoseMediaResolution({
    id: "contextual-hls",
    kind: "hls",
    probeStatus: "discovered",
    playlistType: "unknown",
    probeDiagnostics: [
      {
        phase: "dispatched",
        code: "contextual_probe_prepared",
        observedAt: 2000,
      },
    ],
  });
  assert.equal(result.stage, MEDIA_RESOLUTION_STAGES.MANIFEST_PROBE);
  assert.equal(result.status, "waiting");
  assert.equal(result.code, "contextual_probe_prepared");
  assert.equal(
    result.message,
    "Manifest probe · Referer/Origin prepared · retry starting",
  );
});

test("catalog retains bounded probe metadata without storing manifest bodies", () => {
  const catalog = createMediaCatalog();
  const candidate = createMediaCandidateFromSource({
    pageUrl: "https://video.example/watch",
    sourceUrl: "https://cdn.example/child.m3u8",
    detectedBy: "network",
  });
  catalog.add(1, createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, candidate));
  const updated = catalog.applyProbeDiagnostic(
    1,
    createRegisteredEvent(EVENTS.MEDIA_PROBE_DIAGNOSTIC, {
      mediaId: candidate.id,
      pageUrl: candidate.pageUrl,
      manifestUrl: candidate.manifestUrl,
      kind: candidate.kind,
      phase: "response_received",
      code: "manifest_body_received",
      httpStatus: 200,
      bodyBytes: 4096,
      bodyFormat: "hls",
      observedAt: 2000,
    }),
  );
  assert.deepEqual(updated.probeDiagnostic, {
    mediaId: candidate.id,
    pageUrl: candidate.pageUrl,
    manifestUrl: candidate.manifestUrl,
    kind: candidate.kind,
    phase: "response_received",
    code: "manifest_body_received",
    httpStatus: 200,
    bodyBytes: 4096,
    bodyFormat: "hls",
    playlistType: null,
    segmentCount: null,
    observationSource: null,
    envelopeScheme: null,
    correlationConfidence: null,
    evidence: [],
    observedAt: 2000,
  });
  assert.equal("body" in updated.probeDiagnostic, false);
});

test("catalog merges webRequest routing context into an existing candidate", () => {
  const catalog = createMediaCatalog();
  const candidate = createMediaCandidateFromSource({
    pageUrl: "https://video.example/watch",
    sourceUrl: "https://cdn.example/master.m3u8",
    detectedBy: "network",
  });
  catalog.add(1, createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, candidate));
  const updated = catalog.add(
    1,
    createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, {
      ...candidate,
      requestContexts: [
        {
          requestUrl: candidate.manifestUrl,
          documentUrl: "https://embed.example/player",
          method: "GET",
          credentials: "unknown",
          transport: "web_request",
          requiresBrowserSession: true,
          observedAt: 2000,
        },
      ],
    }),
  );
  assert.equal(updated.requestContexts.length, 1);
  assert.equal(updated.requestContexts[0].transport, "web_request");
});

test("resolved Blob details expose the exact stalled resolution stage", () => {
  const master = {
    id: "master",
    kind: "hls",
    frameId: 3,
    probeStatus: "failed",
    probeError: "manifest_http_403",
  };
  const blob = {
    id: "blob",
    kind: "blob",
    selectedMediaId: "master",
    resolvedKind: "hls",
    resolvedStream: master,
  };
  const [visible] = selectVisibleMediaItems([blob, master]);
  assert.equal(
    formatMediaDetails(visible),
    "Blob resolved to HLS · Child discovery · 0 child playlists · master probe 403",
  );
});

test("parses a static DASH manifest into video and audio choices", () => {
  const parsed = parseDashManifest(
    "https://cdn.example/movie/manifest.mpd",
    `<?xml version="1.0"?>
      <MPD type="static" mediaPresentationDuration="PT1H26M3.5S">
        <Period>
          <AdaptationSet contentType="video" mimeType="video/mp4">
            <Representation id="v720" bandwidth="2200000" width="1280" height="720" codecs="avc1.64001f" />
            <Representation id="v1080" bandwidth="4800000" width="1920" height="1080" codecs="avc1.640028" />
          </AdaptationSet>
          <AdaptationSet contentType="audio" mimeType="audio/mp4" lang="vi">
            <Representation id="a1" bandwidth="128000" codecs="mp4a.40.2" />
          </AdaptationSet>
        </Period>
      </MPD>`,
  );
  assert.equal(parsed.status, "ready");
  assert.equal(parsed.streamType, "vod");
  assert.equal(parsed.duration, 5163.5);
  assert.deepEqual(
    parsed.variants.map((variant) => variant.resolution.height),
    [720, 1080],
  );
  assert.equal(parsed.audioTracks[0].language, "vi");
  assert.equal(parsed.drm, "none");
});

test("DASH parsing identifies dynamic streams and DRM protection", () => {
  const parsed = parseDashManifest(
    "https://cdn.example/live.mpd",
    `<MPD type="dynamic"><Period><AdaptationSet contentType="video">
      <ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed" value="Widevine" />
      <Representation id="video" bandwidth="1000000" width="640" height="360" />
    </AdaptationSet></Period></MPD>`,
  );
  assert.equal(parsed.streamType, "live");
  assert.equal(parsed.drm, "confirmed");
  assert.equal(
    getMediaDownloadAvailability({
      kind: "dash",
      probeStatus: "ready",
      streamType: parsed.streamType,
      drm: parsed.drm,
      variants: parsed.variants,
    }).supported,
    false,
  );
});

test("blob source tracing links an appended network buffer to an adaptive manifest", async () => {
  const previous = {
    Response: globalThis.Response,
    XMLHttpRequest: globalThis.XMLHttpRequest,
    MediaSource: globalThis.MediaSource,
    SourceBuffer: globalThis.SourceBuffer,
    window: globalThis.window,
    location: globalThis.location,
    createObjectURL: URL.createObjectURL,
    revokeObjectURL: URL.revokeObjectURL,
  };
  const messages = [];
  class FakeResponse {
    constructor(url, bytes) {
      this.url = url;
      this.bytes = bytes;
      this.headers = { get: () => "video/iso.segment" };
    }
    async arrayBuffer() {
      return this.bytes;
    }
    async blob() {
      return new Blob([this.bytes]);
    }
  }
  class FakeXhr {
    getResponseHeader() {
      return "video/iso.segment";
    }
  }
  Object.defineProperty(FakeXhr.prototype, "response", {
    configurable: true,
    get() {
      return this.value;
    },
  });
  class FakeSourceBuffer {
    appendBuffer(value) {
      this.lastValue = value;
    }
  }
  class FakeMediaSource {
    addSourceBuffer() {
      return new FakeSourceBuffer();
    }
  }
  globalThis.Response = FakeResponse;
  globalThis.XMLHttpRequest = FakeXhr;
  globalThis.MediaSource = FakeMediaSource;
  globalThis.SourceBuffer = FakeSourceBuffer;
  globalThis.window = {
    postMessage(message) {
      messages.push(message);
    },
  };
  globalThis.location = { href: "https://video.example/watch" };
  URL.createObjectURL = () => "blob:https://video.example/player";
  URL.revokeObjectURL = () => {};
  rememberMediaObservation({
    id: "manifest-hls",
    kind: "hls",
    manifestUrl: "https://cdn.example/master.m3u8",
  });
  const stop = installBlobSourceTracer(
    { can: () => true },
    {
      observerStartedAt: 1234,
      observerDocumentState: "interactive",
    },
  );
  try {
    const mediaSource = new FakeMediaSource();
    URL.createObjectURL(mediaSource);
    const sourceBuffer = mediaSource.addSourceBuffer(
      'video/mp4; codecs="avc1"',
    );
    const bytes = new ArrayBuffer(128);
    const response = new FakeResponse("https://cdn.example/chunk-1.m4s", bytes);
    sourceBuffer.appendBuffer(await response.arrayBuffer());
    await new Promise((resolve) => setTimeout(resolve, 250));
    const trace = messages.find(
      (message) => message.event?.type === EVENTS.MEDIA_BLOB_TRACED,
    )?.event?.payload;
    assert.equal(trace.blobUrl, "blob:https://video.example/player");
    assert.deepEqual(trace.candidateIds, ["manifest-hls"]);
    assert.deepEqual(trace.sourceUrls, ["https://cdn.example/chunk-1.m4s"]);
    assert.equal(trace.appendCount, 1);
    assert.equal(trace.totalAppendedBytes, 128);
    assert.equal(trace.observerStartedAt, 1234);
    assert.equal(trace.observerDocumentState, "interactive");
    assert.equal("chunk" in trace, false);
    assert.equal("buffer" in trace, false);
  } finally {
    stop();
    clearMediaObservations();
    globalThis.Response = previous.Response;
    globalThis.XMLHttpRequest = previous.XMLHttpRequest;
    globalThis.MediaSource = previous.MediaSource;
    globalThis.SourceBuffer = previous.SourceBuffer;
    globalThis.window = previous.window;
    globalThis.location = previous.location;
    URL.createObjectURL = previous.createObjectURL;
    URL.revokeObjectURL = previous.revokeObjectURL;
  }
});

test("recognizes a custom encrypted HLS envelope without retaining its payload", () => {
  const result = classifyEncryptedManifestEnvelope(`#EXTM3U
#ENC-AESGCM;iv=00112233445566778899aabb
#EXT-X-B65:0-138
QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo0123456789abcd==`);
  assert.deepEqual(result, {
    scheme: "aes-gcm",
    evidence: [
      "custom-encryption-tag",
      "base64-payload-tag",
      "opaque-base64-payload",
    ],
  });
  assert.equal(
    classifyEncryptedManifestEnvelope("#EXTM3U\n#EXTINF:5,\na.ts"),
    null,
  );
});

test("player-decrypted HLS Blob is parsed against its encrypted network source", async () => {
  const previous = {
    MediaSource: globalThis.MediaSource,
    window: globalThis.window,
    location: globalThis.location,
    createObjectURL: URL.createObjectURL,
    revokeObjectURL: URL.revokeObjectURL,
  };
  const messages = [];
  class FakeMediaSource {}
  globalThis.MediaSource = FakeMediaSource;
  globalThis.window = {
    postMessage(message) {
      messages.push(message);
    },
  };
  globalThis.location = { href: "https://embed.example/player" };
  URL.createObjectURL = () => "blob:https://embed.example/decrypted";
  URL.revokeObjectURL = () => {};
  const policy = { can: () => true };
  const stopObserver = installDecryptedManifestObserver(policy);
  const stopTracer = installBlobSourceTracer(policy);
  try {
    const plaintext = `#EXTM3U
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:5,
segment-1.ts
#EXTINF:5,
segment-2.ts
#EXT-X-ENDLIST`;
    const blob = new Blob([plaintext], {
      type: "application/vnd.apple.mpegurl",
    });
    const objectUrl = URL.createObjectURL(blob);
    assert.equal(objectUrl, "blob:https://embed.example/decrypted");
    await new Promise((resolve) => setTimeout(resolve, 5));
    rememberEncryptedManifestEnvelope({
      candidate: { id: "encrypted-hls", kind: "hls" },
      manifestUrl: "https://cdn.example/path/encrypted.m3u8",
      body: `#EXTM3U
#ENC-AESGCM;iv=00112233445566778899aabb
#EXT-X-B65:0-138
QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo0123456789abcd==`,
      observedAt: Date.now(),
    });
    await new Promise((resolve) => setTimeout(resolve, 25));

    const probe = messages.find(
      (message) => message.event?.type === EVENTS.MEDIA_PROBED,
    )?.event?.payload;
    assert.equal(probe.mediaId, "encrypted-hls");
    assert.equal(probe.probeSource, "decrypted_blob");
    assert.equal(probe.playlistType, "media");
    assert.equal(probe.streamType, "vod");
    assert.equal(probe.segmentCount, 2);
    assert.equal(probe.manifestEnvelope.scheme, "aes-gcm");
    assert.equal("body" in probe, false);

    const trace = messages.find(
      (message) => message.event?.type === EVENTS.MEDIA_BLOB_TRACED,
    )?.event?.payload;
    assert.deepEqual(trace.candidateIds, ["encrypted-hls"]);
    assert.deepEqual(trace.sourceUrls, [
      "https://cdn.example/path/encrypted.m3u8",
    ]);
    assert.equal(await blob.text(), plaintext);
  } finally {
    stopTracer();
    stopObserver();
    clearEncryptedManifestEnvelopes();
    globalThis.MediaSource = previous.MediaSource;
    globalThis.window = previous.window;
    globalThis.location = previous.location;
    URL.createObjectURL = previous.createObjectURL;
    URL.revokeObjectURL = previous.revokeObjectURL;
  }
});

test("blob tracing does not associate a different-host ad manifest", () => {
  clearMediaObservations();
  rememberMediaObservation({
    id: "ad-hls",
    kind: "hls",
    manifestUrl: "https://ads.example/ad.m3u8",
  });
  assert.deepEqual(
    findRelatedMediaObservations(["https://video-cdn.example/chunk.m4s"], {
      allowedKinds: ["hls", "dash"],
    }),
    [],
  );
  clearMediaObservations();
});

test("catalog resolves a traced Blob row to its downloadable HLS source", () => {
  const catalog = createMediaCatalog();
  const pageUrl = "https://video.example/watch";
  const hls = createMediaCandidateFromSource({
    pageUrl,
    sourceUrl: "https://cdn.example/movie.m3u8",
    detectedBy: "network",
  });
  const blob = createMediaCandidateFromSource({
    pageUrl,
    sourceUrl: "blob:https://video.example/player",
    detectedBy: "dom",
  });
  catalog.add(24, createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, hls));
  catalog.applyProbe(
    24,
    createRegisteredEvent(EVENTS.MEDIA_PROBED, {
      mediaId: hls.id,
      pageUrl,
      manifestUrl: hls.manifestUrl,
      kind: "hls",
      status: "ready",
      playlistType: "media",
      streamType: "vod",
      duration: 120,
      segmentCount: 20,
      probeSource: "decrypted_blob",
      manifestEnvelope: {
        scheme: "aes-gcm",
        observedAt: Date.now(),
        correlationConfidence: 0.98,
        evidence: ["same-frame", "nearby-blob"],
      },
    }),
  );
  catalog.add(24, createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, blob));
  catalog.applyBlobTrace(
    24,
    createRegisteredEvent(EVENTS.MEDIA_BLOB_TRACED, {
      mediaId: blob.id,
      pageUrl,
      blobUrl: blob.sourceUrl,
      sourceUrls: ["https://cdn.example/chunk-1.ts"],
      candidateIds: [hls.id],
      mimeTypes: ["video/mp2t"],
      appendCount: 3,
      totalAppendedBytes: 4096,
    }),
  );
  const resolvedBlob = catalog.list(24).find((item) => item.id === blob.id);
  assert.equal(resolvedBlob.resolutionStatus, "resolved");
  assert.equal(resolvedBlob.selectedMediaId, hls.id);
  assert.equal(resolvedBlob.resolvedKind, "hls");
  assert.match(formatMediaDetails(resolvedBlob), /Blob resolved to HLS/);
  assert.match(formatMediaDetails(resolvedBlob), /Player decrypted/);
  assert.equal(
    resolvedBlob.resolutionStrategy,
    MEDIA_RESOLUTION_STRATEGIES.DECRYPTED_MANIFEST,
  );
  assert.equal(
    getMediaDownloadAvailability(resolvedBlob.resolvedStream).supported,
    false,
  );
  assert.match(
    getMediaDownloadAvailability(resolvedBlob.resolvedStream).reason,
    /download handoff/i,
  );

  const expiresAt = Date.now() + 60_000;
  catalog.applyManifestHandoff(
    24,
    createRegisteredEvent(EVENTS.MEDIA_MANIFEST_HANDOFF_READY, {
      mediaId: hls.id,
      pageUrl,
      manifestUrl: hls.manifestUrl,
      kind: "hls",
      bodyBytes: 256,
      revisionId: "decrypted-revision",
      capturedAt: Date.now(),
      expiresAt,
    }),
  );
  const readyBlob = catalog.list(24).find((item) => item.id === blob.id);
  assert.equal(selectVisibleMediaItems(catalog.list(24)).length, 1);
  assert.equal(
    getMediaDownloadAvailability(readyBlob.resolvedStream).supported,
    true,
  );
  assert.equal(readyBlob.resolvedStream.manifestHandoff.expiresAt, expiresAt);
});

test("decrypted manifest handoff is bounded and validates a usable VOD", () => {
  const now = Date.now();
  const handoff = normalizeStoredManifestHandoff(
    {
      mediaId: "media-hls",
      manifestUrl: "https://cdn.example/path/index.m3u8",
      kind: "hls",
      body: [
        "#EXTM3U",
        "#EXT-X-PLAYLIST-TYPE:VOD",
        "#EXTINF:4,",
        "segment-1.ts",
        "#EXT-X-ENDLIST",
      ].join("\n"),
    },
    now,
  );
  assert.equal(handoff.playlistType, "media");
  assert.equal(handoff.streamType, "vod");
  assert.equal(handoff.expiresAt, now + 15 * 60 * 1000);
  assert.equal(handoff.body.includes("segment-1.ts"), true);
  assert.throws(
    () =>
      normalizeStoredManifestHandoff({
        mediaId: "media-hls",
        manifestUrl: "https://cdn.example/path/index.m3u8",
        kind: "hls",
        body: "#EXTM3U\n#EXT-X-VERSION:3",
      }),
    /usable media source/i,
  );
});

test("public media title prefers page metadata over a technical player name", () => {
  assert.equal(
    chooseMediaTitle(
      "4fa5f5a30bd613f4d02f777ca1ef98a8",
      "Xem phim Máu và Cổ Vật (Phần 1) Tập 1-2 Vietsub - PhimVietSub",
      "https://phimvietsub.click/mau-va-co-vat/tap-1-2",
    ),
    "Máu và Cổ Vật (Phần 1) Tập 1-2",
  );
  assert.equal(
    chooseMediaTitle(
      "Player",
      "Những khoảnh khắc hài hước nhất năm - Phần 589 | Example",
      "https://example.com/watch/589",
    ),
    "Những khoảnh khắc hài hước nhất năm - Phần 589",
  );
});

test("summarized SAMPLE-AES identity Blob is offered to the Media Helper", () => {
  const hls = {
    id: "drm-hls",
    kind: "hls",
    probeStatus: "ready",
    playlistType: "media",
    streamType: "vod",
    segmentCount: 10,
    drm: "suspected",
    encryptionScheme: "sample-aes",
    drmEvidence: ["hls-sample-aes"],
    manifestUrl: "https://cdn.example/movie.m3u8",
  };
  const blob = {
    id: "blob-drm",
    kind: "blob",
    sourceUrl: "blob:https://video.example/player",
    title: "7940ad3c296dddbb98de10bf9f4e3ebc2f1f95a890bdfd28a937cae5157c26f7",
    selectedMediaId: hls.id,
    resolvedMediaIds: [hls.id],
    resolvedKind: "hls",
    resolvedStream: hls,
    blobTrace: { candidateIds: [hls.id] },
  };
  const state = getMediaCatalogDownloadState([blob, hls]);
  assert.deepEqual(state, {
    candidateCount: 1,
    downloadableCount: 1,
    drmBlockedCount: 0,
    unavailableCount: 0,
  });
  assert.equal(
    helperSetupPresentation(
      { status: "permission_required" },
      { hasDownloadableMedia: state.downloadableCount > 0 },
    ).label,
    "Allow helper connection",
  );
  assert.equal(formatMediaName(blob), "cdn.example · HLS source");
  assert.equal(
    formatMediaHelperSummary({ status: "permission_required" }, state),
    "Media found · allow Media Helper connection to download.",
  );
  assert.equal(selectVisibleMediaItems([blob, hls]).length, 1);
});

test("catalog ignores a forged DIRECT candidate that is actually an HLS segment", () => {
  const catalog = createMediaCatalog();
  const event = createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, {
    id: "segment-1",
    pageUrl: "https://video.example/watch",
    sourceUrl: "https://cdn.example/random.ts",
    kind: "direct",
    mimeType: "video/mp2t",
    detectedBy: "network",
  });
  assert.equal(catalog.add(5, event), null);
  assert.deepEqual(catalog.list(5), []);
});

test("creates a stable content-neutral candidate from a relative source", () => {
  const candidate = createMediaCandidateFromSource({
    pageUrl: "https://video.example/watch/1",
    sourceUrl: "/media/master.m3u8?token=abc",
    detectedBy: "dom",
    title: "Example video",
  });
  assert.equal(candidate.kind, "hls");
  assert.equal(
    candidate.manifestUrl,
    "https://video.example/media/master.m3u8?token=abc",
  );
  assert.equal(candidate.sourceUrl, null);
  assert.match(candidate.id, /^media-/);
});

test("catalog merges detection sources and resets when the tab navigates", () => {
  const catalog = createMediaCatalog();
  const baseCandidate = createMediaCandidateFromSource({
    pageUrl: "https://video.example/watch/1",
    sourceUrl: "https://cdn.example/movie.mp4",
    detectedBy: "dom",
  });
  catalog.add(
    10,
    createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, baseCandidate),
  );
  catalog.add(
    10,
    createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, {
      ...baseCandidate,
      detectedBy: "network",
    }),
  );
  const merged = catalog.list(10);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].detectionSources, ["dom", "network"]);

  const nextPageCandidate = createMediaCandidateFromSource({
    pageUrl: "https://video.example/watch/2",
    sourceUrl: "https://cdn.example/next.webm",
    detectedBy: "dom",
  });
  catalog.add(
    10,
    createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, nextPageCandidate),
  );
  assert.deepEqual(
    catalog.list(10).map((item) => item.id),
    [nextPageCandidate.id],
  );
});

test("catalog is bounded per tab", () => {
  const catalog = createMediaCatalog({ maximumPerTab: 2 });
  for (let index = 0; index < 3; index++) {
    const candidate = createMediaCandidateFromSource({
      pageUrl: "https://video.example/watch",
      sourceUrl: `https://cdn.example/video-${index}.mp4`,
      detectedBy: "network",
    });
    const event = createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, candidate);
    event.timestamp += index;
    catalog.add(1, event);
  }
  assert.equal(catalog.list(1).length, 2);
});

test("parses an HLS master playlist with relative variants and media tracks", () => {
  const result = parseHlsManifest(
    "https://cdn.example/path/master.m3u8?token=abc",
    `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English, Stereo",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="audio/en.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Tiếng Việt",LANGUAGE="vi",URI="../subs/vi.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=5200000,AVERAGE-BANDWIDTH=4800000,RESOLUTION=1920x1080,FRAME-RATE=59.94,CODECS="avc1.640028,mp4a.40.2",AUDIO="audio",SUBTITLES="subs"
video/1080.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720
video/720.m3u8`,
  );

  assert.equal(result.status, "ready");
  assert.equal(result.playlistType, "master");
  assert.equal(result.streamType, null);
  assert.equal(result.variants.length, 2);
  assert.deepEqual(result.variants[0].resolution, {
    width: 1920,
    height: 1080,
  });
  assert.equal(result.variants[0].codecs, "avc1.640028,mp4a.40.2");
  assert.equal(
    result.variants[0].url,
    "https://cdn.example/path/video/1080.m3u8",
  );
  assert.equal(result.audioTracks[0].name, "English, Stereo");
  assert.equal(result.subtitles[0].url, "https://cdn.example/subs/vi.m3u8");
});

test("parses VOD duration and distinguishes encryption from suspected DRM", () => {
  const result = parseHlsManifest(
    "https://cdn.example/vod/index.m3u8",
    `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-KEY:METHOD=AES-128,URI="key.bin"
#EXT-X-BITRATE:1800
#EXTINF:9.5,
segment-1.ts
#EXT-X-BITRATE:2200
#EXTINF:10.25,
segment-2.ts
#EXT-X-ENDLIST`,
  );

  assert.equal(result.playlistType, "media");
  assert.equal(result.streamType, "vod");
  assert.equal(result.duration, 19.75);
  assert.equal(result.targetDuration, 10);
  assert.equal(result.segmentCount, 2);
  assert.equal(result.bandwidth, 2_200_000);
  assert.equal(result.averageBandwidth, 2_000_000);
  assert.deepEqual(result.encryptionMethods, ["AES-128"]);
  assert.equal(result.encryptionScheme, "aes-128");
  assert.deepEqual(result.encryptionKeyFormats, []);
  assert.equal(result.drm, "none");
  assert.match(
    formatMediaDetails({ kind: "hls", probeStatus: "ready", ...result }),
    /Encrypted HLS · AES-128/,
  );

  const sampleAes = parseHlsManifest(
    "https://cdn.example/live/index.m3u8",
    '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key"\n#EXTINF:6,\na.ts',
  );
  assert.equal(sampleAes.streamType, "live");
  assert.equal(sampleAes.encryptionScheme, "sample-aes");
  assert.equal(sampleAes.drm, "suspected");
  assert.match(
    formatMediaDetails({ kind: "hls", probeStatus: "ready", ...sampleAes }),
    /Encrypted HLS · SAMPLE-AES · Helper compatible/,
  );

  const widevine = parseHlsManifest(
    "https://cdn.example/live/index.m3u8",
    '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,KEYFORMAT="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed",URI="license"\n#EXTINF:6,\na.ts',
  );
  assert.equal(widevine.drm, "confirmed");
  assert.equal(widevine.drmSystem, "widevine");
  assert.deepEqual(widevine.drmEvidence, ["hls-keyformat"]);
  assert.match(
    formatMediaDetails({ kind: "hls", probeStatus: "ready", ...widevine }),
    /DRM confirmed · Widevine · Playback only/,
  );
});

test("EME metadata confirms a suspected stream without retaining payloads", () => {
  const catalog = createMediaCatalog();
  catalog.applyProbe(
    31,
    createRegisteredEvent(EVENTS.MEDIA_PROBED, {
      mediaId: "eme-hls",
      pageUrl: "https://video.example/watch",
      manifestUrl: "https://cdn.example/index.m3u8",
      kind: "hls",
      status: "ready",
      playlistType: "media",
      streamType: "vod",
      segmentCount: 4,
      encryptionMethods: ["SAMPLE-AES"],
      encryptionScheme: "sample-aes",
      drm: "suspected",
    }),
  );
  catalog.applyEme(
    31,
    createRegisteredEvent(EVENTS.MEDIA_EME_OBSERVED, {
      pageUrl: "https://video.example/watch",
      initDataType: "cenc",
    }),
  );
  assert.equal(catalog.list(31)[0].drm, "suspected");
  catalog.applyEme(
    31,
    createRegisteredEvent(EVENTS.MEDIA_EME_OBSERVED, {
      pageUrl: "https://video.example/watch",
      keySystem: "com.widevine.alpha",
      initDataType: "cenc",
      encryptionSchemes: ["cbcs"],
      keyStatuses: ["usable"],
      licenseStatus: "usable",
      initData: "must-not-survive",
      licensePayload: "must-not-survive",
    }),
  );
  const [item] = catalog.list(31);
  assert.equal(item.drm, "confirmed");
  assert.equal(item.drmSystem, "widevine");
  assert.deepEqual(item.eme.keySystems, ["com.widevine.alpha"]);
  assert.deepEqual(item.eme.initDataTypes, ["cenc"]);
  assert.equal(item.eme.licenseStatus, "usable");
  assert.equal("initData" in item.eme, false);
  assert.equal("licensePayload" in item.eme, false);
});

test("HLS attribute parsing preserves quoted commas", () => {
  assert.deepEqual(
    parseHlsAttributeList('NAME="English, Stereo",LANGUAGE=en,DEFAULT=YES'),
    { NAME: "English, Stereo", LANGUAGE: "en", DEFAULT: "YES" },
  );
});

test("empty HLS envelopes remain unknown instead of being mislabeled live", () => {
  const result = parseHlsManifest(
    "https://embed.example/token",
    "#EXTM3U\n#EXT-X-VERSION:7\n",
  );
  assert.equal(result.status, "ready");
  assert.equal(result.playlistType, "unknown");
  assert.equal(result.streamType, "unknown");
  assert.equal(result.segmentCount, null);
  assert.match(
    getMediaDownloadAvailability({
      kind: "hls",
      probeStatus: "ready",
      drm: "none",
      encryptionMethods: [],
      ...result,
    }).reason,
    /not exposed/,
  );
});

test("encrypted HLS envelopes register bounded query mutation attempts", () => {
  const encrypted = `#EXTM3U
#ENC-AESGCM;iv=1234
#EXT-X-B65:0-138
encrypted-payload`;
  assert.deepEqual(
    createHlsProbeAttempts(
      "https://embed.example/token?d=2&mode=encrypted&sessionId=abc",
      encrypted,
    ),
    [
      {
        url: "https://embed.example/token?mode=encrypted&sessionId=abc",
        adapterId: "aesgcm-b65-query-mutation",
        strategy: "remove_query_parameter",
        removedQueryKey: "d",
        evidence: ["enc_aesgcm", "ext_x_b65"],
      },
      {
        url: "https://embed.example/token?d=2&sessionId=abc",
        adapterId: "aesgcm-b65-query-mutation",
        strategy: "remove_query_parameter",
        removedQueryKey: "mode",
        evidence: ["enc_aesgcm", "ext_x_b65"],
      },
    ],
  );
  assert.deepEqual(
    createHlsProbeAttempts(
      "https://embed.example/token?d=1",
      "#EXTM3U\n#EXTINF:4,\nsegment.ts",
    ),
    [],
  );
  assert.deepEqual(
    createHlsProbeAttempts(
      "https://embed.example/token?access_token=secret&video_id=42",
      encrypted,
    ),
    [],
  );
  assert.equal(
    createHlsProbeAttempts(
      "https://embed.example/token?d=2&mode=x&format=y&output=z",
      encrypted,
    ).length,
    3,
  );
});

test("a directly captured encrypted HLS response resolves through its adapter", async () => {
  const previousWindow = globalThis.window;
  const previousLocation = globalThis.location;
  const previousDocument = globalThis.document;
  globalThis.window = {};
  globalThis.location = { href: "https://embed.example/player" };
  globalThis.document = { title: "Player" };
  const attempts = [];
  try {
    const result = await tryHlsProbeAttempts({
      manifestUrl: "https://embed.example/token?d=1",
      body: "#EXTM3U\n#ENC-AESGCM;iv=1234\n#EXT-X-B65:0-138\npayload",
      candidate: createMediaCandidateFromSource({
        pageUrl: "https://embed.example/player",
        sourceUrl: "https://embed.example/token?d=1",
        detectedBy: "network",
      }),
      originalFetch: async (_url) => ({
        ok: true,
        url: "https://embed.example/token",
        headers: { get: () => "application/vnd.apple.mpegurl" },
        text: async () =>
          "#EXTM3U\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:4,\nsegment.ts\n#EXT-X-ENDLIST",
      }),
      probeGate: createMediaProbeGate(),
      inspect: (url, body, _candidate, _requestContext, attempt) => {
        attempts.push(attempt);
        return parseHlsManifest(url, body);
      },
    });
    assert.equal(result.streamType, "vod");
    assert.equal(result.segmentCount, 1);
    assert.equal(attempts[0].removedQueryKey, "d");
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousLocation === undefined) delete globalThis.location;
    else globalThis.location = previousLocation;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("XHR capture decodes text, ArrayBuffer, and Blob manifest bodies", async () => {
  const manifest = "#EXTM3U\n#EXT-X-TARGETDURATION:4\n";
  assert.equal(
    await readXhrResponseBody({ responseType: "", responseText: manifest }),
    manifest,
  );
  assert.equal(
    await readXhrResponseBody({
      responseType: "arraybuffer",
      response: new TextEncoder().encode(manifest).buffer,
    }),
    manifest,
  );
  assert.equal(
    await readXhrResponseBody({
      responseType: "blob",
      response: new Blob([manifest]),
    }),
    manifest,
  );
});

test("parses low-latency HLS parts without inventing full segments", () => {
  const result = parseHlsManifest(
    "https://cdn.example/live/token",
    `#EXTM3U
#EXT-X-VERSION:9
#EXT-X-TARGETDURATION:4
#EXT-X-MEDIA-SEQUENCE:120
#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=1.5
#EXT-X-PART-INF:PART-TARGET=0.5
#EXT-X-PART:DURATION=0.5,URI="part-120.0.m4s"
#EXT-X-PART:DURATION=0.5,URI="part-120.1.m4s"
#EXT-X-PRELOAD-HINT:TYPE=PART,URI="part-120.2.m4s"`,
  );
  assert.equal(result.playlistType, "media");
  assert.equal(result.streamType, "live");
  assert.equal(result.lowLatency, true);
  assert.equal(result.segmentCount, 0);
  assert.equal(result.partialSegmentCount, 2);
  assert.equal(result.mediaSequence, 120);
  assert.match(result.revisionId, /^revision-/);
});

test("recognizes iframe-only master playlists without treating them as live", () => {
  const result = parseHlsManifest(
    "https://cdn.example/master.m3u8",
    `#EXTM3U
#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=250000,RESOLUTION=1280x720,URI="iframe/720.m3u8"`,
  );
  assert.equal(result.playlistType, "master");
  assert.equal(result.streamType, null);
  assert.equal(result.variants.length, 0);
  assert.equal(result.iframeVariants.length, 1);
  assert.equal(
    result.iframeVariants[0].url,
    "https://cdn.example/iframe/720.m3u8",
  );
});

test("catalog applies a manifest probe even if discovery arrives late", () => {
  const catalog = createMediaCatalog();
  const event = createRegisteredEvent(EVENTS.MEDIA_PROBED, {
    mediaId: "media-hls",
    pageUrl: "https://video.example/watch",
    manifestUrl: "https://cdn.example/master.m3u8",
    kind: "hls",
    status: "ready",
    playlistType: "master",
    variants: [
      {
        id: "1080p",
        url: "https://cdn.example/1080.m3u8",
        resolution: { width: 1920, height: 1080 },
      },
    ],
  });
  const item = catalog.applyProbe(11, event);

  assert.equal(item.probeStatus, "ready");
  assert.equal(item.variants[0].resolution.height, 1080);
  assert.deepEqual(item.detectionSources, ["network"]);

  const lateDiscovery = createMediaCandidateFromSource({
    pageUrl: "https://video.example/watch",
    sourceUrl: "https://cdn.example/master.m3u8",
    detectedBy: "dom",
  });
  lateDiscovery.id = "media-hls";
  catalog.add(
    11,
    createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, lateDiscovery),
  );
  const preserved = catalog.list(11)[0];
  assert.equal(preserved.probeStatus, "ready");
  assert.equal(preserved.variants[0].resolution.height, 1080);
  assert.deepEqual(preserved.detectionSources, ["network", "dom"]);
});

test("catalog links a discovered child playlist back to its HLS master", () => {
  const catalog = createMediaCatalog();
  const pageUrl = "https://video.example/watch";
  const master = createMediaCandidateFromSource({
    pageUrl,
    sourceUrl: "https://cdn.example/master.m3u8",
    detectedBy: "network",
  });
  const child = createMediaCandidateFromSource({
    pageUrl,
    sourceUrl: "https://cdn.example/720.m3u8",
    detectedBy: "network",
  });
  catalog.add(12, createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, master));
  catalog.add(12, createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, child));
  catalog.applyProbe(
    12,
    createRegisteredEvent(EVENTS.MEDIA_PROBED, {
      mediaId: master.id,
      pageUrl,
      manifestUrl: master.manifestUrl,
      kind: "hls",
      status: "ready",
      playlistType: "master",
      variants: [{ id: "720p", url: child.manifestUrl }],
    }),
  );
  const items = catalog.list(12);
  const linkedMaster = items.find((item) => item.id === master.id);
  const linkedChild = items.find((item) => item.id === child.id);
  assert.deepEqual(linkedMaster.childManifestIds, [child.id]);
  assert.deepEqual(linkedChild.parentManifestIds, [master.id]);
});

test("passive resolver promotes a playable child after a master probe is rejected", () => {
  const catalog = createMediaCatalog();
  const pageUrl = "https://video.example/watch";
  const frameMetadata = {
    frameId: 7,
    frameUrl: "https://embed.example/player/42",
  };
  const master = createMediaCandidateFromSource({
    pageUrl,
    sourceUrl: "https://embed.example/hls/session/master.m3u8",
    detectedBy: "network",
  });
  const child = createMediaCandidateFromSource({
    pageUrl,
    sourceUrl: "https://embed.example/hls/session/720p/index.m3u8",
    detectedBy: "network",
  });
  catalog.add(
    120,
    createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, master, frameMetadata),
  );
  catalog.add(
    120,
    createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, child, frameMetadata),
  );
  catalog.applyProbe(
    120,
    createRegisteredEvent(
      EVENTS.MEDIA_PROBED,
      {
        mediaId: master.id,
        pageUrl,
        manifestUrl: master.manifestUrl,
        kind: "hls",
        status: "failed",
        error: "manifest_http_403",
      },
      frameMetadata,
    ),
  );
  catalog.applyProbe(
    120,
    createRegisteredEvent(
      EVENTS.MEDIA_PROBED,
      {
        mediaId: child.id,
        pageUrl,
        manifestUrl: child.manifestUrl,
        kind: "hls",
        status: "ready",
        playlistType: "media",
        streamType: "vod",
        duration: 3_600,
        segmentCount: 720,
      },
      frameMetadata,
    ),
  );

  const resolved = catalog.list(120).find((item) => item.id === master.id);
  assert.equal(resolved.resolutionStatus, "resolved");
  assert.equal(resolved.selectedMediaId, child.id);
  assert.equal(
    resolved.resolutionStrategy,
    MEDIA_RESOLUTION_STRATEGIES.OBSERVED_CHILD,
  );
  assert.equal(resolved.resolvedStream.resolution.height, 720);
  assert.match(formatMediaDetails(resolved), /^Resolved · 720p · VOD/);
});

test("passive resolver accepts a cross-CDN child when playback duration corroborates it", () => {
  const catalog = createMediaCatalog();
  const pageUrl = "https://video.example/watch";
  const frameMetadata = {
    frameId: 7,
    frameUrl: "https://embed.streamc.xyz/player/42",
  };
  const master = createMediaCandidateFromSource({
    pageUrl,
    sourceUrl: "https://embed.streamc.xyz/hls/token/master.m3u8",
    detectedBy: "network",
  });
  const child = createMediaCandidateFromSource({
    pageUrl,
    sourceUrl: "https://streamc-cdn.net/session/720p/index.m3u8",
    detectedBy: "network",
  });
  const blob = createMediaCandidateFromSource({
    pageUrl,
    sourceUrl: "blob:https://embed.streamc.xyz/player",
    duration: 5_163.21,
    detectedBy: "dom",
  });
  catalog.add(
    122,
    createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, master, frameMetadata),
  );
  catalog.add(
    122,
    createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, child, frameMetadata),
  );
  catalog.add(
    122,
    createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, blob, frameMetadata),
  );
  catalog.applyProbe(
    122,
    createRegisteredEvent(
      EVENTS.MEDIA_PROBED,
      {
        mediaId: child.id,
        pageUrl,
        manifestUrl: child.manifestUrl,
        kind: "hls",
        status: "ready",
        playlistType: "media",
        streamType: "vod",
        duration: 5_163.2,
        segmentCount: 1_726,
      },
      frameMetadata,
    ),
  );

  const resolved = catalog.list(122).find((item) => item.id === master.id);
  assert.equal(resolved.resolutionStatus, "resolved");
  assert.equal(resolved.selectedMediaId, child.id);
  assert(resolved.resolutionEvidence.includes("cross-cdn"));
  assert(resolved.resolutionEvidence.includes("playback-duration-match"));
});

test("passive resolver rejects an uncorroborated cross-CDN child in the same frame", () => {
  const catalog = createMediaCatalog();
  const pageUrl = "https://video.example/watch";
  const frameMetadata = {
    frameId: 7,
    frameUrl: "https://embed.streamc.xyz/player/42",
  };
  const master = createMediaCandidateFromSource({
    pageUrl,
    sourceUrl: "https://embed.streamc.xyz/hls/token/master.m3u8",
    detectedBy: "network",
  });
  const unrelated = createMediaCandidateFromSource({
    pageUrl,
    sourceUrl: "https://ads-cdn.example/spot/index.m3u8",
    detectedBy: "network",
  });
  catalog.add(
    123,
    createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, master, frameMetadata),
  );
  catalog.add(
    123,
    createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, unrelated, frameMetadata),
  );
  catalog.applyProbe(
    123,
    createRegisteredEvent(
      EVENTS.MEDIA_PROBED,
      {
        mediaId: unrelated.id,
        pageUrl,
        manifestUrl: unrelated.manifestUrl,
        kind: "hls",
        status: "ready",
        playlistType: "media",
        streamType: "vod",
        duration: 30,
        segmentCount: 6,
      },
      frameMetadata,
    ),
  );

  const unresolved = catalog.list(123).find((item) => item.id === master.id);
  assert.equal(unresolved.resolutionStatus, "waiting");
  assert.equal(unresolved.selectedMediaId, null);
});

test("passive resolver refuses an otherwise similar child from another frame", () => {
  const catalog = createMediaCatalog();
  const pageUrl = "https://video.example/watch";
  const master = createMediaCandidateFromSource({
    pageUrl,
    sourceUrl: "https://embed.example/hls/session/master.m3u8",
    detectedBy: "network",
  });
  const child = createMediaCandidateFromSource({
    pageUrl,
    sourceUrl: "https://embed.example/hls/session/720p/index.m3u8",
    detectedBy: "network",
  });
  catalog.add(
    121,
    createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, master, {
      frameId: 4,
      frameUrl: "https://embed.example/content",
    }),
  );
  catalog.add(
    121,
    createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, child, {
      frameId: 9,
      frameUrl: "https://embed.example/advert",
    }),
  );
  catalog.applyProbe(
    121,
    createRegisteredEvent(
      EVENTS.MEDIA_PROBED,
      {
        mediaId: child.id,
        pageUrl,
        manifestUrl: child.manifestUrl,
        kind: "hls",
        status: "ready",
        playlistType: "media",
        streamType: "vod",
        duration: 30,
        segmentCount: 6,
      },
      { frameId: 9, frameUrl: "https://embed.example/advert" },
    ),
  );

  const unresolved = catalog.list(121).find((item) => item.id === master.id);
  assert.equal(unresolved.selectedMediaId, null);
  assert.equal(unresolved.resolutionStatus, "waiting");
});

test("media resolution strategies keep passive methods ahead of active probes", () => {
  assert.deepEqual(
    MEDIA_RESOLUTION_STRATEGY_CATALOG.map((item) => item.id),
    [
      "captured_response",
      "decrypted_manifest",
      "observed_child",
      "player_api",
      "contextual_probe",
      "bounded_url_adapter",
    ],
  );
  assert.equal(MEDIA_RESOLUTION_STRATEGY_CATALOG[1].maximumExtraRequests, 0);
  assert.equal(
    MEDIA_RESOLUTION_STRATEGY_CATALOG.at(-1).maximumExtraRequests,
    3,
  );
});

test("request context registry reuses only recent routing facts", () => {
  const registry = createRequestContextRegistry({ maximumAgeMs: 1_000 });
  registry.remember(
    {
      requestUrl: "https://cdn.example/master.m3u8",
      finalUrl: "https://cdn.example/child.m3u8",
      documentUrl: "https://embed.example/player",
      parentDocumentUrl: "https://video.example/watch",
      referrer: "https://embed.example/player",
      credentials: "include",
      transport: "fetch",
    },
    1_000,
  );
  assert.equal(
    registry.find("https://cdn.example/child.m3u8", 1_500).credentials,
    "include",
  );
  assert.equal(registry.find("https://cdn.example/child.m3u8", 2_001), null);
  assert.deepEqual(
    createContextualProbeInit(
      {
        documentUrl: "https://embed.example/player",
        referrer: "https://video.example/watch",
        credentials: "include",
      },
      "https://embed.example/player",
    ),
    {
      credentials: "include",
      cache: "default",
      referrer: "https://embed.example/player",
    },
  );
});

test("JWPlayer adapter extracts current HTTP media sources without private state", () => {
  const previousLocation = globalThis.location;
  globalThis.location = { href: "https://embed.example/player" };
  try {
    const sources = extractJwPlayerSources({
      getPlaylistItem: () => ({
        title: "Episode 20",
        file: "https://cdn.example/master.m3u8",
        sources: [
          {
            file: "https://cdn.example/720p/index.m3u8",
            type: "application/vnd.apple.mpegurl",
            label: "720p",
          },
          { file: "blob:https://embed.example/ignored" },
        ],
      }),
      getPlaylist: () => [],
    });
    assert.deepEqual(
      sources.map((source) => source.url),
      [
        "https://cdn.example/master.m3u8",
        "https://cdn.example/720p/index.m3u8",
      ],
    );
    assert.equal(sources[1].title, "Episode 20");
    assert.equal(sources[1].label, "720p");
  } finally {
    globalThis.location = previousLocation;
  }
});

test("resolver selects the best discovered VOD variant and groups child rows", () => {
  const catalog = createMediaCatalog();
  const pageUrl = "https://video.example/watch";
  const manifest = (sourceUrl) =>
    createMediaCandidateFromSource({
      pageUrl,
      sourceUrl,
      detectedBy: "network",
    });
  const master = manifest("https://cdn.example/master.m3u8");
  const child720 = manifest("https://cdn.example/720.m3u8");
  const child1080 = manifest("https://cdn.example/1080.m3u8");
  for (const candidate of [master, child720, child1080]) {
    catalog.add(13, createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, candidate));
  }
  catalog.applyProbe(
    13,
    createRegisteredEvent(EVENTS.MEDIA_PROBED, {
      mediaId: master.id,
      pageUrl,
      manifestUrl: master.manifestUrl,
      kind: "hls",
      status: "ready",
      playlistType: "master",
      variants: [
        {
          id: "720p",
          url: child720.manifestUrl,
          resolution: { width: 1280, height: 720 },
          bandwidth: 2_000_000,
        },
        {
          id: "1080p",
          url: child1080.manifestUrl,
          resolution: { width: 1920, height: 1080 },
          bandwidth: 5_000_000,
        },
      ],
    }),
  );
  for (const [candidate, segmentCount] of [
    [child720, 200],
    [child1080, 300],
  ]) {
    catalog.applyProbe(
      13,
      createRegisteredEvent(EVENTS.MEDIA_PROBED, {
        mediaId: candidate.id,
        pageUrl,
        manifestUrl: candidate.manifestUrl,
        kind: "hls",
        status: "ready",
        playlistType: "media",
        streamType: "vod",
        segmentCount,
      }),
    );
  }
  const items = catalog.list(13);
  const resolvedMaster = items.find((item) => item.id === master.id);
  assert.equal(resolvedMaster.resolutionStatus, "resolved");
  assert.equal(resolvedMaster.selectedMediaId, child1080.id);
  assert.equal(resolvedMaster.resolvedStream.resolution.height, 1080);
  assert.equal(resolvedMaster.resolvedStream.segmentCount, 300);
  assert.deepEqual(
    selectVisibleMediaItems(items).map((item) => item.id),
    [master.id],
  );
});

test("resolver follows a token endpoint redirect to the final media playlist", () => {
  const catalog = createMediaCatalog();
  const pageUrl = "https://video.example/watch";
  const token = createMediaCandidateFromSource({
    pageUrl,
    sourceUrl: "https://embed.example/player/token",
    mimeType: "application/vnd.apple.mpegurl",
    detectedBy: "network",
  });
  const media = createMediaCandidateFromSource({
    pageUrl,
    sourceUrl: "https://cdn.example/session/media.m3u8",
    detectedBy: "network",
  });
  for (const candidate of [token, media]) {
    catalog.add(15, createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, candidate));
  }
  catalog.applyProbe(
    15,
    createRegisteredEvent(EVENTS.MEDIA_PROBED, {
      mediaId: media.id,
      pageUrl,
      manifestUrl: media.manifestUrl,
      kind: "hls",
      status: "ready",
      playlistType: "media",
      streamType: "vod",
      segmentCount: 24,
      requestContext: {
        requestUrl: token.manifestUrl,
        finalUrl: media.manifestUrl,
        documentUrl: "https://embed.example/player",
        credentials: "include",
        transport: "fetch",
        requiresBrowserSession: true,
      },
    }),
  );

  const items = catalog.list(15);
  const resolvedToken = items.find((item) => item.id === token.id);
  assert.equal(resolvedToken.resolutionStatus, "resolved");
  assert.equal(resolvedToken.selectedMediaId, media.id);
  assert.equal(resolvedToken.resolvedStream.segmentCount, 24);
  assert.equal(
    resolvedToken.resolvedRequestContext.finalUrl,
    media.manifestUrl,
  );
  assert.deepEqual(
    selectVisibleMediaItems(items).map((item) => item.id),
    [token.id],
  );
});

test("catalog keeps a usable VOD snapshot when a later HLS envelope is empty", () => {
  const catalog = createMediaCatalog();
  const pageUrl = "https://video.example/watch";
  const candidate = createMediaCandidateFromSource({
    pageUrl,
    sourceUrl: "https://cdn.example/token",
    mimeType: "application/vnd.apple.mpegurl",
    detectedBy: "network",
  });
  const usable = createRegisteredEvent(EVENTS.MEDIA_PROBED, {
    mediaId: candidate.id,
    pageUrl,
    manifestUrl: candidate.manifestUrl,
    kind: "hls",
    status: "ready",
    playlistType: "media",
    streamType: "vod",
    segmentCount: 42,
    revisionId: "revision-usable",
    requestContext: {
      requestUrl: candidate.manifestUrl,
      finalUrl: candidate.manifestUrl,
      documentUrl: "https://embed.example/player",
      credentials: "same-origin",
      transport: "fetch",
      requiresBrowserSession: true,
    },
  });
  usable.timestamp = 100;
  catalog.applyProbe(14, usable);
  const empty = createRegisteredEvent(EVENTS.MEDIA_PROBED, {
    mediaId: candidate.id,
    pageUrl,
    manifestUrl: candidate.manifestUrl,
    kind: "hls",
    status: "ready",
    playlistType: "unknown",
    streamType: "unknown",
    revisionId: "revision-empty",
  });
  empty.timestamp = 200;
  catalog.applyProbe(14, empty);
  const item = catalog.list(14)[0];
  assert.equal(item.streamType, "vod");
  assert.equal(item.segmentCount, 42);
  assert.equal(item.revisionId, "revision-usable");
  assert.equal(item.probeCount, 2);
  assert.equal(item.resolvedRequestContext.requiresBrowserSession, true);
});

test("request context keeps routing facts but discards headers and cookies", () => {
  const context = normalizeMediaRequestContext({
    requestUrl: "https://cdn.example/token",
    finalUrl: "https://cdn.example/master.m3u8",
    documentUrl: "https://embed.example/player",
    method: "get",
    credentials: "include",
    transport: "fetch",
    requiresBrowserSession: true,
    headers: { Cookie: "secret", Authorization: "secret" },
  });
  assert.equal(context.method, "GET");
  assert.equal(context.credentials, "include");
  assert.equal(context.requiresBrowserSession, true);
  assert.equal("headers" in context, false);
  assert.equal("cookie" in context, false);
});

test("contextual retry scopes Referer and frame Origin to one manifest and tab", () => {
  const manifestUrl =
    "https://embed.streamc.xyz/hls/token/master.m3u8?d=1&sig=a.b";
  const rule = createMediaProbeRefererRule({
    ruleId: 1_700_001,
    tabId: 42,
    manifestUrl,
    parentDocumentUrl: "https://phimvietsub.click/watch/1",
    frameDocumentUrl: "https://embed.streamc.xyz/player/abc",
  });
  assert.deepEqual(rule.condition.tabIds, [42]);
  assert.deepEqual(rule.condition.resourceTypes, ["xmlhttprequest"]);
  assert.equal(new RegExp(rule.condition.regexFilter).test(manifestUrl), true);
  assert.deepEqual(rule.action.requestHeaders, [
    {
      header: "Referer",
      operation: "set",
      value: "https://phimvietsub.click/watch/1",
    },
    {
      header: "Origin",
      operation: "set",
      value: "https://embed.streamc.xyz",
    },
  ]);
});

test("contextual probe retries 401, 403, and blocked fetches only once", () => {
  assert.equal(shouldRequestContextualProbeRetry("manifest_http_401"), true);
  assert.equal(shouldRequestContextualProbeRetry("manifest_http_403"), true);
  assert.equal(
    shouldRequestContextualProbeRetry("fallback_fetch_blocked"),
    true,
  );
  assert.equal(shouldRequestContextualProbeRetry("manifest_http_404"), false);
  assert.equal(
    shouldRequestContextualProbeRetry("fallback_fetch_blocked", true),
    false,
  );
});

test("fallback probe gate accepts HTTP manifests once and stays bounded", () => {
  const gate = createMediaProbeGate({ maximumRemembered: 2 });
  assert.equal(
    gate.claim("https://cdn.example/master.m3u8"),
    "https://cdn.example/master.m3u8",
  );
  assert.equal(gate.claim("https://cdn.example/master.m3u8"), null);
  assert.equal(gate.release("https://cdn.example/master.m3u8"), true);
  assert.equal(
    gate.claim("https://cdn.example/master.m3u8"),
    "https://cdn.example/master.m3u8",
  );
  gate.remember("https://cdn.example/one.m3u8", "ready");
  gate.remember("https://cdn.example/two.m3u8", "ready");
  assert.equal(gate.state("https://cdn.example/master.m3u8"), null);
  assert.equal(gate.state("https://cdn.example/two.m3u8"), "ready");
  assert.equal(normalizeHttpMediaUrl("blob:https://video.example/id"), null);
  assert.equal(normalizeHttpMediaUrl("javascript:alert(1)"), null);
});

test("unknown HLS probes remain retryable while populated playlists complete", () => {
  assert.equal(
    isUsableMediaProbe({
      status: "ready",
      playlistType: "unknown",
      streamType: "unknown",
    }),
    false,
  );
  assert.equal(
    isUsableMediaProbe({
      status: "ready",
      playlistType: "media",
      streamType: "vod",
      segmentCount: 1726,
    }),
    true,
  );
});

test("media observer accepts a resolved VOD after an unknown probe", () => {
  const shared = {
    mediaId: "media-hls-token",
    status: "ready",
    playlistType: "unknown",
    streamType: "unknown",
  };
  const waitingKey = createMediaObserverReportKey({
    type: EVENTS.MEDIA_PROBED,
    payload: shared,
  });
  const resolvedKey = createMediaObserverReportKey({
    type: EVENTS.MEDIA_PROBED,
    payload: {
      ...shared,
      playlistType: "media",
      streamType: "vod",
      segmentCount: 1726,
    },
  });
  assert.notEqual(waitingKey, resolvedKey);
});

test("builds an ordered HLS VOD download plan with init and byte ranges", () => {
  const plan = createHlsDownloadPlan(
    "https://cdn.example/video/playlist.m3u8",
    `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXT-X-MAP:URI="init.mp4"
#EXTINF:6,
#EXT-X-BYTERANGE:1000@0
media.mp4
#EXTINF:5.5,
#EXT-X-BYTERANGE:800
media.mp4
#EXT-X-ENDLIST`,
  );
  assert.equal(plan.status, "ready");
  assert.equal(plan.outputExtension, "mp4");
  assert.equal(plan.segmentCount, 2);
  assert.deepEqual(
    plan.resources.map((item) => [item.kind, item.byteRange]),
    [
      ["init", null],
      ["segment", { offset: 0, length: 1000 }],
      ["segment", { offset: 1000, length: 800 }],
    ],
  );
});

test("download plan rejects live, encrypted, and discontinuous playlists", () => {
  assert.equal(
    createHlsDownloadPlan(
      "https://cdn.example/live.m3u8",
      "#EXTM3U\n#EXTINF:6,\na.ts",
    ).reason,
    "live_not_supported",
  );
  assert.equal(
    createHlsDownloadPlan(
      "https://cdn.example/encrypted.m3u8",
      '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:6,\na.ts\n#EXT-X-ENDLIST',
    ).reason,
    "encrypted_not_supported",
  );
  assert.equal(
    createHlsDownloadPlan(
      "https://cdn.example/discontinuous.m3u8",
      "#EXTM3U\n#EXTINF:6,\na.ts\n#EXT-X-DISCONTINUITY\n#EXTINF:6,\nb.ts\n#EXT-X-ENDLIST",
    ).reason,
    "discontinuity_not_supported",
  );
});

test("parallel downloader bounds concurrency, retries, and writes in order", async () => {
  const resources = Array.from({ length: 7 }, (_, index) => ({ index }));
  const attempts = new Map();
  const written = [];
  let active = 0;
  let maximumActive = 0;
  const result = await downloadResourcesInParallel(resources, {
    concurrency: 3,
    retries: 1,
    retryDelay: async () => {},
    async fetchResource(resource) {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      const count = (attempts.get(resource.index) || 0) + 1;
      attempts.set(resource.index, count);
      if (resource.index === 2 && count === 1) throw new Error("retry");
      return Uint8Array.of(resource.index);
    },
    async writeResource(bytes) {
      written.push(bytes[0]);
    },
  });
  assert.equal(maximumActive, 3);
  assert.equal(attempts.get(2), 2);
  assert.deepEqual(written, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(result.downloadedBytes, 7);
});

test("parallel downloader can write completed resources immediately", async () => {
  const resources = Array.from({ length: 4 }, (_, index) => ({ index }));
  const written = [];
  let active = 0;
  let maximumActive = 0;
  await downloadResourcesInParallel(resources, {
    concurrency: 3,
    writeInOrder: false,
    async fetchResource(resource) {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) =>
        setTimeout(resolve, resource.index === 0 ? 20 : 2),
      );
      active -= 1;
      return Uint8Array.of(resource.index);
    },
    async writeResource(bytes) {
      written.push(bytes[0]);
    },
  });
  assert.equal(maximumActive, 3);
  assert.notEqual(written[0], 0);
  assert.deepEqual(
    [...written].sort((left, right) => left - right),
    [0, 1, 2, 3],
  );
});

test("download availability blocks DRM and live HLS before job creation", () => {
  const base = {
    kind: "hls",
    probeStatus: "ready",
    playlistType: "media",
    streamType: "vod",
    drm: "none",
    encryptionMethods: [],
    segmentCount: 1,
  };
  assert.equal(getMediaDownloadAvailability(base).supported, true);
  assert.equal(
    getMediaDownloadAvailability({
      ...base,
      encryptionMethods: ["AES-128"],
      encryptionScheme: "aes-128",
      encryptionKeyFormats: ["identity"],
    }).supported,
    true,
  );
  assert.equal(
    getMediaDownloadAvailability({
      ...base,
      drm: "suspected",
      encryptionScheme: "sample-aes",
      encryptionMethods: ["SAMPLE-AES"],
      drmEvidence: ["hls-sample-aes"],
    }).supported,
    true,
  );
  assert.match(
    getMediaDownloadAvailability({
      ...base,
      drm: "suspected",
      drmSystem: "widevine",
    }).reason,
    /DRM suspected · Widevine · Playback only/,
  );
  assert.match(
    getMediaDownloadAvailability({
      ...base,
      drm: "confirmed",
      drmSystem: "widevine",
    }).reason,
    /Widevine · Playback only/,
  );
  assert.match(
    getMediaDownloadAvailability({ ...base, streamType: "live" }).reason,
    /Live/,
  );
});

test("direct downloads require a valid HTTP source and normalize independently of HLS", () => {
  const candidate = {
    id: "direct-1",
    kind: "direct",
    pageUrl: "https://video.example/watch",
    sourceUrl: "https://cdn.example/movie.mp4",
    title: "Movie",
    mimeType: "video/mp4",
  };
  assert.equal(getMediaDownloadAvailability(candidate).supported, true);
  assert.equal(
    getMediaDownloadAvailability({ ...candidate, sourceUrl: "blob:test" })
      .supported,
    false,
  );
  const job = normalizeMediaDownloadJob({
    id: "job-1",
    createdAt: 1,
    sourceTabId: 7,
    candidate,
  });
  assert.equal(job.candidate.kind, "direct");
  assert.equal(job.candidate.sourceUrl, candidate.sourceUrl);
  assert.deepEqual(job.output, {
    profileId: "source",
    container: "source",
    extension: ".mp4",
    videoTrackId: null,
  });
});

test("download profiles classify direct sources and expose real adaptive containers", () => {
  assert.equal(
    classifyDirectMediaContainer({
      sourceUrl: "https://cdn.example/no-extension",
      mimeType: "video/webm; codecs=vp9",
    }),
    "webm",
  );
  assert.deepEqual(
    getMediaDownloadProfiles({ kind: "direct", mimeType: "video/mp4" }).map(
      (profile) => profile.id,
    ),
    ["source"],
  );
  assert.deepEqual(
    getMediaDownloadProfiles({ kind: "hls" }).map((profile) => profile.id),
    ["video-mp4", "video-mkv"],
  );
  assert.deepEqual(
    getMediaDownloadProfiles(
      { kind: "dash" },
      { canSelectContainer: false },
    ).map((profile) => profile.id),
    ["video-mp4"],
  );
});

test("deep inspection opens only for a proven late-observer MSE lineage gap", () => {
  const pageUrl = "https://video.example/watch";
  const hls = {
    id: "hls-late",
    pageUrl,
    kind: "hls",
    detectedBy: "network",
    manifestUrl: "https://cdn.example/movie.m3u8",
    probeStatus: "discovered",
    drm: "none",
  };
  const blob = {
    id: "blob-late",
    pageUrl,
    frameUrl: "https://player.example/embed",
    kind: "blob",
    detectedBy: "player",
    sourceUrl: "blob:https://player.example/media",
    blobTrace: {
      sourceUrls: ["https://cdn.example/segment-12.m4s"],
      candidateIds: [hls.id],
      mimeTypes: ['video/mp4; codecs="avc1"'],
      appendCount: 4,
      totalAppendedBytes: 512 * 1024,
      observerDocumentState: "interactive",
    },
  };

  const suggestion = evaluateMediaDeepInspection(blob, [blob, hls]);
  assert.equal(suggestion.eligible, true);
  assert.equal(suggestion.confidence, 0.95);
  assert.equal(suggestion.code, "observer_started_late");

  const early = evaluateMediaDeepInspection(
    {
      ...blob,
      blobTrace: { ...blob.blobTrace, observerDocumentState: "loading" },
    },
    [blob, hls],
  );
  assert.equal(early.eligible, false);
  assert.equal(early.code, "observer_already_early");
});

test("deep inspection never opens for custom protected or EME media", () => {
  const pageUrl = "https://video.example/watch";
  const blob = {
    id: "blob-protected",
    pageUrl,
    kind: "blob",
    detectedBy: "player",
    sourceUrl: "blob:https://video.example/media",
    blobTrace: {
      sourceUrls: ["https://cdn.example/segment.m4s"],
      candidateIds: ["hls-protected"],
      appendCount: 5,
      totalAppendedBytes: 1024 * 1024,
      observerDocumentState: "complete",
    },
  };
  const custom = {
    id: "hls-protected",
    pageUrl,
    kind: "hls",
    detectedBy: "network",
    manifestUrl: "https://cdn.example/protected.m3u8",
    probeStatus: "discovered",
    drm: "suspected",
    encryptionKeyFormats: ["urn:avs:shield:v3"],
  };
  const result = evaluateMediaDeepInspection(blob, [blob, custom]);
  assert.equal(result.eligible, false);
  assert.equal(result.blocked, true);
  assert.equal(result.code, "protected_media");

  const eme = {
    ...custom,
    id: "hls-eme",
    drm: "none",
    encryptionKeyFormats: [],
    eme: { keySystems: ["com.widevine.alpha"] },
  };
  const emeBlob = {
    ...blob,
    blobTrace: { ...blob.blobTrace, candidateIds: [eme.id] },
  };
  const emeResult = evaluateMediaDeepInspection(emeBlob, [emeBlob, eme]);
  assert.equal(emeResult.eligible, false);
  assert.equal(emeResult.blocked, true);
});

test("deep inspection profiles cannot be added manually and verify after success", async () => {
  const values = {};
  const storage = {
    async get(key) {
      return { [key]: values[key] };
    },
    async set(update) {
      Object.assign(values, update);
    },
  };
  await assert.rejects(
    stageMediaDeepInspectionProfile(storage, {
      pageUrl: "https://video.example/watch",
      frameUrl: "https://player.example/embed",
      suggestion: { eligible: false },
      now: 1000,
    }),
    /verified technical evidence/i,
  );

  const pending = await stageMediaDeepInspectionProfile(storage, {
    pageUrl: "https://video.example/watch",
    frameUrl: "https://player.example/embed",
    suggestion: {
      eligible: true,
      confidence: 0.95,
      code: "observer_started_late",
      strategy: "early_mse_lineage",
      mediaId: "hls-late",
    },
    now: 1000,
  });
  assert.equal(pending.state, "pending");
  assert.equal(values[MEDIA_DEEP_INSPECTION_PROFILES_KEY].length, 1);

  const verified = await verifyMediaDeepInspectionProfiles(storage, {
    pageUrl: "https://video.example/another",
    frameUrls: ["https://player.example/another"],
    successfulMediaIds: ["hls-late"],
    now: 2000,
  });
  assert.equal(verified[0].state, "verified");
  assert.equal(verified[0].lastVerifiedAt, 2000);
});

test("download estimate reports selected quality and zero-network manifest size", () => {
  const estimate = getMediaDownloadEstimate(
    {
      kind: "hls",
      duration: 600,
      variants: [
        {
          id: "720p",
          bandwidth: 2_000_000,
          resolution: { width: 1280, height: 720 },
        },
        {
          id: "1080p",
          averageBandwidth: 4_000_000,
          resolution: { width: 1920, height: 1080 },
        },
      ],
    },
    null,
  );
  assert.deepEqual(estimate.resolution, { width: 1920, height: 1080 });
  assert.equal(estimate.bandwidth, 4_000_000);
  assert.equal(estimate.estimatedBytes, 300_000_000);
  assert.equal(estimate.basis, "manifest_bandwidth");
});

test("download estimate uses player resolution for a resolved Blob source", () => {
  const estimate = getMediaDownloadEstimate(
    { kind: "hls", duration: 120 },
    {
      kind: "blob",
      resolution: { width: 1280, height: 720 },
      resolvedStream: { duration: 120, bandwidth: 2_000_000 },
    },
  );
  assert.deepEqual(estimate.resolution, { width: 1280, height: 720 });
  assert.equal(estimate.estimatedBytes, 30_000_000);
});

test("media popup signature ignores heartbeat timestamps but detects visible changes", () => {
  const base = {
    tabId: 4,
    status: "Media Helper ready.",
    helper: { status: "ready", helperVersion: "1.0.0", canDownloadHls: true },
    items: [
      {
        id: "media-1",
        kind: "hls",
        manifestUrl: "https://cdn.example/index.m3u8",
        probeStatus: "ready",
        streamType: "vod",
        lastSeenAt: 1,
      },
    ],
  };
  const initial = createMediaCatalogViewSignature(base);
  assert.equal(
    createMediaCatalogViewSignature({
      ...base,
      items: [{ ...base.items[0], lastSeenAt: 999 }],
    }),
    initial,
  );
  assert.notEqual(
    createMediaCatalogViewSignature({
      ...base,
      items: [{ ...base.items[0], probeStatus: "failed" }],
    }),
    initial,
  );
});

test("media popup keeps rows stable when heartbeat order changes", () => {
  const older = { id: "older", firstSeenAt: 10, lastSeenAt: 1000 };
  const newer = { id: "newer", firstSeenAt: 20, lastSeenAt: 50 };
  assert.deepEqual(
    selectVisibleMediaItems([older, newer]).map((item) => item.id),
    ["newer", "older"],
  );
  assert.deepEqual(
    selectVisibleMediaItems([
      { ...newer, lastSeenAt: 5000 },
      { ...older, lastSeenAt: 6000 },
    ]).map((item) => item.id),
    ["newer", "older"],
  );
});

test("media popup groups duplicate unresolved blobs from one player", () => {
  const items = selectVisibleMediaItems([
    {
      id: "blob-1",
      kind: "blob",
      pageUrl: "https://video.example/watch",
      title: "Player",
      firstSeenAt: 10,
    },
    {
      id: "blob-2",
      kind: "blob",
      pageUrl: "https://video.example/watch",
      title: "Player",
      firstSeenAt: 20,
    },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "blob-2");
  assert.equal(items[0].relatedCount, 2);
});

test("media popup groups duplicate Facebook CDN URLs but keeps distinct videos", () => {
  const facebookDirect = (path, query, id) => ({
    ...createMediaCandidateFromSource({
      pageUrl: "https://www.facebook.com/watch/",
      sourceUrl: `https://scontent.fsgn5-11.fna.fbcdn.net/${path}.mp4?${query}`,
      mimeType: "video/mp4",
      title: "Facebook",
    }),
    id,
    firstSeenAt: id === "newer" ? 20 : 10,
  });
  const visible = selectVisibleMediaItems([
    facebookDirect("AQNk_same", "token=old&bytestart=0", "older"),
    facebookDirect("AQNk_same", "token=new&byteend=999", "newer"),
    facebookDirect("AQNw_other", "token=new", "other"),
  ]);
  assert.equal(visible.length, 2);
  assert.equal(visible.find((item) => item.id === "newer")?.relatedCount, 2);
  assert.match(formatMediaName(visible[0]), /^Facebook video · /);
});

test("media popup keeps the resolved Blob when grouping player handles", () => {
  const items = selectVisibleMediaItems([
    {
      id: "blob-resolved",
      kind: "blob",
      pageUrl: "https://video.example/watch",
      title: "Player",
      firstSeenAt: 10,
      selectedMediaId: "hls-source",
      resolvedKind: "hls",
      resolvedMediaIds: ["hls-source"],
      blobTrace: { candidateIds: ["hls-source"] },
    },
    {
      id: "blob-newer",
      kind: "blob",
      pageUrl: "https://video.example/watch",
      title: "Player",
      firstSeenAt: 20,
    },
    {
      id: "hls-source",
      kind: "hls",
      firstSeenAt: 15,
    },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "blob-resolved");
  assert.equal(items[0].selectedMediaId, "hls-source");
  assert.equal(items[0].relatedCount, 2);
});

test("media popup folds a generic Blob signal into the only resolved player", () => {
  const items = selectVisibleMediaItems([
    {
      id: "blob-resolved",
      kind: "blob",
      pageUrl: "https://video.example/watch",
      title: "Try Not To Laugh",
      firstSeenAt: 10,
      selectedMediaId: "hls-source",
      resolvedKind: "hls",
      resolvedMediaIds: ["hls-source"],
      blobTrace: { candidateIds: ["hls-source"] },
    },
    {
      id: "blob-generic",
      kind: "blob",
      pageUrl: "https://video.example/watch",
      title: "Blob media stream",
      firstSeenAt: 20,
    },
    {
      id: "hls-source",
      kind: "hls",
      firstSeenAt: 15,
    },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "blob-resolved");
  assert.equal(items[0].relatedCount, 2);
});

test("media popup does not fold a generic Blob into ambiguous resolved players", () => {
  const items = selectVisibleMediaItems([
    {
      id: "blob-resolved-1",
      kind: "blob",
      pageUrl: "https://video.example/watch",
      title: "Player one",
      selectedMediaId: "hls-1",
      firstSeenAt: 10,
    },
    {
      id: "blob-resolved-2",
      kind: "blob",
      pageUrl: "https://video.example/watch",
      title: "Player two",
      selectedMediaId: "hls-2",
      firstSeenAt: 20,
    },
    {
      id: "blob-generic",
      kind: "blob",
      pageUrl: "https://video.example/watch",
      title: "Blob media stream",
      firstSeenAt: 30,
    },
  ]);
  assert.equal(items.length, 3);
});

test("media popup renders a resolved token endpoint instead of Waiting", () => {
  const token = {
    id: "token-endpoint",
    kind: "hls",
    firstSeenAt: 10,
    probeStatus: "ready",
    playlistType: "unknown",
    resolutionStatus: "resolved",
    selectedMediaId: "clear-playlist",
    resolvedStream: {
      id: "clear-playlist",
      streamType: "vod",
      duration: 5163.209,
      segmentCount: 1726,
      partialSegmentCount: 0,
      encryptionMethods: [],
    },
  };
  const clearPlaylist = {
    id: "clear-playlist",
    kind: "hls",
    firstSeenAt: 11,
    parentManifestIds: [token.id],
    probeStatus: "ready",
    playlistType: "media",
    streamType: "vod",
    duration: 5163.209,
    segmentCount: 1726,
  };
  const visible = selectVisibleMediaItems([token, clearPlaylist]);
  assert.deepEqual(
    visible.map((item) => item.id),
    [token.id],
  );
  assert.equal(
    formatMediaDetails(visible[0]),
    "Resolved · VOD · 1:26:03 · 1726 segments",
  );
});
