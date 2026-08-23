import { build } from "esbuild";
import { access, readFile } from "node:fs/promises";
const checkOnly = process.argv.includes("--check");
const entries = [
  ["src/background/index.js", "background.js", "AdsFriendlyBackground"],
  ["src/content/index.js", "content.js", "AdsFriendlyContent"],
  ["src/picker/index.js", "picker.js", "AdsFriendlyPicker"],
  ["src/video/index.js", "video_surgeon.js", "AdsFriendlyVideo"],
  ["src/main-world/index.js", "injected_spy.js", "AdsFriendlyMainWorld"],
  ["src/popup/index.js", "popup/popup.js", "AdsFriendlyPopup"],
];
const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const scripts =
  manifest.content_scripts?.flatMap((item) => item.js || []) || [];
const resources =
  manifest.web_accessible_resources?.flatMap((item) => item.resources || []) ||
  [];
for (const required of [
  "content.js",
  "picker.js",
  "video_surgeon.js",
  "injected_spy.js",
]) {
  if (!scripts.includes(required) && !resources.includes(required))
    throw new Error(`manifest missing ${required}`);
}
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
