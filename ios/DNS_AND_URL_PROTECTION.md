# iOS 1.2: Safari URL blocking and DNS v1

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
