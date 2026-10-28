import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

async function javaFiles(path) {
  const files = [];
  for (const item of await readdir(path, { withFileTypes: true })) {
    if (item.isDirectory()) files.push(...await javaFiles(join(path, item.name)));
    else if (item.name.endsWith(".java")) files.push(join(path, item.name));
  }
  return files;
}
const jdk = process.env.AF_TEST_JAVA_HOME;
const sdk = process.env.ANDROID_HOME;
test("Android native Java compiles independently with and without the media module", { skip: !jdk || !sdk }, async () => {
  const out = await mkdtemp(join(tmpdir(), "adsfriendly-java-"));
  try {
    const common = [...await javaFiles("android/core/src/main/java"), ...await javaFiles("android/app/src/main/java")];
    for (const profile of ["full", "protection"]) {
      const sources = [...common, ...await javaFiles(`android/app/src/${profile}/java`)];
      if (profile === "full") sources.push(...await javaFiles("android/media-downloads/src/main/java"));
      execFileSync(join(jdk, "bin/javac.exe"), ["--release", "17", "-cp", join(sdk, "platforms/android-36/android.jar"), "-d", join(out, profile), ...sources], { stdio: "pipe" });
    }
    execFileSync(join(jdk, "bin/javac.exe"), ["--release", "17", "-d", out, "android/core/src/main/java/com/adsfriendly/mobile/core/SharedLink.java", "tests/mobile-native/SharedLinkChecks.java"], { stdio: "pipe" });
    assert.match(execFileSync(join(jdk, "bin/java.exe"), ["-cp", out, "SharedLinkChecks"], { encoding: "utf8" }), /passed: 15/);
  } finally { await rm(out, { recursive: true, force: true }); }
});
test("iOS media sources are wired into the app target and have protection-only compile guards", async () => {
  const base = "ios/AdsFriendly_iOS/";
  const project = await readFile(base + "AdsFriendly_iOS.xcodeproj/project.pbxproj", "utf8");
  const sourcesPhase = project.split("/* Begin PBXSourcesBuildPhase section */")[1].split("/* End PBXSourcesBuildPhase section */")[0].split("C1980DDE2FD18E0E00001364")[0];
  for (const file of ["MobileModuleCatalog", "MobileSourceProbe", "MobileDownloadStore", "MobileDownloadsViewController"]) {
    assert.ok(sourcesPhase.includes(file + ".swift in Sources"));
    const source = await readFile(base + `AdsFriendly_iOS/Modules/${file}.swift`, "utf8");
    if (file !== "MobileModuleCatalog") { assert.ok(source.startsWith("#if !AF_PROTECTION_ONLY")); assert.ok(source.trimEnd().endsWith("#endif")); }
  }
  assert.match(project, /mobile-modules.json in Resources/);
});
test("Android composition excludes the share receiver, network permission and media dependency from core", async () => {
  const base = await readFile("android/app/src/main/AndroidManifest.xml", "utf8");
  assert.doesNotMatch(base, /ACTION_SEND|android.intent.action.SEND|android.permission.INTERNET/);
  assert.match(await readFile("android/app/src/full/AndroidManifest.xml", "utf8"), /android.intent.action.SEND/);
  assert.match(await readFile("android/app/build.gradle", "utf8"), /fullImplementation project\(':media-downloads'\)/);
  assert.doesNotMatch(await readFile("android/app/src/protection/java/com/adsfriendly/mobile/ModuleProvider.java", "utf8"), /import com.adsfriendly.mobile.media/);
});
