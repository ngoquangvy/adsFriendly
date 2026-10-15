# Download integration: foundation checkpoint

This document records the initial refactor of existing media downloads.
The subsequent observation-only checkpoint adds an optional Downloads permission;
see BROWSER_DOWNLOAD_INTAKE.md. Automatic Chrome cancellation/takeover and the
generic-file job contract have not been introduced.

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

## Remaining checkpoints

Keep browser intake distinct from media candidates. Build the generic
file executor on the neutral HTTP core, with an explicit filename policy.
Do not reuse the media MP4 fallback or treat all browser downloads as replayable.
POST/session-bound/one-shot/unsupported sources must remain browser-owned until
there is a supported handoff strategy. A successful Helper handshake alone is
not proof that a source can be transferred safely.

The subsequent coordinator must test duplicate intake, extension-originated
downloads, restart/disconnect, handoff failure and browser fallback before any
automatic cancellation/takeover is enabled.
