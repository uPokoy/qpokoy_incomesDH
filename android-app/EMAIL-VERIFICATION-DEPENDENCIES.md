# Android 0.1.20: email-confirmation return dependency (not deployed)

## Implemented only in the Android branch

- Bundled POST /auth/register sends the fixed `client: "android"` UX preference.
  There is no client-supplied redirect URL. Old backend ignores the extra field.
- A separate exact `ru.qpokoy.app://email/confirmed` callback carries no query,
  fragment, email address, confirmation token, OAuth ticket or session credential.
- MainActivity handles cold/warm delivery, removes the URI before Capacitor sees
  it and passes only a boolean through the existing trusted main-WebView bridge.
  Activity recreation preserves a not-yet-delivered hint in saved instance state.
- After auth startup, an unauthenticated user sees the normal login screen and
  `Почта подтверждена. Войдите в аккаунт`. An existing session is never logged out.
  This is an informational hint, NOT proof of email verification or permission to
  log in. A forged custom-scheme link can at most display this message; the server
  remains responsible for enforcing email verification during password login.
- The Yandex OAuth host/path and its proof/session handling are unchanged.

## Why Android alone cannot enable the complete flow

Read-only inspection of origin/main `608a9150234edfa39c40477873bb58ca5ad4a57a`
and the pinned DEV423 frontend shows:
1. backend/app.js ignores the registration source when issuing verification mail.
2. backend/security.js creates `userId.secret`, storing only SHA-256(secret).
3. Successful POST /auth/email-verification/confirm returns empty HTTP 204.
4. js/auth.js confirms the token and shows web login; it has no app-return path.

Therefore the installed backend/site must be updated separately, with explicit
authorization. Nothing in main, deployed backend, cloud or YDB was changed here.

## Proposed minimal follow-up in main/backend (specification only)

1. backend/app.js: accept only optional `client === "android"` on registration;
   reject other supplied values. Treat it as a UX preference, not device identity
   or an authentication factor. Do not accept arbitrary return_url/redirect_uri.
2. backend/security.js: bind the source cryptographically to the actual issued
   verification token without a new table. For example, keep web's existing
   `userId.secret` and hash unchanged; Android can use `userId.secret.android`,
   storing SHA-256(`secret.android`) in the existing token_hash column. The parser
   must require the exact enum suffix and hash it too. Adding/removing/changing
   that suffix then fails the existing stored-hash check. A plain URL query flag
   or hashing only secret for the new format would NOT provide this binding.
3. After successful atomic confirm/consume (including status and expiry checks),
   return HTTP 200 `{ok:true,return_to:"android"}` for Android tokens. Keep web's
   HTTP 204 contract unchanged. Invalid/expired/replayed tokens keep the existing
   controlled error and MUST NOT return an Android target. Never return a session.
4. Preserve resend/rate limits: a resend from the current Android client can
   carry the same fixed enum and issue a newly bound token; old web resend stays
   web. Android resend adaptation, if needed by its UI, requires a small follow-up
   to bundled api-client.js (currently only register is marked). Do not infer a
   source from User-Agent, localhost Origin, Referer or localStorage in a browser.
5. js/auth.js on qpokoy.ru: only after confirm's successful server response with
   `return_to === "android"`, remove verify_token from the URL, retain a usable
   success page and ordinary web login, show a manual "Открыть qPokoy" link, and
   make one automatic attempt to open the fixed callback. No return on a normal
   web response, failed confirm or reused token. Do not append the original query.
6. The manual Android link may be package-targeted:
   `intent://email/confirmed#Intent;scheme=ru.qpokoy.app;package=ru.qpokoy.app;end`.
   Browser fallback must be a fixed clean qpokoy.ru success page, without tokens,
   and must NOT auto-open repeatedly. Keep the current page usable when no app is
   installed or the browser blocks the attempt. No OAuth link/config changes.
7. Add backend tests for web compatibility, signed source binding and tampering,
   expiry/replay/resend and absence of session credentials. Add web tests for
   return only after successful confirm, manual fallback, missing app, browser
   rejection and no auto-return loop. Then test real registration/email/browser
   handoff on Samsung (cold/warm) after an explicitly authorized deployment and APK.

Browsers may require a user gesture and cannot be forced to launch another app.
The automatic attempt is best effort; the manual link is required. See:
https://developer.chrome.com/docs/android/intents
https://developer.android.com/training/app-links/create-deeplinks

## This patch's verification boundary

Node tests simulate registration requests, callback/UI timing, header swipes,
chart clicks/keys and scroll cancellation. JVM tests validate the exact callback
and existing OAuth/native policies. No APK is built or installed for this task.
Thus actual browser handoff, Samsung gestures and end-to-end email confirmation
are NOT claimed as physically verified for 0.1.20. The published 0.1.19 artifacts
and release signing configuration remain untouched.
