import { readFile, mkdir, writeFile } from "node:fs/promises";
import { mobileComposition } from "../src/mobile/module-catalog.js";

// This branch composes the iOS app. Android composition stays in its product branch.
const check = process.argv.includes("--check");
const profile = process.env.AF_MOBILE_PROFILE || "full";
const url = new URL(
  "../ios/AdsFriendly_iOS/AdsFriendly_iOS/Resources/mobile-modules.json",
  import.meta.url,
);
const content = JSON.stringify(mobileComposition(profile), null, 2) + "\n";
if (check) {
  if ((await readFile(url, "utf8")).replace(/\r\n/g, "\n") !== content)
    throw Error(
      "Stale iOS module configuration. Run node scripts/mobile-config.mjs.",
    );
} else {
  await mkdir(new URL("./", url), { recursive: true });
  await writeFile(url, content);
}
console.log("iOS module configuration " + (check ? "verified." : "generated."));
