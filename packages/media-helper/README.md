# AdsFriendly Media Helper

This is an optional Node.js/TypeScript component of the AdsFriendly ecosystem.
The ad-protection product never requires it. The browser extension continues to
own navigation protection, DOM protection, and shared media discovery. All
user-initiated video downloads require this helper; there is no second browser
download backend to keep in sync.

The helper is the only video download backend. Version 0.24.1 implements Direct
HTTP MP4/WebM downloads with bounded parallel Range requests, progress,
cancellation, and resumable `.part` metadata, plus completed unencrypted or
AES-128 identity-key HLS VOD
and static unencrypted DASH VOD downloads through FFmpeg. It also accepts
browser-resolved, unencrypted adaptive HTTP video/audio pairs (initially
YouTube playback tracks), downloads both with the existing bounded parallel
Range engine, and muxes them locally. For YouTube, it resolves bounded Player
JS signature/n challenges and prefers a MWEB profile with a short-lived
Proof-of-Origin token. The quality preflight and the download path both verify
the first byte and a byte after 1 MiB before a format is presented as usable or
parallel transfer starts. It keeps audio languages and roles distinct,
and defaults to the original audio track when YouTube identifies one. Tokens
are cached only by video, provider profile, player revision, and attestation
revision; signed URLs and token values are never written to history or strategy
memory. Immediately before preflight/start/retry, the extension asks the active
player frame for a fresh browser observation; those URLs remain a bounded
fallback after built-in profiles fail and are removed from persisted job
history. If `yt-dlp` is installed,
it can be used only as an optional provider-URL fallback after the built-in
profiles fail. Set `ADSFRIENDLY_YTDLP_PATH` to an explicit executable path when
it is not on PATH. The helper invokes it with `--no-config`, never as the ad
blocker backend.

It does not access DRM streams or persist signed playback URLs in download
history. The manifest adapters
preflight bounded manifests, reject live/DRM streams and unsafe
private-network resources, and mux the selected video and audio tracks into MP4.
AES-128 key URIs are validated as HTTP(S) resources but are not persisted.
It can also open a completed output or reveal it in the operating system file
manager. Output actions are restricted to regular files inside the user's
managed Downloads directory.
For a custom JavaScript-protected player with no replayable media URL, the
Helper can validate a bounded player-output canary and accept an explicitly
started, ordered fMP4 capture. This fallback is non-resumable and transports
acknowledged bounded chunks through Native Messaging; normal network downloads
continue to stream directly from the Helper to disk.
Blob resolution remains a separate discovery adapter so extending it does not
change the extension's ad-protection runtime.

Build it from the repository root with `pnpm helper:build`. On Windows,
`pnpm helper:package:windows` creates a Node Single Executable Application at
`packages/media-helper/dist/adsfriendly-media-helper.exe`.

To register a development build for an unpacked Chrome extension, first copy its
ID from `chrome://extensions`, then run:

```powershell
pnpm helper:register:windows -- --extension-id <32-character-extension-id>
```

Registration copies the executable and native-host manifest under the current
user's `%LOCALAPPDATA%\\AdsFriendly\\MediaHelper` and writes only the Chrome
per-user Native Messaging registry entry. Packaging does not register or install
anything by itself. Production distribution will still need code signing and an
installer/updater.

Native Messaging reserves stdout for framed protocol messages. All helper logs
must go to stderr.
