# Supporting frontend responsibilities — Stage 4

Baseline: DEV365 / `8132ac5a0204d5293f45a580a74afdde16877330`.
This is a bounded internal separation, not a new UI lifecycle. Existing script
tags, window APIs, DOM IDs/classes, injected styles, storage keys and network
routes are retained. Core app/auth/categories/API contracts remain as documented
in frontend-module-contracts.md.

## Ownership and what changed

| File | Actual responsibilities | Stage 4 boundary |
| --- | --- | --- |
| hero-overlap.js | Hero fitting; odometer presentation/protection; history redraw deferral; API delete deduplication; optimistic store deletion/rollback | Existing independent IIFEs documented as visual layers vs legacy application bridges; no wrappers removed or moved |
| notice.js | Notification modal AND legacy statistics gestures, date-selection dismissal, add-income odometer and calendar navigation | Notification UI and page enhancements now have separate private IIFE scopes in the same file; synchronous publication and enhancement initialization stay in the same order |
| backup-controls.js | Capturing JSON export/import controls; billing/account UI; settings swipe; DEV panel relocation | `bindBackupControls()` is a private backup-only binding boundary; orchestration explicitly calls it, billing mount, then settings swipe, in the previous order |
| clear-data.js | Access state/read-only enforcement, banner/UI, wrapped methods/notices and confirmed bulk-income deletion | Prompt/binding delegates to private async `runConfirmedIncomeClear(btn)`; cloud hook still owns the mutation and the action still restores button/access state in finally |

There is no new runtime namespace/event bus. Major cross-module dependencies
remain; the scope/binding/prompt boundaries are now explicit. This does not claim
that supporting modules have become completely single-purpose.

## hero-overlap.js

The original layout-only comment describes its first IIFE, not the whole file.
Seven separate IIFEs implement:

1. Text/badge collision fitting for annual/monthly hero totals.
2. Protecting the temporary odometer DOM when sync redraws the total.
3. Freezing the unchanged prefix of the odometer.
4. Arming/animating edit/delete changes and handling queued animation state.
5. Deferring `window.renderIncomes` while a mobile history row is being touched
   or settling. This is NOT just a post-render visual refresh.
6. Wrapping `qPokoyApi.deleteIncome` on load (or immediately if the document is
   already complete) to deduplicate in-flight IDs and
   treat HTTP 404 / not_found as already removed.
7. Replacing `IncomeStore.remove` with optimistic local removal and ordered
   rollback when `qPokoyCloudRemove` fails.

**Reads:** qPokoyApi.deleteIncome, IncomeStore.load/save, qPokoyCloudRemove,
applyIncomeHeaderFilters/renderIncomes and renderIncomeAnalytics. Captured
receivers, promises, in-flight maps, flush timers and idempotence markers remain
unchanged. It publishes no new API; its replacements are the existing hooks.

**DOM:** `#incomeAnalytics`, `.annual-total-desktop-head`, `.monthly-total-head`,
growth badges, `#annualHeroTotal`, `#monthlyHeroTotal`, `#incomeTotal`,
`#saveIncome`, `#incomeForm`, `.form-title`, `#incomeList`,
`#history #incomeList > .history-swipe-row`, delete controls. Creates canvas for
measurement and temporary `.qp-odometer*` spans; replaces total/odometer children.
It does not move persistent settings/account controls.

**Events:** MutationObserver/ResizeObserver, resize/orientationchange,
qpokoy:income-data-rendered, qpokoy:income-period-change, pointer/click arming,
touch/scroll/visibilitychange for render deferral, load for API wrapping.
**Storage/network:** no direct storage-key/fetch operations; optimistic removal
uses store load/save (the incomes cache), cloud removal uses the existing auth/API
chain. Wrapper removal would affect CRUD/swipe ordering and is deferred.

## notice.js

`qPokoyNoticeUI` owns only `window.qPokoyNotice(title,message,type)`, overlay
creation/replacement, escaped-via-textContent content, close/backdrop/Escape
handlers and rAF focus. `close` and `onKey` are private to that scope.

`qPokoyLegacyPageEnhancements` retains the four existing independent binders:
statistics mode swipe, date selection dismissal, add-income odometer animation,
calendar month/year navigation. They no longer share private lexical scope with
notification functions. Their order and DOMContentLoaded/immediate branch are
unchanged. They do not call notification-private functions.

**Replaces:** qPokoyNotice as before; date input's `select` method keeps its
coarse-pointer no-op/fine-pointer native behavior. No app/API methods replaced.
**DOM:** `#qpNoticeOverlay`/title/message/close button; `#incomeAnalytics` and
mode buttons; income date/form/save/total/title/calendar controls. Enhancements
create temporary odometer nodes, calendar year controls and the same existing
style elements. No permanent nodes transferred into HTML.
**Events:** modal click/keydown, touch gestures, pointerdown/click, scroll/blur,
MutationObservers, rAF/timers and DOMContentLoaded initialization.
**Storage/network:** none. Reads displayed total/date/calendar DOM, not the
income store or token. Notification state is separate from animation state.
Moving these binders to another script could change capture-handler/observer
registration timing, so that file-level move is deliberately not performed.

## backup-controls.js

The first IIFE is settings orchestration, not just backup. The new private
backup binder owns export/import capture listeners and input reset. It does not
mount billing or bind settings swipe. The existing `bind()` still orchestrates
all three in the original order. The second DEV relocation IIFE is unchanged.

**Reads/calls:** optional window.incomes, localStorage incomes, IncomeBackup
importData, qPokoyNotice/qPokoyConfirm (native confirm fallback), qPokoyApi
getToken/billingStatus/setBillingAutoRenew/request, qPokoySetSettingsTab.
No window functions replaced or published by this module.

**DOM created/moved:** billing settings/control IDs under qpAccountCard;
subscription term moved after qpAccountEmail, purchase before logout, existing
delete-account button moved into qpBillingDeleteWrap. DEV panel moves to
qpDataCard, refresh control is removed and existing note styling retained.
Backup uses exportDataBtn/importDataBtn/importDataInput; settings swipe uses
settings and its tab dataset. Temporary export anchor is appended/removed.

**Events:** export/import capture clicks and input change; billing action clicks;
settings touchstart/touchend; DOMContentLoaded/immediate initialization. No
auth events added. Billing refresh still occurs once at mounting and captures
the same API object at the same startup point.

**Storage/network:** reads `incomes`; exporter creates a local Blob/JSON download
and revokes its URL after 2000ms. Import delegates to IncomeBackup.importData.
Billing calls existing status/auto-renew API methods and DELETE
`/billing/payment-method`; purchase navigates to `./pricing.html`. No new requests.
No token storage manipulation.

**Two export paths retained intentionally:** the capture exporter here prefers
nonempty window.incomes, falls back to storage and canonicalizes dates. App's
IncomeBackup.exportData normalizes records, displays a notice, writes
incomeBackupLastAt and revokes at 1000ms. Removing one as an "equivalent duplicate"
would change observable behavior. Payload format/version and restore API remain
unchanged; the >500-record issue is not addressed.

## clear-data.js

This is primarily a read-only access adapter, plus a bulk-income clear UI.
It does NOT implement account deletion; auth.js owns that action/confirmation.

**Private action split:** clearAllIncomeData still checks readOnly and prompts.
Its existing confirmation callback directly returns runConfirmedIncomeClear's
promise. That helper contains the original disable → cloud await → finally
reenable/sync logic. No extra async forwarding/await layer is added. Missing hook,
false cloud result and rejection handling remain as before; no new local cleanup.

**Existing public APIs:** qPokoyCanWrite, qPokoyFocusAccessNotice,
qPokoyAccessState. Existing qPokoyAuthUserId assignment remains in API wrappers.
**Reads/replaces:** API bootstrap/billingStatus apply access; API write methods
reject in read-only mode; logout resets access/user ID even on failure; successful
deleteAccount resets them only after success. IncomeStore add/update/addMany/
remove guards retain their receiver/returns. qPokoyNotice wrapper suppresses
only the existing expired-access sync notice pattern. qPokoyCloudDeleteAll stays
the sole cloud action used by the clear prompt.

**DOM:** injected qpAccessReadOnlyStyles; prepended qpAccessReadOnlyBanner;
existing write-control selector, qpAccessLocked/qpAccessWasDisabled datasets and
aria-disabled/title state. On entering read-only, existing cancelIncome control
closes the editor. clearIncomeDataBtn's capture handler is unchanged.
**Events:** click/keydown capture guards, MutationObserver for newly rendered
controls/late notice publication, timer/load retries for notice wrapping,
qpokoy:access-change only when readOnly changes. init call order unchanged.
**Storage/network:** no direct storage keys/fetch; guards delegate to the same
existing methods. They do not own auth token or income journal cleanup.

## Verification and deferred work

Four additional tests exercise modal replacement/dismissal plus unchanged page
enhancements, export/import binding and account/DEV placement, cancelled vs
confirmed clear, rejection/finally and read-only lock. Existing suites also cover
auth, account changes, income CRUD, categories/history/analytics, subscription,
backup restore and responsive contracts. All use isolated mock-cloud/jsdom data;
this is not real browser E2E, animation/layout verification or live payment testing.

Deferred: physical relocation of legacy notice binders, hero's delete/render
bridges, full access/billing UI separation and export-path consolidation. These
would require deliberate lifecycle/ownership work rather than a small safe patch.
Permanent DOM extraction into HTML belongs to Stage 5 and is not started here.
