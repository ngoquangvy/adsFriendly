import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMediaDownloadIdentity,
  findRelatedDownloadJobs,
  RECENT_DOWNLOAD_WINDOW_MS,
} from "../src/media/download-identity.js";
const direct = (url) => ({
  kind: "direct",
  sourceUrl: url,
  pageUrl: "https://page.test/",
  title: "Same title",
});
const youtube = () => ({
  kind: "adaptive",
  provider: "youtube",
  pageUrl: "https://www.youtube.com/watch?v=abc123",
  sourceUrl: "https://www.youtube.com/watch?v=abc123",
  variants: [
    {
      id: "v720",
      itag: "136",
      mimeType: "video/mp4",
      codecs: "avc1",
      height: 720,
      width: 1280,
      sourceUrl: "https://video.test/?sig=old",
    },
    {
      id: "v360",
      itag: "134",
      mimeType: "video/mp4",
      codecs: "avc1",
      height: 360,
      width: 640,
      sourceUrl: "https://video.test/?sig=old",
    },
  ],
  audioTracks: [
    {
      id: "vi",
      itag: "140",
      mimeType: "audio/mp4",
      sourceUrl: "https://audio.test/?sig=old",
      language: "vi",
      audioRole: "original",
    },
    {
      id: "en",
      itag: "140",
      mimeType: "audio/mp4",
      sourceUrl: "https://audio.test/?sig=old",
      language: "en",
      audioRole: "dubbed",
    },
  ],
});
test("identity never conflates equal titles or different generic query-defined videos", async () => {
  const a = await buildMediaDownloadIdentity(
    direct("https://cdn.test/video.mp4?id=1&token=private"),
  );
  const b = await buildMediaDownloadIdentity(
    direct("https://cdn.test/video.mp4?id=2&token=private"),
  );
  assert.notEqual(a.assetKey, b.assetKey);
  assert.equal(JSON.stringify(a).includes("private"), false);
  assert.equal(JSON.stringify(a).includes("cdn.test"), false);
});
test("YouTube identity survives signed URLs but separates quality, audio language and output mode", async () => {
  const candidate = youtube();
  const selection = {
    profileId: "video-mp4",
    videoTrackId: "v720",
    audioTrackId: "vi",
  };
  const first = await buildMediaDownloadIdentity(candidate, selection);
  const refreshed = youtube();
  refreshed.variants.forEach(
    (track) => (track.sourceUrl = "https://different.video.test/?sig=new"),
  );
  assert.deepEqual(
    await buildMediaDownloadIdentity(refreshed, selection),
    first,
  );
  for (const change of [
    { videoTrackId: "v360" },
    { audioTrackId: "en" },
    { profileId: "audio-ogg" },
    { profileId: "video-mkv" },
  ]) {
    const next = await buildMediaDownloadIdentity(candidate, {
      ...selection,
      ...change,
    });
    assert.equal(next.assetKey, first.assetKey);
    assert.notEqual(next.requestKey, first.requestKey);
  }
});
test("recent lookup prefers active identical requests and excludes failures, old records and legacy unknown choices", async () => {
  const downloadIdentity = await buildMediaDownloadIdentity(
    direct("https://cdn.test/video.mp4"),
  );
  const jobs = [
    { id: "old", status: "completed", updatedAt: 0, downloadIdentity },
    { id: "failed", status: "failed", updatedAt: 100, downloadIdentity },
    { id: "completed", status: "completed", updatedAt: 100, downloadIdentity },
    { id: "active", status: "downloading", updatedAt: 50, downloadIdentity },
    { id: "legacy", status: "completed", updatedAt: 100 },
  ];
  assert.deepEqual(
    findRelatedDownloadJobs(jobs, downloadIdentity, {
      now: RECENT_DOWNLOAD_WINDOW_MS + 1,
    }).map((job) => job.id),
    ["active", "completed"],
  );
});

test("known source IDs survive authorization rotation but quality and language remain distinct", async () => {
  const base = direct(
    "https://s1102.pornone.com/vid2/auth/1791866742/61/279834761/279834761_720x406_500k.mp4?lang=en",
  );
  const fresh = direct(
    "https://s3109.pornone.com/vid2/fresh/1791869999/61/279834761/279834761_720x406_500k.mp4?lang=en",
  );
  const first = await buildMediaDownloadIdentity(base);
  assert.deepEqual(await buildMediaDownloadIdentity(fresh), first);
  for (const source of [
    fresh.sourceUrl.replace("720x406_500k", "1280x720_1500k"),
    fresh.sourceUrl.replace("lang=en", "lang=vi"),
  ]) {
    const identity = await buildMediaDownloadIdentity(direct(source));
    assert.equal(identity.assetKey, first.assetKey);
    assert.notEqual(identity.requestKey, first.requestKey);
  }
});

test("audio-only identity ignores video selection but preserves audio quality and language", async () => {
  const candidate = youtube();
  const output = {
    profileId: "audio-ogg",
    audioTrackId: "vi",
    videoTrackId: "v720",
  };
  assert.deepEqual(
    await buildMediaDownloadIdentity(candidate, output),
    await buildMediaDownloadIdentity(candidate, {
      ...output,
      videoTrackId: "v360",
    }),
  );
  assert.notEqual(
    (await buildMediaDownloadIdentity(candidate, output)).requestKey,
    (
      await buildMediaDownloadIdentity(candidate, {
        ...output,
        audioTrackId: "en",
      })
    ).requestKey,
  );
});

test("Facebook identity retains rendition envelopes while dropping rotating CDN authentication", async () => {
  const envelope = btoa(
    JSON.stringify({ xpv_asset_id: "123456", encoding_tag: "hd" }),
  );
  const sourceUrl = `https://scontent.test.fbcdn.net/video.mp4?efg=${envelope}&auth=old`;
  const candidate = {
    kind: "adaptive",
    provider: "facebook",
    pageUrl: "https://www.facebook.com/reel/123456",
    sourceUrl,
    variants: [
      {
        id: "video",
        sourceUrl,
        mimeType: "video/mp4",
        height: 720,
        muxed: true,
      },
    ],
    audioTracks: [],
  };
  const first = await buildMediaDownloadIdentity(candidate, {
    videoTrackId: "video",
  });
  const refreshedUrl = sourceUrl
    .replace("scontent.test", "scontent.other")
    .replace("auth=old", "auth=new");
  const refreshed = {
    ...candidate,
    sourceUrl: refreshedUrl,
    variants: [{ ...candidate.variants[0], sourceUrl: refreshedUrl }],
  };
  assert.deepEqual(
    await buildMediaDownloadIdentity(refreshed, { videoTrackId: "video" }),
    first,
  );
  refreshed.variants[0].sourceUrl = refreshedUrl.replace(
    envelope,
    btoa(JSON.stringify({ xpv_asset_id: "123456", encoding_tag: "sd" })),
  );
  assert.notEqual(
    (await buildMediaDownloadIdentity(refreshed, { videoTrackId: "video" }))
      .requestKey,
    first.requestKey,
  );
});
