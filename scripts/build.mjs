import { build } from "esbuild";
import { access, readFile } from "node:fs/promises";
import { CAPABILITY_CATALOG } from "../src/runtime/feature-catalog.js";
import "../src/runtime/action-catalog.js";
import "../src/runtime/event-catalog.js";
const checkOnly = process.argv.includes("--check");
const entries = [
  ["src/background/index.js", "background.js", "AdsFriendlyBackground"],
  ["src/content/index.js", "content.js", "AdsFriendlyContent"],
  ["src/media-frame/index.js", "media_frame.js", "AdsFriendlyMediaFrame"],
  ["src/picker/index.js", "picker.js", "AdsFriendlyPicker"],
  ["src/video/index.js", "video_surgeon.js", "AdsFriendlyVideo"],
  ["src/main-world/index.js", "injected_spy.js", "AdsFriendlyMainWorld"],
  ["src/popup/index.js", "popup/popup.js", "AdsFriendlyPopup"],
  ["src/options/index.js", "options/options.js", "AdsFriendlyOptions"],
];
const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const declaredPermissions = new Set([
  ...(manifest.permissions || []),
  ...(manifest.optional_permissions || []),
]);
for (const capability of Object.values(CAPABILITY_CATALOG)) {
  for (const permission of capability.browserPermissions) {
    if (!declaredPermissions.has(permission)) {
      throw new Error(
        `capability ${capability.id} requires undeclared browser permission ${permission}`,
      );
    }
  }
}
await access("packages/default-settings-package.json");
const scripts =
  manifest.content_scripts?.flatMap((item) => item.js || []) || [];
const resources =
  manifest.web_accessible_resources?.flatMap((item) => item.resources || []) ||
  [];
for (const required of [
  "content.js",
  "media_frame.js",
  "picker.js",
  "video_surgeon.js",
  "injected_spy.js",
]) {
  if (!scripts.includes(required) && !resources.includes(required))
    throw new Error(`manifest missing ${required}`);
}
const mainWorldCapture = manifest.content_scripts?.find((item) =>
  item.js?.includes("injected_spy.js"),
);
if (
  mainWorldCapture?.world !== "MAIN" ||
  mainWorldCapture?.run_at !== "document_start" ||
  mainWorldCapture?.all_frames !== true
)
  throw new Error(
    "injected_spy.js must run in MAIN world at document_start for all frames",
  );
if (manifest.background?.service_worker !== "background.js")
  throw new Error("manifest missing background.js service worker");
for (const [entry, outfile, globalName] of entries) {
  await access(entry);
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "iife",
    globalName,
    target: ["chrome110"],
    legalComments: "none",
    logLevel: "info",
    write: !checkOnly,
  });
}
if (checkOnly) console.log("Build check passed.");
