# Download progress and ETA

`src/downloads/progress.js` is the shared, presentation-only calculation:
measured bytes / known total first, processed time / duration next, then
persisted resources / total resources. Invalid/unknown totals produce no invented
percentage. Values are bounded to 0–100. HLS resource progress is **not** a byte
percentage: segments have different sizes. The UI displays the resource count
to make the basis clear; it does not fabricate an estimated file size.

The Helper HLS acquisition layer emits completed/total resource counts after
disk writes, including existing cached resources. It emits an initial snapshot
even if the entire resource set is cached. Compatibility-check traffic does not
become download completion. This metadata addition does not change scheduling,
request headers, encryption policy, cache identity or resume behavior.

`src/downloads/ui/progress-bar.js` keeps the numeric percentage, fill and ARIA
value in sync for both Settings download lists. Unknown progress is a static
neutral hatch, not a falsely empty 0% bar. Terminal rows hide the track. Player
launchers use `formatMediaJobTransferSummary` for percentage + speed + ETA.

`src/downloads/eta.js` owns a bounded estimator. Media job updates and the generic
file store apply it once in the background; all presenters consume that same
snapshot. It uses up to 30 seconds of actual progress deltas and a smoothed rate,
not instantaneous reported speed. ETA is recalculated no more often than every
3 seconds **when progress events arrive**; no extra network polling/timer is
introduced. Labels are compact (`30 s`, `3 min`, `1 h 15 min`). Missing or stale
estimates are omitted. Pause, retry/regression, a changed total/basis/stage and
long observation gaps reset the estimate. It describes the current transfer,
not subsequent remuxing/transcoding time.

Local regression tests cover byte/time/HLS resource bases, unknown totals,
resume, ETA cadence/smoothing/reset, player labels, stable action nodes and live
bar updates. Framed Helper tests assert HLS resource metadata while exercising
real HTTP downloads, cache resume and FFmpeg. A localhost Settings fixture checks
the rendered green fill and compact labels; it is not an installed-Chrome test.

Helper 0.25.1+ is needed for HLS resource counts. An already running native
process keeps its old code: installing the new executable does not upgrade that
in-flight job. Do not interrupt a user's current download merely to update it.
Reload the extension and start a new download after updating Helper to test.
