# Bootstrap startup performance

Base: DEV399, `6b1ba51d7e7cda20060206c1b77159913c1cdcef`.
Branch: `codex/startup-performance`. No production deployment or main merge.

## Confirmed startup chain

1. HTML/CSS and parser-ordered scripts load. `api-client.js` publishes the client;
   categories/app and supporting UI modules initialize before `auth.js`.
2. Auth applies `qp-auth-checking`, inert/aria-hidden and the existing skeleton.
3. The client validates the locally stored bootstrap cache (session binding,
   version, user ownership and checksum), then requests `/bootstrap`, optionally
   with its revision. Cached incomes are not used as authenticated UI yet.
4. The function handler creates/reuses its store, payment router and app. The
   payment router does not authenticate unrelated `/bootstrap` requests.
5. YDB waits for `driver.ready(10000)`; the ready promise is reused on warm calls
   and reset after failure. This is a timeout, not a mandatory ten-second sleep.
6. Bootstrap reads session, user and revision and validates the bearer secret,
   expiry, revocation and active user before any income/category bundle read.
7. A full response reads incomes/categories/settings in a serializable snapshot.
   Onboarding and billing are derived on the server, and internal settings are
   filtered out of the public response.
8. The client checks session changes, validates cache-hit user/revision, or makes
   one full request on a cache mismatch; full data refreshes the local cache.
9. Auth checks its run ID, clears a previous owner's local data, hydrates incomes
   and categories and refreshes views. It starts pending-journal synchronization,
   removes `qp-auth-checking` only for the authenticated/current ready user, then
   waits for the journal separately. This order is unchanged.

## Optimization and security

* With no requested revision, a cache hit is impossible. Skip the AUTO_TX
  preflight and validate auth directly inside the full snapshot. Data reads still
  occur only after validation. Legacy revision initialization stays in that
  transaction and does not overwrite a concurrently initialized revision.
* With a stale revision, retain both preflight and in-transaction validation:
  removing the latter would race revocation or a revision/data mutation.
* Full responses reuse their settings snapshot for onboarding and billing rather
  than reading the same settings again. Other endpoints retain their prior reads.
* Cache hits read the three access flags in one scoped query after authentication.
  They remain fresh even when onboarding/payment updates do not bump data revision.
* Internal `auth.*`, `system.*`, `rate.*`, `billing.*` rows remain server-side.
  The response contract and billing calculations are unchanged. A failed combined
  access query fails bootstrap rather than returning partially resolved access.
* Retry delays and driver timeout are unchanged. RESOURCE_EXHAUSTED retries the
  entire bootstrap operation and revalidates. No optimistic income rendering.
* No HTML, CSS, skeleton, fonts, UI geometry, script order or defer changes. There
  is no measured evidence that changing parser order would safely fix these seconds.

## Measurements (synthetic, NOT production load times)

Reproduce from `backend`:

```sh
node scripts/benchmark-bootstrap.js 6b1ba51d7e7cda20060206c1b77159913c1cdcef
```

The script loads baseline code from Git and current code, injects a fake driver
with 25 ms per query/begin/commit and 60 ms initial ready delay, and checks that
public JSON payloads match. Only synthetic data is used; no network connection.
Five warm samples per scenario; Windows scheduling makes delays approximate.

| Scenario | RPC before → after | Warm mean before → after | Simulated first call before → after |
| --- | --- | --- | --- |
| No cache / first bootstrap | 8 → 4 | 253 → 126 ms | 326 → 188 ms |
| Stale cache | 8 → 5 | 253 → 158 ms | 316 → 219 ms |
| Cache hit | 4 → 2 | 125 → 63 ms | 189 → 127 ms |

Counts cover executeQuery/begin/commit in the normal path without manual billing
override; they exclude session-pool acquisition, SDK-internal work and retries.
The first path removes one auth/revision query and three setting queries. A stale
cache removes three setting queries; a hit replaces three setting queries by one.

The reported real-world 5–10 second startup was not reproduced or measured here.
Cloud instance scheduling, SDK/module initialization, metadata authentication,
YDB discovery/ready, network latency and resource exhaustion remain possible
contributors. The retry schedule alone can add 2.7 s plus jitter and retried work.
App timings cannot measure time before the handler starts; use Cloud Function
execution/init metrics and gateway timing to identify genuine platform cold starts.

## Safe diagnostic timings

Backend logging is opt-in: `QPOKOY_STARTUP_TIMINGS=1` in a future development
deployment. No environment or deployment was changed in this task.

* `qPokoy bootstrap timings`: `ready_ms`, `auth_ms`, `bundle_ms` when applicable,
  `access_ms`, `total_ms` for successful bootstrap responses.
* `bundle_ms` includes transaction begin/auth/data/commit, so it overlaps
  `auth_ms`; do not add the two. `total_ms` includes retry waits and pool work.
* `qPokoy bootstrap handler timing`: `handler_ms`, `first_store_request`. The
  boolean indicates first store initialization, not proof of a platform cold start.
  Handler timing is also recorded on errors; successful-stage timing is unavailable
  for aborted bootstrap calls, which must be correlated with existing error logs.
* Browser User Timing: `qp.bootstrap` (HTTP + cache processing, including failures)
  and `qp.hydration` (authenticated hydration through gate removal). Each replaces
  the previous measurement of that name. Unsupported diagnostics do not block UI.
* Static-resource loading, navigation and script execution can be inspected with
  browser Network/Performance tools. No new identifiers or payloads are recorded.

All new measurements contain only fixed labels, durations and the initialization
boolean; no token, email, user ID, income values or settings payloads.

## Verification and remaining limitations

* Backend baseline: 126/126. After changes: 141/141, including new first-load,
  cache-hit/miss, validation-before-data, internal-setting privacy, fresh access,
  YDB ready/query errors, revocation races and whole-operation retry checks.
* Frontend baseline: 111/112. After changes: 113/114. The same existing onboarding
  test fails: `temporary mobile test mode repeats completed accounts on fresh
  launch and login, not desktop` (`textContent` on null). No onboarding fix added.
* Existing cache/user-switch/session_changed, auth/journal and skeleton tests pass;
  added bootstrap/hydration diagnostic tests cover absent/broken timing APIs and no PII.
* Frontend syntax, CSS parsing/imports and HTML structure pass (19 JS, 20 CSS,
  7 HTML); changed backend files and benchmark pass syntax; diff whitespace passes.
* No production Cloud/YDB integration benchmark or live visual verification:
  production was not deployed. Validate real cold/warm timings in a development
  Cloud Function before deciding deployment policy or infrastructure changes.
* Local untracked Android build artifacts from the previous Android branch remain
  untouched and are excluded from this commit. Main and backup refs are unchanged.
