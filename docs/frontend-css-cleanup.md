# Stage 7 — bounded CSS cleanup

Historical stage-specific record. For the current architecture, see [architecture-current.md](architecture-current.md).

Base: DEV369 / `97a4c8d61ae9604854bc073392145e3f4ae0bf2b`.
Scope is two presentation primitives, not a general analytics redesign:
`#incomeChartSvg` and `.analytics-bar`. Only two early overflow declarations
are removed from main.css; no selector/rule, !important or media query is removed.

## Actual external CSS inventory (before cleanup)

Counts are PostCSS rule nodes (including keyframe steps), important declarations
and repeated exact selector occurrences within each file. Inline/generated CSS
is not included in these external-file totals.

| File | Rules | !important | Repeated selectors |
| --- | ---: | ---: | ---: |
| admin-delete.css | 17 | 0 | 1 |
| admin-mobile.css | 91 | 17 | 2 |
| admin-platform.css | 4 | 0 | 0 |
| admin-receipt-status.css | 5 | 0 | 1 |
| admin-ui-polish.css | 61 | 22 | 12 |
| admin.css | 159 | 3 | 28 |
| analytics-month.css | 260 | 663 | 91 |
| appearance.css | 91 | 204 | 16 |
| components.css | 776 | 1457 | 206 |
| desktop-narrow.css | 70 | 291 | 1 |
| hero-overlap.css | 32 | 156 | 2 |
| main.css | 259 | 69 | 49 |
| mobile-base.css | 292 | 742 | 98 |
| mobile-swipe-actions.css | 18 | 70 | 1 |
| mobile.css | 374 | 1757 | 83 |
| monthly-card-alignment.css | 525 | 2879 | 168 |
| oauth-brand.css | 65 | 101 | 17 |
| year-compare-mobile.css | 22 | 99 | 7 |

Total: 18 files, 3121 rules, 8530 important declarations; 388 exact selector
strings occur in multiple files. Repeated selectors alone do not prove redundancy.
No immediately adjacent identical declaration pairs or identical full rules with
the same parent were found by the inventory; partial repeated declarations need
individual cascade analysis.

## Load order / ownership

- index.html: main → components → mobile → analytics-month → monthly-card-alignment
  → desktop-narrow → oauth-brand → appearance → hero-overlap → year-compare-mobile.
- mobile.css imports, before its own rules: mobile-base → mobile-swipe-actions
  → oauth-brand. OAuth CSS is therefore loaded both through import and a later link;
  the later occurrence participates in source-order precedence. This is unchanged.
- admin.html: appearance → admin → admin-receipt-status → admin-platform →
  admin-delete → admin-ui-polish → admin-mobile.
- about/offer/pricing/privacy/service use inline styles, not external CSS links.
  Login/auth is part of index.html; there is no separate auth HTML page here.
- main owns base form/list/chart/history; components layers desktop analytics,
  settings/account and auth. mobile-base/mobile/swipe are coarse/phone overrides.
  analytics-month/monthly-card-alignment plus narrow/appearance/hero layers form
  the most intertwined analytics cascade. Auth overlaps components, mobile-base,
  mobile and oauth-brand. Settings/account overlap components, appearance,
  hero and oauth-brand. Admin has its own base/polish/mobile/delete layers.
  JS-generated access/notice/report styles also exist and are not modified.

## Proof and small cascade map

| Selector/property | Earlier main rule | Later unconditional main rule | Specificity | Important | Winner |
| --- | --- | --- | --- | --- | --- |
| #incomeChartSvg / overflow | visible (removed) | visible (retained) | 1,0,0 in both | no | visible |
| .analytics-bar / overflow | hidden (removed) | hidden (retained) | 0,1,0 in both | no | hidden |

Both surviving declarations are root-level in the same stylesheet, with identical
selectors, values and priority. Whenever the early rule matched, the later rule
also matches. The earlier copy could never be the final overflow winner. This
holds irrespective of width, pointer, orientation, normal/hover/focus/active,
disabled/hidden/read-only/selected/open state. If another declaration wins, it
still wins after removal of the dominated earlier copy. No overflow-x/y or
shorthand-dependent value is changed by removing these earlier identical entries.

Geometry, margin/padding, font, colors/background, borders/radii, shadow, opacity,
transform, visibility, transitions and all other declarations stay untouched.
The scoped snapshot includes descendant hover/selected rules and both coarse
media rules in mobile.css. This proves declaration/cascade equivalence, not a
real-browser computed-style or screenshot comparison. Final visual confirmation
may be manual; jsdom is not presented as visual QA.

## Metrics / remaining work

- Two duplicate declarations eliminated; zero full rules removed.
- Zero physical CSS lines deleted (two existing single-line rules shortened).
- Exact-selector main scope !important: 2 before / 2 after; whole main: 69 / 69.
- CSS load order, imports, filenames, cache-busters, HTML/JS and workflow unchanged.
- All breakpoints, orientation, coarse pointer and platform rules untouched.
- No dead selectors removed. In particular legacy sidebar/nav, report/modal and
  runtime account selectors are not assumed dead from absence in static markup.

Analytics cards, auth/settings/account, history/swipe and admin overrides are
deferred: their conditional/state-specific winners require separate proof and
visual checks. Stage 7B can address those zones separately; this intentionally
small cleanup is sufficient for Stage 7, not completion of all CSS consolidation.
No important removal is attempted solely to improve a count. Stage 8, restore
>500, export/backup/PDF changes and production deployment are out of scope.
