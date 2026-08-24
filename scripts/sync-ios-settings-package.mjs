import { readFile, writeFile } from "node:fs/promises";

const source = new URL("../packages/default-settings-package.json", import.meta.url);
const target = new URL(
  "../ios/AdsFriendly_iOS/AdsFriendly_iOS Extension/Resources/packages/default-settings-package.json",
  import.meta.url,
);
const checkOnly = process.argv.includes("--check");
const canonical = `${JSON.stringify(JSON.parse(await readFile(source, "utf8")), null, 2)}\n`;

if (checkOnly) {
  const bundled = await readFile(target, "utf8");
  if (bundled !== canonical) {
    throw new Error("iOS bundled settings package is out of sync. Run pnpm ios:settings:sync.");
  }
  console.log("iOS settings package is in sync.");
} else {
  await writeFile(target, canonical, "utf8");
  console.log("Synced the canonical Settings Package into the iOS extension.");
}
