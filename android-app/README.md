# qPokoy Android — first technical prototype

**Bundled frontend**, remote Yandex Cloud API. No local database or new backend.
Android: `ru.qpokoy.app`, `qPokoy`, `versionName=0.1.5-dev`, `versionCode=6`.

Everything for Android lives in this directory. The website, backend, API,
YDB, payments and deployment workflow are unchanged. The app starts at
`https://localhost/`, served by Capacitor from assets physically inside the APK.
Website deployments do not update an installed APK. Data operations need internet.

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
network message; reconnect and retry the action without restarting. Existing account
cache/journal behavior is retained; no new offline editor/cache/database is introduced.
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
- Existing bearer session/localStorage/journal remain in WebView private data.
  Android backup is disabled; no tokens/secrets are embedded. Logout uses the
  unchanged website cleanup. Clearing app data removes the session.
- No service-worker registration exists in the inspected web source; the PWA
  install prompt is also suppressed in the Android adapter. No second PWA shell.
- Launcher icons retain the accepted exact PWA image and existing adaptive padding.
  Android 13+ retains its monochrome resource. Existing legacy PNGs are unchanged;
  the website's original PWA icons are unchanged. `LauncherIconTest` also exports
  mask previews and legacy assets using Android's renderer.

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
