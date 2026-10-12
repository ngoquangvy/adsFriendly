# iOS protection validation

## Build gate

Run `pnpm ios:check`, `pnpm ios:settings:check`, `pnpm test:ios`, and
`pnpm test:ios:browser`. The browser smoke test uses an isolated headless Chrome
profile and a local fixture, not real Safari extension APIs. GitHub's Build iOS
workflow runs these gates before Xcode and checks the packaged resources.

The iOS bundle imports the root Settings Package schema, navigation classifier,
DOM selector/identity helpers and responsive-layout logic. Regenerate it with
`pnpm ios:build` after changing those sources. Do not edit `utils/shared.js`.

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
Desktop-only media/video features are preserved in imported settings but are
not implemented by this iOS app. This is not a background cloud-sync service;
export/import transfers the shared package explicitly.
