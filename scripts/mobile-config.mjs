import { readFile, mkdir, writeFile } from "node:fs/promises";
import { mobileComposition } from "../src/mobile/module-catalog.js";
const check = process.argv.includes("--check");
const iosProfile = process.env.AF_MOBILE_PROFILE || "full";
const outputs = [
  ["../ios/AdsFriendly_iOS/AdsFriendly_iOS/Resources/mobile-modules.json", iosProfile],
  ["../android/app/src/full/assets/mobile-modules.json", "full"],
  ["../android/app/src/protection/assets/mobile-modules.json", "protection"],
];
for (const [path, profile] of outputs) {
  const url = new URL(path, import.meta.url), content = JSON.stringify(mobileComposition(profile), null, 2) + "\n";
  if (check) {
    if ((await readFile(url, "utf8")).replace(/\r\n/g, "\n") !== content) throw Error("Stale mobile module configuration: " + path);
  } else { await mkdir(new URL("./", url), { recursive: true }); await writeFile(url, content); }
}
console.log("Mobile module configurations " + (check ? "verified." : "generated."));
