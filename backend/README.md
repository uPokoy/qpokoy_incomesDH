# qPokoy backend

This directory contains the Yandex Cloud Functions API used by the current frontend API client. Merging code builds a backend archive but does not deploy the Cloud Function or Gateway; verify those separately in staging before releasing backend changes.

## Deployable files

Upload the runtime files in the workflow archive as Cloud Function source (including all billing/payment modules listed below), plus `package.json` and `package-lock.json`. Tests and this README are not needed at runtime. Use Node.js 22 and entrypoint `index.handler`. Install dependencies from the lockfile (`npm ci --omit=dev`) before packaging if uploading an archive. Both `ydb-sdk@5.11.1` and its compatible `@yandex-cloud/nodejs-sdk@2.9.3` must be present. There are no credentials in this repository.

The function service account must have permission to access the existing YDB database. Set `ENDPOINT=grpcs://ydb.serverless.yandexcloud.net:2135` and `DATABASE=/ru-central1/b1gpa63ouuea1kj8rm5d/etnov7clc5jg5habs3kg` in Cloud Functions. The SDK uses `MetadataAuthService` and the function's attached service account; do not upload a service-account key. `ALLOWED_ORIGINS` can contain a comma-separated explicit allowlist for a future frontend (for example, the qpokoy.ru and GitHub Pages origins). Leave it empty while the API is private. API Gateway must route the listed paths and methods to this private function, with its gateway service account as invoker. This repository does not change the deployed function, gateway, DNS, Supabase, or payment resources.

## REST contract

Request and response bodies are JSON. A successful GET or write returns `{ "data": ... }` except auth and health routes; errors return `{ "error": { "code": "...", "message": "..." } }`. Provide `Authorization: Bearer <token>` for all routes other than health/register/login. The token is opaque (`session_id.secret`) and is returned by register/login. The client should store it securely and send it over HTTPS only; the database stores only SHA-256 of the random secret. Do not include `user_id` in requests as authority: it is ignored for writes, and YDB queries always scope reads/writes to the server-authenticated user.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | YDB-backed health check |
| POST | `/auth/register` | `{email,password}`; creates user and returns session |
| POST | `/auth/login` | `{email,password}`; returns session |
| POST | `/auth/logout` | Revokes current session |
| GET | `/auth/me` | Current user |
| GET | `/bootstrap` | Authenticated startup: `{user,incomes,categories,settings}` in one response |
| DELETE | `/auth/me` | Atomically deletes the authenticated account, identities, sessions, incomes, categories and settings |
| GET, POST | `/incomes` | List/create income |
| DELETE | `/incomes` | Deletes only the authenticated user's incomes; leaves their account, categories and settings intact |
| POST | `/incomes/replace` | Atomically replaces all own incomes with `{incomes:[...]}`; an empty array clears them |
| PUT, PATCH, DELETE | `/incomes/:id` | Update/delete own income |
| GET, POST | `/categories` | List/create category |
| DELETE | `/categories/:id` | Delete own category except `Зарплата` |
| GET | `/settings` | List own setting rows |
| PUT | `/settings/:key` | Save `{setting_value: string}` |

Income JSON uses `id`, `user_id`, `income_date` (`YYYY-MM-DD`), `category`, `description`, `amount`, `created_at`, `updated_at`—matching the existing cloud row semantics. Category JSON uses `id`, `user_id`, `name`, `created_at`. Registration saves `trial_ends_at` exactly 14 days after `created_at` and creates `Зарплата`, `Подработка`, and `Прочее` in the same YDB transaction as the user and email identity. Income, category and settings write endpoints enforce the current billing access through requireWriteAccess(): when trial/subscription access has expired and no other access applies, they return HTTP 402 subscription_required. Prelaunch access remains writable. `POST /incomes/replace` accepts at most 500 records; the complete JSON request body is capped at **2 MiB (2,097,152 UTF-8 bytes)** in `index.js`. It validates the entire array before starting a single serializable YDB transaction. Supplied `user_id` is ignored and the authenticated user's ID is used. The initial version described here did not implement Supabase OAuth identities, subscriptions, payments, or frontend cutover; see the later DEV sections for the current billing/payment implementation. Email registration here is a **separate** account namespace from Supabase; existing site passwords and sessions cannot be used to log into this backend. No live data migration is attempted.

The existing API Gateway must forward `POST /incomes/replace`, `DELETE /incomes`, and `DELETE /auth/me` to this function. These URLs reuse existing path shapes, but whether a Gateway configuration change is required depends on its current per-method route declarations; this repository does not contain the deployed Gateway specification. The Gateway may impose its own request-size cap below 2 MiB, so verify that separately before enabling large imports.

DEV137 startup uses `GET /bootstrap`. Publish the backend and ensure the Gateway forwards this new GET **before** releasing its frontend; the frontend deliberately does not fall back to the old startup GETs. No deployment or Gateway update is performed by this patch. The store checks the session/user with one parameterized JOIN, validates the bearer secret/expiry/revocation/status, then reads incomes/categories/settings using one multi-result query in the same borrowed YDB session. Internal `auth.*` settings are omitted from the response. Ordinary reloads without pending writes use two `executeQuery` calls and one `withSession`, versus eight calls/sessions for `/auth/me` + `/incomes` + `/categories` (eleven if `/settings` was also requested). This reduces five logical table reads from eight/eleven repeated reads; it does not imply a fixed RU charge. Existing RESOURCE_EXHAUSTED retry remains active, and pending journal recovery still performs necessary writes. Local appearance settings are not overwritten by the returned settings; frontend consumers can use `qPokoyAuth.getSettings()`.

## Security and verification

### DEV140: revision-validated startup cache without an explicit cache-hit transaction

`GET /bootstrap?revision=<opaque token>` still verifies the bearer secret, session
expiry/revocation and active user on **every** request. `system.data_revision` is a
server-managed UUID in the existing settings table; the public settings endpoint
cannot overwrite it and it is not exposed as an ordinary setting. Bootstrap also
omits internal `auth.*`, `system.*` and `rate.*` settings.

| Startup, without retries/pending writes | Borrowed YDB sessions | executeQuery calls | Full income/category/settings reads |
| --- | ---: | ---: | ---: |
| First launch / missing or invalid cache | 1 | 3 | 1 bundle |
| Reload, unchanged revision | 1 | 1 | 0 |
| Reload after any device changed data | 1 | 3 | 1 bundle |

DEV140 replaces DEV139's session/user/revision JOIN with three result sets in
one AUTO_TX query: session by session_id, user by the session's user_id, and only
the system.data_revision setting by user_id + setting_key. A matching revision
returns immediately: no explicit BeginTransaction, CommitTransaction or RollbackTransaction
RPC, no income/category reads and no full settings read. AUTO_TX still provides
one serializable snapshot within that executeQuery RPC; this is not a transaction-free
or locally cached authorization check.

A miss uses that preflight plus BeginTransaction, a second auth/revision query in
the transaction, the full bundle query, and CommitTransaction (rollback on failure).
The preflight revision is deliberately not reused for the bundle: a concurrent
mutation may have changed it. Legacy revision initialization shares the bundle
transaction, so a concurrently created revision cannot silently be overwritten.
Mutation atomicity and DEV136 RESOURCE_EXHAUSTED delays/jitter are unchanged.

The repository has no production DDL or YDB query plans. Point predicates assume
PRIMARY KEY (session_id), (user_id), and (user_id, setting_key) for sessions, users
and settings respectively. Verify these actual keys and query plans in staging;
no live table metadata or user data was read by this patch. Removing the new LEFT
JOIN and extra cache-hit RPCs removes both DEV139 regression candidates, but the
reported bare 504 does not identify which RPC stalled. SDK-contract/unit tests
cannot prove the production root cause, RU charge or a sub-10-second bound.

Income create/update/delete/delete-all, category create/delete, and public setting
writes update revision in the **same AUTO_TX query** as the data mutation. Income
replacement adds the revision write to its existing explicit transaction. A
revision failure therefore aborts the data write too. OAuth tickets, verification
records and rate-limit/internal settings do not bump the revision. Failed/no-op
income lookups and duplicate inserts do not bump it. Account deletion removes the
revision with the rest of the account's settings.
Revision UUIDs are generated anew for each existing retry attempt, avoiding reuse
of an older token; no retry count/delay is increased. Transaction isolation follows
the [YDB serializable transaction contract](https://ydb.tech/docs/en/concepts/transactions).

Frontend stores raw server rows in `qPokoyBootstrapCacheV1`, separate from both
`IncomeStore` and the durable write journal. The bundle has a schema version, user
id, session id (not the bearer secret), revision, and a corruption checksum. It is
used only after a successful server revision check and matching returned user id;
it is not an offline authorization cache or a TTL cache. Corrupt/unsupported
bundles, storage quota failures, account changes and lost mutation responses
fall back to full bootstrap. Writes invalidate the local bundle **before** sending
the request; successful logout/account deletion and authenticated 401 clear it.
500/network errors preserve the stored session. Auth hydration and pending-journal
reconciliation are unchanged, including DEV138's unlock-before-sync UX.

Before production merge: deploy/test the revision-aware backend before the frontend,
check the existing Gateway forwards `revision` query parameters, and verify the bootstrap equality predicates use
primary-key lookups rather than wide scans. Measure actual RU with
large histories and rapid reloads; mock query counts do not measure billing.
Exercise concurrent multi-device changes, lost write responses, rollback on injected
revision failures and legacy initialization against real YDB. All writers must
use the revision-aware backend; direct DB edits or rollback to an old writer do
not invalidate caches automatically. When rolling back, use the pre-cache frontend
first. No Cloud Function/Gateway deployment is performed by this patch.

Passwords use Node's scrypt (N=16384, r=8, p=1) with a unique 16-byte salt. Session secrets are 32 cryptographically random bytes and stored only as SHA-256 hashes; sessions expire after 30 days and can be revoked. All SQL uses typed parameters. Input lengths, dates, amounts, IDs and JSON size are validated. API errors do not include stack traces or database details. The gateway should retain its restricted invoker configuration, enforce HTTPS, and add rate limits for register/login before public exposure. Email verification, abuse protection, password reset, session cleanup, and production YDB integration tests are still required before replacing Supabase.

Run `npm ci` then `npm test` inside `backend/`. The tests use an in-memory store to exercise routes and ownership checks and do not contact the configured YDB database. A real Cloud Function → YDB smoke test has **not** been run by this change. Verify that separately in a staging gateway before any production switch.

## DEV168: private subscription administration (issue #5)

`admin.html` is a separate frontend, using the existing ordinary account/session.
Its visibility is not authorization: every `/admin/*` request authenticates the
bearer session and checks the server-side UUID allowlist `ADMIN_USER_IDS`.
An unset/invalid allowlist denies all access (403). Configure comma-separated
administrator UUIDs manually in the Cloud Function environment; do not put them
in frontend code or this repository. Existing OAuth and billing enforcement
environment variables are unchanged by this patch.

Deploy the updated backend first, then configure the API Gateway to forward
`GET /admin/session`, `GET /admin/users?email=...` and
`POST /admin/users/{user_id}/access`, including Authorization/query parameters.
The Gateway specification is not in this repository. The frontend deployment
includes `admin.html`, `css/admin.css` and `js/admin.js`. No production deployment,
allowlist configuration or billing enforcement activation is performed here.

Search is exact normalized email, without incomes/categories. Writes support
`month`, `year`, `lifetime`, `until` (inclusive date in Europe/Moscow), `reset` and
`auto_renew` (boolean, monthly/yearly only). Calendar month/year grants start now;
dated grants retain the existing three-day grace period. Grants are private
`billing.admin_override` settings; reset removes only that override, preserving
underlying payment settings, legacy lifetime and trial calculation. Prelaunch
remains unrestricted until BILLING_ENFORCEMENT_STARTED_AT is actually reached.
Toggling auto-renew changes a flag only; it does not initiate a payment.

Grant/reset/auto-renew and an audit record commit atomically in the existing
settings table. Audit rows belong to synthetic owner `system.admin_audit` (not
a real user), so account deletion does not erase the audit. Each record contains
only actor UUID, target UUID, action and UTC time; no email or financial data.
There is no public audit endpoint; public settings/bootstrap cannot read or write
reserved billing rows. No new table/DDL is required. Operators must arrange
private audit inspection/retention through their existing backend/DB procedures.
Search allows 60/minute and writes 20/minute, independently per authenticated
admin and source IP; exhausted requests return 429 with Retry-After.

Unit tests exercise authorization, exact search, overrides/reset, prelaunch,
legacy/trial/grace, auto-renew, validation, rate limits and atomic audit rollback.
They use synthetic accounts and mocked YDB; real staging Function/Gateway/YDB
verification is still required before release.

## DEV183: YooKassa payments and private renewals (issue #7)

DEV182 already supplied the YooKassa adapter, payment routes, grant helpers and
frontend API methods. DEV183 keeps those interfaces, adds durable request state,
atomic/idempotent settlement, guarded consent and a private renewal worker.
It does not deploy a function, change environment variables, enable enforcement
or a schedule, or perform any real financial transaction.

The current Cloud Function package must include `admin-billing.js`,
`billing-payments.js`, `payment-router.js`, `yookassa.js`, `renewals.js`, and the
existing runtime files/dependencies. The build workflow packages them together.
The HTTP entrypoint remains `index.handler`; `renewals.handler` is a **separate
private function**, never a public Gateway route. Existing YDB tables are reused;
no new DDL. Payment settings stay in the private `billing.*` namespace, excluded
from public settings/bootstrap. Every state transition rechecks account existence
and uses one serializable transaction; no provider HTTP call is made inside it.

| Method | Route | Contract |
| --- | --- | --- |
| POST | `/billing/payments` | Bearer session; `{plan,auto_renew?,request_id?}`; returns payment ID, status, fixed server price and validated HTTPS confirmation URL |
| GET | `/billing/payments/{payment_id}` | Bearer session, owner only; pending payments are reconciled with the provider, response contains no saved method ID |
| POST | `/billing/auto-renew` | Bearer session; `{enabled:boolean}`, monthly/yearly only, enabling requires a provider-confirmed saved method |
| POST | `/billing/yookassa/webhook` | Public notification; fetches the payment through authenticated YooKassa API before reading trusted order state |

Client-supplied price, user ID, dates, metadata and payment-method IDs are rejected.
Prices stay 149/1190/1790 RUB. Unknown provider payments cannot grant access:
provider object, amount/currency, owner, plan and order must match durable state.
Only confirmed `succeeded` with `paid:true` grants access. Duplicate/late events
cannot replay the grant, undo lifetime or restore canceled auto-renew. Known
DEV182 pending payments can still be reconciled from their existing private rows.
Canceled checkout never grants access. Canceled renewal stops auto-renew and
preserves grace through the previous paid-until + three days. Billing foundation,
legacy/trial, prelaunch and expired read/PDF/account-deletion behavior are unchanged.

The caller should retain one UUID `request_id` per logical checkout (including
retries), and use a fresh UUID only for a genuinely new checkout. Server keys are
scoped to the account; parameters are frozen **before** provider POST. A lost
response can retry the same order for less than 23 hours. After that, an ambiguous
order returns `409 payment_requires_review` and is never POSTed again: YooKassa
only guarantees idempotency for 24 hours. Reconcile through a verified webhook or
operator provider-status review; do not create a replacement request/renewal key
until the original outcome has been checked. Terminal orders are retained.

Renewal requires explicit user consent, a successful provider `saved:true`, an
eligible due monthly/yearly payment access and a matching consent record. Lifetime,
legacy, admin overrides, prelaunch and missing/disabled consent are skipped. Old
methods without confirmed `saved:true` are not silently promoted. Renewal keys
are stable per user/plan/paid-until; repeated workers use the same frozen request.
No velocity-based or unconditional retry charge exists. Provider/DB failures leave
recoverable order state; sensitive provider objects, credentials, card details and
saved method IDs are not written to application logs or public responses.

Manual release steps (not already assumed configured):

1. Deploy the updated HTTP function archive with existing YDB/service-account
   permissions, existing `YOOKASSA_SHOP_ID` and Lockbox-bound `YOOKASSA_SECRET_KEY`.
   Keep `BILLING_ENFORCEMENT_STARTED_AT` unchanged. No secret values belong in code.
2. Add/verify the four Gateway routes above, Authorization forwarding for user
   routes, query/path/body forwarding and public POST for webhook. Apply Gateway
   source-IP restrictions from YooKassa's official list if desired; do not trust
   client-supplied `X-Forwarded-For`. The handler also independently fetches status.
3. In YooKassa merchant settings configure HTTPS notification URL
   `<PUBLIC_API_BASE_URL>/billing/yookassa/webhook` for `payment.succeeded` and
   `payment.canceled`. Verify that recurring payments are enabled for the shop
   and, where applicable, configure fiscal receipts before accepting real money.
4. Verify end-to-end in a **test shop / staging** (including lost responses and
   parallel webhook/worker runs) before releasing real checkout. Unit tests use
   mock providers and never charge money. Current ordinary UX is unchanged.
5. Only after a separate explicit decision to activate renewals, deploy the
   private `renewals.handler` function, restrict invokers to the scheduler service
   account, bind the same required backend/Lockbox configuration, and explicitly
   set `YOOKASSA_RENEWALS_ENABLED=true` there. No schedule is created by this PR.
   Worker additionally requires enforcement already active; this PR does not
   activate it. An hourly schedule is sufficient for the three-day grace model.
   One invocation scans up to 500 billing setting rows, stopping between accounts
   at a three-minute budget; configure the function timeout with enough margin
   for the last provider/YDB operation. Private orchestration must
   pass returned `next_cursor` until null for larger accounts, then restart a cycle.
   This candidate query scans settings only: check YDB query plans/RU at scale and
   provide an index/queue separately if necessary. Monitor `failed` counts and
   manually review ambiguous orders; never retry with a different charge key.

Official API contracts checked:
[HTTP Basic / idempotency](https://yookassa.ru/developers/using-api/interaction-format),
[notifications / verification](https://yookassa.ru/developers/using-api/webhooks),
[saving a method with consent](https://yookassa.ru/developers/payment-acceptance/scenario-extensions/recurring-payments/save-payment-method/save-during-payment),
[charging a saved method](https://yookassa.ru/developers/payment-acceptance/scenario-extensions/recurring-payments/pay-with-saved).
