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
candidates. A candidate can describe a direct file, HLS, DASH, or a blob-backed
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
encryption methods, and suspected DRM. Full manifest bodies, signed URLs outside
the per-tab session catalog, and segment lists are not persisted.

Network capture is installed at `document_start` in Chrome's MAIN world for both
the top page and video iframes, so page CSP does not block it. When a
manifest URL is discovered through DOM or Resource Timing after its response was
missed, the content observer asks the same page context to fetch that HTTP(S)
manifest once from the browser cache/network. The fallback inherits the page's
origin, referrer, and same-origin cookies; a bounded gate prevents repeated
requests. A blocked fallback is reported explicitly instead of remaining in an
indefinite “reading qualities” state.

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

Blob sources (including the common YouTube player case) remain discovery-only:
the blob URL does not reveal the underlying adaptive streams. DASH probing and
blob resolution are later slices. Probe results and download jobs are not
training labels or video-ad classifications.

## Optional helper boundary

`src/media/helper-contract.js` is the versioned, language-neutral protocol
contract shared by the extension and `packages/media-helper/`. The current
helper slice implements Native Messaging framing, a handshake, and FFmpeg
capability inspection. The background bridge validates and caches that status.
The helper deliberately reports HLS execution as unavailable until the native
job runner is implemented.

The extension declares `nativeMessaging` as an optional permission and asks for
it only after a user initiates Media Helper setup. The extension sends only
bounded job metadata and receives status/progress events. Media bytes never
travel through Native Messaging; the helper will
stream them directly to disk. The helper is optional for the `media-tools`
product and is never a dependency of the `ad-protection` product.
