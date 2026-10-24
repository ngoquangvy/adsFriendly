# Mobile apps: independent protection and Media Tools

## Current milestone (not desktop feature parity)

- iOS keeps the existing Safari protection extension. The containing app has a
  **Media Tools · Downloads** entry: paste a direct HTTPS audio/video URL, check
  response metadata, then explicitly confirm a native background download.
- Android is a standalone **share-to-download manager**, not a browser. From
  Chrome or another app choose Share → AdsFriendly, or paste a URL in the app.
  Sharing only fills the input: it does not start a network request or transfer.
- Both native implementations support original MP3, M4A, OGG, Opus, FLAC, WAV,
  MP4, WebM, MOV and MKV files. They do **not** convert formats. Container support
  does not guarantee that the device can play the codec inside.
- A shared YouTube page is recognized but reports **mobile resolver unavailable**.
  HLS/DASH, signatures/PO tokens, FFmpeg, custom protection and DRM downloading
  are not implemented on mobile. No desktop Node Helper is required or installed.
- Android does not block ads in Chrome, YouTube or other apps. Its `protection`
  flavor is a minimal core companion used to verify removable media composition;
  Safari protection remains an iOS-specific backend.

## Boundaries

| Layer | Responsibility | Must not do |
| --- | --- | --- |
| `src/mobile/module-catalog.js` | Registered modules, capabilities, platform availability | Start requests or mutate desktop settings |
| `scripts/mobile-config.mjs` | Generate identical versioned native configuration | Hand-edit generated JSON |
| Android `:core` | Module contract, shared-link validation, configuration | Depend on downloader code |
| Android `:media-downloads` | Metadata check, explicit confirmation, own OS jobs | Observe/cancel Chrome downloads or copy browser cookies |
| iOS `Modules/` | Native metadata check, background session, app-owned files | Depend on Safari banner/tab blocking |
| Existing Safari extension | Existing protection and Settings Package | Require a working media module |

The current module entry points are `ModuleProvider` (Android flavors) and
`ViewController.openMedia` (iOS composition gate). Media backends are instantiated
only when their module is opened. Failure or exclusion must leave onboarding and
Safari protection operational. Production desktop media/download code is unchanged.

Future resolvers should return an explicit source contract (media type, selected
tracks, transport/profile, estimated or measured size, expiry, unsupported reason)
to the native acquisition backend. Do not add website-specific conditions to the
share receiver or UI, reuse desktop executable code on iOS, or promise download
availability just because a page contains a player.

## Transfer semantics and privacy

Checks use HEAD, then a bounded Range request when HEAD is rejected. Response
bodies are not buffered by the probe. A source check expires after 30 seconds;
metadata is evidence of a media response, not proof a later transfer will work.
403/session requirements are reported rather than importing cookies or keys.

Only HTTPS without embedded credentials, local hostnames, IP literals or custom
ports is accepted. Android additionally checks DNS during probing. This is
best-effort validation, **not** a DNS-rebinding/redirect sandbox: native OS download
services perform their own later requests. Use links from trusted public sources.

Native OS services necessarily retain request URLs for active downloads. Our
history stores only generated file names, owned task IDs, counts/status/reason
metadata (maximum 50 entries), not source URLs, tokens or browser history. No
mobile training upload or telemetry pipeline is enabled. Unknown or unsupported
sources show a fixed reason in the UI; source bodies/URLs are not debug logs.

- iOS uses background URLSession. It restores its session on OS background events
  and records interrupted jobs on recovery. Force-quitting can stop background
  transfers; the app does not promise automatic resume after force-quit.
- Android uses system DownloadManager. Network waits/retries are OS-owned, not
  desktop multi-connection settings. Completion is labelled **Downloaded by
  Android**, not media-validated: the OS may accept a response the preflight did
  not see. Open/Share can still fail for an unsupported codec or a changed source.
- Files are in app-owned storage and removed on uninstall. Use Share/export to
  keep a copy in Files or another app. Removing history does not delete files.
- Cancel only targets this app's owned jobs. There is no custom pause/resume or
  conversion UI in this milestone. UI progress refreshes every three seconds.

## Build

Generate/check native module assets (Node only; no pnpm required):

```powershell
node scripts/mobile-config.mjs
node scripts/mobile-config.mjs --check
```

Android: JDK 17+, Android SDK platform 36, accept the Android SDK licenses.
The pinned Gradle wrapper downloads Gradle/dependencies on the first build.
Set `JAVA_HOME` and `ANDROID_HOME`, then:

```powershell
Set-Location android
.\gradlew.bat :app:assembleFullDebug :app:assembleProtectionDebug :app:lintFullDebug :app:lintProtectionDebug
```

APKs: `android/app/build/outputs/apk/full/debug/app-full-debug.apk` and
`android/app/build/outputs/apk/protection/debug/app-protection-debug.apk`.
These are debug-signed test builds, not store releases. The **Build Android**
workflow builds/lints both and checks the core APK has no media classes,
share receiver or INTERNET permission. Wrapper SHA-256 values are pinned/verified
against the official Gradle distribution; `gradle-wrapper.jar` is a build tool,
not a bundled app runtime.

iOS: run `node scripts/build-ios.mjs` and the existing Safari checks, then open
`ios/AdsFriendly_iOS/AdsFriendly_iOS.xcodeproj` in Xcode on macOS and build/sign
with your existing team. No App Group, new entitlement or URL scheme is needed.
The existing **Build iOS** workflow packages the full unsigned IPA and also
compiles a protection-only composition. Installing an IPA still requires signing.

To exclude iOS media, generate with `AF_MOBILE_PROFILE=protection` and compile
with `SWIFT_ACTIVE_COMPILATION_CONDITIONS='DEBUG AF_PROTECTION_ONLY'` (omit DEBUG
for release). All three media implementation files are compile-guarded. Restore
default full JSON with `node scripts/mobile-config.mjs` before normal development.
Generated profile and compile flag must agree; do not commit protection-only JSON
over the default full configuration.

## Acceptance gates

1. Verify generated configuration; compile full and core profiles independently.
2. Run existing desktop unit/Helper and Safari tests. Mobile must not change
   settings import/export, Keep/Hide, tab guard or desktop download behavior.
3. On device, share one HTTPS MP3/OGG and MP4, check size, confirm, background the
   app, return and verify bytes/status. Reopen the app during and after transfer.
4. Open/export a completed file; remove history without deleting its file; cancel
   an active job without touching other apps' jobs. Check airplane-mode recovery.
5. Reject HTML, HLS/DASH, HTTP, credentials/private addresses and multiple links.
   Share YouTube and verify an explicit unsupported resolver reason, no fake MP4.
6. Test expired/signed URLs, redirect loops, 403 and unknown size. An unknown total
   must not invent a percentage; metadata failure must not start a download.
7. Build without media: Safari protection still works, no Downloads entry on iOS;
   Android core has no share handler, network permission or downloader dependency.

Build/lint and static/native unit checks are not physical-device acceptance.
On Windows, native iOS compilation/signing cannot be verified locally.
