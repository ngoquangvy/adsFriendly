# Direct audio foundation

## Scope and ownership

Audio is a content type, not a new transport or a separate downloader.
`kind` remains direct/HLS/DASH/adaptive/blob; `mediaType` is independent and
defaults to unknown for legacy candidates without enough evidence. Classification
and evidence precedence live in `src/media/content-type.js`. MIME evidence wins
over an audio element, which wins over an extension. Unknown DOM updates cannot
erase an already observed MIME type. Provider adapters remain ahead of generic
classification; HLS/DASH parsers and the parallel HTTP core are unchanged.

This milestone supports direct MP3, M4A, OGG/OGA, Opus, FLAC and WAV sources,
plus explicitly identified audio/webm. DOM audio/source, network headers and
Resource Timing feed the existing catalog. A generic opaque URL can be associated
with an audio element, but this does not establish a container or grant download
access. AAC/M4S segments remain excluded rather than becoming separate songs.
General audio-only HLS/DASH, unresolved blob capture, radio recording and new
conversion profiles are deferred. Existing YouTube Audio/OGG behavior is retained.

The existing media observation capability/modes and user-action broker still own
this feature. No new host permission, automatic download or per-function mode
check is added. Browser-download observation/handoff stays a separate explicit
workflow; its 8 MiB automatic-check threshold does not apply to a user-selected
media download. Observing the same source does not itself create any download.

## UI and metadata

The popup uses AUDIO, Direct audio, duration, observed total size and Original.
When size and duration are known, it can display `~320 kbps avg`: a file-wide
estimate including container overhead, not a measured encoder bitrate or proof
of audio fidelity. Missing values remain unknown; there is no extra body fetch
to infer codec/sample rate/bitrate. The existing bounded header-size probe is
reused. Audio controls do not create a new floating button over an audio element;
the existing video launcher and its placement remain unchanged.

Helper 0.26.0 advertises `download.direct_audio`. Old Helpers keep their video
capabilities but audio controls request an update; the background also checks
this capability before starting a direct-audio job. Protocol 12 is compatible.
The direct HTTP adapter downloads original bytes without FFmpeg. Naming checks
the response MIME, retains a valid audio suffix even for long titles, and rejects
HTML/non-audio responses or an unknown container rather than guessing `.mp4`.
There is no new range scheduler, cache format or pause/resume implementation.

## Missing-evidence diagnostics

`media.source_diagnostic` is centrally registered and routed under the existing
media catalog capability. DOM/network failures and unresolved/unsupported audio
evidence use allowlisted reason codes, not arbitrary exception strings:

- source_missing / source_unclassified
- audio_format_unknown / audio_mime_unsupported / audio_response_conflict
- media_segment / blob_source_unresolved
- response_rejected (bounded HTTP status) / size_unavailable

The memory-only recorder retains at most 50 groups per tab, across 20 tabs,
expires groups after 15 minutes of inactivity, and clears on navigation, tab
close or feature shutdown. DOM reports are deduplicated and capped at 50 distinct
diagnostics per document. Private-tab source diagnostics are not collected.
It retains code, input, host, MIME, extension, frame, counts and times: no paths,
query strings, titles, bodies, headers, cookies, keys or free-form errors.

Open the extension popup > Source diagnostics > Copy diagnostics to inspect or
share the sanitized report. This disclosure is collapsed by default and adds no
website toast. The recorder is neither training data nor proof that a source is
an advertisement. Worker restart/reload loses its memory; copy before reloading.
Capture coverage is limited to the current DOM/network observers, not every
internal player state or every possible failure. No training upload is added.

## Verification gates

1. Contracts/classification: audio MIME/extensions, opaque endpoints, segment
   rejection, legacy normalization and stronger-evidence preservation.
2. Actual DOM observer: late metadata, source change, detached-player cleanup,
   video coexistence and shutdown without further reports.
3. Diagnostics/UI: bounded dedup/expiry, strict field projection, safe text/copy,
   audio labels, estimated vs measured values and old-Helper capability gating.
4. Real native Helper: six generated audio formats downloaded byte-exactly and
   independently checked by ffprobe. Helper PATH is empty during these downloads
   to ensure original transfer does not depend on FFmpeg. Negative fixtures
   verify HTML and unknown containers fail without a completed audio file.
5. Regression: existing direct video range/resume, HLS/AES/disguised segments,
   DASH, adaptive video+audio, player capture, browser file handoff, YouTube and
   Facebook catalog/quality cases; build, Helper typecheck and iOS shared tests.

Tests/fixtures remain local as requested. Real website/private-session coverage
still requires user testing; local fixtures do not prove compatibility with every
music service. Structured gaps may later guide AI/training work, but exporting
them into any dataset requires a separate privacy and schema decision.
