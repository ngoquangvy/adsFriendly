# Player download completion and recent downloads

The on-player popup uses the same download controls as the extension popup.
Completion does not open files automatically or introduce notifications.

## Boundaries

- `media/download-identity.js`: pure, versioned asset/selection identity and a
  minimal job presentation. Titles, byte counts and page proximity never prove
  two assets are identical.
- `background/recent-downloads.js`: duplicate policy, bounded stat cache and a
  per-request start lock. All new download requests use this service, not only
  requests originating from the player overlay.
- `background/media-download-jobs.js`: registered `media.download.lookup`
  action, catalog validation, duplicate gate, then the existing acquisition path.
- `media/ui/download-history.js`: presentation only; explicit Open, Folder,
  Download again and View download actions.
- `content/player-download.js`: source-scoped overlay/context polling. Source,
  selection revision and request sequence prevent stale asynchronous results
  from attaching completion actions to a different player/video.
- Media Helper `output.stat`: checks an individual stored output path; no scans,
  media reads or checksum pass. Real paths must remain below Downloads, including
  junction/symlink resolution. File actions retain their own path checks.

## Identity and retention

`download-identity.v1` persists only SHA-256 asset/selection/request identifiers.
Known provider IDs can survive authorization URL rotation; unknown sources retain
their URL semantics conservatively. Output format, explicit resolution, codec,
audio language/role/bitrate distinguish selections. Auto selection remains
distinct from explicit selection because the resolver may choose a different
available rendition. Summaries say **Auto quality**, not an unverified final
resolution.

The existing download history limit remains 100 entries. Completed matches are
considered recent for seven days; active matches are considered regardless of
age. Removing download history also removes its duplicate evidence. No new
training records are created, and these records are not added to Settings
Packages. Persistent rows contain no candidate or authorization URL/key/token.

Existing history without identity is not guessed from its title. Older **session**
jobs can be matched only when their candidate/output facts are still available.

## Interaction and compatibility

The compact launcher straddles the player's top edge: 70% outside, 30% inside.
`media/player-download-position.js` computes placement from the measured launcher
height, independently of the expanded panel. At the top viewport boundary the
launcher is kept at least 8px inside the screen so it remains clickable.

On appearance/reappearance the launcher stays fully visible for three seconds,
then fades to 40% opacity. Hover, keyboard-visible focus and an open options panel
keep it fully visible. `ui/player-download-attention.js` owns the transient
visibility deadline; continuous scroll/progress updates do not restart it.
Hidden/removed overlays cancel the timer. Reduced-motion users have no fade
animation; this behavior writes no preferences or training data.

- Completed: `Completed` plus size/selection and Open, Folder, Download again.
  The compact badge also offers Open; no finished speed/progress/Started state.
- Matching active selection: View download instead of creating a second job.
- Another quality/audio/container: remains independently downloadable; a recent
  result can be shown below the options without blocking the new selection.
- Explicit Download again passes `repeatOf` for the matching completed job. It
  never bypasses an active match and uses normal non-overwriting output naming.
- Missing or size-changed file: no Open/Folder; Download is allowed normally.
- Helper without `output.stat`: shows **file not checked**, not a false missing
  claim. Protocol 12 remains compatible; Helper 0.24.2 adds the stat capability.

The overlay polls metadata on the existing two-second interval; polling never
performs a native stat. A stat is requested on popup open, first completion,
selection changes and the actual duplicate-start check. Passive results may use
a 60-second cache (maximum 128 entries); starts always recheck. Equal file size
does not prove equal file contents; checks are deliberately lightweight.

## Verification

The local development test suite includes identity, service, presenter and framed
`output.stat` regression checks. These additional tests and browser fixtures are
not included in this product milestone; committed CI keeps its existing suite.
Existing Helper checks cover Direct/HLS/AES-128/DASH/adaptive/capture. Local browser fixture:
`tests/player-download-browser.html` (serve local modules and icon). It mocks
native actions; it does not validate the installed Chrome extension or open a
real downloaded video.
