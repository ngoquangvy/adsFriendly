# AdsFriendly Media Helper

This is an optional Node.js/TypeScript component of the AdsFriendly ecosystem.
The ad-protection product never requires it. The browser extension continues to
own navigation protection, DOM protection, and shared media discovery. All
user-initiated video downloads require this helper; there is no second browser
download backend to keep in sync.

The helper is the only video download backend. Version 0.12 implements Direct
HTTP MP4/WebM downloads with bounded parallel Range requests, progress,
cancellation, and resumable `.part` metadata, plus completed unencrypted or
AES-128 identity-key HLS VOD
and static unencrypted DASH VOD downloads through FFmpeg. It also accepts
browser-resolved, unencrypted adaptive HTTP video/audio pairs (initially
YouTube playback tracks), downloads both with the existing bounded parallel
Range engine, and muxes them locally. It does not derive signatures, access
DRM streams, or persist signed playback URLs in download history. The manifest adapters
preflight bounded manifests, reject live/DRM streams and unsafe
private-network resources, and mux the selected video and audio tracks into MP4.
AES-128 key URIs are validated as HTTP(S) resources but are not persisted.
It can also open a completed output or reveal it in the operating system file
manager. Output actions are restricted to regular files inside the user's
managed Downloads directory.
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
