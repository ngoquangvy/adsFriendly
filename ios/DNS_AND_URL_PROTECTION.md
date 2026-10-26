# iOS 1.3.0: distinct site policies and individual area recovery

## Restore the Block baseline (1.3.0)

The ba63595 iOS detector automatically removed discovered banner candidates in
Block, including unknown outbound image banners, text/CSS slots, large closeable
overlays and invisible click catchers. Later refactors narrowed this to a
media/known-signal subset and capped positioned scanning at 1500 nodes. The 1.2.x
patches restored individual patterns, not the original general policy coverage.

1.3.0 separates policy from candidate discovery and from review budgets:

- Allow bypasses DOM/banner intervention on the website.
- Default retains known-ad filtering and corroborated close/ad evidence, while
  uncertain candidates use the quiet review UI.
- Block automatically removes discovered banner-like external links, explicit
  slots, closeable large overlays and pointer-catching invisible layers. An
  external image can be a false positive by design in Block; Keep or Default is
  the correction. Protected navigation, forms, page shells, player controls and
  saved Keep exceptions remain protected in every policy.

The full DOM is scanned in coalesced slices (up to 120 nodes / 8ms per slice,
yielding 16ms between slices), not permanently truncated at 1500. Newly inserted
or replaced nodes trigger a later sweep. A finite scan completes before a
coalesced retry, avoiding restarting at the head on each mutation. Automatic
slots/positioned hints also receive a short priority pass, so an obvious overlay
at the DOM tail need not wait for the full sweep. Ordinary non-banner navigation
links are rejected before expensive feature/sibling extraction. The long-page
browser fixture is additionally exercised with 4x CPU throttling in CI. Asynchronous
assertions wait for the required DOM condition with a finite deadline and scan
diagnostics, rather than assuming that every machine finishes in 450ms. Automatic
metadata is re-evaluated when policy, layout, evidence or site styles change.
Ad-owner selection includes the backdrop and close controls where supported by
the same evidence, not only the nested image. No page close/toggle button is
programmatically clicked. The review popup budget never limits automatic hides.

Safari popup > Review individual areas exposes up to 20 current regions:
Show once is document-local; Keep writes the existing root-compatible,
layout-scoped exception; Hide again writes the reverse decision. Saved Keep
targets can be reviewed again after reload. Labels contain bounded element/host
identities and dimensions, not URL queries or copied HTML. All UI labels are text.
Opaque document-scoped tokens reject stale/replaced targets; only extension pages
may request actions and the background validates the current tab hostname.
Storage errors remain errors, with Show once available as a separate recovery.
More regions appear as the first set is reviewed. No unsolicited popup train or
new permission is added. The all-page Show/Hide control remains temporary.

Validation includes three-policy unit tests; browser fixtures for the DOM/link
tail, text/CSS ads, transparent traps, passive layers, protected forms/navigation,
owner restoration, Keep across fresh documents, reversal, stale tokens, quota
failure, XSS-resistant labels and 320–768px review controls. Native XCTest also
loads the packaged JS in WKWebView using a simulated request (no live network),
checks a 2600-node fixture, and verifies Block -> Default -> Allow. This validates
WebKit but is not a claim of complete coverage on every live Safari website.

## Late overlay owner regression (1.2.2)

The user's 1.2.1 screenshot confirms Block, active URL filtering and connected
page protection, with 13 hidden areas but a surviving 3Bet creative. A nonzero
hidden-element count does not prove that every advertising surface was removed.

Live DOM inspection found the publisher's `_preload-ads-1` fixed full-viewport
ad owner at node 2572 of 2586, beyond the positioned-element scan's first-1500
budget. Existing URL cosmetic rules matched its creative but not the backdrop
and close-control owner. The targeted candidate query also lacked ad tokens
in the middle of IDs such as `_preload-ads-1`.

The publisher profile now targets its verified `div[id^="_preload-ads-"]`
owners, and the generic targeted query discovers middle/suffix ad ID tokens
without an unbounded computed-style sweep of every page element. Discovery
alone still does not authorize automatic hiding; protection, policy, content,
form-safety and remembered Keep checks remain in place.

A sanitized browser regression first failed on 1.2.1 with the owner's display
still `flex`, then passed with the complete owner hidden beyond 2600 filler
nodes. Checks cover replacement insertion, display rewrites, Show/Hide, Default,
Block, Allow, nested Keep and a real sign-in dialog. This reproduces the verified
overlay hole, not the exact rotating 3Bet creative on the physical iPhone;
that variant remains a required device acceptance check.

## Banner coverage regression (1.2.1)

Inspected https://animevietsub.sale/ on 2026-10-17. Its inline header grid
uses `header-ads-pc` / `Adv ad-center-header`; the floating placement uses
`pc_catfix_adv`. Creatives use a shared Googleusercontent image CDN and
outbound hosts outside the starter network list. Candidate discovery missed
several of these class tokens; the former 0.9 score plus mandatory external
link excluded otherwise explicit image grids and iframe-only ad slots.

Block now discovers complete ad/ads/adv slot tokens and removes small,
explicit media slots supported by outbound-link or iframe evidence. It does
not hide an external image merely for being external or called "banner".
Dismissed reviews cannot override a later Block choice. Ancestor wrappers
respect Keep on a descendant, while sibling ads can still be hidden.
Narrow publisher-scoped cosmetic rules cover the observed header, sidebar,
catfish and popup campaign links. The CDN itself is never globally blocked.
These are placement rules, not a promise of complete or permanent site coverage.

Automatic blocking stays quiet. A manual Hide offers a compact Show action
that saves the existing Keep exception. Safari's toolbar popup additionally
offers Hide/Show banners for the current top-frame document; this is a
temporary DOM override, resets on navigation/reload, does not change saved
choices and cannot restore resources already blocked by URL/DNS filtering.
No new tabs are opened. Hidden slot geometry is retained for reconciliation
so the website cannot undo a block by rewriting display styles.

Tests include a sanitized fixture of the observed placement structure with
unknown hosts, plus normal heroes/posters/navigation, nested Keep, iframe
slots, Default-to-Block after dismissal, style rewrites, manual Show recovery
and the toolbar controls. Real Safari/iPhone playback still requires device QA.

## Regression findings

The earlier mobile banner changes routed all detections into the review UI.
The two-prompt review budget therefore limited the opportunity to remove ads
on a Block site. Saved Hide rules were the only automatic DOM removal path.
Also, attaching an observer to document.documentElement at document_start
silently failed when HTML did not exist yet. Finally, a tracked element could
be made visible again by changing its inline display without being re-enforced.

The fix observes Document, separates automatic blocking from review, enforces
active display rules, and restores the site's newest display on disable/Allow.
High-confidence automatic heuristics run only in Block and use known ad
resources or explicit ad tokens corroborated by the shared desktop classifier.
Generic heroes/external images aren't blanket ad rules. Keep on a wrapper also
protects its descendants. Narrow builtin ad slots apply independently of review.

## Safari network layer

The Safari web extension now declares declarativeNetRequest and ships a
generated advertising ruleset: known ad hosts plus narrow pagead/gampad/adsystem
resource paths. It does not block main-frame navigation, login or video paths
just because the URL contains a marketing query parameter. This is a starter
list, not a complete maintained filter subscription.

The background enables/disables the ruleset with the existing protection switch,
updates source-frame Allow exceptions after settings/package changes, and keeps
its dynamic IDs separate. A more-specific Block overrides inherited blanket
Allow without prohibiting typed main-frame navigation. Verify this priority
behavior on physical Safari, including nested source frames.

The popup exposes ruleset state and a top-frame content-script probe. "Active"
means Safari reports the ruleset enabled, not that every ad has been blocked.
If a page is not connected, reload and check website access. Reload after
changing site policy or importing. Disabling Safari content blockers in Safari
can also prevent URL rules from operating. No fake blocked-request counters
are added.

## DNS first stage (no special signing entitlement)

The containing app creates a removable, unsigned .mobileconfig DNS-over-HTTPS
profile. It requires explicit consent, validates HTTPS endpoint syntax, and
exports through the native share sheet. The default is AdGuard public filtering
DNS; a custom provider endpoint may be supplied. The profile contains only the
DNS payload, no certificate, VPN, enrollment or device-management payload.
Stable identifiers support replacing an earlier AdsFriendly profile.

Install manually from Mail/Files in iOS Settings. If Files does not offer the
installation flow on a device version, use Mail or the provider's Safari
download instructions. If installation is deferred too long, iOS can delete
the pending download; export/open it again. The app never reports profile
export as activation and cannot inspect an externally installed profile.

DNS blocks domain lookups, not HTTPS paths. It doesn't import Safari DOM rules,
Keep exceptions or the user's Chrome blocklist into a public resolver. Providers
may see DNS domains. Apps using custom DNS/direct IP, VPNs and Private Relay may
change coverage. The Safari toggle doesn't remove a DNS profile. Recovery:
Settings > General > VPN & Device Management > AdsFriendly DNS > Remove Profile.

Direct app-managed DNS with NEDNSSettingsManager requires appropriate signing
capabilities; it is deliberately not added as an entitlement that can break
ordinary Sideloadly installations. System-wide full-URL filtering on iOS 26 is
a separate future layer requiring Apple's URL Filter provider and PIR backend.

## Acceptance

Local gates: ios:check, ios:settings:check, test:ios, test:ios:browser.
CI additionally runs native simulator unit tests for profile payload/safety,
then builds the unsigned IPA and checks both DNS.js and URL-rules resources.

On a physical iPhone, verify:

1. Enable extension/site access after upgrading to 1.2; confirm URL filter
   active and Page protection connected in the Safari popup.
2. Known ad-host requests fail while normal login/playback still works.
3. Block removes confirmed banners without asking; Keep and Allow restore them.
4. A dynamic ad cannot unhide itself by rewriting style. Orientation remains safe.
5. General protection off disables URL rules and restores DOM changes.
6. Export/install the DNS profile, then inspect DNS behavior on Wi-Fi and cellular
   in a separate app. Export alone must not claim activation.
7. Remove the profile and confirm normal DNS returns. Test a second resolver,
   VPN interactions, cancellation and malformed endpoint inputs.

References:
- https://developer.apple.com/documentation/safariservices/blocking-content-with-your-safari-web-extension
- https://developer.apple.com/documentation/networkextension/dns-settings
- https://developer.apple.com/documentation/devicemanagement/dnssettings
- https://support.apple.com/102400
- https://adguard-dns.io/en/public-dns.html
