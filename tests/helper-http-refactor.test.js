import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

async function loadModule(name) {
  const result = await build({
    entryPoints: [
      fileURLToPath(
        new URL(`../packages/media-helper/src/${name}.ts`, import.meta.url),
      ),
    ],
    platform: "node",
    format: "esm",
    bundle: true,
    write: false,
    logLevel: "silent",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}

const youtube = await loadModule("youtube-http-profile");
const probe = await loadModule("http-probe");
const media = await loadModule("media-http-source");
const facade = await loadModule("direct-http-adapter");
const naming = await loadModule("media-filename");

function job(overrides = {}) {
  return {
    browserUserAgent: "fixture-provider-agent",
    candidate: {
      sourceUrl:
        "https://fixture.googlevideo.com/videoplayback?clen=2097153&itag=399",
      pageUrl: "https://www.youtube.com/watch?v=fixture",
      provider: "youtube",
      requestMode: "youtube_query_range",
      requestCpn: "fixture_cpn_123",
      contentLength: 2097153,
      ...overrides,
    },
  };
}

function mockNetwork(t, handler) {
  const oldFetch = globalThis.fetch;
  const oldPrivate = process.env.ADSFRIENDLY_HELPER_ALLOW_PRIVATE;
  process.env.ADSFRIENDLY_HELPER_ALLOW_PRIVATE = "1";
  globalThis.fetch = handler;
  t.after(() => {
    globalThis.fetch = oldFetch;
    if (oldPrivate === undefined)
      delete process.env.ADSFRIENDLY_HELPER_ALLOW_PRIVATE;
    else process.env.ADSFRIENDLY_HELPER_ALLOW_PRIVATE = oldPrivate;
  });
}

function response(url, status, headers) {
  const result = new Response(null, { status, headers });
  Object.defineProperty(result, "url", { value: String(url) });
  return result;
}

test("YouTube profile preserves query ranges, CPN, UA, size hints and the continuation preflight", async (t) => {
  const requests = [];
  mockNetwork(t, async (url, init) => {
    requests.push({ url: new URL(url), init });
    return response(url, 206, {
      "content-length": "1",
      "content-range": "bytes 0-0/2097153",
    });
  });
  const source = media.createMediaHttpSource(job());
  const result = await probe.probeHttpSource(
    source,
    new AbortController().signal,
  );
  assert.equal(result.totalBytes, 2097153);
  assert.equal(result.acceptsRanges, true);
  assert.deepEqual(
    requests.map(({ url }) => url.searchParams.get("range")),
    ["0-0", "1048576-1048576"],
  );
  for (const { url, init } of requests) {
    assert.equal(url.searchParams.get("cpn"), "fixture_cpn_123");
    assert.equal(init.headers["User-Agent"], "fixture-provider-agent");
    assert.equal(init.headers.Referer, "https://www.youtube.com");
    assert.equal(init.headers.Range, undefined);
  }
  const range = source.rangeRequest(
    source.url,
    { index: 1, start: 10, end: 19, length: 10 },
    '"etag"',
  );
  assert.equal(range.acceptsFullResponse, true);
  assert.equal(new URL(range.url).searchParams.get("range"), "10-19");
  assert.equal(range.headers["If-Range"], undefined);
});

test("YouTube HTTP-range profile keeps If-Range and rejects a fake first-byte success", async (t) => {
  const requests = [];
  mockNetwork(t, async (url, init) => {
    requests.push(init);
    return response(url, requests.length === 1 ? 206 : 403, {
      "content-length": "1",
      "content-range": "bytes 0-0/2097153",
    });
  });
  const source = media.createMediaHttpSource(
    job({ requestMode: "http_range" }),
  );
  const request = source.rangeRequest(
    source.url,
    { index: 1, start: 1, end: 5, length: 5 },
    '"revision"',
  );
  assert.equal(request.headers.Range, "bytes=1-5");
  assert.equal(request.headers["If-Range"], '"revision"');
  assert.equal(request.acceptsFullResponse, false);
  await assert.rejects(
    probe.probeHttpSource(source, new AbortController().signal),
    /continuation preflight rejected byte 1048576 \(HTTP 403\)/,
  );
  assert.equal(requests[1].headers.Range, "bytes=1048576-1048576");
});

test("ordinary HTTP sources keep HEAD, range verification and server-200 fallback without YouTube hints", async (t) => {
  const requests = [];
  mockNetwork(t, async (url, init) => {
    requests.push(init);
    return response(url, 200, {
      "content-length": "42",
      "accept-ranges": "bytes",
    });
  });
  const source = media.createMediaHttpSource(
    job({
      provider: null,
      sourceUrl: "https://cdn.example/file.mp4",
      pageUrl: "https://page.example/watch",
    }),
  );
  const result = await probe.probeHttpSource(
    source,
    new AbortController().signal,
  );
  assert.equal(requests.length, 2);
  assert.equal(requests[0].method, "HEAD");
  assert.equal(requests[1].headers.Range, "bytes=0-0");
  assert.equal(requests[0].headers.Referer, "https://page.example/watch");
  assert.equal(requests[0].headers.Origin, undefined);
  assert.equal(result.acceptsRanges, false);
  assert.equal(result.totalBytes, 42);
  assert.equal(
    youtube.isGoogleVideoUrl("https://googlevideo.com.attacker.example/file"),
    false,
  );
});

test("existing direct adapter exports and media naming remain compatible", () => {
  for (const name of [
    "downloadDirectHttp",
    "fetchRemote",
    "assertSafeRemoteUrl",
    "resolveOutputDirectory",
    "availableOutputPath",
    "sanitizeFilename",
    "preflightGoogleVideoTrack",
  ])
    assert.equal(typeof facade[name], "function", name);
  const current = job({ title: "Fixture title", mimeType: "video/webm" });
  assert.equal(
    naming.chooseMediaFilename(current, {
      url: "https://cdn.example/track",
      contentType: "video/webm",
      contentDisposition: null,
    }),
    "Fixture title.webm",
  );
  assert.equal(
    naming.chooseMediaFilename(current, {
      url: "https://cdn.example/track",
      contentType: "video/webm",
      contentDisposition: "attachment; filename*=UTF-8''Downloaded%20name.mp4",
    }),
    "Downloaded name.mp4",
  );
});

test("HTTP core cannot depend on media candidates or provider implementations", async () => {
  for (const name of [
    "http-transfer",
    "http-probe",
    "http-transfer-types",
    "http-remote",
  ]) {
    const code = await readFile(
      new URL(`../packages/media-helper/src/${name}.ts`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(
      code,
      /candidate\.|youtube-http|direct-http-adapter|chrome\./,
    );
    assert.doesNotMatch(code, /\bDownloadJob\b|\bAdaptiveHttpTrack\b/);
  }
});
