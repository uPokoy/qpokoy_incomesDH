# Stage 8 — category routing (DEV370 baseline)

Historical stage-specific record. For the current architecture, see [architecture-current.md](architecture-current.md).

Baseline: `c6c340af13f77affdc85ff73494baa18915d6803`. Branch: `codex/stage8-backend-routing`.
One route group only; no frontend change, deployment or main merge.

## Backend responsibility map before extraction

Environment is read at entry/adapters, not in app route groups. App receives options and store.
The table names the actual store methods; helpers may also authenticate and read billing settings.

| Responsibility / location | Dependencies and store operations | Configuration / HTTP contract |
| --- | --- | --- |
| Cloud entry / transport: `index.js` | Lazy `createYdbStore`, `createApp`, OAuth/mail/payment adapters; JSON serialization | `handler(event)`; Gateway v1/v2 method/path/query/IP, base64 body, 2 MiB cap, bad JSON 400, OPTIONS 204, CORS, redirects, no-store; `ALLOWED_ORIGINS` |
| Dispatch: `index.js`, `app.js` | Payment router first, transport admin list/receipt/delete second, app fallback; app public auth/bootstrap before authenticate, admin before account/incomes/categories/settings | Exact route order retained. `APP_BASE_URL`, `PUBLIC_API_BASE_URL`, `REQUIRE_EMAIL_VERIFICATION`, `ADMIN_USER_IDS` passed from entry |
| Email auth: `app.js` | `security.js`; `register`, `getIdentity`, `getUser`, `addSession`, `getSession`, `revokeSession` | POST `/auth/register`, `/auth/login`, `/auth/logout`; GET `/auth/me`; token/public user or 204; register may return verification-required; 14-day trial, 8–1024 password unchanged |
| Verification/reset: `app.js`, `mail.js` | `getEmailVerification`, `createEmailVerification`, `confirmEmailVerification`, `createPasswordResetToken`, `deletePasswordResetToken`, `resetPassword`; send email and existing failure cleanup | POST `/auth/email-verification/resend`, `/confirm`, `/auth/password-reset/request`, `/confirm`; 202/204 and existing errors; base URLs/from supplied by entry |
| OAuth: `oauth.js`, `app.js` | Yandex token/profile fetch, signed state/ticket; `getIdentity`, `getUser`, `linkIdentity`, `activateUser`, `registerOAuth`, `putSetting`, `getSetting`, `deleteSetting`, session creation | GET `/auth/oauth/yandex/start`, `/callback`, POST `/auth/oauth/exchange`; URL, redirect, session; `YANDEX_OAUTH_CLIENT_ID`, `YANDEX_OAUTH_CLIENT_SECRET` |
| Bootstrap/health: `app.js` | `loadBootstrap` validates session/user, `billingAccess`; `health` | GET `/bootstrap?revision=...` full/not-modified bundle; GET `/health`; no new startup queries |
| Incomes: `app.js` | `listIncomes`, `getIncome`, `addIncome`, `updateIncome`, `deleteIncome`, `deleteAllIncomes`, `replaceIncomes`; existing write access | GET/POST/DELETE `/incomes`, PUT/PATCH/DELETE `/incomes/:id`, POST `/incomes/replace`; existing 200/201/204; replace cap **500**, deliberately unchanged |
| Categories: formerly `app.js`, now `category-router.js` | `listCategories`, `addCategory`, `getCategory`, `deleteCategory`; write access, name/UUID validators, UUID/clock/response/error injected | GET/POST `/categories`, DELETE `/categories/:id`; 200/201/204, exact existing 400/403/404/409 errors; no environment reads |
| Settings: `app.js` | `listSettings`, `putSetting`; write access and reserved prefix validation | GET `/settings`, PUT `/settings/:key`; 200; auth/system/rate/billing prefixes server-managed |
| Account: `app.js` | `deleteAccount`; session authentication | DELETE `/auth/me` 204; no change to deletion internals |
| Admin: `app.js`, `index.js`, `admin-billing.js` | Admin membership, rate limits; `getIdentity`, `getUser`, `getSetting`, `applyAdminBillingChange`; transport `listAdminUsers`, `deleteAccount` | GET `/admin/session`; GET `/admin/users?email=...` search versus no-email list; POST `/admin/users/:id/access`, `/delete`; exact access/errors preserved; `ADMIN_USER_IDS` |
| Billing/entitlement: `app.js`, `billing-payments.js`, `admin-billing.js` | `getSetting`; grant parsing/calendar arithmetic, manual override/payment/trial/grace; write gate | GET `/billing/status` data/plans; app options include legacy enforcement timestamp (not new env); 149 monthly / 1190 yearly / 1790 lifetime, 3-day grace unchanged |
| Payments: `payment-router.js`, `yookassa.js` | Session/user authentication, `consumeRateLimit`, `getSetting`, `withPaymentTransaction` with transaction get/put; provider create/get; idempotency/consent | POST `/billing/payments`, GET `/billing/payments/:id`, POST `/billing/auto-renew`, DELETE `/billing/payment-method`, POST `/billing/yookassa/webhook`; provider errors sanitized; entry reads `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY`, `YOOKASSA_RETURN_URL` |
| Receipts: `index.js`, `admin-receipt.js`, `receipt-mail.js` | Admin auth, `getUser`, `getSetting`, `putSetting`, `deleteSetting`; payment/URL validation, send email, cleanup | GET/POST `/admin/users/:id/receipt`, POST access action=receipt compatibility; existing pending/sending/sent contracts; entry reads `POSTBOX_FROM` |
| Storage: `ydb-core.js`, `ydb.js` | YDB SDK/MetadataAuthService; queries, auto-commit writes + revisions, explicit transactions, RESOURCE_EXHAUSTED retry; production wrapper has one-use income cache and separate lazy admin driver | `ENDPOINT`, `DATABASE`; no SQL/schema/key/driver/store API changes; FakeDriver path differs from production wrapper |
| Security/session: `security.js`, auth helpers in `app.js` | scrypt, hashes, constant-time secret comparison, random UUID/secrets; store session/user reads | Bearer parsing, expiry/revocation/active-user validation; no new global mutable state |
| Email: `mail.js`, `receipt-mail.js`, `precharge-notifications.js` | Metadata IAM token, Postbox HTTP, escaped shared email template | No direct env reads in mail helpers; `POSTBOX_FROM` supplied by callers, metadata credentials; no browser/client secrets |
| Private workers: `renewals.js`, `precharge-notifications.js`, `precharge-test.js` | Renewal/notification workers use `listPaymentRenewalUsers`, `getUser`, `getSetting`, `withPaymentTransaction`, payment router/mail; separate guarded diagnostic worker | Not public Gateway routes; `YOOKASSA_RENEWALS_ENABLED`, `PRECHARGE_NOTIFICATIONS_ENABLED`, `PRECHARGE_TEST_EMAIL_ENABLED`, `PRECHARGE_TEST_EMAIL_TO`, provider config/app URL at worker entry; unchanged |
| Rate limiting: `app.js`, `payment-router.js` | `consumeRateLimit`, clock, hashed subject/bucket; separate auth/admin/payment limits | Existing 429 codes/messages and `Retry-After`; no limit changes |
| Validation/errors: `app.js`, payment/provider/admin helpers, `index.js` | Shared app validators / `HttpError`; payment-specific errors; app catch logs unexpected errors, serializes 500; outer transport catch unchanged | Exact status/code/message/headers/redirect contracts preserved; no new catch in router |

## Choice and extraction

Categories are the smallest complete mutable route group with no email/provider side effects.
Income routing includes restore and destructive bulk writes; admin transport mixes entitlement,
receipt send/cleanup and account deletion; auth/payment/YDB internals are higher risk.
Settings are small but contain reserved namespace filtering/decoding and bootstrap-related data.
Categories already have CRUD/default-category/protected-salary tests, clear user-scoped arguments,
and can move without moving authentication, validators or billing logic.

Moved the **19-line** category block verbatim from app into a CommonJS factory.
`app.js` decreases from 663 to 649 lines (net 14 lines); reducing file size is not the objective.
The factory receives `{store, requireWriteAccess, requiredString, uuidValue, randomUUID, now,
HttpError, response}` and returns `{handle(method, pathname, body, user)}`.
`user` is already authenticated; pathname is already normalized by app. Unknown routes return null.
This is an internal module, not a new HTTP endpoint. It reads no env and holds no mutable singleton.

The call remains **after income routes and before settings**. Public/auth/bootstrap/admin routes
retain their earlier positions. Entry export/event parsing/CORS/body/error serialization are unchanged.
Router errors escape to the same app catch using the same injected HttpError class.

Orders retained:

- GET: authenticate → listCategories → response.
- POST: authenticate → write-access check → validate/normalize name → UUID → clock → addCategory → conflict check → getCategory → response.
- DELETE: authenticate → write-access check → validate UUID → getCategory → not-found/protected check → deleteCategory → response.

No new transaction, query, retry, external side effect or rate-limit behavior was introduced.

## Evidence / tests

Five regression tests cover the route group. Two compare the new router with an independently
compiled **verbatim DEV370 block**, frozen in `backend/test/fixtures/stage8-category-baseline.txt`
(not compiled from the new router); the other three exercise app integration.
Thirteen scenarios compare exact results/errors and ordered dependency calls: list/create/delete,
normalized name, duplicate, empty/too-long name, null body at internal boundary, invalid UUID,
missing category, case-insensitive protected salary, unsupported method, unrelated/deep path.
Injected failures at write-access/list/add/read/delete prove thrown error identity and stopping order.
App integration separately checks 401, 402, 403/404, 500 logging, read access after expiry,
path/query normalization, settings/admin precedence and user-scoped deletion arguments.
Existing auth/OAuth/CRUD/YDB tests are retained without edits.

Baseline: frontend 82/82; backend 120/120; skipped/todo 0; syntax/structure/diff PASS.
Final checks: frontend **82/82 PASS**; backend **125/125 PASS** (120 existing + five new),
skipped/todo 0; frontend/backend syntax, structural checks and diff check PASS.
Backend is run from `backend/` with `node --test`, exactly the command in its npm test script
(npm is not on PATH in this environment). This retains discovery of precharge-test.js and the
existing helper module; no explicit test-file glob replaces the standard discovery.
No real Cloud Function/YDB request or browser E2E was performed: the evidence is local tests,
source-preserving extraction and unchanged production adapter, not a deployment guarantee.

## Packaging and intentional exclusions

The backend workflow packages an **explicit** `zip -j` list, not a glob.
With explicit user approval, exactly two workflow locations change:
`node --check category-router.js` after app syntax check, and `category-router.js` after app.js
in the existing zip command. No workflow target/env/secrets/versions/triggers/dependencies change.
Without the package-list addition, Cloud Function would fail requiring a missing module.
An independent temporary ZIP is created from that exact list and inspected for root names and
byte-identical content: all 18 prior members plus category-router.js, no README/tests/other files.
The two existing untracked ZIPs are not reused or overwritten.

Auth/session/OAuth/reset/verification, all admin transport, billing/payments/receipts/workers,
YDB/retries/schema, incomes/replace >500 and frontend are consciously left in their current modules.
Remaining debt: broad app/transport responsibilities, duplicate entitlement logic, adapter/test-path
differences and restore >500. Further extraction needs its own reviewed scope; Stage 8B is not
required to make this one group complete. Stage 9 was not started. No deploy, main merge/push,
backup updates or ZIP changes are part of Stage 8.
