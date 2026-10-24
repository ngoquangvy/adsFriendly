import { build } from "esbuild";
import { readFile, readdir } from "node:fs/promises";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import "./mobile-config.mjs";
const resources = new URL(
  "../ios/AdsFriendly_iOS/AdsFriendly_iOS Extension/Resources/",
  import.meta.url,
);
const checkOnly = process.argv.includes("--check");
const result = await build({
  entryPoints: [
    fileURLToPath(new URL("../src/ios/shared.js", import.meta.url)),
  ],
  outfile: fileURLToPath(new URL("utils/shared.js", resources)),
  bundle: true,
  format: "iife",
  target: ["safari15"],
  legalComments: "none",
  write: !checkOnly,
});
if (checkOnly) {
  const saved = await readFile(new URL("utils/shared.js", resources), "utf8");
  if (saved.replace(/\r\n/g, "\n") !== result.outputFiles[0].text)
    throw new Error("Stale iOS shared bundle. Run node scripts/build-ios.mjs.");
}
const manifest = JSON.parse(
  await readFile(new URL("manifest.json", resources), "utf8"),
);
const references = [
  ...manifest.background.scripts,
  ...manifest.content_scripts.flatMap((s) => [...s.js, ...(s.css || [])]),
  manifest.action.default_popup,
];
for (const path of references) await readFile(new URL(path, resources));
for (const path of ["popup.html", "packages/import.html"]) {
  const html = await readFile(new URL(path, resources), "utf8");
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (!match[1].includes("://"))
      await readFile(new URL(match[1], new URL(path, resources)));
  }
}
async function validate(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = new URL(
      entry.name + (entry.isDirectory() ? "/" : ""),
      directory,
    );
    if (entry.isDirectory()) await validate(path);
    else if (entry.name.endsWith(".js"))
      new vm.Script(await readFile(path, "utf8"), { filename: path.pathname });
  }
}
await validate(resources);
console.log("iOS shared bundle, manifest references and JavaScript validated.");
