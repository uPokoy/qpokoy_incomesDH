# Current architecture

Карта проверена в контексте Stage 9. Постоянные DEV/SHA здесь не фиксируются:
актуальные версии публикации вычисляет frontend deploy workflow.

## Frontend

`index.html` — основное приложение, auth и settings; `admin.html` — отдельный admin UI.
Публичные страницы: `about.html`, `service.html`, `offer.html`, `pricing.html`, `privacy.html`.
Это classic scripts/inline scripts и CSS, не SPA-framework/module-bundler build.

| Модуль | Ответственность |
| --- | --- |
| `js/api-client.js` | REST transport, bearer token, session-scoped revision-validated bootstrap cache; также сохранившиеся pricing DOM adjustments |
| `js/auth.js` | Auth/account UI, session restoration/bootstrap hydration, cloud conversion, per-user durable pending write journal, legacy cloud hooks |
| `js/categories.js` | Категории, manager UI, editor category options/inline creation; bootstrap hydration без повторного GET |
| `js/app.js` | IncomeStore/IncomeBackup, редактор/календарь, период, история, базовая аналитика, settings routes и window compatibility hooks |
| `js/analytics-month.js`, `js/analytics-year.js` | Дополнительная месячная/годовая аналитика поверх store/period/DOM contracts |
| `js/hero-overlap.js` | Hero/odometer presentation плюс render deferral и delete/store wrappers; не только layout |
| `js/notice.js`, `js/confirm.js` | Уведомления/подтверждения; notice также содержит отдельный private scope legacy page enhancements |
| `js/backup-controls.js`, `js/clear-data.js` | Backup/settings/billing orchestration; access/read-only adapter и подтверждённая bulk очистка |
| `js/report-print.js`, `js/accent.js` | Report/print/PDF UI; акцентные цвета |
| `js/admin*.js` | Admin dashboard/API UI и receipt/delete/polish/mobile adapters |

Внешние scripts в index загружаются в порядке:
api-client → categories → app → accent → confirm → backup-controls → report-print
→ clear-data → analytics-year → analytics-month → hero-overlap → notice → auth.
Между ними также есть inline scripts; этот список не заменяет полный порядок HTML.
API/categories публикуются до app; auth начинает bootstrap после supporting scripts.
В admin используются defer scripts: api-client → admin → admin-receipt → admin-delete
→ admin-ui-polish → admin-mobile. Порядок и DOM readiness — часть совместимости.

`qPokoyApi`, `qPokoyAuth`, `IncomeStore`, `IncomeBackup` и существующие window hooks
сохранены. Несколько adapters оборачивают методы, поэтому динамический lookup/receiver
важны. API владеет token/cache; auth — hydration/journal, категории — своим user state.
Bootstrap cache не является offline authorization: используется после серверной проверки.

Category manager и admin filter toggle уже находятся в HTML. Stage 5A fallback
конструирования и однократной binding через private element markers сохранён:
новый JS работает с legacy HTML без shell. Это не гарантирует совместимость любого
нового HTML с произвольно старым JS. Optional globals/guards и standalone formatter
fallbacks также не заменены новым module-loading contract.

CSS ownership многослойный: `main.css` — base; `components.css` — component/desktop
overrides; mobile-base/mobile/swipe — coarse/mobile layers; analytics-month и
monthly-card-alignment — analytics, с narrow/hero/year-compare слоями;
appearance/oauth-brand — пересекающиеся theme/auth/settings правила. Admin имеет
собственные base/receipt/platform/delete/polish/mobile CSS. Media и source order важны;
width не заменяет pointer:fine/coarse. Есть inline и JS-created styles.
Точный CSS load order и ограниченный cascade audit: [Stage 7](frontend-css-cleanup.md).

## Backend

- `backend/index.js`: `index.handler`, Gateway event adapter, base64/JSON/body cap,
  OPTIONS/CORS, response serialization, lazy services и transport admin list/receipt/delete.
- `backend/app.js`: public auth/OAuth/health/bootstrap, authentication, admin/application
  routing, billing/write-access, income/settings/account routes и общий error flow.
- `backend/category-router.js`: injected route group GET/POST `/categories`, DELETE
  `/categories/:id`. Вызывается после incomes и перед settings; ошибки идут в app catch.
- `backend/payment-router.js`, `billing-payments.js`, `yookassa.js`: payment routes,
  grants/metadata, provider HTTP; payment router идёт перед transport admin и app fallback.
- `backend/admin-billing.js`, `admin-receipt.js`: admin grant/receipt helpers; не весь admin routing.
- `backend/ydb-core.js`, `ydb.js`: store/queries/transactions/revisions/retries и production wrapper.
- `backend/security.js`, `oauth.js`, `mail.js`, `receipt-mail.js`: crypto/session primitives,
  Yandex OAuth adapter и metadata-IAM/Postbox mail.
- `backend/renewals.js`, `precharge-notifications.js`, `precharge-test.js`: отдельные
  worker/diagnostic entry points; не новые публичные Gateway routes.

API/auth/side-effect contracts и схема YDB не менялись в архитектурном цикле.
Подробности: [backend README](../backend/README.md), [Stage 8](backend-routing-stage8.md).

## Deploy and checks

Workflows: `Frontend deploy to Yandex Object Storage`, `Backend check and package`,
`Secret scan (advisory)`. Frontend workflow создаёт site copy, вычисляет версию по
истории коммитов и дате, обновляет generated HTML/runtime marker/cache-busters,
публикует объекты через S3 sync/copy. Оно не меняет source-файлы в Git.

Backend workflow выполняет npm ci/test, explicit syntax checks, создаёт ZIP командой
**zip -j с явным списком 19 файлов** (17 JS + package.json/package-lock.json).
Новый runtime-модуль обязательно добавлять в этот список и syntax check.
Workflow загружает artifact, но не deploy Cloud Function/Gateway. Проверять доступы,
env и live-инфраструктуру нужно отдельно; advisory secret scan не является блокирующей гарантией.

Frontend: `pnpm test` / `node --test tests/*.test.js`; structural/syntax:
`pnpm check` / `node tests/helpers/check-project.js`. Backend: `npm test` / `node --test`
**из backend/**. Syntax всех runtime backend JS: `node --check` по workflow list.
На проверке Stage 9: frontend 82/82, backend 125/125, skipped/todo 0. Backend discovery
включает precharge-test.js и test helper module; glob только test/*.test.js меняет число.
Локальные jsdom/VM/mock SDK tests не равны real-browser layout/E2E или live YDB verification.

## Known technical debt / intentionally deferred

- `/incomes/replace` принимает максимум 500 записей; JSON backup exporter не имеет
  этого лимита и может создать более крупный backup. Также есть транспортный cap 2 MiB.
- `js/app.js` остаётся крупным; auth соединяет UI и sync, supporting responsibilities
  распределены между файлами, сохраняются method wrappers и два разных export пути.
- Shared pure helpers не вынесены: exact semantics/edge cases отличаются, а новый
  обязательный script при mixed-version deploy создаёт load-order риск.
- CSS имеет сложные overrides/!important. Stage 7 удалил только две доказанно
  избыточные overflow declarations; общее упрощение analytics/auth/settings/admin отложено.
- Permanent billing/account UI, access banner, pager, report picker/modals и часть
  calendar/appearance helpers остаются runtime-created; Stage 5B вынес только два shell.
- Further backend route splitting возможно, но не требуется для текущей работы.
  App/transport остаются многозадачными; billing/access logic частично дублируется.
- FakeDriver не покрывает production path полностью: injected driver обходит ydb.js
  production wrapper. Mock production-wrapper tests также не заменяют live YDB smoke/query-plan/RU checks.
- Object deployment не атомарно заменяет сайт; stable paths и query cache-busters
  не дают immutable release. Mixed-version fallback и script order остаются важными.

Ничего из этого не исправляется на Stage 9. Stage-specific документы сохраняются:
[Stage 3](frontend-module-contracts.md), [Stage 4](frontend-supporting-responsibilities.md),
[Stage 5A](frontend-static-shell-compatibility.md), [Stage 5B](frontend-static-shell-stage5b.md),
[Stage 6](frontend-shared-pure-functions.md), [Stage 7](frontend-css-cleanup.md),
[Stage 8](backend-routing-stage8.md). Завершение цикла означает завершение согласованного
scope, а не устранение всего долга или доказательство корректности live deployment.
