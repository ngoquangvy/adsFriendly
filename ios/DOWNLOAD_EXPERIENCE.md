# iOS 1.5.3: download flow and automatic parallel transfers

Both editions share a native, scrollable download form: paste link, analyze,
choose source, confirm. A bounded three-pulse cue after Paste highlights Analyze;
Reduce Motion disables the animation. Analysis never starts a download. Fields,
empty states, active transfers and finished history have separate sections.
YouTube defaults to audio AAC/M4A with a video picker and optional WebM disclosure.
The home screen collapses detailed protection/DNS instructions, preserving all
DNS consent, profile and system-activation boundaries.

Active rows show bytes, percentage when known, a smoothed transfer rate, and a
progress bar. These describe transport, not total time including extraction,
validation or mux. Each row has a visible menu for cancel, export to Files or
forget. Bulk history deletion removes only terminal records; it keeps active
transfers and saved files. History writes roll back on failure. Export files
before forgetting them, because the history is the app's index to those files.

## Names and upgrade compatibility

YouTube reuses the local extractor's cached metadata after resolving streams.
It propagates the title through choice, preflight, job and saved filename.
Direct HTTPS files prefer Content-Disposition filename* (UTF-8), then filename,
then a recognizable URL basename. Signed URL query strings are never used as
names or stored in history. Unknown names use a generic media filename.
Names retain Unicode, strip path/control/bidi characters, and have bounded UTF-8
length. UUID directories isolate duplicate titles without putting UUIDs in the
exported filename. Existing ledgers and old root-level files remain readable;
no historical files are renamed without their original metadata.

## Transfer policy (no mobile settings)

Video and audio already downloaded concurrently. Their preflight header probes
now also run concurrently, at most two, with sibling cancellation and stable
track ordering. Downloads use a non-discretionary background URLSession with
four connections per host and high task priority. iOS still controls scheduling.

Files at least 2 MiB can use three contiguous byte ranges. A bounded GET 0-0
checks that the origin actually returns valid 206/Content-Range; merely seeing
Accept-Ranges is insufficient. Mutable direct-file origins additionally require
an ETag or Last-Modified for If-Range. Signed googlevideo source URLs identify
the immutable selected track. Small files, unknown lengths and unsupported
origins keep a single complete-file download. There is no thread-count control.

Every part must have exact offsets, total and length, expected MIME, identity
encoding and consistent validators where present. Parts may finish out of order;
assembly streams in original order with at most 1 MiB buffered at a time, off the
main thread. HTTP 200 after a range request is accepted only as one validated
complete file; it is never concatenated with other complete bodies. Sibling
tasks are cancelled. Bad/truncated/mismatched data cannot be marked saved.
YouTube still validates the joined AAC/MP4 or original WebM and native mux output.
Cancellation propagates into joining; recovery reconciles both legacy and range
task IDs. All parts complete before joining, which resumes while the app is active.
Parallel transfer may help per-connection limits; it cannot guarantee a speedup
when the origin, total bandwidth or iOS scheduling is the bottleneck.

## Verification

Native tests cover Unicode/header names, path/token guards, duplicate isolation,
legacy ledgers, rollback, history deletion preserving active downloads/files,
contiguous range plans, exact out-of-order assembly, unsupported Range fallback,
bad offsets, AAC decoding, concurrent preflight and the next-action form.
Deterministic UIKit form screenshots are exported from native XCTest results
for visual review at 390 and 320 points. Live YouTube availability and throughput
must be checked separately on the physical iPhone; GitHub IPs can hit bot checks.
