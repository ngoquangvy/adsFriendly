# Navigation attribution and enforcement

The Chrome navigation pipeline separates observations, attribution, classification,
and execution. A click near a tab creation is correlation, not proof of an opener.
No detector may turn that fact alone into closing a tab or replacing its page.

## Ownership

- `content/intent-tracker.js`: observes real website gestures; ignores UI hosts
  marked `data-adsfriendly-ui`, including closed shadow-root hosts.
- `background/attribution.js`: bounded, volatile `navigation-context.v1` snapshots.
  One context owns its source, frame, captured intent, evidence, ID, TTL and revision.
  Late strong evidence upgrades the context; weaker events cannot downgrade it.
- `background/managed-tabs.js`: registers before `tabs.create`, then binds the
  action to the actual returned tab. Potential matches defer attribution until
  creation settles. Matching URLs in unrelated tabs never inherit the receipt.
- `background/policy.js`: reads rules/trust and classifies the destination plus
  the captured intent. It has no tab mutation or UI responsibilities.
- `background/enforcement-policy.js`: shared action ceiling for both sequences.
- `background/navigation-sequences.js`: plans which tab survives and receives
  feedback. The notifier cannot be the tab selected for removal.
- `background/guard.js`: correlates Chrome events and executes current plans.
- `background/user-navigation.js`: a 10-second, at-most-five-hop user redirect
  chain. It only carries across matching host families, or Google Search changing
  hostname without changing the query, and requires redirect transition metadata.

These are helpers owned by the existing registered navigation features, not new
unregistered features. Capabilities remain declared in `runtime/feature-catalog.js`.
The helper app and media download backend are not needed for ad protection.

## Confidence is not an ad label

| Evidence                                               | Source attribution | Maximum action without additional proof                   |
| ------------------------------------------------------ | ------------------ | --------------------------------------------------------- |
| Recent click only                                      | unconfirmed        | Observe; optional non-destructive review with ad evidence |
| `openerTabId` only                                     | probable           | Same ceiling; opener does not prove user intent           |
| `onCreatedNavigationTarget` source/frame               | confirmed          | Existing destination/rule policy                          |
| Observed same-page clone plus original-source redirect | confirmed sequence | Shared reverse-popunder policy                            |
| Registered extension-created tab                       | owned action       | No ad enforcement for that bound destination              |
| Explicit address-bar/history/search navigation         | user owned         | Cancel prior ad decision; bounded redirects only          |

Intent association is recorded separately: `matched_link`, `frame_temporal`,
`temporal_only`, or `none`. An unrelated prior ad click cannot contaminate a
confirmed source's ordinary destination. Frame-only overlay evidence may prompt
review but cannot force a blocking page without independent destination evidence.

## Required implementation rules

1. Background code opens tabs through `openExtensionManagedTab`. Popup/content
   UIs request an existing capability-gated background action instead of calling
   `tabs.create` themselves. The receipt is tab-and-destination-scoped, not a
   website whitelist. Existing `openOptionsPage` still uses Chrome's own UI API.
2. Source evidence is captured when a navigation is linked. Never re-read a global
   latest click to decide a pending navigation.
3. Both sequences pass through the shared policy/action ceiling. New sequences
   must register an enforcement plan before any destructive action.
4. Async results check context ID/revision, guard lifetime and live destination
   before enforcement. Address-bar navigation, removed tabs and feature shutdown
   invalidate stale work. Losing delivery of a weak review toast does not permit
   escalation to a blocking page.
5. Unconfirmed-source review feedback must not create a source-to-target trusted
   workflow. Keep/Block still refers to the actual reviewed destination.
6. Keep bounded state: attribution has at most 256 contexts/intents; managed tab
   actions/receipts at most 32; context TTL 10 seconds, intent TTL 2.5 seconds,
   managed receipt TTL 5 seconds. Expired entries are removed on access and mode
   shutdown clears state. No new polling, network request or browser permission.

## Diagnostics and future training

Trace exports carry version, navigation ID, source frame, revision, origin,
attribution evidence and intent association. URLs in trace are reduced to hosts.
`navigationAttributionFacts` / `normalizeNavigationAttributionFacts` are the only
allowlist projection; never serialize a raw context or intent into trace/datasets.

Heuristic block samples remain weak `policy_inference_not_user_label` evidence.
Keep/Block feedback carries the attribution metadata alongside its explicit user
label. A heuristic decision is not training ground truth. Existing records are
not retroactively marked confirmed. Training/telemetry remain outside Settings
Packages and retain the existing physical IndexedDB separation.

## Verification

Run `npm run test:unit`, then **`npm run build`** (check-only does not update the
extension bundles). Attribution unit/integration tests cover event ordering,
early managed creation, competing same-URL tabs, immutable click snapshots,
cross-frame identity, late evidence upgrades, user navigation, reverse-popunder
survivor notification and metadata redaction. Mock Chrome tests do not substitute
for user testing in an installed extension.
