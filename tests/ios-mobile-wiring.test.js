import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mobileComposition } from "../src/mobile/module-catalog.js";

const base = "ios/AdsFriendly_iOS/";
test("packaged iOS composition matches the registered full profile", async () => {
  const saved = JSON.parse(
    await readFile(
      base + "AdsFriendly_iOS/Resources/mobile-modules.json",
      "utf8",
    ),
  );
  assert.deepEqual(saved, mobileComposition("full"));
  for (const format of saved.directFormats) {
    assert.match(format.extension, /^[a-z0-9]{2,5}$/);
    assert.ok(format.mime.every((mime) => /^(audio|video)\//.test(mime)));
  }
});

test("optional native media is wired only into the containing app", async () => {
  const project = await readFile(
    base + "AdsFriendly_iOS.xcodeproj/project.pbxproj",
    "utf8",
  );
  const sources = project
    .split("/* Begin PBXSourcesBuildPhase section */")[1]
    .split("/* End PBXSourcesBuildPhase section */")[0];
  const phases = sources.split("isa = PBXSourcesBuildPhase;");
  for (const name of [
    "MobileModuleCatalog",
    "MobileSourceProbe",
    "MobileDownloadStore",
    "MobileDownloadsViewController",
  ]) {
    assert.equal(
      sources.match(new RegExp(name + "\\.swift in Sources", "g"))?.length,
      1,
    );
    assert.ok(phases[1].includes(name + ".swift in Sources"));
    const source = await readFile(
      base + "AdsFriendly_iOS/Modules/" + name + ".swift",
      "utf8",
    );
    if (name !== "MobileModuleCatalog")
      assert.match(source, /^#if !AF_PROTECTION_ONLY/);
  }
  assert.match(project, /mobile-modules.json in Resources/);
  const manifest = JSON.parse(
    await readFile(
      base + "AdsFriendly_iOS Extension/Resources/manifest.json",
      "utf8",
    ),
  );
  assert.ok(
    manifest.content_scripts.every((script) =>
      script.js.every((path) => !/media|download/i.test(path)),
    ),
  );
  assert.ok(
    manifest.background.scripts.every((path) => !/media|download/i.test(path)),
  );
});
