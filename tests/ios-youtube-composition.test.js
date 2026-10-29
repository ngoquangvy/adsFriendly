import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { mobileComposition } from "../src/mobile/module-catalog.js";

test("YouTube is an explicit separate edition and preserves direct audio formats", () => {
  const basic = mobileComposition("full"),
    youtube = mobileComposition("youtube");
  assert.equal(basic.backends["ios-app"].youtubeResolve, false);
  assert.equal(youtube.backends["ios-app"].youtubeResolve, true);
  assert.equal(youtube.backends["ios-safari"].youtubeResolve, false);
  assert.equal(youtube.backends["android-app"].youtubeResolve, false);
  assert.deepEqual(youtube.directFormats, basic.directFormats);
  assert.ok(
    ["mp3", "m4a", "ogg", "opus", "flac", "wav"].every((ext) =>
      basic.directFormats.some((format) => format.extension === ext),
    ),
  );
});
test("basic project has no YouTube sources/package; generated edition pins the dependency and separate composition", async () => {
  const basic = await readFile(
    "ios/AdsFriendly_iOS/AdsFriendly_iOS.xcodeproj/project.pbxproj",
    "utf8",
  );
  const advanced = await readFile(
    "ios/AdsFriendly_iOS/AdsFriendly_YouTube.xcodeproj/project.pbxproj",
    "utf8",
  );
  assert.doesNotMatch(basic, /YouTubeKit|YouTubeEdition|YouTubeSources/);
  assert.match(advanced, /revision = 89854c93207ad0d2b3d78d6f1aea24595ca66552/);
  assert.match(
    advanced,
    /\.\.\/\.\.\/YouTubeEdition\/Resources\/mobile-modules.json/,
  );
  const config = JSON.parse(
    await readFile(
      "ios/AdsFriendly_iOS/YouTubeEdition/Resources/mobile-modules.json",
      "utf8",
    ),
  );
  assert.deepEqual(config, mobileComposition("youtube"));
  execFileSync(
    process.execPath,
    ["scripts/build-ios-youtube-project.mjs", "--check"],
    { stdio: "pipe" },
  );
  const live = await readFile(
    "ios/AdsFriendly_iOS/AdsFriendly_YouTube.xcodeproj/xcshareddata/xcschemes/AdsFriendly_iOS-Live.xcscheme",
    "utf8",
  );
  assert.doesNotMatch(live, /SkippedTests|AF_YOUTUBE_LIVE_PROBE/);
});
