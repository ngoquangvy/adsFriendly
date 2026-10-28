import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createFileTransferView } from "../src/options/downloads/file-transfer-view.js";
import { FILE_MESSAGES as M } from "../src/downloads/file-contract.js";
const require = createRequire(
  new URL("../packages/media-helper/package.json", import.meta.url),
);
const { JSDOM } = require("jsdom");
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
test("automatic checks do not offer a duplicate manual check", (t) => {
  const f = fixture(t);
  const item = {
    id: 1,
    filename: "file.zip",
    assessment: { disposition: "needs_validation" },
  };
  for (const status of ["queued", "checking"]) {
    f.view.observation(f.row, item, {
      autoChecks: { items: [{ browserId: 1, status }] },
    });
    assert.equal(f.row.querySelector("button"), null);
    assert.match(f.row.textContent, /Chrome continues/);
  }
  f.view.observation(f.row, item, {
    checks: [{ browserId: 1, checkId: "ready" }],
    autoChecks: { items: [{ browserId: 1, status: "checking" }] },
  });
  assert.equal(f.row.querySelector("button").textContent, "Transfer to Helper");
  assert.deepEqual(f.calls, []);
});
function fixture(t) {
  const dom = new JSDOM(
    '<article id="observation"></article><section id="browser-file-transfer-card" hidden><div id="browser-file-transfers"></div></section>',
  );
  let confirmed = true,
    granted = true;
  const calls = [],
    errors = [];
  dom.window.confirm = () => confirmed;
  const view = createFileTransferView({
    document: dom.window.document,
    window: dom.window,
    chrome: {
      permissions: {
        request: async (value) => {
          calls.push({ permission: value });
          return granted;
        },
      },
      runtime: {
        sendMessage: async (message) => {
          calls.push(message);
          return {
            status:
              message.type === M.CHECK
                ? "ready_for_handoff"
                : message.type === M.ACCEPT
                  ? "transferring"
                  : message.type === M.RETURN
                    ? "returned_to_chrome"
                    : "opened",
          };
        },
      },
    },
    refresh: async () => {},
    onError: (error) => errors.push(error.message),
  });
  t.after(() => {
    view.stop();
    dom.window.close();
  });
  return {
    view,
    calls,
    errors,
    document: dom.window.document,
    row: dom.window.document.getElementById("observation"),
    confirm: (value) => {
      confirmed = value;
    },
    grant: (value) => {
      granted = value;
    },
  };
}
test("checking needs a user permission activation; transferring requires explicit confirmation and the check ID", async (t) => {
  const f = fixture(t),
    item = {
      id: 1,
      filename: "fixture.zip",
      assessment: { disposition: "needs_validation" },
    };
  f.view.observation(f.row, item, {});
  f.row.querySelector("button").click();
  await tick();
  assert.deepEqual(f.calls[0], {
    permission: { permissions: ["nativeMessaging"] },
  });
  assert.equal(f.calls[1].type, M.CHECK);
  f.view.observation(f.row, item, {
    checks: [{ browserId: 1, checkId: "checked" }],
  });
  f.confirm(false);
  f.row.querySelector("button").click();
  await tick();
  assert.ok(!f.calls.some((call) => call.type === M.ACCEPT));
  f.confirm(true);
  f.row.querySelector("button").click();
  await tick();
  assert.ok(
    f.calls.some(
      (call) => call.type === M.ACCEPT && call.checkId === "checked",
    ),
  );
});
test("file controls stay stable across progress and never use media job actions", async (t) => {
  const f = fixture(t);
  const job = {
    id: "file-1",
    browserId: 1,
    filename: "Fixture.zip",
    status: "downloading",
    totalBytes: 10000,
    progress: { downloadedBytes: 10, bytesPerSecond: 0 },
  };
  f.view.render({ fileTransfers: [job] });
  assert.equal(
    f.document.querySelector(".download-progress-bar").style.width,
    "0%",
  );
  const button = f.document.querySelector(".file-transfer-controls button");
  job.progress.downloadedBytes = 5000;
  f.view.render({ fileTransfers: [job] });
  assert.equal(
    f.document.querySelector(".download-progress-bar").style.width,
    "50%",
  );
  assert.match(
    f.document.querySelector(".file-transfer-details").textContent,
    /50%/,
  );
  assert.equal(
    f.document.querySelector(".file-transfer-controls button"),
    button,
  );
  assert.match(
    f.document.querySelector(".file-transfer-details").textContent,
    /0 KB\/s/,
  );
  button.click();
  await tick();
  assert.equal(f.calls[0].type, M.RETURN);
  job.status = "completed";
  job.outputPath = "C:/Downloads/AdsFriendly/Fixture.zip";
  f.view.render({ fileTransfers: [job] });
  const buttons = [
    ...f.document.querySelectorAll(".file-transfer-controls button"),
  ];
  assert.deepEqual(
    buttons.map((node) => node.textContent),
    ["Open", "Folder"],
  );
  buttons[0].click();
  buttons[1].click();
  await tick();
  assert.ok(f.calls.some((call) => call.type === M.OPEN));
  assert.ok(f.calls.some((call) => call.type === M.REVEAL));
  assert.ok(!f.calls.some((call) => String(call.type).includes("MEDIA")));
});
test("permission rejection cannot start a check; ineligible sources have no transfer control", async (t) => {
  const f = fixture(t);
  f.grant(false);
  f.view.observation(
    f.row,
    {
      id: 1,
      filename: "fixture.zip",
      assessment: { disposition: "needs_validation" },
    },
    {},
  );
  f.row.querySelector("button").click();
  await tick();
  assert.equal(f.calls.length, 1);
  assert.match(f.errors[0], /permission/);
  f.view.observation(
    f.row,
    { id: 1, assessment: { disposition: "browser_only" } },
    {},
  );
  assert.equal(f.row.querySelector("button"), null);
});
