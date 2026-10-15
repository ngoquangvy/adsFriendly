# Browser download intake — observation checkpoint

This is not automatic interception. Chrome continues to own every download:
the observer never calls cancel, pause, resume, download, erase or removeFile.
It does not probe sources or send work to the Helper.

## Enable and test

Reload the Chrome extension, open Settings > Downloads > Browser downloads,
and enable **Observe new browser downloads**. Chrome requests the optional
`downloads` permission in this user activation. Download a normal HTTP(S) file
using Chrome; its observation should appear independently of the media job list.
Old Chrome download history is not scanned. No Helper reinstall is needed.

The UI shows filename, destination host, total size when Chrome reports it,
browser state and a reason the source is not yet eligible for handoff.
**Clear observations** removes only the feature's metadata, never Chrome
history, in-progress transfers or downloaded files. Turning observation off
removes its listeners and stored metadata; the granted browser permission is
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
- `src/background/downloads/intake-messages.js`: GET/CLEAR endpoints, restricted
  to this extension's exact Settings page. A content script sharing the extension
  ID does not satisfy the sender URL check.
- `src/options/downloads/intake-panel.js`: presentation and activation-time
  permission request. Updates do not trigger media Helper probes or hidden-page
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
extension-originated downloads are excluded. No source URL is sent to the Helper.

The Settings Package may carry the feature override, but cannot grant Chrome
permissions and does not contain session observations. Importing an enabled
override without Downloads permission yields `permission_required`; permission
is never requested from background code.

## Why HTTP sources still need validation

Chrome DownloadItem does not expose the request method or prove a URL can be
replayed outside its browser session. An HTTP URL and a file size do not prove
GET, token reuse or Helper access. Danger/paused/terminal/non-HTTP sources stay
browser-only. Ordinary HTTP files are labelled `needs_validation`, not ready.

## Verification

Local tests cover policy, metadata redaction, bootstrap events, deduplication,
worker/session restore, expiry/limits, permission denial/revocation, clearing
during hydration, stale writes, sender isolation, opt-in registry lifecycle,
UI activation, safe text rendering and old Download Manager operations.
The UI was also inspected in a disposable localhost fixture; this is not proof
of permission prompts or MV3 wake delivery in the user's installed Chrome.
Additional regression test/fixture files remain local per publishing preference.

Next: generic-file execution on the neutral HTTP core, then a coordinator with
explicit acceptance/failure recovery. No Chrome download should be cancelled
merely because its URL was observed or the Helper handshake succeeded.
