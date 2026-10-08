# Stage 6 — pure-function inventory and extraction boundary

Base: DEV368, `0ae16ff38df9388ab12a54f4a259246d093bf550`.
This stage deliberately keeps production code unchanged. It documents proven
duplicates and adds direct tests of actual production function bodies.
No shared module, global, HTML dependency or local-helper removal is shipped.

## Inventory

| Candidate / locations | Semantics and edge cases | Dependencies | Decision |
| --- | --- | --- | --- |
| Ruble rendering: app.formatMoney, report.money, analytics-month.money | Same ru-RU / integer rounding / ruble suffix core; report/monthly coerce with Number(value)\|\|0, app does not. undefined/NaN and negative zero differ. Monthly additionally supports an optional global formatter and standalone fallback. | Intl; monthly optional external function | Keep adapters. Equivalent report/monthly default outputs are tested, not assumed equivalent to raw app inputs. |
| HTML escaping: app.escapeHtml, categories.escapeHtml | Equivalent nullish/string conversion and apostrophe `&#039;`; no double-escape avoidance. | None | Exact duplicate, but private lifecycle/module boundaries differ; not exposed solely for deduplication. |
| HTML escaping: report.escapeHtml, analytics-month.escapeText | Equivalent default escaping with apostrophe `&#39;`, different exact output from app/categories. | None | Keep; do not silently change serialized HTML to `&#039;`. |
| Amount text parsing: hero-overlap.parseMoney, notice.parseMoney | Identical removal of ₽/whitespace, first comma replacement, Number and finite-or-null. Empty/nullish/NaN input via truthy fallback becomes zero; nonfinite parsed value becomes null. | None | Proven equivalent and directly tested; sharing would need a new loading/API contract. |
| Dates: app.textDateToDate / formatDateShort, auth.toIsoDate / validIsoDate / fromIsoDate, backup.canonicalDate, report.parseDate / formatDate | Validation vs string rearrangement, trimming, two-digit years, local Date vs UTC; report allows local Date rollover where app rejects invalid calendar dates. | Some use Date/local timezone | Keep; not interchangeable. |
| Display dates: backup.formatBillingDate, admin.date/dateOnly, admin-receipt.formatDate | Date-only vs date/time, local timezone vs Europe/Moscow; fallback empty vs em dash; admin.date rejects falsy inputs while receipt.formatDate can render null/0 epoch. | Intl/Date | Keep. |
| Category/string/record normalization: categories.normalizeName/sortCategories, report.normalizeCategory, auth.uiToRow/rowToUi, app.normalizeIncomeRecord, api-client.validData/checksum | Different schema, owner validation, casing, defaults, UUID rules, ordering and output contracts. | Some state/store/API boundaries | Keep; not a shared generic normalizer. |
| Range/layout/month logic: app, analytics-month/year, notice, hero-overlap, admin calendar | DOM sizes, selected period, current time, pointer/media and mutable animation state are meaningful inputs. | DOM/state/time | Not pure candidates as written. |
| Notice/confirm/clear-data/admin adapters and accent controls | Similar binding/overlay patterns, but callbacks, capture flags, ownership, observers and teardown differ. | DOM/events/media/state | No lifecycle deduplication. |
| Export: app IncomeBackup.exportData vs backup-controls.exportData | Record source/normalization, notice and BACKUP_KEY write differ; revoke delay 1000 vs 2000ms. | DOM/storage/download/time | Explicitly not merged. PDF/report template, restore/import/download are unchanged. |

The inventory covers all 18 frontend JS files, including api-client, auth,
categories, app, backup/clear-data, notice/hero, analytics, accent/confirm and
admin adapters. Similar API error handlers and billing helpers are intentionally
not generalized: status-specific behavior and mutable UI ownership differ.

## Why no extraction is shipped

`formatMoney` is private inside the app IIFE, not an existing shared window API.
The monthly `typeof formatMoney` branch does not make that private function
available to report/other modules. Reusing it without a new contract is invalid.

A new helper script could remove a few repeated lines, but the current deploy
overwrites stable paths nonatomically. New consumer JS + cached/old HTML lacking
the helper would introduce a startup ReferenceError. Merely inserting the script
before consumers in new HTML is not sufficient. Avoiding that requires a staged
compatibility migration, retaining fallback implementations or a different
loading contract; these costs outweigh this narrowly scoped deduplication.
No new global or dependency is introduced just to satisfy an extraction count.

## Tests and contracts

`tests/shared-pure-functions.test.js` evaluates extracted production helper
bodies in isolated VM contexts with no DOM, network, storage or user state.
It checks raw app money output; report/monthly exact output/coercion/throws;
the distinction between raw and coerced inputs and monthly standalone fallback;
and both odometer parsers including spaces, decimal comma, signs, nonfinite,
empty inputs and conversion errors. No test-only production exports are added.
The unchanged source amount and date formats remain authoritative; functions
retain locale/timezone semantics and caller coercion.

Shared-function extraction is deferred, not claimed complete. A future extraction
must explicitly solve mixed-version loading and preserve formatter override and
standalone contracts. Stage 7, restore >500, export/PDF changes and production
deployment are not part of this commit.
