# Stage 1: regression baseline

These tests exercise the unchanged DEV361 sources. They are not deployed: the
frontend workflow only copies the application's HTML, CSS, JS, icons and manifest.
No test makes a request to qpokoy.ru, YDB, OAuth, mail or the payment provider.

## Run

Use Node 22.13 or later in the 22.x line (the CI runtime) and pnpm 11.19.0:

```sh
pnpm install --frozen-lockfile --ignore-scripts
node --test tests/*.test.js
node tests/helpers/check-project.js
npm --prefix backend ci --ignore-scripts
npm --prefix backend test
```

Backend retains its existing npm lockfile and CI installation. Root dependencies
are test-only and pinned by pnpm-lock.yaml. No production package was changed.

## Coverage

- Existing API/auth suites protect sessions, revisions, journal recovery, cloud
  CRUD, import/delete failure paths and payment endpoint contracts.
- frontend-dom.test.js loads the actual index.html and frontend scripts in their
  existing order. It checks generated component IDs/containers, login/logout,
  repeat login, CRUD, confirmation, categories, history search/category filtering,
  settings tabs, Month/Year, subscription controls, read-only and JSON export/import.
- A delayed add response resolves after logout/login as another fixture user;
  assertions check the new user's records, account label and income DOM.
- A lost add response leaves its journal entry, then the next login reconciles
  the server-saved record without another insert.
- api-client.test.js also delays the actual client's bootstrap across a session
  change and checks it cannot overwrite the new cache.
- responsive-contract.test.js protects the current coarse/fine, 900/901/1200/1201
  boundaries and landscape conditions, including their existing overlap. It checks
  the resulting mobile history DOM and settings behavior, not pixel layout.
- check-project.js parses all frontend JS, HTML inline scripts, external/inline
  CSS, checks duplicate IDs and balanced script/style tags, and validates local
  script, stylesheet and quoted CSS-import targets. It is not an HTML validator
  or a complete CSS semantic validator.
- backend/test/ydb-production-wrapper.test.js loads the unchanged ydb.js without
  DriverClass, replacing only dependency boundaries. It covers the production
  cache/expiry, owner isolation, duplicate result and lazy admin driver/readiness.

## Limits and manual follow-up

The DOM suite uses jsdom outside-only execution and a mock API. Geometry, canvas
text measurement, scrolling and downloads are test substitutes. Inline delete
attributes are not compiled by jsdom in this mode: the test calls the same public
function referenced by the button, then clicks the actual confirmation dialog.

Still require browser checks: real CSS cascade/overflow, resize while an editor
or settings is open, touch/native-scroll gestures and inertia, iOS/Android
keyboard/safe-area, focus trapping, file dialogs, PDF/print, browser refresh/tab
close, real network cancellation, multi-tab storage concurrency, OAuth/payment
provider redirects and live YDB transactions. No such scenario is claimed passed.

The delayed-response tests do not establish safety of every asynchronous operation.
Follow-up characterization is needed for delayed category/billing mutations and
an old request's 401 after a new login. If a new safe-behavior assertion exposes
a production defect, do not weaken it or change production code in this stage;
report the defect for a separately authorized fix.

Full backup restore above the existing 500-record server limit is also outside
this refactoring baseline. Its contract must not be changed by test utilities.
