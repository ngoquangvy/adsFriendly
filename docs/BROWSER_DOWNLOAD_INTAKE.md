# Browser downloads — explicit Helper handoff

This is not automatic interception. Observation is opt-in and passive. A separate
coordinator can transfer a supported file only after a successful source check
AND explicit user confirmation. Ad blocking does not require the Helper.

## Enable and test

Reload the Chrome extension, open Settings > Downloads > Browser downloads,
and enable **Observe new browser downloads**. Chrome requests the optional
`downloads` permission in this user activation. Download a normal HTTP(S) file
using Chrome; its observation should appear independently of the media job list.
Old Chrome download history is not scanned. File handoff requires **Media Helper
0.25.0+** (the additive `download.file_http` capability, protocol 12).

The UI shows filename, destination host, total size when Chrome reports it,
browser state and a reason the source is not yet eligible for handoff.

### Detection is not ownership

Each observation now has an explicit **Detected** status, separate from who is
downloading: Check available, Ready to transfer, Helper check failed, Chrome
only, Completed/Interrupted in Chrome, or the matching Helper lifecycle state.
Signed/session URL hints remain visible even if a small file finishes in Chrome
before the user opens Settings. A signed link is not silently omitted merely
because handoff is unsupported. Unsupported filename types are labelled Chrome
only rather than offering a check the executor would reject anyway.

The summary distinguishes observation off, permission required, startup,
unavailable and an active observer with zero records. Zero records means no event
in the current observation window, **not proof that a particular click was
missed**: earlier downloads, private tabs and extension-created downloads remain
outside its scope. This presentation does not change intake policy or enable
automatic takeover.

**Copy diagnostics** copies an allowlisted JSON report locally: observer state,
storage-health flag, up to 50 basenames/hosts/sizes/browser states and diagnostic
codes. It contains no original/final URLs, query values, output paths, cookies,
native check IDs or free-form Helper errors. It adds no persistent log, network
request, training sample or history scan. A failed refresh disables copying an
old snapshot as if it were current.

For an eligible in-progress file:

1. **Check with Helper** requests optional Native Messaging permission directly
   from user activation. Chrome keeps downloading normally during the check.
2. The coordinator correlates the exact observed GET response with the Chrome
   download. Helper independently verifies size, strong ETag, range support and
   an actual one-byte GET. A handshake or HEAD success alone is insufficient.
3. **Transfer to Helper** asks for confirmation; the checked session expires in
   30 seconds. Chrome is paused only after revalidating its identity and saving
   recovery metadata. Handoff proceeds only if Chrome reports a resumable pause.
4. Helper downloads using the shared HTTP range core and the configured parallel
   connections (default 8). The Browser file transfers card shows size, progress,
   speed, **Return to Chrome**, then **Open / Folder** on completion.
5. Only verified completion with its output path saved permits cancellation of
   Chrome's paused copy. Failure, disconnect, stopping observation or returning
   ownership resumes the original Chrome request when possible, never replays a
   download URL. Otherwise the UI asks the user to check Chrome manually.

Current support deliberately requires a known size, strong ETag, proven GET,
safe download state and ordinary credential-free HTTP(S) URL. Supported filename
extensions are explicitly listed in `src/downloads/file-contract.js` (archives,
documents, common images/audio/video). Executables, POST, signed/session-risk
URLs, unknown validators, HTML/manifests and unsupported ranges stay in Chrome.
Helper receives no cookies or browser authorization headers. Checking uses small
metadata/range requests; transferring restarts the file in Helper, rather than
adopting bytes already downloaded by Chrome. Generic partial files are removed
after failure/cancellation; Chrome is the resume fallback for this workflow.
**Clear observations** removes only the feature's metadata, never Chrome
history, in-progress transfers or downloaded files. Turning observation off
removes its listeners/session observations and returns active transfers to Chrome;
the separate file history is retained. The granted browser permission is
not revoked automatically.

## Registered ownership

- `downloads.browser_observe`: passive Media Tools capability, optional Downloads
  permission. Available independently of ad protection being on or off.
- `background.browser-download-observer`: explicitly opt-in
  (`enabledByDefault: false`). The existing feature override list controls it.
- MainController supports opt-in registry entries; other features retain their
  previous default behavior. This does not add mode checks to individual methods.
- `src/downloads/intake-contract.js`: projects browser DownloadItem/Delta into
  bounded, source-neutral facts. Never creates a media candidate.
- `src/downloads/intake-policy.js`: pure conservative assessment; every current
  decision has `canTakeOver: false`.
- `src/background/downloads/intake-observer.js`: event ingress, hydration,
  lifecycle, session storage and permission revocation. No network/native IO.
- `downloads.file_transfer`: centrally registered user capability requiring
  Downloads + Native Messaging; `background.browser-file-handoff` owns the
  corresponding check/accept/return/open/reveal actions. No scattered mode gates.
- `request-evidence.js`: bounded passive GET/validator/size evidence, keyed by
  SHA-256 of the exact effective URL; never guesses request method from a name.
- `file-handoff.js`: per-download ownership state machine, duplicate locks,
  checked tickets, journaled pauses and restart/disconnect recovery.
- `file-helper-client.js`: short-lived native sessions and deadlines; distinct
  from media job state. `file-transfer-store.js` owns lifecycle/progress storage.
- `src/downloads/file-contract.js`: separate generic contract. Native
  `file-job-manager.ts` / `file-http-download.ts` execute it without constructing
  media candidates, invoking FFmpeg or applying a media MP4 filename fallback.
- `src/background/downloads/intake-messages.js`: metadata/action endpoints, restricted
  to this extension's exact Settings page. A content script sharing the extension
  ID does not satisfy the sender URL check.
- `src/options/downloads/intake-panel.js`: presentation and activation-time
  permission request; delegates transfer controls to `file-transfer-view.js`.
  Updates do not trigger media Helper probes or hidden-page
  polling. No additional behavior is put in the navigation guard.

## Startup, privacy and bounds

The background entry installs a synchronous event ingress when the Downloads
namespace is available. A short bounded buffer retains the event waking MV3
while settings are loaded. It drops the buffer and detaches when observation
is off; no off-state observations are persisted. Optional permission/session
hydration is non-blocking so it cannot hold up protection startup.

At most 50 records are retained in `chrome.storage.session`, with a one-hour
validity window. Expiry is enforced on reads, updates and session hydration.
Cleanup is opportunistic while the worker is awake; this is not a hard wall-clock
deletion alarm during worker suspension. Writes are coalesced at 500ms.
The startup event buffer is bounded at 100 sanitized events.

Stored facts contain only ID, basename, host/protocol, MIME, total bytes, state,
safety/paused status, observation time, unknown method and boolean URL-risk hints.
No original/final URLs, paths, query values, cookies, tokens, request bodies or
absolute filenames are stored or sent to training/telemetry. Incognito and
extension-originated downloads are excluded. Only an explicitly requested check
sends that file's URL, browser User-Agent, referrer origin and expected size/ETag
to Helper in memory. Prepared tokens expire; they are never stored or trained.

Response evidence is memory-only: up to 200 source hashes, 10 recent response
facts per source, maximum age one hour and a narrow start-time correlation window.
Ambiguous method/validator facts are rejected. File history/recovery uses a
separate bounded local journal (`browserFileTransfers.v1`, up to 100 records)
containing filenames, output paths, timestamps, sizes, source hashes and lifecycle
status. Progress uses session storage, coalesced at 500ms. Neither store contains
source URLs, cookies, tokens or payloads; neither is training data or part of
Settings Packages. Restart recovery touches only matching, explicitly owned
Chrome pauses, never arbitrary paused downloads. Completed files are published
with exclusive names; simultaneous same-name jobs cannot overwrite each other.

The Settings Package may carry the feature override, but cannot grant Chrome
permissions and does not contain session observations. Importing an enabled
override without Downloads permission yields `permission_required`; permission
is never requested from background code.

## Why HTTP sources still need validation

Chrome DownloadItem does not expose the request method or prove a URL can be
replayed outside its browser session. An HTTP URL and a file size do not prove
GET, token reuse or Helper access. Danger/paused/terminal/non-HTTP sources stay
browser-only. Ordinary HTTP files start as `needs_validation`, not ready. The
observer's pure assessment never authorizes takeover; only the checked ticket
and explicit coordinator acceptance can do so. This phase has no automatic
takeover, content-script file detection or inline IDM-style generic-file prompt.

## Verification

Local tests cover policy, metadata redaction, bootstrap events, deduplication,
worker/session restore, expiry/limits, permission denial/revocation, clearing
during hydration, stale writes, sender isolation, opt-in registry lifecycle,
UI activation, safe text rendering and old Download Manager operations.
Additional tests cover byte-exact parallel files, invalid range/validator changes,
collision safety, failed preflight without Chrome mutation, explicit acceptance,
disconnect/restart, persistence failure before cancellation and stable UI controls.
A full local test connects the coordinator to the real framed Helper and a local
HTTP server; Chrome APIs are mocked. This is not a live installed-Chrome test.
The initial observation UI was inspected in a disposable localhost fixture; this is not proof
of permission prompts or MV3 wake delivery in the user's installed Chrome.
Additional regression test/fixture files remain local per publishing preference.

Next gate: user testing in installed Chrome, including default-off behavior,
source check/confirmation, Return to Chrome, interrupted Helper, permission
revocation and browser-only sources. Expand source support only with explicit
evidence and recovery tests; do not weaken validation to advertise more files.
