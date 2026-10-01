# qPokoy backend (staging only)

This is an independent Yandex Cloud Functions API. The published qPokoy site still uses Supabase; this directory does **not** replace it and is not deployed by merely merging code. Do not point the production API Gateway or frontend at this code until integration and security testing are complete.

## Deployable files

Upload the entire `backend/` directory contents as the Cloud Function source: `index.js`, `app.js`, `security.js`, `ydb.js`, `package.json`, and `package-lock.json`. Tests and this README are not needed at runtime. Use Node.js 22 and entrypoint `index.handler`. Install dependencies from the lockfile (`npm ci --omit=dev`) before packaging if uploading an archive. Both `ydb-sdk@5.11.1` and its compatible `@yandex-cloud/nodejs-sdk@2.9.3` must be present. There are no credentials in this repository.

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

Income JSON uses `id`, `user_id`, `income_date` (`YYYY-MM-DD`), `category`, `description`, `amount`, `created_at`, `updated_at`—matching the existing cloud row semantics. Category JSON uses `id`, `user_id`, `name`, `created_at`. Registration saves `trial_ends_at` exactly 14 days after `created_at` and creates `Зарплата`, `Подработка`, and `Прочее` in the same YDB transaction as the user and email identity. There is no trial enforcement yet. `POST /incomes/replace` accepts at most 500 records; the complete JSON request body is capped at **2 MiB (2,097,152 UTF-8 bytes)** in `index.js`. It validates the entire array before starting a single serializable YDB transaction. Supplied `user_id` is ignored and the authenticated user's ID is used. This version does not implement Supabase OAuth identities, subscriptions, payments, or frontend cutover. Email registration here is a **separate** account namespace from Supabase; existing site passwords and sessions cannot be used to log into this backend. No live data migration is attempted.

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
