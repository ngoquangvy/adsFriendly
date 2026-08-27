# Media Foundation Boundary

AdsFriendly's media layer is content-neutral. It discovers, describes, and can
download explicitly selected supported media; it does not decide whether that
media is an advertisement.

The media layer is shared browser infrastructure, not a requirement to install
the local helper. Discovery stays available for ad protection and future
video-ad classification without it. Every user download, including simple HLS,
goes through the optional Node.js/TypeScript helper so the product has one
consistent large-file, retry, resume, and FFmpeg output path.

## Shared foundation

The future `media.observer`, `media.catalog`, manifest parsers, and timeline
builder produce registered `media.*` events containing normalized media
candidates. A candidate can describe a direct file, HLS, DASH, a resolved
adaptive HTTP video/audio pair, or a blob-backed
player and can later gain variants, audio tracks, subtitles, DRM state, and a
timeline.

## Independent consumers

- The downloader selects a candidate and creates a helper job. The extension
  owns selection and status UI; the helper owns all network bytes and output.
- Video-ad intelligence reads the same media ID and timeline but emits separate
  `video_ad.*` evidence. It cannot silently remove suspected ad segments from a
  download.
- Training storage only receives labelled evidence. Discovery history and
  download history are not training labels.

## Permission rule

Capability metadata is declared once in `src/runtime/feature-catalog.js`.
Features do not maintain their own Safe/Assist/Auto checks. Registered side
effects execute through an action broker, while pure media transformations stay
independent of protection mode.

Download execution requires the optional Native Messaging helper. It does not
require Chrome's `downloads` permission, and media bytes never pass through the
extension message channel.

## Current discovery slice

The first implementation detects direct MP4/WebM sources, HLS manifests, DASH
manifests, and blob-backed video elements from DOM, Performance Resource Timing,
page-world `fetch`, and page-world XHR. Results are deduplicated into a per-tab
catalog and mirrored only to `chrome.storage.session` so service-worker sleep
does not erase the test view. The session catalog is cleared when its tab
navigates or closes, and it is not part of Settings Packages or training data.

The popup exposes the catalog and user-initiated Media Helper setup in Assist
and Auto modes. HLS response bodies already available to the page are parsed
without a second network request. Master playlists expose quality variants, audio and
subtitle tracks; media playlists expose VOD/live state, duration, segment count,
Low-Latency HLS parts, delta updates, encryption methods, and suspected DRM.
Empty HLS envelopes remain unknown until media evidence appears instead of being
inferred as live merely because `EXT-X-ENDLIST` is absent. The catalog also links
discovered child quality/audio/subtitle playlists back to their master. Full manifest bodies, signed URLs outside
the per-tab session catalog, and segment lists are not persisted.

YouTube is handled by a bounded acquisition profile rather than pretending its
`blob:` player source is a DASH manifest. Successful `googlevideo/videoplayback`
responses are classified as already browser-resolved tracks; playback byte
windows are deduplicated by video/itag and grouped into one adaptive candidate.
The profile waits for both video and audio, retains the signed track URLs only
in the per-tab/session job state, and never evaluates YouTube player code or
derives a signature. The Helper prefers an MP4/M4A pair for MP4 output, downloads
the two files through the shared parallel Range engine, then invokes FFmpeg only
for local muxing.

The HLS resolver keeps multiple observations of a tokenized endpoint and does
not let a later empty envelope replace an already usable media playlist. It
links request redirects and master variants, selects the best discovered VOD
stream by readiness and quality, and exposes one logical source in the popup.
Resolution methods are registered in one ordered catalog. Already captured
response bodies are preferred, followed by a child playlist that the same
frame/player has demonstrably loaded, a public player API adapter, one
context-aware probe, and finally a bounded URL adapter. A passive child is
accepted only when frame, origin, observation time, and optional player/path
evidence clear a fixed confidence threshold; ambiguous children from separate
players or ad frames are not joined. Strategy results remain session metadata
and do not become training labels.
When a bounded encrypted-envelope adapter resolves a usable playlist, its
strategy evidence is retained only as `resolutionAttempt` session metadata. It
is not a training label. The future schema and validation boundary are pinned
at [TRAINING_BACKLOG: MEDIA_RESOLUTION_STRATEGY](TRAINING_BACKLOG.md#training_backlog-media_resolution_strategy)
so this signal is reconsidered when training work resumes.
Request routing facts (document/referrer URL, transport, credentials mode, and
whether the browser session is required) stay in `chrome.storage.session`.
Cookie, authorization, and arbitrary request-header values are never captured.
The request context distinguishes the current frame document from its parent
document. Browser Fetch continues to own forbidden headers such as `Origin`;
the extension replays only a recent, normalized credentials/referrer context
that is valid for the current frame instead of injecting arbitrary headers.

HLS protection is classified explicitly. Plain `AES-128` with the identity key
format is encrypted HLS, not DRM. `SAMPLE-AES` without stronger evidence remains
`DRM suspected`; a recognized HLS key format, DASH ContentProtection scheme, or
an EME/CDM call confirms the DRM system where possible. The main-world EME
observer records only normalized key-system names, init-data type, declared
encryption scheme, key-status names, and license lifecycle status. It never
reads or stores raw init data, key IDs, license payloads, decryption keys, or
session credentials.

Network capture is installed at `document_start` in Chrome's MAIN world for both
the top page and video iframes, so page CSP does not block it. When a
manifest URL is discovered through DOM or Resource Timing after its response was
missed, the content observer asks the same page context to fetch that HTTP(S)
manifest once from the browser cache/network. The fallback inherits the page's
origin, referrer, and same-origin cookies; a bounded gate prevents repeated
requests. A blocked fallback is reported explicitly instead of remaining in an
indefinite “reading qualities” state.

The low-level network, Blob, and public-player hooks are registered as core
bootstrap features so they exist before an early player consumes its first
token. Their policies still require `media.observe` before parsing or reporting
media, so installing the hooks early does not enable the Media catalog in Safe
mode or while protection is disabled.

The active fallback is intentionally scheduled once after a short passive
grace period. Repeating it can consume signed or single-use manifest URLs.
Failure changes the visible state to a reason such as HTTP 403 or a blocked
page/CORS probe while network and player observers continue listening for a
usable child. JWPlayer integration uses only its public playlist and quality
events in the page MAIN world; player-private state is never inspected.

## Legacy browser download slice

An HLS candidate is checked before a job can be created. The first supported
path is an unencrypted VOD media playlist with muxed audio/video and no stream
discontinuities. Master playlists expose a quality selector, but variants with a
separate audio playlist are blocked until muxing is available. Live playlists,
AES encryption, suspected DRM, and unsupported layouts fail visibly before any
segment download begins.

The dedicated download page previously refetched only the selected media
playlist and built a volatile ordered resource plan. It downloaded 1–16 resources at a time
(chosen adaptively, user-adjustable), retries transient failures twice, and
writes each completed batch in playlist order. A browser writable file keeps
memory bounded to roughly one concurrent batch; the Blob fallback is used only
when the file picker API is unavailable. Byte-range resources and fMP4 init maps
are supported. Jobs expire from `chrome.storage.session` after 24 hours, while
manifest bodies and segment lists are not persisted. This implementation is
retained in `src/download/` as a reference and regression fixture, but its
extension runtime page and generated bundle are no longer shipped. It can be
removed after the native helper reaches feature parity.

Blob URLs (including the common YouTube player case) are never downloaded
directly because the object URL itself does not reveal the underlying adaptive streams. The
main-world Blob tracer now correlates response ArrayBuffers from Fetch/XHR with
`SourceBuffer.appendBuffer`, the owning `MediaSource`, and its object URL. A
same-host HLS or DASH manifest observed in the same bounded time window can then
replace the Blob row as the downloadable source. Static, unencrypted DASH VOD is
parsed in the extension and downloaded through the helper. Players that copy,
transform, or stream bytes without preserving the observed buffer identity can
still remain unresolved. Duplicate unresolved Blob handles from the same page
player are grouped in the popup. Trace metadata, probe results, and download jobs
are transient diagnostics—not training labels or video-ad classifications.

## Optional helper boundary

`src/media/helper-contract.js` is the versioned, language-neutral protocol
contract shared by the extension and `packages/media-helper/`. The helper has
an adapter registry, a Direct HTTP MP4/WebM adapter with parallel byte-range
requests, progress, cancellation, and resume metadata, plus FFmpeg-backed HLS
and DASH VOD adapters. A resolved-adaptive adapter reuses the Direct HTTP engine
for separate video/audio tracks and performs a local FFmpeg mux. HLS AES-128 identity keys are supported when their HTTP(S)
key URI is reachable; SAMPLE-AES and DRM key formats remain playback-only.
Adaptive preflight rejects live/DRM streams, bounds
manifest input, validates referenced network resources, and supports HLS
discontinuities that FFmpeg can remux into MP4. The background bridge keeps transient job status in
`chrome.storage.session`; these records remain separate from Settings packages
and training data.

For identity AES HLS, the Helper first uses bounded request-header profiles
derived from captured routing facts and the browser's actual User-Agent. If the
key server rejects every profile but the page player already received the
declared key, the main-world observer can hand that exact key to the Helper in
memory. To handle a player that requests its key before the manifest clone has
finished parsing, at most 32 binary responses of an exact AES key size may be
held in page memory for 15 seconds; a response is never exposed unless its
exact URL then appears in a parsed identity AES key tag. Master/child manifest
relations and observed frame IDs bound which page frames may answer the
handoff. Chunked key responses do not require `Content-Length`: during this
short parsing window the observer reads the actual response stream, accepts
only 16/24/32-byte AES keys, and cancels a clone as soon as it exceeds 32
bytes. Per-host strategy outcomes are scored locally so a successful
registered method is preferred on the next download. Sensitive
headers and key material are excluded from this memory and from persisted job
history; temporary key files are removed after any terminal outcome. See
`TRAINING_BACKLOG: MEDIA_ACCESS_STRATEGY` before considering these outcomes for
future AI training.

The extension declares `nativeMessaging` as an optional permission and asks for
it only after a user initiates Media Helper setup. The extension sends only
bounded job metadata and receives status/progress events. Media bytes never
travel through Native Messaging; the helper streams them directly to disk. The
helper is optional for the `media-tools`
product and is never a dependency of the `ad-protection` product.

## Planned YouTube audio output

Audio-only download remains a separate output profile rather than a fallback
that silently discards video. The planned flow selects the highest-quality
available audio track, preserves its native codec when requested, or explicitly
transcodes it to OGG through the Media Helper. The popup must show the selected
track, estimated source size, output codec, and the cost of transcoding before
the job starts.
