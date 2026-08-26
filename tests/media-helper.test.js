import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { endianness, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  MEDIA_HELPER_EVENTS,
  MEDIA_HELPER_PROTOCOL_VERSION,
  MEDIA_HELPER_REQUESTS,
} from "../src/media/helper-contract.js";

const execFileAsync = promisify(execFile);

test("built helper completes a framed Native Messaging handshake", async () => {
  const hostPath = fileURLToPath(
    new URL("../packages/media-helper/dist/host.cjs", import.meta.url),
  );
  const child = spawn(
    process.execPath,
    [hostPath, "chrome-extension://test/"],
    {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  const request = {
    type: MEDIA_HELPER_REQUESTS.HELLO,
    requestId: "hello-1",
    protocolVersion: MEDIA_HELPER_PROTOCOL_VERSION,
    payload: { extensionVersion: "test" },
  };
  child.stdin.end(frame(request));
  const response = await readFrame(child.stdout);
  child.kill();

  assert.equal(response.type, MEDIA_HELPER_EVENTS.READY);
  assert.equal(response.requestId, "hello-1");
  assert.equal(response.protocolVersion, MEDIA_HELPER_PROTOCOL_VERSION);
  assert.equal(response.payload.callerOrigin, "chrome-extension://test/");
  assert.equal(typeof response.payload.capabilities, "object");
  assert.equal(response.payload.capabilities["output.open"], true);
  assert.equal(response.payload.capabilities["output.reveal"], true);
  assert.equal(
    response.payload.capabilities["download.hls_parallel_acquisition"],
    true,
  );
  assert.equal(
    response.payload.capabilities["output.container_selection"],
    true,
  );
});

test("built helper times out a stalled HLS preflight with a precise stage", async (t) => {
  const server = createServer(() => {});
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections?.();
    server.close();
  });
  const outputDirectory = await mkdtemp(
    join(tmpdir(), "adsfriendly-hls-timeout-"),
  );
  t.after(() => rm(outputDirectory, { recursive: true, force: true }));
  const address = server.address();
  const manifestUrl = `http://127.0.0.1:${address.port}/stalled.m3u8`;
  const child = spawnHelper({
    ADSFRIENDLY_HELPER_HLS_PREFLIGHT_TIMEOUT_MS: "200",
  });
  t.after(() => child.kill());
  const frames = createFrameReader(child.stdout);

  child.stdin.write(
    frame(hlsDownloadRequest("hls-timeout-1", manifestUrl, outputDirectory)),
  );
  const probing = await frames.next(
    (event) =>
      event.type === MEDIA_HELPER_EVENTS.DOWNLOAD_PROGRESS &&
      event.payload.stage === "manifest_fetch",
  );
  assert.equal(probing.payload.phase, "probing");
  const failed = await frames.next(
    (event) =>
      event.type === MEDIA_HELPER_EVENTS.ERROR &&
      event.requestId === "hls-timeout-1",
  );
  assert.match(
    failed.payload.message,
    /HLS preflight timed out after 0\.2 seconds/,
  );
});

test("built helper downloads direct media with ranges, cancellation, and resume", async (t) => {
  const bytes = Buffer.alloc(12 * 1024 * 1024 + 37);
  for (let index = 0; index < bytes.length; index++) bytes[index] = index % 251;
  const server = createRangeServer(bytes, 3);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const outputDirectory = await mkdtemp(join(tmpdir(), "adsfriendly-helper-"));
  t.after(() => rm(outputDirectory, { recursive: true, force: true }));
  const address = server.address();
  const sourceUrl = `http://127.0.0.1:${address.port}/sample.mp4`;
  const child = spawnHelper();
  t.after(() => child.kill());
  const frames = createFrameReader(child.stdout);

  child.stdin.write(
    frame(downloadRequest("download-1", sourceUrl, outputDirectory)),
  );
  await frames.next(
    (event) => event.type === MEDIA_HELPER_EVENTS.DOWNLOAD_STARTED,
  );
  await frames.next(
    (event) =>
      event.type === MEDIA_HELPER_EVENTS.DOWNLOAD_PROGRESS &&
      event.payload.downloadedBytes >= 8 * 1024 * 1024 &&
      event.payload.downloadedBytes < bytes.length,
  );
  child.stdin.write(
    frame({
      type: MEDIA_HELPER_REQUESTS.DOWNLOAD_CANCEL,
      requestId: "download-1",
      protocolVersion: MEDIA_HELPER_PROTOCOL_VERSION,
      payload: { jobId: "download-1" },
    }),
  );
  await frames.next(
    (event) => event.type === MEDIA_HELPER_EVENTS.DOWNLOAD_CANCELLED,
  );

  child.stdin.write(
    frame(downloadRequest("download-2", sourceUrl, outputDirectory)),
  );
  const resumed = await frames.next(
    (event) =>
      event.requestId === "download-2" &&
      event.type === MEDIA_HELPER_EVENTS.DOWNLOAD_PROGRESS &&
      event.payload.resumedBytes > 0,
  );
  const completed = await frames.next(
    (event) =>
      event.requestId === "download-2" &&
      event.type === MEDIA_HELPER_EVENTS.DOWNLOAD_COMPLETED,
  );
  assert.ok(resumed.payload.resumedBytes >= 4 * 1024 * 1024);
  assert.deepEqual(await readFile(completed.payload.outputPath), bytes);
});

test("built helper remuxes inline HLS with disguised segment extensions", async (t) => {
  if (
    !(await executableAvailable("ffmpeg")) ||
    !(await executableAvailable("ffprobe"))
  ) {
    t.skip("FFmpeg integration tools are not installed.");
    return;
  }
  const fixtureDirectory = await mkdtemp(
    join(tmpdir(), "adsfriendly-hls-fixture-"),
  );
  const outputDirectory = await mkdtemp(
    join(tmpdir(), "adsfriendly-hls-output-"),
  );
  t.after(() => rm(fixtureDirectory, { recursive: true, force: true }));
  t.after(() => rm(outputDirectory, { recursive: true, force: true }));
  const manifestPath = join(fixtureDirectory, "index.m3u8");
  await execFileAsync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=160x90:rate=10",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=880:sample_rate=44100",
      "-t",
      "2",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-g",
      "5",
      "-keyint_min",
      "5",
      "-sc_threshold",
      "0",
      "-c:a",
      "aac",
      "-hls_time",
      "0.5",
      "-hls_list_size",
      "0",
      "-hls_playlist_type",
      "vod",
      "-hls_segment_filename",
      join(fixtureDirectory, "segment%03d.ts"),
      manifestPath,
    ],
    { windowsHide: true, cwd: fixtureDirectory },
  );
  const playlist = await readFile(manifestPath, "utf8");
  const disguisedPlaylist = playlist
    .replace(/segment(\d+)\.ts/g, "segment$1.png")
    .replace(/(segment000\.png\r?\n)/, "$1#EXT-X-DISCONTINUITY\n");
  await writeFile(manifestPath, disguisedPlaylist);

  const server = createServer(async (request, response) => {
    try {
      const filename = basename(
        new URL(request.url, "http://fixture").pathname,
      );
      if (filename === "index.m3u8") {
        response.writeHead(403).end();
        return;
      }
      const sourceFilename = filename.endsWith(".png")
        ? filename.replace(/\.png$/i, ".ts")
        : filename;
      const bytes = await readFile(join(fixtureDirectory, sourceFilename));
      response.setHeader(
        "content-type",
        filename.endsWith(".m3u8")
          ? "application/vnd.apple.mpegurl"
          : filename.endsWith(".png")
            ? "image/png"
            : "video/mp2t",
      );
      response.end(bytes);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  const manifestUrl = `http://127.0.0.1:${address.port}/index.m3u8`;
  const child = spawnHelper();
  t.after(() => child.kill());
  const frames = createFrameReader(child.stdout);
  child.stdin.write(
    frame(
      hlsDownloadRequest(
        "hls-download-1",
        manifestUrl,
        outputDirectory,
        disguisedPlaylist,
        "video-mkv",
      ),
    ),
  );
  const started = await frames.next(
    (event) => event.type === MEDIA_HELPER_EVENTS.DOWNLOAD_STARTED,
  );
  assert.equal(started.payload.adapterId, "hls-ffmpeg");
  const completed = await frames.next(
    (event) =>
      event.requestId === "hls-download-1" &&
      [
        MEDIA_HELPER_EVENTS.DOWNLOAD_COMPLETED,
        MEDIA_HELPER_EVENTS.ERROR,
      ].includes(event.type),
  );
  assert.equal(
    completed.type,
    MEDIA_HELPER_EVENTS.DOWNLOAD_COMPLETED,
    completed.payload.message,
  );
  assert.match(completed.payload.outputPath, /\.mkv$/i);
  const probe = JSON.parse(
    (
      await execFileAsync(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration:stream=codec_type",
          "-of",
          "json",
          completed.payload.outputPath,
        ],
        { windowsHide: true },
      )
    ).stdout,
  );
  assert.ok(Number(probe.format.duration) >= 1.5);
  assert.deepEqual(
    [...new Set(probe.streams.map((stream) => stream.codec_type))].sort(),
    ["audio", "video"],
  );
});

test("built helper downloads HLS encrypted with an AES-128 identity key", async (t) => {
  if (
    !(await executableAvailable("ffmpeg")) ||
    !(await executableAvailable("ffprobe"))
  ) {
    t.skip("FFmpeg integration tools are not installed.");
    return;
  }
  const fixtureDirectory = await mkdtemp(
    join(tmpdir(), "adsfriendly-aes128-fixture-"),
  );
  const outputDirectory = await mkdtemp(
    join(tmpdir(), "adsfriendly-aes128-output-"),
  );
  t.after(() => rm(fixtureDirectory, { recursive: true, force: true }));
  t.after(() => rm(outputDirectory, { recursive: true, force: true }));
  const manifestPath = join(fixtureDirectory, "encrypted.m3u8");
  const keyPath = join(fixtureDirectory, "key.bin");
  const keyInfoPath = join(fixtureDirectory, "key-info.txt");
  await writeFile(keyPath, Buffer.from("0123456789abcdef"));
  await writeFile(keyInfoPath, `key.bin\n${keyPath}\n`);
  await execFileAsync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=160x90:rate=10",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=44100",
      "-t",
      "2",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-g",
      "5",
      "-keyint_min",
      "5",
      "-sc_threshold",
      "0",
      "-c:a",
      "aac",
      "-hls_time",
      "0.5",
      "-hls_list_size",
      "0",
      "-hls_playlist_type",
      "vod",
      "-hls_key_info_file",
      keyInfoPath,
      "-hls_segment_filename",
      join(fixtureDirectory, "encrypted%03d.ts"),
      manifestPath,
    ],
    { windowsHide: true, cwd: fixtureDirectory },
  );

  let activeSegmentRequests = 0;
  let maximumConcurrentSegmentRequests = 0;
  const requestedSegments = new Set();
  const keyUserAgents = [];
  const server = createServer(async (request, response) => {
    try {
      const filename = basename(
        new URL(request.url, "http://fixture").pathname,
      );
      if (filename === "key.bin") {
        keyUserAgents.push(request.headers["user-agent"] || "");
        response.writeHead(403).end();
        return;
      }
      if (filename.endsWith(".ts")) {
        requestedSegments.add(filename);
        activeSegmentRequests += 1;
        maximumConcurrentSegmentRequests = Math.max(
          maximumConcurrentSegmentRequests,
          activeSegmentRequests,
        );
        await new Promise((resolve) => setTimeout(resolve, 60));
        activeSegmentRequests -= 1;
      }
      const bytes = await readFile(join(fixtureDirectory, filename));
      response.setHeader(
        "content-type",
        filename.endsWith(".m3u8")
          ? "application/vnd.apple.mpegurl"
          : filename.endsWith(".bin")
            ? "application/octet-stream"
            : "video/mp2t",
      );
      response.end(bytes);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  const manifestUrl = `http://127.0.0.1:${address.port}/encrypted.m3u8`;
  const child = spawnHelper();
  t.after(() => child.kill());
  const frames = createFrameReader(child.stdout);
  const keyUrl = `http://127.0.0.1:${address.port}/key.bin`;
  child.stdin.write(
    frame(
      hlsDownloadRequest(
        "hls-aes128-1",
        manifestUrl,
        outputDirectory,
        null,
        null,
        {
          browserUserAgent: "AdsFriendly-Test-Browser/123",
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
        },
      ),
    ),
  );
  await frames.next(
    (event) => event.type === MEDIA_HELPER_EVENTS.DOWNLOAD_STARTED,
  );
  const segmentProgress = await frames.next(
    (event) =>
      event.type === MEDIA_HELPER_EVENTS.DOWNLOAD_PROGRESS &&
      event.payload.stage === "segment_download",
  );
  assert.equal(segmentProgress.payload.resumable, true);
  const completed = await frames.next(
    (event) =>
      event.requestId === "hls-aes128-1" &&
      [
        MEDIA_HELPER_EVENTS.DOWNLOAD_COMPLETED,
        MEDIA_HELPER_EVENTS.ERROR,
      ].includes(event.type),
  );
  assert.equal(
    completed.type,
    MEDIA_HELPER_EVENTS.DOWNLOAD_COMPLETED,
    completed.payload.message,
  );
  const probe = JSON.parse(
    (
      await execFileAsync(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration:stream=codec_type",
          "-of",
          "json",
          completed.payload.outputPath,
        ],
        { windowsHide: true },
      )
    ).stdout,
  );
  assert.ok(Number(probe.format.duration) >= 1.5);
  assert.deepEqual(
    [...new Set(probe.streams.map((stream) => stream.codec_type))].sort(),
    ["audio", "video"],
  );
  assert.ok(requestedSegments.size >= 3);
  assert.ok(maximumConcurrentSegmentRequests >= 2);
  assert.ok(keyUserAgents.length >= 1);
  assert.ok(
    keyUserAgents.every((value) => value === "AdsFriendly-Test-Browser/123"),
  );

  const keyRequestsBeforeLearnedRetry = keyUserAgents.length;
  child.stdin.write(
    frame(
      hlsDownloadRequest(
        "hls-aes128-learned-2",
        manifestUrl,
        outputDirectory,
        null,
        null,
        {
          browserUserAgent: "AdsFriendly-Test-Browser/123",
          accessStrategyPreferences: {
            "127.0.0.1": { browser_key_handoff: 2 },
          },
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
        },
      ),
    ),
  );
  const learnedCompletion = await frames.next(
    (event) =>
      event.requestId === "hls-aes128-learned-2" &&
      [
        MEDIA_HELPER_EVENTS.DOWNLOAD_COMPLETED,
        MEDIA_HELPER_EVENTS.ERROR,
      ].includes(event.type),
  );
  assert.equal(
    learnedCompletion.type,
    MEDIA_HELPER_EVENTS.DOWNLOAD_COMPLETED,
    learnedCompletion.payload.message,
  );
  assert.equal(keyUserAgents.length, keyRequestsBeforeLearnedRetry);
});

test("built helper resumes cached HLS segments after cancellation", async (t) => {
  if (!(await executableAvailable("ffmpeg"))) {
    t.skip("FFmpeg is not installed.");
    return;
  }
  const fixtureDirectory = await mkdtemp(
    join(tmpdir(), "adsfriendly-hls-resume-fixture-"),
  );
  const outputDirectory = await mkdtemp(
    join(tmpdir(), "adsfriendly-hls-resume-output-"),
  );
  t.after(() => rm(fixtureDirectory, { recursive: true, force: true }));
  t.after(() => rm(outputDirectory, { recursive: true, force: true }));
  const manifestPath = join(fixtureDirectory, "resume.m3u8");
  await execFileAsync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=160x90:rate=10",
      "-t",
      "6",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-g",
      "5",
      "-keyint_min",
      "5",
      "-sc_threshold",
      "0",
      "-hls_time",
      "0.5",
      "-hls_list_size",
      "0",
      "-hls_playlist_type",
      "vod",
      "-hls_segment_filename",
      join(fixtureDirectory, "resume%03d.ts"),
      manifestPath,
    ],
    { windowsHide: true, cwd: fixtureDirectory },
  );

  const requests = new Map();
  const server = createServer(async (request, response) => {
    try {
      const filename = basename(
        new URL(request.url, "http://fixture").pathname,
      );
      requests.set(filename, (requests.get(filename) || 0) + 1);
      if (filename.endsWith(".ts")) {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      const bytes = await readFile(join(fixtureDirectory, filename));
      response.setHeader(
        "content-type",
        filename.endsWith(".m3u8")
          ? "application/vnd.apple.mpegurl"
          : "video/mp2t",
      );
      response.end(bytes);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  const manifestUrl = `http://127.0.0.1:${address.port}/resume.m3u8`;
  const child = spawnHelper();
  t.after(() => child.kill());
  const frames = createFrameReader(child.stdout);
  const jobId = "hls-resume-1";

  child.stdin.write(
    frame(hlsDownloadRequest(jobId, manifestUrl, outputDirectory)),
  );
  const firstWritten = await frames.next(
    (event) =>
      event.requestId === jobId &&
      event.type === MEDIA_HELPER_EVENTS.DOWNLOAD_PROGRESS &&
      event.payload.stage === "segment_download" &&
      event.payload.downloadedBytes > event.payload.resumedBytes,
  );
  child.stdin.write(
    frame({
      type: MEDIA_HELPER_REQUESTS.DOWNLOAD_CANCEL,
      requestId: "hls-resume-cancel-1",
      protocolVersion: MEDIA_HELPER_PROTOCOL_VERSION,
      payload: { jobId },
    }),
  );
  await frames.next(
    (event) =>
      event.requestId === jobId &&
      event.type === MEDIA_HELPER_EVENTS.DOWNLOAD_CANCELLED,
  );
  await new Promise((resolve) => setTimeout(resolve, 20));

  child.stdin.write(
    frame(hlsDownloadRequest(jobId, manifestUrl, outputDirectory)),
  );
  const resumed = await frames.next(
    (event) =>
      event.requestId === jobId &&
      event.type === MEDIA_HELPER_EVENTS.DOWNLOAD_PROGRESS &&
      event.payload.stage === "segment_download" &&
      event.payload.resumedBytes > firstWritten.payload.resumedBytes,
  );
  const completed = await frames.next(
    (event) =>
      event.requestId === jobId &&
      [
        MEDIA_HELPER_EVENTS.DOWNLOAD_COMPLETED,
        MEDIA_HELPER_EVENTS.ERROR,
      ].includes(event.type),
  );
  assert.ok(resumed.payload.resumedBytes > 0);
  assert.equal(
    completed.type,
    MEDIA_HELPER_EVENTS.DOWNLOAD_COMPLETED,
    completed.payload.message,
  );
  assert.ok(
    [...requests.entries()].some(
      ([filename, count]) => filename.endsWith(".ts") && count === 1,
    ),
  );
});

test("built helper stops after a failed HLS canary without downloading the full playlist", async (t) => {
  if (!(await executableAvailable("ffmpeg"))) {
    t.skip("FFmpeg is not installed.");
    return;
  }
  const outputDirectory = await mkdtemp(
    join(tmpdir(), "adsfriendly-hls-canary-failure-"),
  );
  t.after(() => rm(outputDirectory, { recursive: true, force: true }));
  const requestedSegments = [];
  const manifest = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXT-X-TARGETDURATION:2",
    "#EXT-X-PLAYLIST-TYPE:VOD",
    "#EXTINF:2,",
    "segment000.ts",
    "#EXTINF:2,",
    "segment001.ts",
    "#EXTINF:2,",
    "segment002.ts",
    "#EXT-X-ENDLIST",
  ].join("\n");
  const server = createServer((request, response) => {
    const filename = basename(new URL(request.url, "http://fixture").pathname);
    if (filename === "index.m3u8") {
      response.setHeader("content-type", "application/vnd.apple.mpegurl");
      response.end(manifest);
      return;
    }
    requestedSegments.push(filename);
    response.setHeader("content-type", "video/mp2t");
    response.end(Buffer.from("not-a-transport-stream"));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  const child = spawnHelper();
  t.after(() => child.kill());
  const frames = createFrameReader(child.stdout);
  child.stdin.write(
    frame(
      hlsDownloadRequest(
        "hls-canary-failure-1",
        `http://127.0.0.1:${address.port}/index.m3u8`,
        outputDirectory,
      ),
    ),
  );
  const failed = await frames.next(
    (event) =>
      event.requestId === "hls-canary-failure-1" &&
      event.type === MEDIA_HELPER_EVENTS.ERROR,
  );
  assert.match(failed.payload.message, /HLS compatibility check failed/);
  assert.deepEqual(requestedSegments, ["segment000.ts"]);
});

test("built helper downloads and muxes a static DASH VOD with FFmpeg", async (t) => {
  if (
    !(await executableAvailable("ffmpeg")) ||
    !(await executableAvailable("ffprobe"))
  ) {
    t.skip("FFmpeg integration tools are not installed.");
    return;
  }
  const fixtureDirectory = await mkdtemp(
    join(tmpdir(), "adsfriendly-dash-fixture-"),
  );
  const outputDirectory = await mkdtemp(
    join(tmpdir(), "adsfriendly-dash-output-"),
  );
  t.after(() => rm(fixtureDirectory, { recursive: true, force: true }));
  t.after(() => rm(outputDirectory, { recursive: true, force: true }));
  const manifestPath = join(fixtureDirectory, "manifest.mpd");
  await execFileAsync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=160x90:rate=10",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=660:sample_rate=44100",
      "-t",
      "2",
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-seg_duration",
      "0.5",
      "-use_template",
      "1",
      "-use_timeline",
      "1",
      "-f",
      "dash",
      manifestPath,
    ],
    { windowsHide: true, cwd: fixtureDirectory },
  );

  const server = createServer(async (request, response) => {
    try {
      const filename = basename(
        new URL(request.url, "http://fixture").pathname,
      );
      const bytes = await readFile(join(fixtureDirectory, filename));
      response.setHeader(
        "content-type",
        filename.endsWith(".mpd")
          ? "application/dash+xml"
          : "video/iso.segment",
      );
      response.end(bytes);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  const manifestUrl = `http://127.0.0.1:${address.port}/manifest.mpd`;
  const child = spawnHelper();
  t.after(() => child.kill());
  const frames = createFrameReader(child.stdout);
  child.stdin.write(
    frame(dashDownloadRequest("dash-download-1", manifestUrl, outputDirectory)),
  );
  const started = await frames.next(
    (event) => event.type === MEDIA_HELPER_EVENTS.DOWNLOAD_STARTED,
  );
  assert.equal(started.payload.adapterId, "dash-ffmpeg");
  const completed = await frames.next(
    (event) =>
      event.requestId === "dash-download-1" &&
      [
        MEDIA_HELPER_EVENTS.DOWNLOAD_COMPLETED,
        MEDIA_HELPER_EVENTS.ERROR,
      ].includes(event.type),
  );
  assert.equal(
    completed.type,
    MEDIA_HELPER_EVENTS.DOWNLOAD_COMPLETED,
    completed.payload.message,
  );
  const probe = JSON.parse(
    (
      await execFileAsync(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration:stream=codec_type",
          "-of",
          "json",
          completed.payload.outputPath,
        ],
        { windowsHide: true },
      )
    ).stdout,
  );
  assert.ok(Number(probe.format.duration) >= 1.5);
  assert.deepEqual(
    [...new Set(probe.streams.map((stream) => stream.codec_type))].sort(),
    ["audio", "video"],
  );
});

test("built helper downloads resolved adaptive tracks in parallel and muxes them", async (t) => {
  if (
    !(await executableAvailable("ffmpeg")) ||
    !(await executableAvailable("ffprobe"))
  ) {
    t.skip("FFmpeg integration tools are not installed.");
    return;
  }
  const fixtureDirectory = await mkdtemp(
    join(tmpdir(), "adsfriendly-adaptive-fixture-"),
  );
  const outputDirectory = await mkdtemp(
    join(tmpdir(), "adsfriendly-adaptive-output-"),
  );
  t.after(() => rm(fixtureDirectory, { recursive: true, force: true }));
  t.after(() => rm(outputDirectory, { recursive: true, force: true }));
  const videoPath = join(fixtureDirectory, "video.mp4");
  const audioPath = join(fixtureDirectory, "audio.m4a");
  await execFileAsync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=160x90:rate=10",
      "-t",
      "1",
      "-an",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      videoPath,
    ],
    { windowsHide: true },
  );
  await execFileAsync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=660:sample_rate=44100",
      "-t",
      "1",
      "-vn",
      "-c:a",
      "aac",
      audioPath,
    ],
    { windowsHide: true },
  );
  const files = new Map([
    ["/video.mp4", await readFile(videoPath)],
    ["/audio.m4a", await readFile(audioPath)],
  ]);
  const server = createStaticRangeServer(files);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const child = spawnHelper();
  t.after(() => child.kill());
  const frames = createFrameReader(child.stdout);
  child.stdin.write(
    frame(
      adaptiveDownloadRequest(
        "adaptive-download-1",
        `${baseUrl}/video.mp4`,
        `${baseUrl}/audio.m4a`,
        outputDirectory,
      ),
    ),
  );
  const started = await frames.next(
    (event) => event.type === MEDIA_HELPER_EVENTS.DOWNLOAD_STARTED,
  );
  assert.equal(started.payload.adapterId, "adaptive-http");
  const completed = await frames.next(
    (event) =>
      event.requestId === "adaptive-download-1" &&
      [
        MEDIA_HELPER_EVENTS.DOWNLOAD_COMPLETED,
        MEDIA_HELPER_EVENTS.ERROR,
      ].includes(event.type),
  );
  assert.equal(
    completed.type,
    MEDIA_HELPER_EVENTS.DOWNLOAD_COMPLETED,
    completed.payload.message,
  );
  const probe = JSON.parse(
    (
      await execFileAsync(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "stream=codec_type",
          "-of",
          "json",
          completed.payload.outputPath,
        ],
        { windowsHide: true },
      )
    ).stdout,
  );
  assert.deepEqual(
    [...new Set(probe.streams.map((stream) => stream.codec_type))].sort(),
    ["audio", "video"],
  );
});

function spawnHelper(extraEnv = {}) {
  const hostPath = fileURLToPath(
    new URL("../packages/media-helper/dist/host.cjs", import.meta.url),
  );
  return spawn(process.execPath, [hostPath, "chrome-extension://test/"], {
    env: {
      ...process.env,
      ADSFRIENDLY_HELPER_ALLOW_PRIVATE: "1",
      ...extraEnv,
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
}

function downloadRequest(jobId, sourceUrl, outputDirectory) {
  return {
    type: MEDIA_HELPER_REQUESTS.DOWNLOAD_START,
    requestId: jobId,
    protocolVersion: MEDIA_HELPER_PROTOCOL_VERSION,
    payload: {
      jobId,
      connections: 2,
      outputDirectory,
      candidate: {
        id: "direct-test",
        kind: "direct",
        pageUrl: sourceUrl,
        sourceUrl,
        title: "sample",
        mimeType: "video/mp4",
      },
    },
  };
}

function hlsDownloadRequest(
  jobId,
  manifestUrl,
  outputDirectory,
  manifestBody = null,
  profileId = null,
  options = {},
) {
  return {
    type: MEDIA_HELPER_REQUESTS.DOWNLOAD_START,
    requestId: jobId,
    protocolVersion: MEDIA_HELPER_PROTOCOL_VERSION,
    payload: {
      jobId,
      connections: 4,
      outputDirectory,
      output: profileId ? { profileId } : undefined,
      browserUserAgent: options.browserUserAgent,
      accessStrategyPreferences: options.accessStrategyPreferences,
      candidate: {
        id: "hls-test",
        kind: "hls",
        pageUrl: manifestUrl,
        manifestUrl,
        title: "fixture-hls",
        mimeType: "application/vnd.apple.mpegurl",
        duration: 2,
        segmentCount: 4,
        requestContext: {
          referrer: manifestUrl,
          documentUrl: manifestUrl,
          method: "GET",
          credentials: "omit",
          requiresBrowserSession: false,
        },
        manifestHandoff: manifestBody
          ? {
              kind: "hls",
              manifestUrl,
              body: manifestBody,
              revisionId: "fixture-inline-manifest",
            }
          : null,
        keyHandoff: options.keyHandoff || null,
      },
    },
  };
}

function dashDownloadRequest(jobId, manifestUrl, outputDirectory) {
  return {
    type: MEDIA_HELPER_REQUESTS.DOWNLOAD_START,
    requestId: jobId,
    protocolVersion: MEDIA_HELPER_PROTOCOL_VERSION,
    payload: {
      jobId,
      connections: 4,
      outputDirectory,
      candidate: {
        id: "dash-test",
        kind: "dash",
        pageUrl: manifestUrl,
        manifestUrl,
        title: "fixture-dash",
        mimeType: "application/dash+xml",
        duration: 2,
        requestContext: {
          referrer: manifestUrl,
          documentUrl: manifestUrl,
          method: "GET",
          credentials: "omit",
          requiresBrowserSession: false,
        },
      },
    },
  };
}

function adaptiveDownloadRequest(jobId, videoUrl, audioUrl, outputDirectory) {
  return {
    type: MEDIA_HELPER_REQUESTS.DOWNLOAD_START,
    requestId: jobId,
    protocolVersion: MEDIA_HELPER_PROTOCOL_VERSION,
    payload: {
      jobId,
      connections: 4,
      outputDirectory,
      candidate: {
        id: "adaptive-test",
        kind: "adaptive",
        pageUrl: videoUrl,
        sourceUrl: videoUrl,
        title: "fixture-adaptive",
        duration: 1,
        provider: "test",
        acquisitionProfile: "resolved_tracks",
        variants: [
          {
            id: "video-1",
            type: "video",
            sourceUrl: videoUrl,
            mimeType: "video/mp4",
            width: 160,
            height: 90,
          },
        ],
        audioTracks: [
          {
            id: "audio-1",
            type: "audio",
            sourceUrl: audioUrl,
            mimeType: "audio/mp4",
          },
        ],
        requestContext: {
          referrer: videoUrl,
          documentUrl: videoUrl,
          method: "GET",
          credentials: "omit",
          requiresBrowserSession: false,
        },
      },
    },
  };
}

async function executableAvailable(command) {
  try {
    await execFileAsync(command, ["-version"], { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function createRangeServer(bytes, delayMs) {
  return createServer((request, response) => {
    response.setHeader("Accept-Ranges", "bytes");
    response.setHeader("Content-Type", "video/mp4");
    response.setHeader("ETag", '"direct-test-v1"');
    if (request.method === "HEAD") {
      response.setHeader("Content-Length", bytes.length);
      response.end();
      return;
    }
    const match = request.headers.range?.match(/^bytes=(\d+)-(\d+)$/);
    if (!match) {
      response.writeHead(200, { "Content-Length": bytes.length });
      response.end(bytes);
      return;
    }
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), bytes.length - 1);
    response.writeHead(206, {
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
    });
    let offset = start;
    const send = () => {
      if (offset > end) {
        response.end();
        return;
      }
      const next = Math.min(end + 1, offset + 64 * 1024);
      if (!response.write(bytes.subarray(offset, next))) {
        response.once("drain", () => setTimeout(send, delayMs));
      } else {
        setTimeout(send, delayMs);
      }
      offset = next;
    };
    send();
  });
}

function createStaticRangeServer(files) {
  return createServer((request, response) => {
    const pathname = new URL(request.url, "http://fixture").pathname;
    const bytes = files.get(pathname);
    if (!bytes) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader("Accept-Ranges", "bytes");
    response.setHeader(
      "Content-Type",
      pathname.endsWith(".m4a") ? "audio/mp4" : "video/mp4",
    );
    if (request.method === "HEAD") {
      response.setHeader("Content-Length", bytes.length);
      response.end();
      return;
    }
    const match = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    if (!match) {
      response.writeHead(200, { "Content-Length": bytes.length });
      response.end(bytes);
      return;
    }
    const start = Number(match[1]);
    const end = match[2]
      ? Math.min(Number(match[2]), bytes.length - 1)
      : bytes.length - 1;
    response.writeHead(206, {
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
    });
    response.end(bytes.subarray(start, end + 1));
  });
}

function createFrameReader(stream) {
  let pending = Buffer.alloc(0);
  const queued = [];
  const waiters = [];
  stream.on("data", (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.byteLength >= 4) {
      const length = readLength(pending);
      if (pending.byteLength < length + 4) break;
      const event = JSON.parse(
        pending.subarray(4, length + 4).toString("utf8"),
      );
      pending = pending.subarray(length + 4);
      queued.push(event);
    }
    flush();
  });
  function flush() {
    for (let waiterIndex = 0; waiterIndex < waiters.length; waiterIndex++) {
      const waiter = waiters[waiterIndex];
      const eventIndex = queued.findIndex(waiter.predicate);
      if (eventIndex < 0) continue;
      waiters.splice(waiterIndex--, 1);
      waiter.resolve(queued.splice(eventIndex, 1)[0]);
    }
  }
  return {
    next(predicate) {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () =>
            reject(
              new Error(
                `Timed out waiting for helper event. Queued: ${JSON.stringify(queued)}`,
              ),
            ),
          10_000,
        );
        waiters.push({
          predicate,
          resolve(value) {
            clearTimeout(timeout);
            resolve(value);
          },
        });
        flush();
      });
    },
  };
}

function frame(value) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  const output = Buffer.allocUnsafe(body.byteLength + 4);
  writeLength(output, body.byteLength);
  body.copy(output, 4);
  return output;
}

function readFrame(stream) {
  return new Promise((resolve, reject) => {
    let pending = Buffer.alloc(0);
    stream.on("data", (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      if (pending.byteLength < 4) return;
      const length = readLength(pending);
      if (pending.byteLength < length + 4) return;
      resolve(JSON.parse(pending.subarray(4, length + 4).toString("utf8")));
    });
    stream.on("error", reject);
    stream.on("end", () =>
      reject(new Error("Helper exited without a response.")),
    );
  });
}

function readLength(buffer) {
  return endianness() === "BE"
    ? buffer.readUInt32BE(0)
    : buffer.readUInt32LE(0);
}

function writeLength(buffer, value) {
  if (endianness() === "BE") buffer.writeUInt32BE(value, 0);
  else buffer.writeUInt32LE(value, 0);
}
