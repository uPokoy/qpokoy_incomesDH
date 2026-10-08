# Frontend module contracts — Stage 3

Historical stage-specific record. For the current architecture, see [architecture-current.md](architecture-current.md).

Baseline: DEV364, `bd1ed06b1513ad29d5837fde0cb6c9f1f6e6d4f0`.
This documents existing behavior, not a new startup protocol. No public name,
signature, return convention, storage key or publication point is changed.

## Loading and compatibility

`index.html` loads classic scripts in this order: api-client → categories → app
→ supporting UI scripts (including confirm, backup-controls, clear-data,
analytics, hero-overlap and notice) → auth. API publication is synchronous.
Categories publishes its hooks immediately but initializes its manager on
DOMContentLoaded (or immediately if the document is ready). App needs its
existing DOM at evaluation time. Auth starts bootstrap only after the app and
supporting scripts have loaded. API/category scripts precede parts of the DOM.

Dependencies are bidirectional but calls are deferred: app calls cloud hooks
on user writes; auth hydrates the already-published local store and category
loader. Categories gets the API dynamically. Auth captures the client object,
not new copies of its methods. Do not cache function references or freeze API
objects: clear-data wraps client/store methods; hero-overlap.js wraps
`window.renderIncomes`.
Existing optional `typeof` checks and fallbacks are compatibility behavior,
not permission to introduce another startup order.

No new namespace/alias is introduced. Every existing legacy name stays at its
original publication point; these names are the compatibility interface.

## api-client.js

**Owns:** transport, response/error handling, bearer credential persistence and
session-scoped bootstrap cache. It does not own income DOM, pending writes or
the signed-in UI. Existing pricing-section DOM adjustments are a legacy UI
responsibility left in this module for a later stage.

**Public browser object:** `window.qPokoyApi`. CommonJS exports:
`API_BASE_URL`, `TOKEN_KEY`, `BOOTSTRAP_CACHE_KEY`, `ApiError`, `createApiClient`.
The factory accepts `baseUrl`, `storage`, `fetchImpl` overrides for tests.

Stable client methods (existing arguments/REST response shapes preserved):

| Group | Methods |
| --- | --- |
| Transport/session | `getToken`, `clearToken`, `request`, `setUnauthorizedHandler` |
| Auth | `register`, `login`, `restoreSession`, `bootstrap`, `logout`, `deleteAccount` |
| OAuth/email/password | `startOAuth`, `exchangeOAuthTicket`, `resendEmailVerification`, `confirmEmailVerification`, `requestPasswordReset`, `confirmPasswordReset` |
| Income | `listIncomes`, `addIncome`, `updateIncome`, `deleteIncome`, `replaceIncomes`, `deleteAllIncomes` |
| Category/settings | `listCategories`, `addCategory`, `deleteCategory`, `listSettings`, `putSetting` |
| Billing | `billingStatus`, `createPayment`, `paymentStatus`, `setBillingAutoRenew` |
| Admin | `adminSession`, `adminFindUser`, `adminSetAccess` |

`request(method, path, body, authenticated=true)` returns the parsed payload;
resource convenience methods generally unwrap `.data`. HTTP/API errors can be
normalized to `ApiError` with status/code/message. Network errors from fetch and
some storage errors (such as saving the session token) can propagate as ordinary
errors without conversion to `ApiError`. This is not a new retry/error policy.

**Token ownership:** `getToken()` is read-only. `setToken`/`saveSession` remain
private; successful login/session exchanges persist credentials. Auth may call
`clearToken()` during its existing reset/verification/logout lifecycle.
Authenticated HTTP 401 clears token/cache and invokes the one callback installed
by auth via `setUnauthorizedHandler`. Clearing credentials alone does not clear
UI data/journal. Other consumers should not mutate the token storage directly.
`logout` clears credentials even on failure; account deletion only after success.
Bootstrap/cache invalidation and session-change protections remain unchanged.

**Dependencies/DOM/events:** browser fetch/localStorage (or factory overrides),
optional root document; `#subscription-title`/its section and `.question h3`
for existing pricing content. Reads DOMContentLoaded for that content. Does not
emit application custom events. No dependency on app/auth exports at creation.

## auth.js

**Owns:** auth forms/gate/account actions, session restoration, bootstrap
hydration, cloud income conversion and per-user durable pending write journal.
UI permissions/billing wrappers elsewhere remain external, not moved here.

**Public namespace:** `qPokoyAuth.client` is the same `qPokoyApi` instance;
`showGate(show, checking=false)`, `setMode(next)`, `getSettings()` (copies rows).
These UI functions do not themselves log a user in/out. `cloudUser`, readiness,
busy/generation flags, `sync`, journal and OAuth helpers remain private.
No new public user object: normalized user (`id` from `user_id`) is passed to
categories; account email is displayed through `#qpAccountEmail`. The auth user
ID global used by billing is published by clear-data, not by auth.

**Legacy public cloud hooks:**

- `qPokoyCloudAdd(record)` / `qPokoyCloudUpdate(id,record)`: enqueue durable
  writes synchronously, then return flush promise. Do not assume boolean success
  for every flush outcome.
- `qPokoyCloudRemove(id)`: promise of boolean; app changes local rows only after
  true. Does not itself remove the local income row.
- `qPokoyCloudRestoreBackup(records)` / `qPokoyCloudDeleteAll()`: promise of
  boolean; drain/check current-user pending writes before bulk mutation.
- `qPokoyCloudAddMany(records)`: async compatibility importer; no guaranteed
  boolean result. Preserve its current validation and sequential network writes.
- `qPokoyCloudReplace()`: compatibility refusal, resolves false; not an alias
  for the supported restore-backup path.

**Consumes:** API auth/bootstrap and income CRUD/bulk methods; `IncomeStore`
load/save; `qPokoyLoadCategories`; `applyIncomeHeaderFilters` (or renderIncomes),
`renderIncomeAnalytics`, optional `renderDashboard`/`renderAnalytics`;
`qPokoyConfirm`, `qPokoyConfirmPhrase`, optional `qPokoyNotice`.
`window.incomes` is only an optional legacy fallback; app's real income array is
private. Do not treat that global as the authoritative store.

**DOM:** `#qpAuthGate`, all three `#qpAuthForm`/`#qpAuthSignupForm`/
`#qpAuthResetForm` with their qpAuth inputs, submit and message elements,
`[data-auth-mode]`, `#qpAuthYandex .qp-auth-oauth-label`, `#qpAuthOAuthDivider`,
reset/back controls, `#qpAuthLogoutBtn`, `#qpAuthDeleteAccountBtn`,
`#qpAccountEmail`; body auth-locked/checking classes. Exact IDs remain in HTML.

**Notifications/lifecycle:** pageshow resets OAuth UI; forms use submit and
buttons use click. Unauthorized callback runs `sync(null)`; bootstrap calls the
category loader and render hooks directly. There is no custom auth-change event.
Storage owner/journal keys and URL verification/reset/OAuth parameters stay as
implemented; no new event bus or startup sequence is introduced.

## categories.js

**Owns:** private `currentUser`, `categories`, load generation, category CRUD,
settings manager and editor's option list/inline category creation.

**Public functions:** `qPokoyLoadCategories(user, bootstrapCategories)` async;
null user clears rows, provided array hydrates without GET, omitted array loads
via `qPokoyApi.listCategories()`. `qPokoyGetCategories()` returns a sorted new
array, but row objects are shared (not deep copies). `qPokoyCategoryVisual(name,
index)` returns `{icon,color}` for category rendering. No new custom event.

**Consumes:** dynamic `window.qPokoyApi` category list/add/delete methods;
optional `qPokoyNotice`, `qPokoyConfirm`, and its own category visual hook.
Auth owns user/bootstrap assignment. App owns income editor lifecycle and popup
geometry; categories controls option contents and selection through shared DOM:
`#incomeCategory`, `#categoryValue`, `#categoryPopup`, `#categorySelect`.
Deleting a selected category clears that field; creating/selecting updates it.
It does not rewrite categories on previously saved income records.

**DOM/events:** `#settings > .settings-card:not([style])`; generated
`.qp-category-manager`, `#qpCategoryInput`, `#qpCategoryAddBtn`, `#qpCategoryList`,
`.qp-category-delete`, `.category-option` and `.category-popup-create*`.
Reads click/keydown and DOMContentLoaded; MutationObserver watches popup
class/style for the existing coarse-pointer placement. Pointer/width/orientation
rules remain unchanged. No other module must access its private array.

## app.js

**Owns:** local income store, income editor/calendar, navigation, selected
period, history/filter rendering, core analytics/chart, settings routes/tabs and
backup bridge. Its IIFE-local `incomes`, `AppState`, filters, editor and gesture
state and helpers are not public interfaces.

**Public namespaces:**

- `IncomeStore`: `key`, `load`, `save`, `add`, `update`, `remove`, `addMany`.
  `load/save` are local-only; add/update/addMany call cloud hooks; remove awaits
  cloud confirmation. Methods use `this`; retain normal object invocation.
- `IncomeBackup`: `exportData`, `importData`, `getAllIncomeRecords`,
  `persistRecords`. Import/persist await the confirmed cloud restore hook.

**Legacy window functions (keep names and dynamic lookup):** `renderIncomes`,
`renderIncomeAnalytics`, `renderIncomeMonthChart`, `applyIncomeHeaderFilters`,
`qPokoyReplaceIncomes`, `qPokoyDeleteIncome`, `qPokoyGetSelectedIncomePeriod`,
`qPokoyChangeSelectedIncomeMonth`, `qPokoyChangeSelectedIncomeYear`,
`qPokoySetAnalyticsSettingsOpen`, `qPokoySetSettingsRoute`, `qPokoySetSettingsTab`.
Period getter returns a copy. `qPokoyReplaceIncomes(records,cloudSync=true)`
rejects legacy cloud replacement; false is local hydration/refresh, not a
server write. Delete UI hook retains existing confirmation and cloud handling.

**Consumers:** auth uses store/refresh hooks; analytics-month/year use store,
period methods and category visuals; report-print reads the store;
backup-controls uses backup methods; clear-data wraps store/API; hero-overlap
observes render events and uses store/cloud removal. These supporting modules
were inspected read-only, not refactored.

**Consumes:** auth's `qPokoyCloud*` hooks, categories' `qPokoyCategoryVisual`,
confirmation/notice globals, optional `renderDashboard`/`renderAnalytics` hooks.
These optional legacy render hooks are not app exports in this baseline.

**DOM contract:** existing `.sidebar`, `.content`, `.nav-item[data-page]`,
`.page`, `#pageTitle`; income editor/input/calendar IDs; `#incomeList`,
history search/filter controls and `.income-recent*`/history panel; totals,
`#incomeAnalytics`, chart and analytics controls; `#settings`, settings tabs,
`#analyticsSettingsToggle`/`#analyticsSettingsHost`; backup/dev controls.
App and categories deliberately share category selection DOM; IDs/selectors
remain defined by the existing HTML, not replaced by a second schema.

**Events:** emits `qpokoy:income-data-rendered` after rendering and
`qpokoy:income-period-change` with `detail.period` snapshot on period change.
Analytics/hero consumers observe them. Reads existing click/input/change,
keyboard/touch/pointer/scroll/resize/load/storage/media-change events; none are
new module-init notifications. Startup and initial renders remain synchronous
at their current points before auth hydration.

## Deliberately deferred

Auth still owns both account UI and cloud income synchronization; app combines
many UI responsibilities; category selection depends on shared editor DOM;
API client still edits pricing UI. Optional globals, mutable/wrapped exports,
DOM availability and script order remain coupling. Consolidating them would
change lifecycle/ownership beyond Stage 3, so they are documented, not moved.

Stage 4: examine mixed responsibilities in hero-overlap.js, notice.js,
backup-controls.js and clear-data.js separately, especially API/store wrapping
and UI permissions. Do not infer permission for that work from this document.

## Verification scope

`tests/module-contracts.test.js` guards the public method inventory, legacy
external calls, client identity, settings/period snapshots and category array
ownership. Existing suites cover auth/CRUD/sync/read-only/DOM/responsive flows.
They use isolated fixtures, not production accounts or a real layout engine.
No runtime exports, events or aliases were added for these tests.
