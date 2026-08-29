# AdsFriendly Settings Packages

A Settings Package is a portable, editable snapshot of user-managed behavior.
It is separate from the built-in heuristic code and from training data.

An installed package is a starting point, not a locked policy. Users can keep
adding personal Hide, Magic Wand, Not an ad, whitelist, blacklist, and
trusted-workflow choices. Those changes are stored locally, appear in Settings
immediately, and are included the next time the user exports a package.

## Included

- General protection enabled state.
- Safe, Assist, or Auto mode and feature overrides.
- Whitelist and blacklist domains.
- Magic Wand and Hide element rules grouped by hostname.
- Fingerprinted Not an ad element exceptions grouped by hostname.
- Trusted navigation workflows.

## Excluded

- DOM or video training samples.
- Telemetry queues and client identifiers.
- Recent block history and counters.
- Feedback messages and timestamps.
- Runtime reputation caches and learned global heuristics.

## Storage Separation

Settings Packages and personal protection rules use `chrome.storage.local`.
DOM training samples and the telemetry upload queue use the extension's
IndexedDB database (`adsfriendly-training`). On upgrade, legacy training arrays
are migrated out of settings storage and then removed from that shared bucket.
This prevents a large dataset from blocking user actions such as Hide, Magic
Wand, Not an ad, whitelist, or blacklist.

## Bundled Default

The editable default lives at `packages/default-settings-package.json`. It is
installed only when AdsFriendly has not initialized a package and no meaningful
user configuration exists. Once initialized, upgrades do not reinstall deleted
rules or overwrite user changes.

To create a release default:

1. Configure AdsFriendly through the popup, Settings, Magic Wand, Hide, and Not
   an ad decisions.
2. Open Settings and export a package.
3. Review the domains, selectors, fingerprints, and trusted workflows.
4. Replace `packages/default-settings-package.json` with the reviewed export.
5. Run `npm run test:unit` and `npm run build`.

## Import Behavior

Importing replaces the shareable settings so the Settings page matches the
package. Local diagnostics and training samples remain intact. The import
preview reports hidden rule, Not an ad, site, list, and workflow counts before
confirmation.
