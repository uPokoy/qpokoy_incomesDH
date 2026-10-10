# Prototype verification — 2026-10-09

## Offline income creation — 2026-10-10, 0.1.7-dev / versionCode 8

Work started at Android branch HEAD `51791aab18efdffb5d380a3f2cf2ef5eeaead453`.
Bundled frontend source remains `a1b167a21b18aa7634517cbd79cca6faa492f1a9`
(DEV400). Production frontend files and web DEV were not edited. Changes are
Android-local except the explicitly permitted opt-in backend route and its test.

Changed files in this task:

```text
android-app/README.md
android-app/VERIFICATION.md
android-app/android/app/build.gradle
android-app/android/app/src/androidTest/java/ru/qpokoy/app/BundledFrontendTest.java
android-app/android/app/src/androidTest/java/ru/qpokoy/app/OutboxDatabaseTest.java
android-app/android/app/src/androidTest/java/ru/qpokoy/app/ReadCacheDatabaseTest.java
android-app/android/app/src/main/assets/android-read-cache.js
android-app/android/app/src/main/java/ru/qpokoy/app/ReadCacheDatabase.java
android-app/android/app/src/main/java/ru/qpokoy/app/ReadCachePlugin.java
android-app/package-lock.json
android-app/package.json
android-app/scripts/bundle.cjs
android-app/tests/outbox.test.cjs
android-app/tests/read-cache.test.cjs
android-app/tests/smoke.test.cjs
backend/app.js
backend/test/routes.test.js
```

### Current results

- Android Node tests: 29/29. Twelve outbox scenarios cover A–J, actual same-UUID
  POST retry after a lost response, 503/restart, 401/same-user re-login/different
  user isolation, permanent 4xx/no endless retry, enqueue failure/no success UI,
  logout/deletion/bulk guards, online ACK and denial of offline edit/delete/import.
- Backend: 127/127, including concurrent opt-in retries (201 then 200), payload
  conflict (409), malformed mutation identifier (400), same UUID in another
  account and ordinary web CRUD contracts. No backend deployment.
- Existing frontend suite: 111/112. The unchanged
  `temporary mobile test mode repeats completed accounts on fresh launch and login, not desktop`
  test in `tests/onboarding.test.js:150` expects test mode enabled, but the
  unchanged production `js/onboarding.js` has `MOBILE_ONBOARDING_TEST_MODE=false`.
  This pre-existing failure is not reported as a green suite or fixed in this task.
- Project syntax/structure: passed (19 frontend JS, 20 CSS, 7 HTML).
  Android adapter/bundle/backend JS syntax and `git diff --check`: passed.
- Gradle `test` (2 debug + 2 release unit cases), `assembleDebug`,
  `assembleDebugAndroidTest`: successful, ordinary debug signing only.
- Real Android API 36 emulator, SQLite instrumentation: 9/9. Separate fixture
  database validates v1→v2 migration, reopen/FIFO, snapshot clear/corruption with
  retained outbox, verified user/session binding, atomic ACK, date/category
  validation and duplicate UUID rejection. Actual account database not reset.
- Existing WebView runner with explicit authenticated/cache flags: no failures;
  six applicable checks ran (session restore, normal form CRUD/reload, read-cache
  offline/CRUD, local offline pages, network recovery/CORS, bundled PDF).
  Five unrelated opt-in/account-changing checks were skipped; not claimed passed.
- `durableOfflineCreates`, authorized test account: prepare / verify after host
  `am force-stop` / verify after real emulator reboot / sync: all passed.
  Three rows (711, 712, 713 ₽) created using the existing form with radios off;
  visible immediately, absent from confirmed snapshot, pending in real SQLite.
  Logout blocked without token loss. Restart/reboot retained all three, history
  status labels and month/year source. Reconnect resulted in exactly three cloud
  UUIDs, total 2136 ₽, empty queue and no pending labels. Only the uniquely named
  test rows/category were deleted; count returned to baseline, reload verified.
- `offlineLostResponseReconcilesCloudUuid`: passed using the real API. An
  instrumentation-only fetch shim is installed before API initialization, sends
  the POST and discards its successful response. Pending remains with network
  status; cloud list contains one account-scoped UUID; bootstrap atomically
  reconciles it, UI still has exactly one row. Temporary data cleaned up.
  Initial after-load fetch substitution did not reach the captured API fetcher;
  the corrected pre-initialization test is the reported result.

### Storage and deployment boundaries

`pending_adds` is durable app-private SQLite with user ID/session digest, operation
UUID, stable income UUID used as client_mutation_id, income fields and bounded
retry metadata. Snapshot and pending are separate; ACK writes snapshot and removes
pending in one transaction. Cache clear never deletes pending. Rebinding requires
a server-verified snapshot for the same user. No password/token is stored in the
queue or printed to logs. Android backups remain disabled.

Start/foreground/online/verified bootstrap sync sequentially. Transient errors
retain rows and back off; 401 stops and retains them for same-account verification;
permanent 4xx retains a visible error without automatic repeated POSTs. Pending
blocks logout/account deletion/bulk replacement. Offline edit/delete/category
CRUD/import/settings/payment writes are not added. A killed app performs no sync;
SQLite persists and sync resumes on launch. Uninstall/clear app storage destroys
unsynced data, like other private app storage.

Backend change: only optional `client_mutation_id === id` handling in
`POST /incomes`. Existing `(user_id,id)` INSERT uniqueness is reused, with no
YDB schema or migration. Ordinary web requests keep their old behavior. Android
also reconciles legacy 409 by an authoritative account-scoped UUID, not fields.
**For full verification of the new 200-on-retry contract, the backend change in
the resulting commit must be deployed separately. It is not deployed here.**
The emulator tested production UUID uniqueness/reconciliation, not an undeployed
production contract. Mocked 401/5xx and two-account queue isolation are automated;
not claimed as manual production account/session-error tests.

APK: `android-app/artifacts/qPokoy-0.1.7-dev-debug.apk`. Physical Samsung and
API 24 UI were not available for this task. Native validation avoids java.time
so it does not raise the existing minimum SDK. No release keys, merge, main push,
backup changes, frontend/backend deployment or production web edits.

The following sections are historical verification of earlier APKs.

Base: `e80af88504b216c3ef5f1fbe6d9c72fc52274cd4`, expected web DEV386.
The public production HTML actually advertised `dev-2026.10.09.390` during
verification. The remote prototype loads the live deployment, not pinned assets.

## Completed checks

- Capacitor 8.5.3; Java 21; Gradle 8.14.3; Android API 36.
- `assembleDebug`: successful. APK installed on an Android 36 x86_64 emulator.
- Android Lint: 0 errors, 31 warnings (generated resource/icon density warnings,
  dependency update suggestions, JavaScript-enabled report WebView review,
  conservative feature-guard warning, older Android backup recommendation).
- Android smoke tests: 3/3 passed; adapter JS syntax passed.
- Existing backend tests: 128/128 passed.
- Existing frontend tests: 111/112 passed. The unchanged test
  `tests/onboarding.test.js:150` expects temporary mobile test mode enabled,
  while base `js/onboarding.js` already has `MOBILE_ONBOARDING_TEST_MODE=false`.
  Neither file was changed by this Android project; not reported as a green suite.
- Existing project syntax/structure checks: passed (19 JS, 20 CSS, 7 HTML).
- Android launch shows the existing email/password login screen without browser
  chrome. Logcat sample contained no fatal exception or uncaught JS error.
- Emulator physical profile: 1080x2400, density 420, approximately 411x914 dp.
- Native inset backgrounds are dark; no website CSS changes.
- Email/password login completed manually by the user. Bootstrap loaded the
  account; closing/restarting the app retained its session and test record once.
- Month navigation, Month/Year analytics, recent incomes, full history, native
  swipe, category popup and all three settings tabs worked on the emulator.
- One marked test income was added and edited. Totals changed by the expected
  amount; the edited row did not duplicate.
- The marked test income was deleted with the user's explicit confirmation.
  Restarting the app restored the original total; the test contribution did not return.
- Pricing and service pages opened inside the app. Android Back returned from
  service to pricing, then to the main interface. No payment was submitted.
- Logout through Settings > Data returned to the login screen and hid account data.
- The user logged in again to the same test account. Its original total returned,
  without the removed test contribution.
- The final APK was installed as an update, preserving the session. Full history
  again showed no marked test record after loading.
- Android keyboard kept the active amount/description fields visible; Back
  dismissed keyboard and settings/history/report views without exiting the app.
- PDF export opened an Android document picker and saved a valid 182600-byte,
  one-page A4 PDF. Poppler rendering confirmed its table, test record and total.
- No frontend/backend/payment/API changes, release key, or embedded token.

## Not yet verified / release blockers

Registration, password recovery, export/import, multipage PDF, Samsung hardware,
and additional manual flows still require verification. These are **not** claimed passed.
Additional 360x800 and 390x844 profiles are not yet checked.

Native Back close ordering and report message transport were verified in DOM
smoke tests; that does not replace device UI and PDF end-to-end tests.
The initial emulator Qt host window had capture/position/scaling failures;
manual testing proceeded through official scrcpy mirroring. The emulator later
disconnected unexpectedly on several runs, including during a parallel build;
the cause was not established. Emulator stability is not claimed passed, nor is
this claimed an app crash (no FATAL EXCEPTION found in inspected logcat samples).
Native text-selection toolbar occasionally remained after form/report dismissal;
investigate selection/action-mode Back handling before a release.

Yandex OAuth native return is not implemented. Existing OAuth opens the system
browser and cannot return its session to this WebView. Email verification/reset
links also need a future verified Android App Link integration.

Before release: move to bundled assets with explicit CORS origin, implement secure
App Links, complete real-account/device and PDF tests, review native bridge/XSS,
then separately plan RuStore requirements and approved release signing/payment.

## Artifact

Ignored local artifact: `artifacts/qPokoy-0.1.0-dev-debug.apk`.
Version `0.1.0-dev`, code `1`, application ID `ru.qpokoy.app`.
SHA256: `5455999d2e7677ed42a7375ec65cac8006807feac005fa0c1511b1eeab84e125`.
The APK and local toolchains are not committed.

## 0.1.1-dev / code 2 — top safe area

- Capacitor 8.5.3 SystemBars switches to passthrough on WebView >=140 with
  viewport-fit=cover, even for its native configuration. MainActivity now pads
  the content container by max(remaining status-bar top, remaining cutout top).
  When decor has already padded these areas, the remaining inset is zero.
- Only handled top values are zeroed before forwarding the inset notification;
  navigation/side/IME values and existing web padding are unchanged. No CSS,
  viewport metadata, manifest, themes or web adapter modifications were needed.
- assembleDebug succeeded; the APK was signed with the same local debug
  certificate as 0.1.0-dev and installed successfully as an update.
- :app:connectedDebugAndroidTest passed 1/1. The test exercises passthrough
  status/cutout values, repeated dispatch, zero reset, and unchanged navigation/IME.
- Android smoke checks passed 3/3; adapter syntax and git diff checks passed.
- A broad unqualified connectedDebugAndroidTest also attempted generated
  Cordova library tests and failed there with pre-existing duplicate Kotlin
  dependencies. The targeted app test passed; library dependencies were not changed.
- Android 16 emulator / WebView 133 with tall-cutout overlay: display cutout
  top 126 physical px, status-bar top 136 px. Native hierarchy places the WebView
  at global y=136 (not 272): the existing native fallback is not double padded.
- Login screen remains fully below the status bar. Real Samsung / modern-WebView
  passthrough end-to-end verification remains a device follow-up; synthetic
  passthrough dispatch was verified by the instrumented test.
- After manual test-account login, main, settings, pricing.html and service.html
  were inspected with the tall cutout enabled. Their top content remained below
  the system area. Pricing hierarchy also starts the WebView at y=136.
- Focusing the empty income description opened the keyboard without covering
  the field. Back closed the keyboard, then the unsaved form. Back from service
  returned to pricing and then main. No test income or payment was submitted.
- The temporary tall-cutout overlay was disabled after verification.
- Artifact: artifacts/qPokoy-0.1.1-dev-debug.apk.
  SHA256: 89c59e4896589d415329c4e15867e504ae7e445130b6385ef11e2ca288cdedbb.

## 0.1.2-dev / code 3 — content inset, edge-to-edge background

Supersedes the 0.1.1 approach: padding android.R.id.content exposed the native
background above the WebView on Samsung. That padding has been removed.

- MainActivity is the sole inset owner (SystemBars insetsHandling=disable).
  WebView/decor have zero top padding. The status bar is transparent and display
  cutout layout is allowed. Native bottom navigation/IME padding is retained.
- The max of real status-bar/display-cutout top is converted from device pixels
  to CSS pixels and sent to the packaged adapter after navigation and inset events.
- Adapter-only CSS adds this value to the site's existing body/auth padding,
  keeping page and fixed background layers full-screen. Values are replaced,
  not accumulated. Handled native safe-area insets are zeroed, preventing env()
  from applying them twice. No production HTML/CSS/JS was edited.
- assembleDebug passed. Same debug signature; emulator updated without clearing data.
- Native test passed 1/1 via adb instrumentation (no Gradle uninstall); smoke
  passed 4/4, adapter syntax and diff checks passed.
- Android 16 / WebView 133, tall cutout: native WebView global y=0, compared with
  y=136 in 0.1.1. Main, settings, pricing, service and login were inspected;
  backgrounds painted underneath clock/Wi-Fi/battery without a separate native
  strip. Initial actionable content remained below the top system area.
- Back service -> pricing -> main worked. Ordinary test-account logout opened
  the login screen. No financial data or payment was created/changed.
- Cutout overlay disabled after verification. A real Samsung confirmation of
  this APK is still needed; emulator results are not a Samsung certification.
- Artifact: artifacts/qPokoy-0.1.2-dev-debug.apk.
  SHA256: 93b3972b932c84fe1a5451fb7eb264d663f966f230200a67095ed0740d4f15c9.

## Adaptive launcher icon safe-zone fix (0.1.2-dev / code 3 unchanged)

- Cause: v26 adaptive XML used density PNG foregrounds containing the entire
  square PWA tile, including its background and pre-rounded corners. Adaptive
  overscan enlarged that image under the launcher mask. The unrelated default
  Android robot vector was not referenced by those XMLs.
- The existing document, three blue lines and green plus badge have been
  vectorized in the Android resource only. Background remains the existing
  `ic_launcher_background` color #070C14. No outer tile/corners are drawn in
  the foreground; Android owns the mask. Website PWA PNGs are unchanged.
- Foreground viewport: 108x108dp, source-coordinate scale 0.135 with centered
  translation. Visible composition is approximately 44x47dp, about 65% of the
  72dp mask viewport. Layer padding is at least 30dp (~12dp after overscan).
  Every nontransparent pixel fits inside the 66dp safe circle, including the
  document border, badge and monochrome details.
- Added API 33 adaptive XMLs with a monochrome document/plus silhouette and
  transparent line/plus details; the ordinary colored foreground stays primary.
- Removed all five obsolete raster foregrounds. Re-exported the ten legacy
  normal/round PNGs (48,72,96,144,192px) from the same vector using Android's
  renderer. `LauncherIconTest` produces these assets in its icon-review folder.
- Android Emulator API 36: installed the final APK with `adb install -r`, same
  debug certificate as 0.1.2, no uninstall/data clearing. Actual launcher icon
  inspected: document and plus are compact and uncropped.
- Instrumentation passed 1/1: colored and monochrome alpha pixels checked against
  the safe circle; circle, rounded-square, squircle and One UI-like preview rendered.
  The One UI shape is an approximation, NOT a test of Samsung's proprietary mask
  or a physical Samsung launcher. Real Samsung confirmation remains outstanding.
- Native debug assemble passed without a project signing/dependency change.
  Targeted app AndroidTest assemble also passed. A broad initial AndroidTest build
  hit a duplicate Kotlin dependency in an unrelated Capacitor library test target;
  no production dependencies were changed. The final targeted build needs no workaround.
- Android smoke: 4/4. Icon XML parsing, all ten legacy PNG dimensions and
  `git diff --check` passed. No Capacitor sync needed for native resources only.
- Version/application ID/name/signing configuration unchanged. Only android-app
  resources, icon instrumentation and Android documentation changed. No website,
  backend, main, backup branch or user financial data was changed.
- Artifact: `artifacts/qPokoy-0.1.2-dev-icon-fix-debug.apk`.
  SHA256: 56ff80bf927792481fef4557dd91aeee4ae203c305d3abd9b6a53a290cc9113d.
- Local previews: `artifacts/adaptive-icon-masks.png`,
  `artifacts/adaptive-icon-monochrome.png`, `artifacts/icon-launcher.png`.

## 0.1.3-dev / code 4 — native first-load offline fallback

- The old errorPath was an unstyled white HTML page, with no native first-load
  guard or load deadline. The custom link handler also did not recognize its
  https://localhost/offline.html URL. Exact Samsung-specific behavior is not
  independently diagnosed here (no physical device connected).
- Native dark loading/offline overlay; retry is local and network-aware. Main-frame
  network/HTTP errors and certificate cancellation do not invoke Capacitor's
  destructive errorPath navigation. A 20-second first-load deadline prevents a
  permanently blank/loading WebView. Secondary resources do not own offline UI.
- ConnectivityManager validated network transitions retry a failed initial load
  once; loaded documents are never reloaded on network loss/recovery. Offline
  internal navigation is blocked, loss shows a short Toast. Callback, timeout and
  Toast are cleaned up on Activity destruction. ACCESS_NETWORK_STATE added.
- API 36 emulator: online cold start, force-stop + cold start with Wi-Fi/data OFF,
  repeat OFF, automatic recovery without Activity replacement, network loss and
  recovery retaining the same JavaScript document marker, background/resume,
  Activity recreation and Android Back passed. Offline portrait and landscape
  screens visually checked; no white background or clipped controls.
- Verification of preserved loaded content used the real production login page;
  no credentials, income operations or user financial data were needed.
- Automated checks: Android smoke 4/4, InitialLoadState JUnit 5/5,
  OfflineGuardTest instrumentation 3/3. assembleDebug passes; diff whitespace check
  passes. Individual DNS/refused/HTTP-server outages were not forced against the
  production host; their main-frame callbacks share the tested fallback state.
- API 26 image installed for this task: native cold-offline screen and retry OFF
  passed with privileged emulator airplane mode; restoring network loaded the
  remote document automatically with the same process (PID 5458). The automated
  radio-OFF fixture failed its network precondition on this old image (Wi-Fi
  remained validated); it is not counted as a successful instrumentation test.
- API 26's bundled Chrome/System WebView 69 cannot correctly render the current
  production CSS; full online appearance on that outdated runtime did not pass.
  This needs an updated System WebView, not a production CSS change in this patch.
  No physical Samsung/USB device is connected: physical verification remains open.
- Artifact: artifacts/qPokoy-0.1.3-dev-debug.apk. Website, backend, main, backups,
  icon resources and signing configuration unchanged.

Files changed by this offline patch (all paths relative to android-app/):
- README.md; VERIFICATION.md
- package.json; package-lock.json; tests/smoke.test.cjs
- www/offline.html (copied into the ignored packaged public assets for this APK)
- android/app/build.gradle; android/app/src/main/AndroidManifest.xml
- android/app/src/main/java/ru/qpokoy/app/MainActivity.java
- android/app/src/main/java/ru/qpokoy/app/OfflineGuard.java
- android/app/src/main/java/ru/qpokoy/app/InitialLoadState.java
- android/app/src/main/res/layout/qpokoy_offline.xml
- android/app/src/main/res/drawable/offline_button.xml
- android/app/src/main/res/values/offline_strings.xml
- android/app/src/main/res/values/styles.xml
- android/app/src/test/java/ru/qpokoy/app/InitialLoadStateTest.java
- android/app/src/androidTest/java/ru/qpokoy/app/OfflineGuardTest.java

## 0.1.4-dev: offline fallback only (2026-10-10)

- Ordinary initial loading and retry loading hide the native overlay. Its XML
  defaults to GONE before attachment; only an initial failure/offline state shows
  it. Loaded documents remain visible after connectivity loss.
- Removed offline_loading and offline_loading_detail strings. The 20-second
  initial timeout and main-frame error callbacks are unchanged.
- Dark Activity/window theme remains #070C14; rendering an uncommitted WebView
  into a bitmap confirmed the same dark pixel color, with no loading UI.
- API 36 emulator: normal and repeated online startup, cold offline, Retry with
  no network, automatic recovery, and loss/restoration after page commit passed.
  Pending/slow first load was simulated with a WebView without a document commit;
  real carrier throttling and physical Samsung startup were not tested.
- Smoke 4/4; InitialLoadState unit 6/6; OfflineGuard UI 5/5; Gradle assembleDebug
  and diff whitespace checks passed. UI waits require document commit, rather than
  assuming that a hidden overlay means the remote page finished loading.
- APK: artifacts/qPokoy-0.1.4-dev-debug.apk (versionCode 5).
- Website, main, backups, backend, icons and signing configuration unchanged.

## 0.1.5-dev: bundled frontend migration (2026-10-10)

Base Android commit: `90ba81946a90ae897f6be7fdaad5a35232d923a0`.
Frontend source: `a1b167a21b18aa7634517cbd79cca6faa492f1a9` (origin/main),
prepared bundled DEV400 (`2026.10.10.400`). VersionName 0.1.5-dev, versionCode 6.

### Architecture and reproducibility

- Removed server.url/errorPath. Capacitor serves APK assets at **https://localhost**.
  API remains the existing HTTPS Yandex gateway; no new DB/backend or deployment.
- `npm run sync` builds www from committed origin/main, then cap sync android.
  `npm run bundle -- --source-ref <SHA>` pins the input. Rebuilding the same SHA
  reproduced identical hashes for every output file. 35 frontend source files,
  six pages, Android prelude/adapter and local vendor assets are packaged.
- Generated www/public assets are ignored. Removed the old tracked placeholder
  and remote offline page. Production HTML/CSS/JS are untouched; transformations
  happen only in the generated Android copy. DEV/cache preparation mirrors the
  frontend workflow without running its deploy steps.
- AppOrigin accepts only HTTPS localhost, default/443 port, without userinfo.
  Native bridge requires that origin and the main frame. External HTTPS/mail/tel
  use Intent; cleartext, mixed content and SSL bypass remain disabled.
- SW registration and PWA install are disabled by an early Android-only prelude;
  the manifest is excluded. Existing inspected source has no SW registration.
- OfflineGuard/InitialLoadState, overlay layout/strings/button and their obsolete
  tests are removed. Local UI no longer needs remote HTML or a loading overlay.

### Verified on API 36 emulator

| Scenario | Result / actual scope |
| --- | --- |
| Online cold start | Local origin/UI loaded; no remote document needed |
| Cold start with wifi/data disabled | Local UI and all six pages loaded, no fullscreen loading/offline overlay; no app crash |
| API while offline | Controlled Russian network error, no attempted offline write |
| Reconnect | Actual API response became readable in the same Activity without restarting |
| CORS | OPTIONS /auth/login: 204, allowed origin `*`; GET /auth/me without token: 401 readable from local WebView; dummy nonexistent login POST: readable 401 |
| Email/password login | Human signed into permitted test account twice on local origin |
| Incomes/categories | Temporary category + income 983 RUB created; edited to 984 RUB using UI; actual API confirmed exactly one matching row at each amount |
| Cleanup | Own income/category deleted in finally; reload returned to baseline income count; separate cloud list confirmed no ANDROID_BUNDLE_ rows and unique IDs |
| Main/history/analytics | Month previous/next returned to starting label; Year/Month switch and history opened |
| Settings | Categories/Appearance/Data tabs and Android Back closing settings passed |
| Logout | Interface confirmation used; auth gate returned, IncomeStore empty, token and bootstrap cache absent |
| Session restore | Login survived app update and force-stop/relaunch, plus a document reload; restored cloud count matched local count |
| Pricing/service/privacy/offer/about | Each loaded locally without internet with non-empty content |
| PDF/report | Native report WebView loaded bundled html2pdf offline and generated a non-empty `%PDF` document from synthetic table; Back dismissed report |
| Print/download | Existing Android print and Blob transport smoke passed; actual document-picker file save/physical printer were not tested in this migration |
| Keyboard | Real touchscreen focus opened IME; Back dismissed it. Gboard hardware-keyboard toolbar initially hid keys for the user, changed emulator settings/Alt+K to show normal keyboard; no app patch for that |
| Safe area/icons | Existing TopSafeAreaTest and LauncherIconTest passed; icon resources and geometry unchanged |

### Not verified or intentionally deferred

- Full registration with verification email and password-reset round trip were
  not performed. Signup required-field validation passed; production endpoints
  and email flows are preserved. Email verification/reset links currently return
  to the website; user must sign in to Android after completing the web flow.
- Yandex OAuth is explicitly unavailable in this APK: safe error asks for email
  login. A verified App Link + secure callback/session exchange is a separate
  stage. No OAuth secret, token URL or insecure third-party WebView bridge added.
- YooKassa code/API unchanged; external checkout uses browser. No real payment
  or successful callback to Android tested. Existing web return URL remains;
  automatic app return needs the App Link stage. RuStore Pay not implemented.
- API 26 emulator has outdated WebView 69: optional chaining throws SyntaxError
  and modern production CSS renders incorrectly. Full UI did **not** pass there.
  Update System WebView; frontend transpilation/design changes are out of scope.
  Network restored and old emulator stopped. Physical Samsung unavailable.
- Existing private token/journal behavior retained, no migration of the old
  remote-origin localStorage; existing users sign in once on the new origin.
- html2pdf Android-only dependency pinned at 0.14.0 instead of vulnerable 0.10.1;
  website dependency unchanged. npm audit reports three moderate existing CLI
  dependency findings (uuid/xcode), no high/critical findings in this dependency tree.

### Checks / artifact

- Android smoke: 6/6. JVM unit: 3/3 (two trust-boundary tests + existing template).
- API 36 general instrumentation: seven active tests passed; two account tests
  skipped by default and passed explicitly after human test-account login.
  Additional read-only restored-session test checks cloud/local count and IDs.
- Initial CRUD test incorrectly inspected the old document during reload;
  corrected test waiting with a document marker, then CRUD/cleanup/reload passed.
  No product change was made to satisfy that test.
- Gradle assembleDebug/testDebugUnitTest/assembleDebugAndroidTest passed.
  Node syntax checks for build script, prelude, adapter, generated auth/report
  and git diff --check passed. Only android-app tracked changes.
- APK: `android-app/artifacts/qPokoy-0.1.5-dev-debug.apk`.
- main (local and remote), backups, website/PWA/launcher icons, backend/YDB/API,
  payments, release signing and deployment workflow were not changed.

## 0.1.6-dev / versionCode 7 — Android SQLite read cache (2026-10-10)

Base Android commit: `b3e39505e9cb2d085589ffd2fe7f86ca8a452f10`.
Bundled frontend remains DEV400, source `a1b167a21b18aa7634517cbd79cca6faa492f1a9`.
Only `android-app/` is changed. Server/API/YDB and production website are unchanged.

### Storage and account boundary

- Framework SQLiteOpenHelper + small own Capacitor plugin; no extra database SDK.
- Private `/data/user/0/ru.qpokoy.app/databases/qpokoy-read-cache.db`, schema 1.
- One GZIP/checksummed snapshot: incomes, categories, UI settings, minimal user
  identity, successful sync timestamp. History and analytics reuse incomes.
- Raw token/password/OAuth/payment secrets are not copied. Auth token remains in
  its existing private WebView storage. Session SHA-256 binds the snapshot to the
  immutable server user ID from a successful bootstrap; every record owner is checked.
- Unknown sessions never get an account fallback. A transaction replaces the
  whole snapshot. Logout/successful deletion purge it; stale response generations
  cannot recreate it. Damaged payload/schema/owner mismatch is discarded.
- SQL/compression/native validation run on a shared serial background executor,
  not the Android UI thread. Capacitor payload logging is disabled.
- Existing `allowBackup=false` and cloud/device-transfer exclusions remain.
  Cache is not exported/shared. This is private storage, not database encryption
  against a rooted/compromised phone.

### Behaviour and measured tests

| Scenario | Result |
|---|---|
| No cache / first verified bootstrap | Automated test fills the cache from server data; normal loading remains |
| Saved session / cached UI before delayed bootstrap | Real API36 WebView test, three reloads, cached income/category visible before response; no duplicate |
| Process cold start offline | Prepare real temporary server income/category, host force-stop, disable wifi/data, launch a new process: cached rows visible, no crash |
| Offline history/month/year | Opened from cache; attempted income write rejected, no fake row or journal |
| Network restored | Same Activity refreshes from API; no restart or retry loop |
| Add/edit/delete + category | Server-confirmed real test rows saved into snapshots; UI CRUD also passed; all own rows/categories deleted afterward |
| No data change | Timestamp refreshed, UI hydration not repeated (coordinator test) |
| Mutation failure / transient 5xx | No false successful snapshot; old verified display retained (coordinator test) |
| Concurrent mutation/old bootstrap | Obsolete response ignored; requested refresh waits for fresh data (coordinator test) |
| A logout → B | JS coordinator and actual SQLite automatic tests: A not readable under B, A removed; no two real credential sessions used |
| Logout via settings + cold process | Token/bootstrap cache/IncomeStore removed; native read of old session hash returns null; new process opens auth |
| Account deletion | Successful/failed deletion cleanup paths covered by automatic coordinator tests; no real account destroyed in this task |
| Old/corrupt cache | Native API36 + API26: incompatible database version, old row version, corrupt GZIP; discarded without crash; JS falls back to server |
| Back/insets/icons | Existing API36 TopSafeAreaTest/LauncherIconTest and smoke Back tests passed; resources/geometry unchanged |
| Settings/history/analytics | Real test-account UI: settings tabs, Back, history, month previous/next and Year/Month switches passed |
| Login/session/keyboard | Existing test-account session restored; real auth 401 validation and touchscreen IME/Back test run after logout |
| Internal pages/PDF | All packaged legal/service/pricing pages open offline; native report WebView generates nonempty PDF using bundled library |

Latest passing delayed-network measurements (about 188 original test-account
incomes plus one temporary row; Android emulator, not physical Samsung):

| Run | Reload → cached data | Reload → server refresh |
|---|---:|---:|
| 1 | 435 ms | 3975 ms |
| 2 | 396 ms | 2484 ms |
| 3 | 521 ms | 2385 ms |

Bootstrap was intentionally delayed by 1500 ms through a test WebViewClient.
Numbers include document reload/render and test polling, not APK installation.
Separate successful process cold/offline run: 632 ms from cache-start coordinator
to completed cached hydration; there is no server refresh until network returns.

### Scale

SQLite native write/read synthetic benchmark (ms; write includes fixture generation;
JIT/emulator warming explains nonmonotonic timing):

| Records | API36 write/read | API26 write/read |
|---:|---:|---:|
| 100 | 32 / 14 | 24 / 15 |
| 1000 | 139 / 130 | 73 / 38 |
| 5000 | 411 / 40 | 74 / 68 |
| 10000 | 89 / 80 | 99 / 102 |

Additional real API36 WebView test injected disposable LOCAL synthetic snapshots
only (no synthetic API writes), reloaded offline, checked exact counts/read-only,
then restored the original snapshot and revalidated against the server:

| Records | Reload → shown | Cache coordinator → hydrated |
|---:|---:|---:|
| 100 | 469 ms | 109 ms |
| 1000 | 580 ms | 295 ms |
| 5000 | 2012 ms | 1210 ms |
| 10000 | 3962 ms | 2945 ms |

There is no small record-count cap. **Instant UI for 10000 rows is not claimed**:
the existing frontend hydration/render still takes seconds at that scale, even
though SQLite IO is off the UI thread. A separate frontend performance stage and
physical Samsung measurements are needed before promising large-dataset latency.

### Coverage, reproducibility and limits

- Android Node smoke 6/6 + cache coordinator 11/11; JVM unit 3/3.
- API36 general instrumentation reported OK (16 registered tests, ten active,
  six account-dependent skips at that run). Explicit account cache/CRUD/session
  tests: 3/3; cold prepare and verify: each 1/1; scale benchmark: 1/1.
- Final API36 general rerun after logout: OK (17 registered tests, eleven active,
  six explicit-account/benchmark skips). Explicit UI logout + fresh-process auth
  validation/keyboard: each 1/1.
- Native SQLite API36 and API26: 4/4 on each, with a separate private test database.
- Gradle debug APK/test APK/unit build, Node syntax and diff checks passed.
- `npm run sync` copies the Android-only adapter reproducibly; no manual `www`
  edits. Source SHA/DEV stays fixed. Debug APK:
  `android-app/artifacts/qPokoy-0.1.6-dev-debug.apk`.
- Physical Samsung unavailable. API26 has old WebView69, so **full modern UI is
  not claimed there**; native storage/size/schema/account tests passed.
- Actual account deletion, second real account login, physical printer and file
  picker save were not exercised. Automatic deletion/A→B tests and existing native
  transport smoke cover code paths, not those external/manual end-to-end flows.
- OAuth App Link return, payment return/RuStore Pay, release publication/signing,
  offline mutations and conflict resolution remain outside this stage.
- During development, tests found (and this stage fixed) a PRAGMA API misuse,
  UI comparison against an already-updated cache, and a refresh coalescing race
  after mutation. A test-only WebViewClient UI-thread access and an early cached
  baseline assertion were also corrected. Final relevant reruns passed.

### Changed files

- `android/app/src/main/java/ru/qpokoy/app/ReadCacheDatabase.java`
- `android/app/src/main/java/ru/qpokoy/app/ReadCachePlugin.java`
- `android/app/src/main/java/ru/qpokoy/app/MainActivity.java` (plugin registration)
- `android/app/src/main/assets/android-read-cache.js`
- `android/app/src/main/assets/android-platform.js`
- `scripts/bundle.cjs`, `capacitor.config.json`
- `android/app/build.gradle`, `package.json`, `package-lock.json` (Android version)
- `tests/read-cache.test.cjs`, `tests/smoke.test.cjs`
- `android/app/src/androidTest/java/ru/qpokoy/app/ReadCacheDatabaseTest.java`
- `android/app/src/androidTest/java/ru/qpokoy/app/BundledFrontendTest.java`
- `README.md`, `VERIFICATION.md`

main, all backup refs, production web/PWA assets, backend/API/YDB, release signing
and deployment workflows are untouched. No offline mutation queue was introduced.
