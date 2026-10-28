import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { normalizeFilePayload } from "../src/downloads/file-contract.js";

const bundled = await build({
  entryPoints: [
    fileURLToPath(
      new URL(
        "../packages/media-helper/src/file-http-download.ts",
        import.meta.url,
      ),
    ),
  ],
  platform: "node",
  format: "esm",
  bundle: true,
  write: false,
  logLevel: "silent",
});
const { prepareFile, downloadPreparedFile } = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundled.outputFiles[0].text).toString("base64")
);
function request(url, extra = {}) {
  return {
    jobId: randomUUID(),
    url,
    filename: "fixture.zip",
    connections: 8,
    expected: {
      size: 10 * 1024 * 1024 + 17,
      etag: '"fixture-v1"',
      mime: "application/zip",
    },
    ...extra,
  };
}
async function fixture(t) {
  const bytes = Buffer.alloc(10 * 1024 * 1024 + 17);
  for (let index = 0; index < bytes.length; index++) bytes[index] = index % 251;
  const calls = [];
  let mode = "normal",
    active = 0,
    max = 0;
  const server = createServer((req, res) => {
    calls.push({ method: req.method, range: req.headers.range });
    const match = /bytes=(\d+)-(\d+)/.exec(req.headers.range || "");
    const start = match ? Number(match[1]) : 0,
      end = match ? Number(match[2]) : bytes.length - 1;
    const ranged = match && mode !== "ignore";
    res.statusCode = ranged ? 206 : 200;
    res.setHeader("ETag", mode === "changed" ? '"different"' : '"fixture-v1"');
    res.setHeader(
      "Content-Type",
      mode === "html" ? "text/html" : "application/zip",
    );
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Length", ranged ? end - start + 1 : bytes.length);
    if (ranged)
      res.setHeader(
        "Content-Range",
        `bytes ${mode === "wrong-range" && end > 0 ? start + 1 : start}-${end}/${bytes.length}`,
      );
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    active++;
    max = Math.max(max, active);
    res.on("close", () => active--);
    if (mode === "fail" && end > 0) {
      res.statusCode = 403;
      res.end();
      return;
    }
    setTimeout(
      () => res.end(ranged ? bytes.subarray(start, end + 1) : bytes),
      15,
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const old = process.env.ADSFRIENDLY_HELPER_ALLOW_PRIVATE;
  process.env.ADSFRIENDLY_HELPER_ALLOW_PRIVATE = "1";
  const directory = await mkdtemp(join(tmpdir(), "adsfriendly-generic-file-"));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
    if (old === undefined) delete process.env.ADSFRIENDLY_HELPER_ALLOW_PRIVATE;
    else process.env.ADSFRIENDLY_HELPER_ALLOW_PRIVATE = old;
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/file.zip`,
    bytes,
    calls,
    directory,
    mode: (value) => {
      mode = value;
    },
    active: () => active,
    max: () => max,
  };
}
const context = () => ({
  signal: new AbortController().signal,
  progress() {},
  strategy() {},
});

test("generic file downloads preserve bytes/extension, use parallel ranges and never require a media candidate", async (t) => {
  const f = await fixture(t);
  const prepared = await prepareFile(
    request(f.url),
    new AbortController().signal,
  );
  assert.equal(
    f.calls.some((call) => call.method === "HEAD"),
    true,
  );
  const result = await downloadPreparedFile(
    { ...prepared, directory: f.directory },
    context(),
  );
  assert.deepEqual(await readFile(result.outputPath), f.bytes);
  assert.equal(basename(result.outputPath), "fixture.zip");
  assert.ok(f.max() > 1);
  const second = await downloadPreparedFile(
    { ...prepared, directory: f.directory },
    context(),
  );
  assert.equal(basename(second.outputPath), "fixture (1).zip");
  const concurrent = await Promise.all(
    [1, 2].map(() =>
      downloadPreparedFile(
        {
          ...prepared,
          request: { ...prepared.request, jobId: randomUUID() },
          directory: f.directory,
        },
        context(),
      ),
    ),
  );
  assert.notEqual(concurrent[0].outputPath, concurrent[1].outputPath);
  for (const result of concurrent)
    assert.deepEqual(await readFile(result.outputPath), f.bytes);
});

test("preflight rejects changed files, server-200 range fallback and login pages before transfer", async (t) => {
  const f = await fixture(t);
  for (const mode of ["changed", "ignore", "html"]) {
    f.mode(mode);
    await assert.rejects(
      prepareFile(request(f.url), new AbortController().signal),
    );
    assert.ok(
      !f.calls.some((call) => call.range && call.range !== "bytes=0-0"),
    );
  }
});

test("a wrong range/HTTP failure cannot finalize a file; sibling workers drain before return", async (t) => {
  const f = await fixture(t);
  const prepared = await prepareFile(
    request(f.url),
    new AbortController().signal,
  );
  for (const mode of ["wrong-range", "fail"]) {
    f.mode(mode);
    await assert.rejects(
      downloadPreparedFile({ ...prepared, directory: f.directory }, context()),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(f.active(), 0);
    assert.deepEqual(await readdir(f.directory), []);
  }
});

test("generic names keep their approved extension after long/Windows reserved names; executable and unsafe contracts fail", async (t) => {
  const f = await fixture(t);
  const prepared = await prepareFile(
    request(f.url, { filename: "x".repeat(175) + ".exe" + ".zip" }),
    new AbortController().signal,
  );
  assert.match(prepared.filename, /\.zip$/);
  assert.ok(prepared.filename.length <= 180);
  const reserved = await prepareFile(
    request(f.url, { filename: "CON.zip" }),
    new AbortController().signal,
  );
  assert.equal(reserved.filename, "file.zip");
  for (const extra of [
    { filename: "malware.exe" },
    { url: "file:///private" },
    { url: "https://user:password@example.com/a.zip" },
    { expected: { size: 10, etag: 'W/"weak"' } },
    { expected: { size: -1, etag: '"strong"' } },
  ])
    assert.throws(() => normalizeFilePayload(request(f.url, extra)));
});
