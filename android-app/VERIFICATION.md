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
