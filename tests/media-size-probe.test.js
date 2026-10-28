import test from "node:test";
import assert from "node:assert/strict";
import { createMediaSizeProbe } from "../src/background/media-size-probe.js";

function response(status, headers = {}, body = null) {
  return {
    status,
    headers: new Headers(headers),
    body: body || {
      cancelled: false,
      async cancel() {
        this.cancelled = true;
      },
    },
  };
}

test("size probe prefers a metadata-only HEAD response", async () => {
  const calls = [];
  const probe = createMediaSizeProbe({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(200, { "content-length": "58262277" });
    },
  });

  const result = await probe.probe("https://cdn.example/video.mp4", {
    scopeKey: "tab:1",
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.contentLength, 58_262_277);
  assert.equal(result.method, "HEAD");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "HEAD");
  assert.equal(calls[0].options.credentials, "include");
});

test("size probe falls back to a one-byte Range request and cancels the body", async () => {
  const calls = [];
  const rangeBody = response(206, {
    "content-length": "1",
    "content-range": "bytes 0-0/58262277",
  }).body;
  const probe = createMediaSizeProbe({
    fetchImpl: async (_url, options) => {
      calls.push(options);
      return options.method === "HEAD"
        ? response(200)
        : response(
            206,
            {
              "content-length": "1",
              "content-range": "bytes 0-0/58262277",
            },
            rangeBody,
          );
    },
  });

  const result = await probe.probe("https://cdn.example/video.mp4", {
    scopeKey: "tab:1",
  });
  assert.equal(result.contentLength, 58_262_277);
  assert.equal(result.method, "GET_RANGE");
  assert.equal(calls[1].headers.Range, "bytes=0-0");
  assert.equal(rangeBody.cancelled, true);
});

test("ignored Range still cancels the body and uses the exact full Content-Length", async () => {
  const bodies = [];
  const probe = createMediaSizeProbe({
    fetchImpl: async (_url, options) => {
      if (options.method === "HEAD") return response(405);
      const body = response(200, { "content-length": "1000000" }).body;
      bodies.push(body);
      return response(200, { "content-length": "1000000" }, body);
    },
  });

  const result = await probe.probe("https://cdn.example/ignore-range.mp4");
  assert.equal(result.contentLength, 1_000_000);
  assert.equal(result.method, "GET_RANGE");
  assert.equal(bodies[0].cancelled, true);
});

test("probe deduplicates concurrent work and caches metadata without another request", async () => {
  let calls = 0;
  let now = 1_000;
  const probe = createMediaSizeProbe({
    now: () => now,
    fetchImpl: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return response(200, { "content-length": "42" });
    },
  });
  const options = { scopeKey: "tab:1" };
  const [first, second] = await Promise.all([
    probe.probe("https://cdn.example/a.mp4", options),
    probe.probe("https://cdn.example/a.mp4", options),
  ]);
  assert.deepEqual(first, second);
  assert.equal(calls, 1);
  await probe.probe("https://cdn.example/a.mp4", options);
  assert.equal(calls, 1);
  now += 5 * 60_000 + 1;
  await probe.probe("https://cdn.example/a.mp4", options);
  assert.equal(calls, 2);
});

test("probe limits unique candidates per scope and rejects non-HTTP sources", async () => {
  let calls = 0;
  const probe = createMediaSizeProbe({
    maxPerScope: 1,
    fetchImpl: async () => {
      calls += 1;
      return response(200, { "content-length": "12" });
    },
  });
  const first = await probe.probe("https://cdn.example/a.mp4", {
    scopeKey: "tab:1",
  });
  const limited = await probe.probe("https://cdn.example/b.mp4", {
    scopeKey: "tab:1",
  });
  const invalid = await probe.probe("blob:https://site.example/id");
  assert.equal(first.status, "resolved");
  assert.equal(limited.reason, "scope_limit");
  assert.equal(invalid.reason, "invalid_url");
  assert.equal(calls, 1);
});

test("probe bounds concurrent network requests", async () => {
  let active = 0;
  let maximumActive = 0;
  const probe = createMediaSizeProbe({
    maxConcurrent: 2,
    fetchImpl: async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return response(200, { "content-length": "8" });
    },
  });

  await Promise.all(
    ["a", "b", "c", "d", "e"].map((name) =>
      probe.probe(`https://cdn.example/${name}.mp4`, { scopeKey: "tab:1" }),
    ),
  );
  assert.equal(maximumActive, 2);
});
