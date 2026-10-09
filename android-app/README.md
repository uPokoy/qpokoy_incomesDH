# qPokoy Android — first technical prototype

**Temporary remote production frontend**, not a bundled/offline release.
Base web commit: `e80af88504b216c3ef5f1fbe6d9c72fc52274cd4` (DEV386).
Android: `ru.qpokoy.app`, `qPokoy`, `versionName=0.1.0-dev`, `versionCode=1`.

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

## Android-only behavior

- Capacitor SystemBars native insets plus `adjustResize`; website geometry/CSS
  stay unchanged. The installed Android System WebView must be up to date.
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
- Launcher icons reuse the existing `icons/pwa-192.png` and `pwa-512.png`.

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
