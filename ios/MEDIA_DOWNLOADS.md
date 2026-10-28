# iOS 1.4.0: native media with Safari 1.3.0 protection

## Composition

This build integrates the optional Media Tools module from product commit
`1c5aab2` on top of the Safari blocking, individual-area recovery, Package,
URL filtering and DNS profile exporter in `0bd5340`. It does not merge the
desktop product branch or replace its media backend.

- `src/mobile/module-catalog.js` registers module IDs, product IDs, capabilities
  and full/protection profiles. `direct-formats.js` is the format allowlist.
- `scripts/mobile-config.mjs` generates the iOS JSON resource from that catalog.
  This branch generates iOS only; Android generation remains in its own branch.
  `ios:check` rejects stale generated JSON without changing it.
- `Modules/MobileModuleCatalog.swift` decodes and validates that resource.
- `MobileSourceProbe` performs an explicit header check; `MobileMediaResponse`
  also validates the eventual download response and file length.
- `MobileDownloadStore` owns the background URLSession and app-private files.
- `MobileDownloadsViewController` owns input, confirmation, progress and export.
- `ViewController` composes the optional entry below the scrolling DNS/Safari
  onboarding; its existing local-file-only DNS bridge remains independent.
- `AppDelegate` forwards only the dedicated media session's background events.

No Safari content/background script imports or requires the downloader. Its
only protection change in this integration is the reported version (1.4.0).
Browser settings, cookies, native credentials, URL filters and DOM decisions
are not shared with the media module. Opening Media Tools starts no transfer.

## Current behavior

Open the app → Media Tools · Downloads → paste one public HTTPS direct-file URL
→ Check source → Download original → confirm. You can background the app,
cancel its jobs, preview a saved file and swipe Share to export a copy to Files.
Forget removes the history entry without deleting the file.

Supported original files: MP3, M4A, OGG, Opus, FLAC, WAV, MP4, WebM, MOV and MKV.
There is no conversion; codecs may be unsupported by the device's preview.
The input is a direct file URL, not a website/watch-page URL. YouTube pages,
HLS/DASH, DRM, Safari source discovery and desktop Helper features are not
implemented by this milestone. Imported desktop download settings do not
silently enable unsupported native capabilities.

HEAD falls back once to a header-only Range request for HTTP 403/405. Response
bodies are not buffered by the probe. A 206 probe requires bytes 0-0/positive
total; the actual complete-file transfer must return HTTP 200, a supported
media MIME (or an allowed suffix with absent/octet-stream MIME), nonzero length,
and lengths matching both the check and final response when known. A response
changed since the check fails rather than being marked saved. These checks
are not a codec decoder or proof that a site supplied the intended creative.

The check expires after 30 seconds and is invalidated on input changes and
leaving the screen. Probe reuse resets fallback/redirect state. Old callbacks
cannot replace the active check. No network request is made by simply pasting.
Requests use the same User-Agent and identity encoding for preflight/transfer;
cookie, credential and cache stores are disabled.

Only public-shaped HTTPS URLs without credentials, IP literals, local suffixes
or custom ports are accepted. Redirects are revalidated (probe limit: 3).
This is not a DNS-rebinding sandbox: DNS and later URLSession requests are
OS-owned. Use trusted sources. Authentication-dependent links can fail.

History is capped at 50 entries and contains generated names, task IDs, status,
lengths and fixed error codes, without source URLs or tokens. The OS necessarily
holds request URLs while downloading. Invalid/duplicate history records are
discarded. Recovery reconciles this app's session, cancels orphaned tasks and
marks ended jobs interrupted. Force-quit can end background transfers; custom
pause/resume is not provided. Files live in app storage and uninstall deletes
them: export files you want to keep.

## Build and tests

`npm run ios:check`, `npm run ios:settings:check`, `npm run test:ios`,
`npm run test:unit` and the browser smoke suite cover composition and existing
protection behavior. Native XCTest adds catalog/URL policy, bounded HEAD/Range
preflight using an in-process URLProtocol fixture, final response/length
validation and the independent UI entry. All those fixture requests stay local
to URLProtocol; the tests do not contact an advertising/media service.

GitHub macOS runs those native tests alongside DNS and the long-page WKWebView
Block/Default/Allow test. It builds the full unsigned IPA, verifies packaged
resources, then compiles with `AF_PROTECTION_ONLY` and generated protection-only
JSON. The latter must exclude media implementation symbols, including any
debug dylib. The full generated JSON is restored even if that build fails.

To build without media locally on macOS:

1. `AF_MOBILE_PROFILE=protection node scripts/mobile-config.mjs`.
2. Build with `SWIFT_ACTIVE_COMPILATION_CONDITIONS='DEBUG AF_PROTECTION_ONLY'`.
3. Restore default full configuration: `node scripts/mobile-config.mjs`.

These checks do not replace physical-device acceptance. On iPhone, verify:

1. Install the combined IPA with Sideloadly; Safari reports connected 1.4.0.
2. Retained Block/Default/Allow, Keep/Hide/Show, package import/undo and DNS export.
3. A trusted MP3 and MP4: metadata, confirmation, background/return, completion,
   playback, export, byte integrity, reopening the app and cancelling another job.
4. Airplane mode, force-quit/relaunch, low storage, expired URLs, unknown size,
   HTML/missing sources and YouTube rejection; no false completed status.
5. Small screens, landscape and large text: DNS controls remain scrollable and
   the optional entry does not cover them. Test protection-only build separately.
