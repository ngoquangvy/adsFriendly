# Media Foundation Boundary

AdsFriendly's media layer is content-neutral. It discovers and describes media;
it does not decide whether that media is an advertisement and it does not choose
where completed downloads are presented.

## Shared foundation

The future `media.observer`, `media.catalog`, manifest parsers, and timeline
builder produce registered `media.*` events containing normalized media
candidates. A candidate can describe a direct file, HLS, DASH, or a blob-backed
player and can later gain variants, audio tracks, subtitles, DRM state, and a
timeline.

## Independent consumers

- The downloader selects a candidate and creates a download job. Its output is
  behind an adapter, so Chrome Downloads, a dedicated extension page, or a local
  helper can be selected later without changing discovery and parsing.
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

No download output adapter or browser download permission is selected in this
foundation change.

## Current discovery slice

The first implementation detects direct MP4/WebM sources, HLS manifests, DASH
manifests, and blob-backed video elements from DOM, Performance Resource Timing,
page-world `fetch`, and page-world XHR. Results are deduplicated into a per-tab
catalog and mirrored only to `chrome.storage.session` so service-worker sleep
does not erase the test view. The session catalog is cleared when its tab
navigates or closes, and it is not part of Settings Packages or training data.

The popup exposes the catalog as a read-only test surface in Assist and Auto
modes. HLS response bodies already available to the page are parsed without a
second network request. Master playlists expose quality variants, audio and
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

Blob sources (including the common YouTube player case) remain discovery-only:
the blob URL does not reveal the underlying adaptive streams. DASH probing and
download output are separate later slices. None of these probe results are
training labels or video-ad classifications.
