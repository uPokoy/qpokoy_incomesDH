# Prototype verification — 2026-10-09

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
