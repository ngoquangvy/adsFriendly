import test from "node:test";
import assert from "node:assert/strict";
import {
  describeDownloadIntake,
  describeDownloadObserver,
  buildDownloadIntakeDiagnosticReport,
} from "../src/downloads/intake-diagnostics.js";
import { normalizeDownloadIntake } from "../src/downloads/intake-contract.js";
import { assessDownloadIntake } from "../src/downloads/intake-policy.js";

const item = (extra = {}) => {
  const row = normalizeDownloadIntake({
    id: 1,
    filename: "artifact.zip",
    url: "https://github.com/example/project/actions/runs/1/artifacts/2",
    finalUrl: "https://cdn.example/artifact.zip",
    state: "in_progress",
    danger: "safe",
    totalBytes: 123,
    ...extra,
  });
  return { ...row, assessment: assessDownloadIntake(row) };
};

test("signed GitHub-style redirect remains detected before and after Chrome completes, without changing transfer policy", () => {
  const row = item({
    finalUrl: "https://cdn.example/artifact.zip?sig=private&se=2099-01-01",
  });
  const before = JSON.stringify(row);
  assert.equal(describeDownloadIntake(row).code, "check_available");
  assert.match(describeDownloadIntake(row).label, /Detected.*Check available/);
  assert.equal(JSON.stringify(row), before);
  assert.equal(row.assessment.canTakeOver, false);
  const done = item({
    state: "complete",
    finalUrl: "https://cdn.example/artifact.zip?sig=private",
  });
  assert.equal(done.assessment.reason, "not_active");
  const diagnostic = describeDownloadIntake(done);
  assert.match(diagnostic.label, /Detected.*Completed in Chrome/);
  assert.match(diagnostic.detail, /Signed\/session.*Already completed/);
});

test("detected and checkable is distinct from checked, failed, transferred or unsupported", () => {
  const row = item();
  assert.equal(describeDownloadIntake(row).code, "check_available");
  assert.equal(
    describeDownloadIntake(row, { checks: [{ browserId: 1 }] }).code,
    "ready_for_handoff",
  );
  assert.equal(
    describeDownloadIntake(row, {
      checkErrors: [{ browserId: 1, error: "private error" }],
    }).code,
    "helper_check_failed",
  );
  for (const [status, code] of [
    ["pause_requested", "helper_preparing"],
    ["downloading", "helper_downloading"],
    ["completed", "helper_completed"],
    ["returned_to_chrome", "returned_to_chrome"],
    ["needs_browser_attention", "browser_attention"],
  ])
    assert.equal(
      describeDownloadIntake(row, { fileTransfers: [{ browserId: 1, status }] })
        .code,
      code,
    );
  assert.equal(
    describeDownloadIntake(item({ filename: "installer.exe" })).code,
    "unsupported_file_type",
  );
  assert.equal(
    describeDownloadIntake(
      item({
        url: "blob:https://site.example/1",
        finalUrl: "blob:https://site.example/1",
      }),
    ).code,
    "browser_only",
  );
});

test("observer off, denied, empty, failed and detected are never conflated with a missed download", () => {
  assert.match(
    describeDownloadObserver({ status: "off" }).label,
    /not being recorded/,
  );
  assert.match(
    describeDownloadObserver({ status: "permission_required" }).label,
    /detection unavailable/,
  );
  assert.match(
    describeDownloadObserver({ status: "observing", items: [] }).empty,
    /does not prove a missed download/,
  );
  assert.match(
    describeDownloadObserver({ status: "observing", items: [item()] }).label,
    /1 detected/,
  );
  assert.match(
    describeDownloadObserver({ status: "observing", storageFailed: true })
      .label,
    /storage unavailable/,
  );
  assert.match(
    describeDownloadObserver({ status: "bad" }).label,
    /unavailable/,
  );
});

test("copy report is bounded metadata only, with no raw URL, paths, errors or tokens", () => {
  const row = item({
    finalUrl: "https://cdn.example/artifact.zip?sig=PRIVATE_TOKEN",
  });
  const report = buildDownloadIntakeDiagnosticReport({
    status: "observing",
    items: Array.from({ length: 60 }, () => ({
      ...row,
      sourceUrl: "https://secret.example/?token=PRIVATE_TOKEN",
      outputPath: "C:/Private/path",
      keyHandoff: "PRIVATE_KEY",
    })),
    checkErrors: [{ browserId: 1, error: "PRIVATE_ERROR" }],
    checks: [{ browserId: 1, checkId: "PRIVATE_CHECK_ID" }],
  });
  assert.equal(report.detectedCount, 50);
  assert.equal(report.items[0].diagnostic, "helper_check_failed");
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE|https:\/\/|C:\//);
  assert.match(JSON.stringify(report), /artifact.zip|cdn.example/);
});
