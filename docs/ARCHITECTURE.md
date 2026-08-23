# AdsFriendly Extension Architecture

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
- `src/shared/`: small cross-context helpers and constants.
- `server/`: local telemetry intake server, JSONL storage, and dataset inspection dashboard.

## Data Principle

Runtime rules and AI training samples must stay separate:

- `globalAdPatterns` is a fast rule cache for live decisions.
- Dataset samples should be append-only evidence records with labels, source of label, action, and outcome.
- User feedback is strong label data; heuristic detections are weak labels.
- Telemetry upload should stay opt-in. Sanitize URLs and identifiers before sending samples to `server/`.

## Known Follow-up

`src/picker/index.js` still preserves the old picker implementation as a single module to avoid behavior loss during the first architecture migration. It should be the next file split into UI state, selector generation, validation, fingerprinting, and manual labeling modules.

## MainController, Feature Registry, and Capabilities

`src/runtime/feature-catalog.js` is the only authority allowed to declare:

- feature IDs and their execution contexts;
- registered capability IDs;
- capabilities granted by `safe`, `assist`, and `auto` modes;
- capabilities each feature is allowed to request.

Each execution context has a small implementation list in its entrypoint and is
bootstrapped by the shared `MainController`. Feature modules do not read
`friendlyMode` or `isEnabled` directly. The controller loads `appSettings`,
starts and stops registered features, and supplies a scoped policy object.

Unknown features, unknown capabilities, missing implementations, and capability
calls not declared for the calling feature are hard runtime errors. Adding a
feature or capability therefore requires an explicit catalog entry before it can
run.

Protection modes are capability bundles rather than feature-specific booleans:

- `safe`: verified static rules and manual controls;
- `assist`: observation and user-confirmed suggestions;
- `auto`: registered automatic actions and learned-pattern execution.

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
