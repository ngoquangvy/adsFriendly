import { readFile, writeFile, mkdir } from "node:fs/promises";

// A generated project shares protection/direct-download sources with the basic
// project, but only this project compiles or links the YouTube module.
export const YOUTUBE_KIT_REVISION = "89854c93207ad0d2b3d78d6f1aea24595ca66552";
export function youtubeProject(source) {
  let project = source.replaceAll("\r\n", "\n");
  const insert = (marker, value) => {
    if (!project.includes(marker))
      throw Error("Missing Xcode project anchor: " + marker);
    project = project.replace(marker, marker + "\n" + value);
  };
  const files = [
    "YouTubeSources.swift",
    "YouTubeAssembler.swift",
    "YouTubeDownloadStore.swift",
    "YouTubeDownloadsViewController.swift",
    "YouTubeTests.swift",
    "YouTubeKit-LICENSE.txt",
  ];
  const ref = (n) => "AF20000000000000000000" + String(n).padStart(2, "0");
  insert(
    "/* Begin PBXFileReference section */",
    files
      .map(
        (name, i) =>
          `\t\t${ref(i + 1)} /* ${name} */ = {isa = PBXFileReference; lastKnownFileType = ${name.endsWith(".swift") ? "sourcecode.swift" : "text"}; path = ${name}; sourceTree = "<group>"; };`,
      )
      .join("\n"),
  );
  insert(
    "/* Begin PBXBuildFile section */",
    files
      .map(
        (name, i) =>
          `\t\t${ref(i + 11)} /* ${name} in ${name.endsWith(".swift") ? "Sources" : "Resources"} */ = {isa = PBXBuildFile; fileRef = ${ref(i + 1)}; };`,
      )
      .join("\n") +
      `\n\t\t${ref(30)} /* YouTubeKit in Frameworks */ = {isa = PBXBuildFile; productRef = ${ref(31)}; };`,
  );
  insert(
    "/* Begin PBXGroup section */",
    `\t\t${ref(20)} /* YouTubeEdition */ = {isa = PBXGroup; children = (${files.map((_, i) => ref(i + 1)).join(", ")}, ); path = YouTubeEdition; sourceTree = "<group>"; };`,
  );
  const root =
    "\t\tC1980DBC2FD18DFE00001364 = {\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (";
  insert(root, `\t\t\t\t${ref(20)} /* YouTubeEdition */,`);
  for (const [id, phase, entries] of [
    ["C1980DC12FD18DFE00001364", "PBXSourcesBuildPhase", [11, 12, 13, 14]],
    ["C1980DDE2FD18E0E00001364", "PBXSourcesBuildPhase", [15]],
    ["C1980DC22FD18DFE00001364", "PBXFrameworksBuildPhase", [30]],
    ["C1980DC32FD18DFE00001364", "PBXResourcesBuildPhase", [16]],
  ]) {
    const expression = new RegExp(
      "(" +
        id +
        " /\\*[^\\n]+\\*/ = \\{\\n\\s+isa = " +
        phase +
        ";\\n\\s+buildActionMask = 2147483647;\\n\\s+files = \\()",
    );
    if (!expression.test(project)) throw Error("Missing build phase: " + id);
    project = project.replace(
      expression,
      "$1\n" + entries.map((n) => "\t\t\t\t" + ref(n) + ",").join("\n"),
    );
  }
  project = project.replace(
    'path = "mobile-modules.json";',
    'path = "../../YouTubeEdition/Resources/mobile-modules.json";',
  );
  project = project.replace(
    "path = mobile-modules.json;",
    'path = "../../YouTubeEdition/Resources/mobile-modules.json";',
  );
  insert(
    '\t\t\tprojectDirPath = "";',
    `\t\t\tpackageReferences = (${ref(32)}, );`,
  );
  const target =
    "\t\t\tname = AdsFriendly_iOS;\n\t\t\tproductName = AdsFriendly_iOS;";
  insert(target, `\t\t\tpackageProductDependencies = (${ref(31)}, );`);
  project = project.replaceAll(
    "SWIFT_VERSION = 5.0;",
    'SWIFT_VERSION = 5.0;\n\t\t\t\tSWIFT_ACTIVE_COMPILATION_CONDITIONS = "$(inherited) AF_YOUTUBE";',
  );
  project = project.replace(
    "/* End PBXProject section */",
    `/* End PBXProject section */\n
/* Begin XCRemoteSwiftPackageReference section */
\t\t${ref(32)} = {isa = XCRemoteSwiftPackageReference; repositoryURL = "https://github.com/alexeichhorn/YouTubeKit.git"; requirement = {kind = revision; revision = ${YOUTUBE_KIT_REVISION}; }; };
/* End XCRemoteSwiftPackageReference section */
/* Begin XCSwiftPackageProductDependency section */
\t\t${ref(31)} = {isa = XCSwiftPackageProductDependency; package = ${ref(32)}; productName = YouTubeKit; };
/* End XCSwiftPackageProductDependency section */`,
  );
  return project;
}

const source = await readFile(
  new URL(
    "../ios/AdsFriendly_iOS/AdsFriendly_iOS.xcodeproj/project.pbxproj",
    import.meta.url,
  ),
  "utf8",
);
const output = new URL(
  "../ios/AdsFriendly_iOS/AdsFriendly_YouTube.xcodeproj/project.pbxproj",
  import.meta.url,
);
const content = youtubeProject(source);
if (process.argv.includes("--check")) {
  if ((await readFile(output, "utf8")).replace(/\r\n/g, "\n") !== content)
    throw Error(
      "Stale YouTube project. Run node scripts/build-ios-youtube-project.mjs.",
    );
} else {
  await mkdir(new URL("./", output), { recursive: true });
  await writeFile(output, content);
}
console.log(
  "Separate YouTube project " +
    (process.argv.includes("--check") ? "verified." : "generated."),
);
for (const name of [
  "YouTubeSources.swift",
  "YouTubeAssembler.swift",
  "YouTubeDownloadStore.swift",
  "YouTubeDownloadsViewController.swift",
  "YouTubeTests.swift",
  "YouTubeKit-LICENSE.txt",
])
  await readFile(
    new URL("../ios/AdsFriendly_iOS/YouTubeEdition/" + name, import.meta.url),
  );
const scheme = new URL(
  "../ios/AdsFriendly_iOS/AdsFriendly_YouTube.xcodeproj/xcshareddata/xcschemes/AdsFriendly_iOS.xcscheme",
  import.meta.url,
);
const schemeXML = `<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1420" version="1.7">
  <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries>
    <BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">
      <BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="C1980DC42FD18DFE00001364" BuildableName="AdsFriendly_iOS.app" BlueprintName="AdsFriendly_iOS" ReferencedContainer="container:AdsFriendly_YouTube.xcodeproj"/>
    </BuildActionEntry>
  </BuildActionEntries></BuildAction>
  <TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="NO">
    <Testables><TestableReference skipped="NO">
      <BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="C1980DE12FD18E0E00001364" BuildableName="AdsFriendly_iOSTests.xctest" BlueprintName="AdsFriendly_iOSTests" ReferencedContainer="container:AdsFriendly_YouTube.xcodeproj"/>
    </TestableReference></Testables>
    <EnvironmentVariables><EnvironmentVariable key="AF_YOUTUBE_LIVE_PROBE" value="$(AF_YOUTUBE_LIVE_PROBE)" isEnabled="YES"/></EnvironmentVariables>
  </TestAction>
  <LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES">
    <BuildableProductRunnable runnableDebuggingMode="0"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="C1980DC42FD18DFE00001364" BuildableName="AdsFriendly_iOS.app" BlueprintName="AdsFriendly_iOS" ReferencedContainer="container:AdsFriendly_YouTube.xcodeproj"/></BuildableProductRunnable>
  </LaunchAction>
  <ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"/>
  <AnalyzeAction buildConfiguration="Debug"/>
  <ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>
`;
if (process.argv.includes("--check")) {
  if ((await readFile(scheme, "utf8")).replace(/\r\n/g, "\n") !== schemeXML)
    throw Error("Stale YouTube test scheme.");
} else {
  await mkdir(new URL("./", scheme), { recursive: true });
  await writeFile(scheme, schemeXML);
}
