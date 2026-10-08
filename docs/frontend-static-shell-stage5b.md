# Stage 5B — two static UI shells

Base: published Stage 5A / DEV367, `b2253adb9eff95875ab513d902d57bbd16e0beeb`.

Only the category manager and admin filter toggle move to production HTML.
Markup follows `tests/fixtures/stage5-static-shells.html` and the reference
Stage 5 commit `ef76232055d1e966757b68d1198f29cc6c137752`.

- The category manager is the last child of `#qpAppearanceCard`, after its
  existing trailing whitespace. No trailing whitespace is added inside the card.
- The admin filter button immediately follows `.admin-search-box`, before the
  existing whitespace and status field. The reference button has no ID.

Production JS is unchanged. Stage 5A binding reuses existing shells exactly once;
the compatibility construction fallback is intentionally retained for older or
missing-shell HTML. Both old DEV367 HTML and static HTML use the same DEV367 JS,
so the HTML transition does not require simultaneous JS replacement.
This does not make future HTML compatible with pre-Stage-5A JS.

Tests now use actual static production pages and reconstruct legacy pages by
removing only these shells. Existing transition tests retain click/Enter,
hydration, user switching, read-only, repeated admin initialization and media
coverage. Added checks cover raw reference markup, unique IDs, the appearance
card selector and full initialized DOM equivalence (including whitespace,
attributes and sibling order). These are jsdom checks, not visual browser E2E.

Other permanent UI remains runtime-created: billing/account enhancements,
appearance controls, access banner, pager, calendar helpers, report picker,
modals and subscription UI. This is not completion of all Stage 5 work.
No CSS, API, storage, auth, responsive logic or workflow changes are included.
The existing deploy workflow versions generated artifacts; no manual DEV bump
is made in this branch. Stage 6 and restore >500 are out of scope.
