# qPokoy Android — first technical prototype

**Bundled frontend**, remote Yandex Cloud API, Android-only SQLite snapshots and create-only outbox.
Android: `ru.qpokoy.app`, `qPokoy`, `versionName=0.1.10-dev`, `versionCode=11`.

Android UI/storage adaptations live in this directory. The user has separately
deployed the existing opt-in idempotent POST /incomes contract. This change does not edit or deploy backend code.
The website, YDB schema, payments and deployment workflow are unchanged. The app starts at
`https://localhost/`, served by Capacitor from assets physically inside the APK.
Website deployments do not update an installed APK. Previously verified data can
be viewed offline; only creation of incomes can be durably queued offline.

## Build / Android Studio

Use Node 22+, JDK 21, Android SDK 36 / build-tools 36, and Android Studio
Otter 2025.2.1+ compatible with Capacitor 8.

```sh
cd android-app
npm ci
npm run sync
npm run open
# Or command-line build (Windows: gradlew.bat):
cd android
./gradlew assembleDebug
```

Configure `ANDROID_HOME`, `JAVA_HOME` and ignored `android/local.properties`.
APK: `android/app/build/outputs/apk/debug/app-debug.apk`.
Install: `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`.
No release key is created/committed. Gradle uses ordinary local debug signing;
debug APK is for Samsung testing, not RuStore publication.

## Updating the bundled frontend

APK 0.1.10-dev uses main DEV402, source
`6fe773d1ec56983889ef9878919d3d1dfc2f2648`. Recent mobile cards now share the
full-history layout, including description. Android pending status remains under
the date. Offline adapters are unchanged. To reproduce this source, use
`npm run bundle -- --source-ref 6fe773d1ec56983889ef9878919d3d1dfc2f2648`, then
`npx cap sync android` and the normal Gradle build.

After fetching the desired `origin/main`, run **`npm run sync`** in `android-app`.
It builds `www` and runs `cap sync android`. `scripts/bundle.cjs` reads committed
frontend assets using Git, follows HTML/CSS asset references, includes six app/legal
pages, and does not copy backend, tests, admin, secrets or the web manifest.
Generated `www` and Capacitor public assets are ignored, not manually maintained.
`www/bundle-info.json` records the exact source SHA; reproduction uses
`npm run bundle -- --source-ref <SHA>` followed by `npx cap sync android`.
It also records the frontend DEV derived from that commit using the existing
deployment workflow's version baseline/count. Only the bundled copy's DEV and
asset query strings are prepared; this script never invokes deployment.

Android-only adaptations inject the early platform prelude and native adapter,
remove the manifest, prevent PWA install/SW registration, retain the remote API,
and route report PDF scripts to a bundled library. html2pdf.js 0.14.0 is pinned
(the old web 0.10.1 dependency has high/critical audit findings); the website is
unchanged. Its license and the existing Yandex decorative SVG are included locally.
OAuth/PDF source markers are checked so a changed frontend fails the build for review.

## Startup and connectivity

The local UI and internal pages load without internet, over a dark #070C14 native
background. OfflineGuard, InitialLoadState, their fullscreen overlay, retry/timeout
machinery and remote offline HTML are removed. API fetch failures have an Android-only
network message; reconnect triggers one background refresh without restarting.
The Android adaptation replaces optimistic income writes with awaited server writes
and disables the website write journal in the generated copy. Offline creation
uses the SQLite outbox described below. Offline edit/delete remain forbidden.
The source website remains unchanged.
The production gateway currently returns `Access-Control-Allow-Origin: *` for
https://localhost, including preflight and actual responses. No backend deploy was
needed; CORS must be rechecked if gateway/backend policy changes.

## Android-only behavior

- MainActivity owns WindowInsets; automatic SystemBars inset handling is disabled
  to avoid a second owner. WebView stays edge-to-edge at the top with a transparent
  status bar. Its Android-only adapter adds the real top inset to page content
  and the fixed auth overlay, preserving their original spacing and backgrounds.
  Handled safe-area insets are zeroed before reaching WebView, avoiding duplicate
  env() padding. Navigation/keyboard keep native bottom handling and adjustResize.
  No production styles are changed. Android System WebView should be up to date.
- Back first dismisses a report or the existing confirmation/category/calendar/
  income/settings/history UI, then navigates page history. At the root it asks
  before closing. Keyboard Back remains handled by Android IME.
- Same-origin legal/service/pricing pages stay inside the app. External HTTPS,
  mail and phone links open their system app; arbitrary custom schemes and
  cleartext HTTP are not allowed.
- A small packaged adapter runs only on trusted `https://localhost/`. It bridges
  report HTML, Android printing, and Blob export downloads. Files are saved
  through the Android document picker, not broad storage permissions.
  Messages accept only the trusted origin and main frame, with size limits.
- Existing bearer session stays in WebView private localStorage, separate from
  read snapshots. Legacy income buffers/journal are removed before site scripts
  start. Android backup is disabled; no tokens/secrets are embedded. Logout clears
  SQLite snapshots and the existing website session state. Clearing app data
  removes both the session and cache.
- No service-worker registration exists in the inspected web source; the PWA
  install prompt is also suppressed in the Android adapter. No second PWA shell.
- Launcher icons retain the accepted exact PWA image and existing adaptive padding.
  Android 13+ retains its monochrome resource. Existing legacy PNGs are unchanged;
  the website's original PWA icons are unchanged. `LauncherIconTest` also exports
  mask previews and legacy assets using Android's renderer.

## Android read cache

`ReadCachePlugin` uses Android framework `SQLiteOpenHelper`, with no third-party
database dependency. SQL, compression and native validation run on one serial
background executor, shared across Activity instances. Database version 2, snapshot format 1:
`/data/user/0/ru.qpokoy.app/databases/qpokoy-read-cache.db` (Android may expose
the equivalent `/data/data/ru.qpokoy.app/databases/` path). This is private app
storage, not Downloads. Backup remains disabled with existing transfer exclusions.

One atomic, compressed snapshot contains incomes, categories, UI settings, stable
server user ID, minimal user display fields and last successful sync timestamp.
History/month/year analytics use the same incomes, without duplicate aggregates.
Password, raw bearer token, OAuth/payment secrets and internal auth/billing settings
are excluded. The existing session is bound by its SHA-256 digest to the user ID
confirmed by bootstrap; an unknown/different session cannot read the old snapshot.
This is account isolation, not encryption against a compromised/rooted device.

On launch, `android-read-cache.js` validates and displays that session's snapshot
before the normal bootstrap finishes. Offline creation requires a previously
verified, session-bound snapshot; online mutations wait for fresh verification.
Identical responses update the sync timestamp
without rehydrating the UI; changed responses win. Successful mutations persist
only server-confirmed values, then refresh the shown UI. Failed writes do not
produce a successful snapshot. Offline mutations other than income creation are
rejected with the existing notice. Online/visible events request a refresh and outbox sync.

Logout/account deletion clear snapshots and invalidate pending callbacks. Incompatible
schema, mixed ownership, damaged payload or checksum mismatch discards the cache
and falls back to the server. No raw token is stored in SQLite or cache logs;
Capacitor payload logging is disabled to avoid logging financial snapshots.

Build integration is in `scripts/bundle.cjs`; do not edit generated `www`.
Source markers deliberately fail the bundle build if auth/save structure changes.
Run `node --test tests/*.test.cjs`, Gradle `testDebugUnitTest`, and instrumentation
`ReadCacheDatabaseTest`. Account UI tests are opt-in and require an authorized
test account. `processColdReadCache` uses `coldCachePhase=prepare`, host `adb shell
am force-stop ru.qpokoy.app`, radio disable, then `coldCachePhase=verify`; verify
restores network and deletes only its named temporary income/category.

## Durable offline creation (0.1.7-dev)

`pending_adds` is a separate SQLite table, never part of the confirmed snapshot.
It stores operation UUID, stable income UUID (also `client_mutation_id`), user ID,
session digest, normal income fields, creation order and retry/error metadata.
SQLite commit completes before the form shows success. UI hydration combines
confirmed rows with pending rows, using the existing history and analytics.
Only snapshot categories can be selected offline. A small Android-only status
label disappears after confirmation. No new CSS or second income interface.

Version 1 → 2 migration retains the snapshot. Cache reset/corruption/logout never
delete unconfirmed additions. A verified server snapshot rebinds only that user’s
queue to their new session; another user cannot read or send it. Pending data
blocks logout/account deletion/bulk replacement with a notice. A 401 clears the
visible account/session but retains the outbox until verified login to the same user.

Start, foreground, verified bootstrap and `online` trigger sequential sync. Transient
network/timeout/408/429/5xx errors retain rows with 5-second exponential backoff,
capped at five minutes while the app is foregrounded. A 30-second request timeout
does not undo a late server commit; retries always retain the same UUID. Permanent
4xx errors retain a visible error row and stop automatic retries for that operation.
No background worker while the app is killed; SQLite survives and sync resumes on start.

Server confirmation and removal of its pending UUID happen in one SQLite transaction.
Bootstrap containing the same account-scoped UUID reconciles a lost response.
The existing backend `(user_id,id)` INSERT uniqueness prevents duplicates. The
opt-in POST /incomes extension returns the saved row with HTTP 200 on repeated
`id === client_mutation_id`, or 409 for a different payload. Ordinary web requests
retain their existing 201/409 behavior. No new endpoint or YDB schema/migration.
Compatibility reconciliation can resolve an old backend’s 409 by account-scoped
UUID, never by comparing amount/date/category/description.

The idempotent contract was deployed separately by the user. No backend editing
or deployment is performed by the Android 0.1.8 network fix.

Automated coordinator scenarios A–J are in `tests/outbox.test.cjs`; real SQLite
migration/reopen/isolation/ACK tests are in `OutboxDatabaseTest`. Opt-in
`BundledFrontendTest#durableOfflineCreates` has `outboxPhase=prepare`, `verify`
and `sync`; host force-stop/reboot between phases verifies persistence, then
deletes only the test’s uniquely named incomes/category. Never run on a main account.
Clearing Android app storage or uninstalling removes unsynced data; no cloud or
device-transfer backup is enabled. Authentication secrets are never put in the outbox.

## Android network detection and transport fallback (0.1.8-dev)

`QPokoyReadCache.getNetworkState()` uses ConnectivityManager's active network
and NetworkCapabilities: no network/no INTERNET is offline, INTERNET+VALIDATED
is online, transitional/unavailable capabilities are unknown. Native state wins
over WebView's stale `navigator.onLine`; onLine is only an unknown-state hint.
One default-network callback is registered per resumed plugin, removed on pause
and destroy. One JS listener per document is removed on pagehide; native events
and existing online/visibility events request the coalesced refresh/outbox sync.

IncomeStore.add generates the income UUID before its first POST and sends it as
client_mutation_id. Explicit native offline goes straight to SQLite without POST.
Only transport failure (fetch/network/DNS/socket/30-second timeout or lost
successful response body) falls back to enqueue with that same UUID. Local
success is displayed only after SQLite commit, using the existing pending label.
The verified snapshot/session/account/category checks remain required; no other
offline mutations are enabled. Normal online server ACK does not create pending.

Real HTTP errors, including 400/401/402/403/404/409 and 5xx, business/validation
errors and invalid JSON responses are not newly queued. Existing already-pending
operations retain their existing retry policy. Received error HTTP status is
preserved even if reading its body subsequently fails or times out.

Native network callbacks may report reachability without guaranteeing this API
is reachable; transport fallback covers that distinction. OS network details,
SSID and IP are neither collected nor logged. See [Android network state](https://developer.android.com/develop/connectivity/network-ops/reading-network-state).

## Offline UX and mobile recent pagination (0.1.9-dev)

Known native state is read from the callback-updated cache without another bridge
probe. Unknown state has a 150ms bound; if still unknown, create-only adds use the
existing verified SQLite binding instead of waiting for an API timeout. Background
refresh explicitly requests a fresh network reading. SQLite commit still precedes
UI success; transport fallback and stable UUID retry remain unchanged.

Combined confirmed/pending history is sorted by income_date descending, then
created_at descending, following cloud ordering. Pending status is never a sort
key. Old snapshots without creation timestamps remain readable. Normal online
ACK keeps date ordering too. Pending labels can wrap within their available width.

Coarse mobile recent pages contain one full-width card; fine-pointer desktop
retains four. The isolated web patch is css/mobile.css + js/app.js with regression
coverage in tests/mobile-recent-pagination.test.js. It is NOT merged or deployed
to main. The Android bundle script applies those same two minimal substitutions
to origin/main during asset generation; it accepts either old or already-updated
source, and otherwise fails for review. No wholesale stale website copy is used.

## Known limits / next stage

- Yandex OAuth shows an explicit unsupported message instead of starting a flow
  that cannot return a session to the app. **Not claimed supported.** Add a
  verified Android App Link / secure callback exchange in a dedicated stage;
  never move session tokens into URLs or allow third-party pages onto the native bridge.
- Registration verification and password-reset email links currently open the
  website/browser. The restored password can be used for email login in the app;
  seamless return is part of the App Link stage.
- Remote-WebView localStorage is not copied to the new origin. Sign in again once;
  cloud data is retained. Bearer tokens remain private to the local app origin,
  without cross-origin cookies, SameSite workarounds or credentials embedded in APK.
- Payment confirmation opens the external HTTPS browser. The existing return URL
  remains the website; automatic Android return is not implemented or claimed.
  Reopen the app and refresh subscription status. No real charge was made for tests.
- RuStore Pay, billing changes, release signing, store listing and publication
  are deliberately absent. Opening pricing does not mean payment integration
  has been approved or tested.
- Emulator and Samsung verification results are recorded in `VERIFICATION.md`.

References: [Capacitor setup](https://capacitorjs.com/docs/getting-started/environment-setup),
[Capacitor configuration](https://capacitorjs.com/docs/config).
