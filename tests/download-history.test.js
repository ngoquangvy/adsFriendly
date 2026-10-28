import test from "node:test";
import assert from "node:assert/strict";
import { downloadHistoryView } from "../src/media/ui/download-history.js";

test("completed view retains size and actions, never speed or a Started state", () => {
  const view = downloadHistoryView({
    status: "completed",
    outputPath: "/managed/video.mp4",
    fileStatus: "available",
    progress: { totalBytes: 100, bytesPerSecond: 99 },
  });
  assert.equal(view.status, "Completed");
  assert.equal(view.size, 100);
  assert.equal(view.canOpen, true);
  assert.equal(view.canRepeat, true);
  assert.equal(JSON.stringify(view).includes("Started"), false);
  assert.equal(JSON.stringify(view).includes("bytesPerSecond"), false);
});
test("missing files offer Download, active jobs only View download, other renditions cannot be repeated as current selection", () => {
  assert.equal(
    downloadHistoryView({ status: "completed", fileStatus: "missing" }).canOpen,
    false,
  );
  assert.equal(downloadHistoryView({ status: "downloading" }).canRepeat, false);
  assert.equal(
    downloadHistoryView({ status: "completed" }, false).canRepeat,
    false,
  );
  assert.equal(downloadHistoryView({ status: "failed" }), null);
  assert.match(
    downloadHistoryView({ status: "completed", fileStatus: "unchecked" })
      .detail,
    /not checked/,
  );
});
