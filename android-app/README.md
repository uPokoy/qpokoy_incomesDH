# qPokoy Android — first technical prototype

**Temporary remote production frontend**, not a bundled/offline release.
Base web commit: `e80af88504b216c3ef5f1fbe6d9c72fc52274cd4` (DEV386).
Android: `ru.qpokoy.app`, `qPokoy`, `versionName=0.1.4-dev`, `versionCode=5`.

Everything for Android lives in this directory. The website, backend, API,
YDB, payments and deployment workflow are unchanged. The app loads the current
`https://qpokoy.ru/`; later website deployments will also appear in this prototype.
It needs internet. A bundled frontend is a separate next stage requiring an
explicit Android origin in backend CORS and proper OAuth/email-link return routing.

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

## Offline startup (0.1.4-dev)

Normal initial loading shows only the dark WebView background (#070C14), with no
native loading screen. No connectivity at startup, main-frame network/HTTP/TLS
failure or a 20-second initial load timeout shows the offline screen. Retry hides
it while loading https://qpokoy.ru/; validated connectivity recovery retries once.
There is no polling or endless reload. Errors in secondary resources do not activate
this screen. The packaged offline HTML is a secondary, dark fallback.

Once a page has loaded, network loss only shows a short native notification:
the WebView, session and document are retained, and recovery does not reload them.
Internal navigation without connectivity is blocked so it cannot replace that
page with WebView's network error document. This is not offline income editing.
ACCESS_NETWORK_STATE supports ConnectivityManager; its callback and timeout are
removed when the Activity is destroyed. No API cache, database or journal is added.

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
- A small packaged adapter is injected only into `https://qpokoy.ru/`. It bridges
  report HTML, Android printing, and Blob export downloads. Files are saved
  through the Android document picker, not broad storage permissions.
  Messages accept only the trusted origin and main frame, with size limits.
- Existing bearer session/localStorage/journal remain in WebView private data.
  Android backup is disabled; no tokens/secrets are embedded. Logout uses the
  unchanged website cleanup. Clearing app data removes the session.
- No service-worker registration exists in the inspected web source; the PWA
  install prompt is also suppressed in the Android adapter. No second PWA shell.
- Launcher icons retain the existing PWA document/plus mark as Android-only vector
  foreground, with a separate dark background and a 66dp safe zone. Android 13+
  has a monochrome resource. Legacy PNGs are exported from the same Android vector;
  the website's original PWA icons are unchanged. `LauncherIconTest` also exports
  mask previews and legacy assets using Android's renderer.

## Known limits / next stage

- Yandex OAuth opens the system browser. Its existing web callback cannot put
  the resulting session back into this app. **Not claimed supported.** Add a
  verified Android App Link / secure callback exchange in a dedicated stage;
  never move session tokens into URLs or allow third-party pages onto the native bridge.
- Registration verification and password-reset email links currently open the
  website/browser. The restored password can be used for email login in the app;
  seamless return is part of the App Link stage.
- RuStore Pay, billing changes, release signing, store listing and publication
  are deliberately absent. Opening pricing does not mean payment integration
  has been approved or tested.
- Emulator and Samsung verification results are recorded in `VERIFICATION.md`.

References: [Capacitor setup](https://capacitorjs.com/docs/getting-started/environment-setup),
[Capacitor configuration](https://capacitorjs.com/docs/config).
