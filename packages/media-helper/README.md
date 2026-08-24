# AdsFriendly Media Helper

This is an optional Node.js/TypeScript component of the AdsFriendly ecosystem.
The ad-protection product never requires it. The browser extension continues to
own navigation protection, DOM protection, media discovery, and the simple
browser HLS downloader.

The helper will provide large-file downloading and FFmpeg-backed muxing for
media jobs that exceed the browser backend. Its first slice only implements the
versioned Native Messaging handshake and FFmpeg capability inspection; download
execution remains disabled until the extension bridge is added.

Build it from the repository root with `pnpm helper:build`. The generated
`dist/host.cjs` still runs through Node.js during development. A signed installer
and single-executable release are later packaging slices, not extension
dependencies.

Native Messaging reserves stdout for framed protocol messages. All helper logs
must go to stderr.
