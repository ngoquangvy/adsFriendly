# AdsFriendly Media Helper

This is an optional Node.js/TypeScript component of the AdsFriendly ecosystem.
The ad-protection product never requires it. The browser extension continues to
own navigation protection, DOM protection, and shared media discovery. All
user-initiated video downloads require this helper; there is no second browser
download backend to keep in sync.

The helper will provide the only video download backend, including large-file
streaming and FFmpeg-backed muxing. Its first slice implements the versioned
Native Messaging handshake and FFmpeg capability inspection; download execution
remains disabled until the native job runner is added.

Build it from the repository root with `pnpm helper:build`. The generated
`dist/host.cjs` still runs through Node.js during development. A signed installer
and single-executable release are later packaging slices, not extension
dependencies.

Native Messaging reserves stdout for framed protocol messages. All helper logs
must go to stderr.
