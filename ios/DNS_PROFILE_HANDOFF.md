# iOS 1.5.1: bundled DNS profile and browser handoff

The default AdGuard DNS-over-HTTPS profile is generated at build time, included
in the containing app, and checked against the native profile builder before use.
The same profile/payload identifiers as previous AdsFriendly exports are kept,
so a changed endpoint can replace the earlier configuration.

## User flow

Consent → Install default DNS → the default browser receives the profile →
allow the download/open the downloaded profile if necessary → Settings →
Profile Downloaded → Install. Safari is recommended for configuration profiles.
No email round trip or website owned by the app is needed for the default path.

The app cannot inspect or switch externally installed profiles. The
"Enable/disable DNS in Settings" disclosure gives the real system path rather
than showing an app switch with a guessed state. Creating, delivering or
exporting a profile is never presented as DNS activation.

To change servers, open the custom DNS section, enter a DoH endpoint and choose
Install/update custom DNS. The validated endpoint is remembered as an app draft,
not as proof the system uses it. The new profile still needs manual installation.
File export and the official provider guide remain fallback paths if browser
handoff is blocked or unavailable on the device/browser version.

AdGuard public DNS manages its own filtering list. A domain added to a Safari
list/package does not become a system DNS rule. Custom domain control needs a
private resolver/account with its own dashboard/API. Editing that server-side
list normally keeps the same endpoint/profile; DNS caches may delay results.
Changing the endpoint encoded in a profile requires reinstalling the profile.

## Native delivery boundary

`DNSProfileDelivery` is an independent Network.framework helper:

- Binds explicitly to IPv4 loopback and the loopback interface, with a random
  port and unguessable per-handoff path; no LAN or Bonjour advertisement.
- Starts only after an explicit consented install action and stops after at
  most 25 seconds (or the OS background-task expiration).
- Serves only the supplied <=64 KiB profile; does not read arbitrary files.
- Accepts the exact route/Host and GET/HEAD only, bounds header reads to 8 KiB
  and each connection to five seconds, caps connections and profile GETs.
- Allows up to three matching GETs within the window: a browser may inspect
  MIME, ask for consent and retry. HEAD does not consume a profile response.
- Uses the configuration-profile MIME, byte length, attachment disposition and
  no-store headers. A successful socket handoff is not installation.
- Does not log paths, profile bytes or custom endpoints. URL tokens expire;
  the handoff is local to the device and uses no remote hosting service.

The view controller requests a short standard background task while opening
the default browser, releases it on all completion/failure paths, and guards
against stale callbacks from older handoffs. No Network Extension entitlement,
private Settings URL or programmatic MDM enrollment is added.

## Validation and device limits

Native tests compare the bundled plist with the safe builder, verify stable
replacement identity, exercise real loopback HTTP bytes/MIME, bounded retries,
invalid routes/Host/methods and timeout completion. No test installs a profile
or changes the simulator's DNS. JavaScript/browser tests cover consent,
default/custom separation, draft handling, duplicate clicks and narrow layouts.
Both app editions and the protection-only composition must build.

Physical iPhone acceptance is still required: Safari's configuration-profile
download prompt, opening the downloaded item, Settings installation, actual
DNS selection, switching to Automatic, custom replacement and profile removal.
If browser security settings block local HTTP/profile delivery, use file export
or the official provider's HTTPS setup page; do not report activation.
