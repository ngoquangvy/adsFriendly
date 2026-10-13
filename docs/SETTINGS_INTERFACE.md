# Settings interface

Chrome Settings has six registered pages: Protection, Sites & Rules, Settings
Package, Downloads, Activity and Advanced. This is a presentation change; no
protection policy, download adapter or package/training schema is changed.

## Ownership

- `src/options/section-catalog.js`: page IDs, names, descriptions and old-link
  aliases. Add a navigation entry here, its static panel in `options.html` and
  its renderer in the Settings controller.
- `src/options/section-navigation.js`: navigation, panel visibility, Back/Forward,
  mobile selector and a session-only last-page preference. No Chrome business IO.
- `src/options/list-filters.js`: search and status filtering of existing rows;
  filtering never changes the original delete index, job ID or expanded state.
- `src/options/index.js`: existing save/import/export/rule/download/diagnostic
  actions, page rendering and subscriptions.
- `options/settings-shell.css`: responsive shell and shared presentation.

Exactly one page is visible. Desktop uses a sticky sidebar; narrow screens use
a labelled section selector. Native anchors support history and keyboard access.
The skip link focuses the main content without changing the current page.

## Compatibility and lifecycle

`#downloads` is unchanged. `?site=example.com#element-decisions` still opens Sites
& Rules and expands that site's personal decisions. Unknown routes fall back to
Protection. Explicit URL routes override the remembered page. Remembering the
page uses `sessionStorage`, not shareable settings or training data.

Opening a page refreshes its data. Hidden Downloads does not react to job-change
events with Helper probes or DOM updates; entering Downloads reads fresh state.
Acquisition continues in background, independently of this page. Unchanged job
action nodes are retained through progress updates to avoid losing user focus.
Active jobs are ordered before finished history. Search/filtering affects only
the displayed rows; Clear history continues to have its original confirmed scope.

Advanced defers IndexedDB and navigation trace reads until their disclosure is
opened. Training and telemetry remain separate from Settings Packages. Reset
and other destructive operations retain confirmation and explicitly state their
scope. Feedback is never sent automatically.

## Verification

The additional regression tests and browser fixtures below are retained in the
local development checkout; they are not included in this product milestone.
The committed CI scripts continue to use the existing repository test suite.

`tests/settings-navigation.test.js` covers the registry, aliases, unique controls,
visibility, lifecycle and non-destructive row filtering. `tests/settings-ui.test.js`
runs the real controller with disposable DOM/Chrome mocks to check saving,
filtered delete targets, active-only reads and stable download action nodes.

For browser/layout QA, run `npm run build`, then
`node scripts/preview-settings.mjs`. Open the printed loopback URL. It serves the
actual HTML/CSS/bundle with in-memory Chrome fixtures; it does not access installed
extension data, invoke native outputs or send feedback. It is not proof of a
live Chrome extension session. Stop the preview with Ctrl+C.
