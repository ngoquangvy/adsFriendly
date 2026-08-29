# AdsFriendly Extension Architecture

## Ecosystem Products and Components

AdsFriendly is one ecosystem with independently installable components:

- `ad-protection` is the browser protection product. It requires only the
  extension and must keep navigation, DOM, rules, learning, and future video-ad
  protection working when the media helper is absent or broken.
- `media-tools` provides media discovery and user-initiated downloads. Discovery
  remains in the extension, while every actual download is executed by the
  optional `media-helper` Node.js/TypeScript component with FFmpeg-backed output.
- Media observation and normalized timelines form a browser-resident shared
  core. Downloader jobs consume that core without becoming ad labels. Future
  video-ad classification can consume the same core without acquiring a helper
  dependency.

`src/runtime/ecosystem-catalog.js` registers product/component relationships.
Capability ownership and component requirements are declared centrally in
`src/runtime/feature-catalog.js`. `media.download` owns browser UI and job
requests; `media.native_download` owns every execution path and requires both
the optional `nativeMessaging` permission and `media-helper`. No protection
capability may require `media-helper`.

The helper lives in `packages/media-helper/` and is released separately from the
extension. Installing or updating the extension must never install, launch, or
require the helper without an explicit media-tools action from the user. The
`nativeMessaging` permission is optional and requested only from that action, so
ad-protection-only users do not receive its permission warning.

## Source vs Runtime Bundles

Development source lives in `src/`. The root runtime files are generated bundles used by the Chrome extension manifest:

- `background.js` <- `src/background/index.js`
- `content.js` <- `src/content/index.js`
- `picker.js` <- `src/picker/index.js`
- `video_surgeon.js` <- `src/video/index.js`
- `injected_spy.js` <- `src/main-world/index.js`

Run `pnpm build` before packaging or loading the extension.

## Module Boundaries

- `src/background/`: extension service worker responsibilities: messages, navigation guard, reputation, trusted paths, learning stores.
- `src/content/`: page-side observation and DOM actions: spy injection, user intent, YouTube UI cleanup, in-page ad prediction.
- `src/main-world/`: code injected into the page context: fetch/XHR capture, manifest detection, timer control.
- `src/video/`: video-specific observation, scoring, playback actions, skip handling, and bridge messages.
- `src/dataset/`: label schema and sample builders for future AI training data. This is intentionally separate from runtime rule caches.
- `src/storage/`: physical persistence boundaries. Settings stay in Chrome local storage; training samples and telemetry queues live in IndexedDB.
- `src/shared/`: small cross-context helpers and constants.
- `packages/media-helper/`: optional Node.js/TypeScript Native Messaging host;
  it is not part of the extension bundle.
- `server/`: local telemetry intake server, JSONL storage, and dataset inspection dashboard.

## Data Principle

Runtime rules and AI training samples must stay separate:

- `globalAdPatterns` is a fast rule cache for live decisions.
- Dataset samples should be append-only evidence records with labels, source of label, action, and outcome.
- User feedback is strong label data; heuristic detections are weak labels.
- Telemetry upload should stay opt-in. Sanitize URLs and identifiers before sending samples to `server/`.
- Settings Packages are editable configuration snapshots. They contain protection settings, site lists, manual element rules, and trusted workflows, but never telemetry, history, counters, identifiers, or training samples.
- The separation is physical as well as logical: large training arrays cannot consume the settings bucket and prevent Hide, Magic Wand, whitelist, or blacklist writes.

DOM review decisions are also separated by intent. `userCustomRules` contains
elements the user chose to hide; `userElementExceptions` contains narrow,
fingerprinted `Not an ad` decisions. The latter suppresses a future suggestion
only when selector, responsive layout, and stable element identity still match.
Candidates without a bounded reusable selector are discarded before suggestion
or auto-hide; they are not converted into `Not an ad` rules because that would
turn an uncertain detector result into permanent configuration.
The Magic Wand keeps its large-area safety limit, but a unique fixed fullscreen
overlay may pass it when it has a high z-index, an explicit ad identity, and an
external ad link. The selected element and generated selector must always refer
to the same node.
The review outline is transient UI and appears only while its toast is hovered
or keyboard-focused. Explicit labels may produce separate training samples,
but removing a setting never depends on training storage.

## Navigation Protection Pipeline

New-tab ads and reverse pop-unders are two detectors, not two independent rule
systems. They both feed the same navigation policy, which owns URL
classification, whitelist/blacklist checks, trusted source-to-target workflows,
and the weak/medium/strong response level. New rules and user exceptions belong
in that shared policy and must not be duplicated in either detector.

Execution remains sequence-aware because the surviving tab differs:

- when the newly opened tab is blocked, keep and notify the original source tab;
- when the old tab is redirected and a same-page clone was opened, keep and
  notify the clone; if the clone cannot be kept, restore and notify the old tab.

Blocked-navigation actions and their aggregated toast are shared by both
sequences. A toast must never be sent to the tab selected for removal.
`navigation-sequences.js` is the required sequence registry and enforces this
invariant. A new sequence must be registered there and covered by its plan test
before the guard can execute it.

## Settings Packages

`packages/default-settings-package.json` is installed once for a new user. An
existing user's settings are never overwritten during extension upgrades.
Imported packages replace only the shareable configuration keys and preserve
diagnostics and datasets. Package contents are normalized through
`src/settings-package/schema.js` before being stored.

To publish a curated default, export the desired state from AdsFriendly
Settings, review the JSON, replace `packages/default-settings-package.json`,
then run the unit tests and build.

## Known Follow-up

`src/picker/index.js` still preserves the old picker implementation as a single module to avoid behavior loss during the first architecture migration. It should be the next file split into UI state, selector generation, validation, fingerprinting, and manual labeling modules.

## MainController, Feature Registry, and Capabilities

`src/runtime/feature-catalog.js` is the only authority allowed to declare:

- feature IDs and their execution contexts;
- registered capability IDs;
- the minimum mode, trigger type, disabled-state behavior, and browser
  permissions for each capability;
- capabilities each feature is allowed to request.

Each execution context has a small implementation list in its entrypoint and is
bootstrapped by the shared `MainController`. Feature modules do not read
`friendlyMode` or `isEnabled` directly. The controller loads `appSettings`,
starts and stops registered features, and supplies a scoped policy object.

Unknown features, unknown capabilities, missing implementations, and capability
calls not declared for the calling feature are hard runtime errors. Adding a
feature or capability therefore requires an explicit catalog entry before it can
run.

Protection modes are derived from capability metadata rather than maintained as
three separate lists. Adding a capability requires one metadata entry with a
`minMode` and `trigger`; `safe`, `assist`, and `auto` views are generated from
that entry:

- `safe`: verified static rules, untrusted new-tab verification, reverse pop-under protection, and manual controls;
- `assist`: observation and user-confirmed suggestions;
- `auto`: registered automatic actions and learned-pattern execution.

Side effects should pass through a context action broker. The broker maps a
registered action to its owning feature and capability, verifies the active
policy and any browser permissions, and only then invokes the implementation.
Pure parsers, scoring functions, and catalog transformations should not contain
mode checks.

Cross-module media and video-ad messages are declared in
`src/runtime/event-catalog.js`. Payloads are normalized by the content-neutral
contracts in `src/media/contracts.js`; downloader events and video-ad evidence
remain separate even when both reference the same media ID.

## Media Sessions and Timeline

`media.playback_observed` is the content-neutral boundary between browser media
observation and future video-ad reasoning. Each HTML media element receives an
ephemeral player session ID scoped to its document. A bounded session timeline
records playback state, media time, visibility, mute state, playback rate,
ready state, frame lineage, and the media IDs seen by that player.

Session timelines contain no source URL, signed query, token, cookie, media
bytes, or ad/content label. They live only in the versioned
`chrome.storage.session` Media Catalog snapshot and reset on navigation. The
observer coalesces continuous playback heartbeats and checkpoints them at a
bounded interval; state transitions are persisted immediately. The
downloader may use lineage to select the intended content asset. A future
video-ad classifier may consume the same timeline, but it must emit separate
`video_ad.*` evidence rather than mutating the media observation.

Legacy `friendlyMode` and `isEnabled` values are migrated once into:

```json
{
  "appSettings": {
    "enabled": true,
    "protectionMode": "safe",
    "featureOverrides": {}
  }
}
```
