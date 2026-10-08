# Stage 5A — static shell transition compatibility

Historical stage-specific record. For the current architecture, see [architecture-current.md](architecture-current.md).

Base: DEV366 / `e763806d933ddb9a1d2454e2628b3d676bf7e01d`.
Stage 5 reference only: `ef76232055d1e966757b68d1198f29cc6c137752`.
Production HTML remains unchanged. The old Stage 5 branch is not amended,
merged or deleted; neither Stage 5B nor Stage 6 is implemented here.

## Categories

renderManager retains the original card selector and missing-card guard.
When the manager is absent it creates the exact original markup and appends it
to the same card. This compatibility fallback preserves attributes, text, child
order, parent and sibling placement.

Binding is now independent of creation: both a newly created manager and a
pre-existing static manager receive the existing click/Enter handlers.
`__qPokoyManagerBound` is a private element property, not a data attribute or
window export. It is set after registration and preserves one binding across
renderManager calls, hydration and repeated DOMContentLoaded initialization.
Handlers continue calling addCategory against current private currentUser and
categories state; the marker does not capture a user or category snapshot.
Auth calls, category CRUD/sorting and editor popup code are unchanged.

This does not introduce hot replacement of the entire categories module; its
private state/window publication lifecycle remains the same as DEV366.

## Admin mobile filters

The adapter first looks for the existing filter toggle. If absent, it creates
the exact original button and inserts it after the search box (or prepends when
the search box is absent), retaining the original filters/dashboard guards.

`__qPokoyFilterToggleBound` prevents repeat execution from registering another
click listener or media subscription. It is a private property, with no new DOM
attribute/window API. The marker is set after the existing initial desktop-close
call. Rerunning the adapter on an already bound button leaves its open state and
existing media subscription intact. The first binding retains the original
matchMedia query, change handler and addListener compatibility branch.

## Reference fixture and tests

tests/fixtures/stage5-static-shells.html contains only the two exact shell
fragments from the unmerged Stage 5 commit, not production page replacements.
Their markup was compared to that commit's parsed index.html/admin.html.
Tests insert those fragments at their original DOM positions into in-memory
copies of current production pages. No test requires the unmerged commit to
exist in a shallow CI checkout. The test harness accepts an optional HTML string;
default execution still loads the unchanged production index.html.

Eight transition regression tests cover:

- Legacy/future category shells: one click and Enter action each, repeat hydration,
  logout/login and user switching without stale ownership.
- Both category variants: hydration before DOMContentLoaded and repeated init
  without duplicated handlers.
- Legacy/future admin shells: loading/complete readyState, one button, one click
  registration/media subscription, repeat execution while open, and media changes.
- Both category variants: desktop/coarse-pointer read-only locks and no writes.
- Both admin variants: initial desktop closing and addListener fallback.

Separate in-memory comparisons to main verify full initialized DOM, text siblings,
attributes and current-HTML startup/API/window surfaces. Fixtures use mock APIs
and jsdom; this is not real browser E2E, a live deployment or cloud mutation.

## Deployment boundary

The existing deployment overwrites stable object paths nonatomically. Query
cache-busters are not immutable release paths. Stage 5A intentionally leaves
HTML unchanged and preserves runtime construction, so DEV366 HTML works with
either DEV366 JS or Stage 5A JS. Stage 5A JS also binds the future static shells.

This is preparation, not proof that the deployment issue is already resolved.
Stage 5A must actually be published and verified before introducing Stage 5B
static HTML. Stage 5B must be based on the compatible adapters, not the rejected
Stage 5 adapters that removed fallback. A client receiving future HTML with
pre-5A JS is still incompatible; Stage 5A cannot retroactively change old JS.

No workflow/cache policy, CSS, responsive rules, storage/network contracts,
auth/billing, export/restore or public window API is changed. Versions are not
manually bumped: the existing main deployment versions its generated artifacts.
