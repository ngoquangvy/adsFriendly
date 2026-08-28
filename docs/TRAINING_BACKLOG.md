# Training Backlog

This file records evidence that is useful to a future training pipeline but is
not a training label yet. Search for the stable marker `TRAINING_BACKLOG` before
changing training schemas or collection flows.

## TRAINING_BACKLOG: MEDIA_RESOLUTION_STRATEGY

Status: instrumented as session-only media metadata; dataset storage and user
feedback are intentionally deferred.

Some players return an encrypted HLS envelope for one form of a URL and a
parseable media playlist for a bounded mutation of that URL. The resolver now
attaches a structured `resolutionAttempt` to the successful probe:

- adapter ID and strategy;
- the query parameter name that was removed, never its value;
- content markers that caused the adapter to run.

This record stays in the per-tab media catalog in `chrome.storage.session`. It
must not be exported through Settings Packages and must not be copied into the
DOM training store merely because a probe succeeded.

### Proposed future dataset unit

Use a separate unit named `media_resolution`. A future sample may contain:

```json
{
  "unit": "media_resolution",
  "features": {
    "envelopeMarkers": ["enc_aesgcm", "ext_x_b65"],
    "queryKeyNames": ["d", "mode"]
  },
  "strategy": {
    "adapterId": "aesgcm-b65-query-mutation",
    "type": "remove_query_parameter",
    "removedQueryKey": "d"
  },
  "outcome": "resolved_valid_hls",
  "validation": {
    "playlistType": "media",
    "streamType": "vod",
    "durationMatch": null,
    "segmentCountBucket": "1000_plus"
  },
  "labelSource": "deterministic_validation",
  "labelStrength": "strong"
}
```

Do not store full URLs, query values, cookies, authorization data, request
headers, manifest bodies, segment URLs, or video bytes. Query key names also
need a denylist before export because site-specific keys can contain user data.

### Conditions before persistence

1. Add a dedicated versioned schema and IndexedDB store outside Settings
   Packages and outside the existing DOM-labelled store.
2. Validate that the result is a usable HLS playlist. Where the player timeline
   is observable, compare duration and playback identity; a parseable unrelated
   playlist is not automatically a positive label.
3. Add user correction such as `Correct video` / `Wrong video`. User feedback
   overrides deterministic inference and records its own label source.
4. Make collection/export opt-in, bounded, redactable, and independently
   clearable.
5. Add migration, privacy, negative-label, and false-positive tests before any
   sample is persisted.

The runtime safety boundary remains narrower than training: an adapter runs
only on exact envelope markers, tries at most three same-origin URLs, removes
one non-authentication query key per attempt, and accepts an attempt only when
the existing HLS validator reports usable media.

## TRAINING_BACKLOG: MEDIA_ACCESS_STRATEGY

Status: locally scored runtime preference; dataset export and model training
are intentionally deferred.

The Media Helper can try a bounded set of access strategies when an HLS key or
YouTube provider source is not available with the first request profile.
Examples include captured
Referer plus Origin, captured Referer alone, document/page Referer, and an
ephemeral key response already received by the browser, MWEB/Web PO profiles,
browser URL handoff, and an optional external provider adapter. The extension stores
only the resource hostname, registered strategy ID, success/failure counters,
score, outcome, and timestamps. A later download for that hostname tries the
higher-scoring registered strategy first.

This runtime memory is not a training label. It must never contain full URLs,
Referer/Origin values, User-Agent values, cookies, authorization data, key
URLs, key bytes, manifest bodies, or media bytes. Browser key responses remain
in page memory for a bounded time. A key-sized response held briefly to resolve
a response/manifest parsing race becomes eligible only when its exact URL is
subsequently declared by the parsed manifest. Key data is removed from
persisted download state, and temporary Helper key files are deleted on
success, failure, or cancel.

Before this signal becomes training data, add a separate versioned
`media_access_strategy` schema, opt-in export, host hashing/generalization,
minimum observation counts, negative examples, and user-visible deletion.
Do not infer that a strategy is universally correct from one host or one
successful request.
