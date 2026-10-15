# Download integration: foundation checkpoint

This document records the initial refactor of existing media downloads.
The subsequent checkpoints add optional Downloads observation and explicit
checked generic-file handoff; see BROWSER_DOWNLOAD_INTAKE.md. Automatic takeover
has not been introduced.

## Helper responsibilities

- `http-transfer-types.ts`: provider-neutral source/probe/range contracts. A
  source can inject request construction, preflight and diagnostic formatting.
- `http-remote.ts`: HTTP(S), DNS/private-network guard and validated redirects.
- `http-probe.ts`: HEAD/range metadata and actual range-support verification.
- `http-transfer.ts`: existing range scheduling, bounded retries, disk writes,
  progress, sequential fallback and resume metadata. No media candidates or
  provider switches. Chunk sizes and worker counts are unchanged.
- `youtube-http-profile.ts`: GoogleVideo query ranges, CPN, declared size hints,
  first-byte/continuation preflight and redacted diagnostics.
- `media-http-source.ts`: maps an existing media job onto a transfer source,
  retaining the current browser/provider header behavior.
- `media-filename.ts`: media naming policy, including the existing MP4 default.
- `output-paths.ts`: output-directory, sanitization and collision utilities.
- `direct-http-adapter.ts`: thin media adapter orchestrating those components.
  Compatibility re-exports keep old consumers working, while in-tree adapters
  import utilities from their actual owners.

No Helper protocol, history/identity schema, training schema or protection mode
has changed. Existing Direct, HLS, DASH, adaptive, audio-only and player-output
acquisition continue to use the same registered adapters.

## Settings responsibilities

Downloads lifecycle/actions are owned by `src/options/downloads-section.js`.
Rows/viewport are owned by `src/options/downloads/history-list.js`.
The main Settings controller keeps navigation, storage subscription and shared
settings writes. Existing action names, connection default and confirmation
scope remain unchanged. Open/Folder buttons are restored after an action even
when the keyed row does not need rebuilding.

## Verification gates used locally

1. Baseline full unit suite and framed Helper integration suite.
2. After utility/provider extraction: typecheck and all Helper integrations.
3. After neutral transfer extraction: profile/boundary tests and all integrations.
4. After Settings extraction: real-controller DOM tests, individual job actions,
   late responses, binding cleanup, confirmations, scroll threshold, stable rows
   and the full unit suite.
5. Final bundle/build consistency and staged-source review.

Additional regression fixtures remain local according to the repository owner's
current publishing preference. They do not depend on installed browser data.
Local HTTP/FFmpeg fixtures exercise real bytes and remuxing; DOM mocks do not
prove live Chrome behavior or acceptance of a current YouTube CDN token.

## Observation checkpoint (implemented separately)

The opt-in observer and conservative policy are now described in
[BROWSER_DOWNLOAD_INTAKE.md](./BROWSER_DOWNLOAD_INTAKE.md). This changes no existing
media adapter or browser download ownership.

## Confirmed generic-file checkpoint (implemented separately)

Generic file contracts/execution are separate from media candidates. The shared
range core now drains aborted sibling workers before returning, allowing safe
generic partial-file cleanup without concurrent writes. Provider request policy,
media adapters, chunk sizing and YouTube range logic are unchanged.

The coordinator requires observed GET + strong size/ETag evidence, independent
native validation and explicit acceptance. It journals pause ownership and keeps
Chrome's resumable request until native completion is verified and saved. See
[BROWSER_DOWNLOAD_INTAKE.md](./BROWSER_DOWNLOAD_INTAKE.md) for supported files,
privacy, recovery, tests and remaining live-Chrome verification gates.
