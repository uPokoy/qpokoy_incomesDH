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

Passwords use Node's scrypt (N=16384, r=8, p=1) with a unique 16-byte salt. Session secrets are 32 cryptographically random bytes and stored only as SHA-256 hashes; sessions expire after 30 days and can be revoked. All SQL uses typed parameters. Input lengths, dates, amounts, IDs and JSON size are validated. API errors do not include stack traces or database details. The gateway should retain its restricted invoker configuration, enforce HTTPS, and add rate limits for register/login before public exposure. Email verification, abuse protection, password reset, session cleanup, and production YDB integration tests are still required before replacing Supabase.

Run `npm ci` then `npm test` inside `backend/`. The tests use an in-memory store to exercise routes and ownership checks and do not contact the configured YDB database. A real Cloud Function → YDB smoke test has **not** been run by this change. Verify that separately in a staging gateway before any production switch.
