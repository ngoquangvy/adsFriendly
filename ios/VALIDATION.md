# iOS protection validation

## Build gate

Run `pnpm ios:check`, `pnpm ios:settings:check`, `pnpm test:ios`, and
`pnpm test:ios:browser`. The browser smoke test uses an isolated headless Chrome
profile and a local fixture, not real Safari extension APIs. GitHub's Build iOS
workflow runs these gates before Xcode and checks the packaged resources.

The iOS bundle imports the root Settings Package schema, navigation classifier,
DOM selector/identity helpers and responsive-layout logic. Regenerate it with
`pnpm ios:build` after changing those sources. Do not edit `utils/shared.js`.

## Quiet banner review policy

The single-row banner card says **Marked area? / Hide / Keep / ×**, uses 44px
touch targets, and dismisses after 8 seconds. A document gets at most two
automatic banner prompts, spaced at least 60 seconds apart. Banner reviews do
not queue behind other reviews. This budget does not limit blocked-navigation
notifications or the application of saved Hide/Keep rules.

Review history survives attribute mutations, storage updates, Safari toolbar
resize, nested creative scans and replacement of the same identifiable ad slot.
Dismissal/timeout is document-local and does not save a Keep exception; reloading
starts a new review budget. Use Keep to remember a choice across visits.

The browser gate checks 320, 375, 390, 768 and 980px viewports, single-row height,
touch targets, active-card stability, mutation/resize/replacement deduplication,
automatic dismissal, prompt flood limits and saved banner decisions. Physical
Safari acceptance is still required.

## Actionable target and storage checks

Chrome and iOS use the same visible-content guard and isolated blue target
marker. Reviews require on-screen content, not just an ad-shaped DIV. Empty
slots, broken images, hidden ancestors and off-screen targets are skipped.
Inline-link markers include the image they contain. The marker never changes
site outlines or scroll position. Content/resource changes, detachment or a
blocker hiding the target cancel the pending review; actions revalidate before
sending any decision. A cross-origin iframe's internal rendering cannot be
verified by this guard, so iframe URL/geometry checks remain best-effort.

Storage verification compares JSON values independently of object key order.
Verification and transport failures must not be labelled as a full quota.
Chrome's Hide applies locally before saving; Show still restores an unconfirmed
local Hide if quota/storage writes fail. iOS saves first and reports a failed
save without claiming to hide. Learning sync is best-effort after a verified
Chrome save, not another settings-saving step.

## Device acceptance (required before claiming release quality)

1. Download the **AdsFriendly-iOS** artifact from the workflow for the exact
   commit and sign/install its IPA with Sideloadly. Enable Safari extension
   website access. Existing pages should be reloaded.
2. Open a normal page, login/OAuth link and payment link. Normal visible exact
   clicks must work; synthetic or advertising links must not borrow that intent.
3. Reproduce `about:blank → same-host intermediate → ad destination`, direct
   `window.open`, target-blank links, and a popup initiated by an iframe.
   Web-created suspicious destinations are neutralized and reviewed with a small
   toast. The background fallback cannot guarantee cancellation before a network
   request starts. Safari versions and website permissions affect event coverage.
4. Choose **Block**. Retry and confirm **Blocked host / Open once**. Open once
   must open one requested HTTP(S) page and keep the Block list unchanged.
   Choosing Allow/Block does not automatically reopen previously blocked tabs.
5. Check the suspected-banner **Hide / Keep** prompt. Hide and reload to verify
   persistence. Keep must create a root-compatible identity exception. Test a
   reused ad slot with a different link/resource identity.
6. Test portrait, landscape and Request Desktop Website. Layout is determined by
   the document viewport (compact ≤767px), not device screen width. Wide/compact
   rules stay independent. Toggling protection or removing a rule restores the
   original display style.
7. Export a package on desktop and save it to iPhone Files. Open the extension's
   Import Settings Package page, inspect the counts, import and reload. Verify
   Allow/Block, Hide rules, Keep exceptions and manual trusted paths.
8. Undo the import: prior choices return; counters and diagnostics remain.
   Try malformed, unsupported and >2 MB JSON files; none may alter settings.
9. In import page diagnostics, inspect injection_ready/unavailable and tab-guard
   reasons. These events store hosts, not full URLs. An unavailable injection
   handshake must not claim success; the tab guard is the fallback.

Safari iframe fallback matching for about:blank depends on browser support.
Direct injection can be denied by site CSP; diagnostics report this limitation.
Desktop-only media/video settings are preserved in imported packages. iOS 1.4.0
adds an independent native direct-file downloader, not the desktop Helper or
YouTube/HLS resolver. See [media composition and acceptance](MEDIA_DOWNLOADS.md).
The separate 1.5.0 YouTube test edition is documented in
[two-build isolation and acceptance](YOUTUBE_TEST_EDITION.md); basic builds keep
the direct-file boundary.
The 1.5.1 bundled DNS profile/browser handoff and actual enable/disable limits
are covered in [DNS profile validation](DNS_PROFILE_HANDOFF.md).
Export/import transfers the shared package explicitly, without background sync.
