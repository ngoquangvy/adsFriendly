import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDownloadIntake,
  applyDownloadDelta,
  restoreDownloadIntake,
} from "../src/downloads/intake-contract.js";
import { assessDownloadIntake } from "../src/downloads/intake-policy.js";

const raw = (extra = {}) => ({
  id: 1,
  url: "https://cdn.example/file.zip",
  filename: "C:\\Users\\Private\\file.zip",
  state: "in_progress",
  danger: "safe",
  totalBytes: 400,
  ...extra,
});

test("intake projects only metadata, preserves zero/unknown size and never infers GET", () => {
  const row = normalizeDownloadIntake(
    raw({ url: "https://cdn.example/file.zip?token=secret" }),
    1000,
  );
  assert.equal(row.filename, "file.zip");
  assert.equal(row.authorizationHints, true);
  assert.equal(row.method, "unknown");
  assert.equal(row.host, "cdn.example");
  assert.equal(
    normalizeDownloadIntake(raw({ totalBytes: -1 })).totalBytes,
    null,
  );
  assert.equal(normalizeDownloadIntake(raw({ totalBytes: 0 })).totalBytes, 0);
  assert.doesNotMatch(JSON.stringify(row), /secret|Private|https:\/\/|token=/);
  assert.equal(normalizeDownloadIntake(raw({ incognito: true })), null);
  assert.equal(normalizeDownloadIntake(raw({ byExtensionId: "ours" })), null);
});

test("pure policy never authorizes takeover, and exposes conservative stable reasons", () => {
  for (const [extra, reason] of [
    [{}, "request_not_verified"],
    [{ url: "blob:https://page.example/id" }, "unsupported_source"],
    [{ url: "https://u:p@cdn.example/file" }, "url_credentials"],
    [
      { url: "https://cdn.example/file?X-Amz-Signature=secret" },
      "authorization_not_verified",
    ],
    [{ danger: "uncommon" }, "browser_safety_check"],
    [{ state: "complete" }, "not_active"],
    [{ paused: true }, "browser_paused"],
    [{ mime: "text/html" }, "not_direct_file"],
    [
      { mime: "text/html", url: "https://cdn.example/file.zip?sig=secret" },
      "not_direct_file",
    ],
  ]) {
    const decision = assessDownloadIntake(normalizeDownloadIntake(raw(extra)));
    assert.equal(decision.reason, reason);
    assert.equal(decision.canTakeOver, false);
  }
});

test("delta updates retain private flags, actual total and sanitize changed filenames", () => {
  const row = normalizeDownloadIntake(raw(), 1000);
  const changed = applyDownloadDelta(row, {
    id: 1,
    totalBytes: { current: 500 },
    filename: { current: "C:/secret/new.zip" },
    finalUrl: { current: "https://new.example/new.zip?sig=private" },
  });
  assert.equal(changed.host, "new.example");
  assert.equal(changed.filename, "new.zip");
  assert.equal(changed.totalBytes, 500);
  assert.equal(changed.authorizationHints, true);
  assert.equal(
    applyDownloadDelta(changed, { id: 1, state: { current: "complete" } })
      .authorizationHints,
    true,
  );
  assert.equal(row.host, "cdn.example");
});

test("session restore expires records and does not accept arbitrary stored fields", () => {
  const row = normalizeDownloadIntake(raw(), 1000);
  const [restored] = restoreDownloadIntake(
    { version: 1, items: [{ ...row, token: "secret", method: "GET" }] },
    1100,
  );
  assert.equal(restored.method, "unknown");
  assert.equal(restored.token, undefined);
  assert.deepEqual(
    restoreDownloadIntake({ version: 1, items: [row] }, 4000000),
    [],
  );
  assert.deepEqual(
    restoreDownloadIntake({ version: 7, items: [row] }, 1100),
    [],
  );
});
