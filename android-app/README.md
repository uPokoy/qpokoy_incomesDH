# qPokoy Android — first technical prototype

**Bundled frontend**, remote Yandex Cloud API, Android-only SQLite read snapshots.
Android: `ru.qpokoy.app`, `qPokoy`, `versionName=0.1.6-dev`, `versionCode=7`.

Everything for Android lives in this directory. The website, backend, API,
YDB, payments and deployment workflow are unchanged. The app starts at
`https://localhost/`, served by Capacitor from assets physically inside the APK.
Website deployments do not update an installed APK. All data writes need internet
and server confirmation; previously verified data can be viewed offline.

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
and disables the website write journal in the generated copy. There is no offline
editor, write queue or conflict resolution. The source website remains unchanged.
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
background executor, shared across Activity instances. Database/schema version 1:
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
before the normal bootstrap finishes. Cache display unlocks viewing only; writes
wait for fresh server verification. Identical responses update the sync timestamp
without rehydrating the UI; changed responses win. Successful mutations persist
only server-confirmed values, then refresh the shown UI. Failed writes do not
produce a successful snapshot. Offline operations are rejected with the existing
notice. Online/visible events each request one refresh, without a retry loop.

Logout/account deletion clear snapshots and pending generations. Incompatible
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
