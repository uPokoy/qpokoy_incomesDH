# qPokoy — Учёт доходов

Веб-приложение для личного учёта доходов: история, категории, месячная/годовая
аналитика, отчёты и синхронизация через API в Yandex Cloud Functions / YDB.

## Структура

- `index.html` — основное приложение и формы авторизации.
- `admin.html` — отдельный административный интерфейс; права проверяет backend.
- `about.html`, `service.html`, `offer.html`, `pricing.html`, `privacy.html` — публичные страницы.
- `js/`, `css/`, `icons/`, `manifest.json` — frontend без сборщика и module bundler.
- `backend/index.js` — Cloud Function entry point `index.handler`;
  `backend/app.js` — application routing; `backend/category-router.js` — routes категорий.
- `tests/` — frontend regression suite; `backend/test/` — backend tests.

Актуальная карта и подтверждённый технический долг:
[docs/architecture-current.md](docs/architecture-current.md).
Backend contracts/configuration: [backend/README.md](backend/README.md).
Документы этапов в `docs/` сохраняют историю архитектурного цикла, а не заменяют текущую карту.

## Проверки

CI использует Node.js 22. В корне проекта:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm check
```

В `backend/`:

```sh
npm ci
npm test
```

Эквивалентные команды без package runner: `node --test tests/*.test.js` в корне,
`node tests/helpers/check-project.js` в корне и `node --test` из `backend/`.
Frontend structural check проверяет внешний/inline JS, CSS, HTML IDs/tags и ссылки
на локальные ресурсы. Backend syntax checks (`node --check`) перечислены в
`.github/workflows/backend-build.yml`. Перед коммитом: `git diff --check`.
Это локальные regression/structural проверки, не real-browser E2E или проверка live YDB.

## Публикация

`Frontend deploy to Yandex Object Storage` публикует выбранные HTML, `manifest.json`
и каталоги `js/`, `css/`, `icons/` при push в main; DEV/cache-busters формируются
в подготовленной копии сайта. Загрузка объектов не атомарна.

`Backend check and package` проверяет код и создаёт source ZIP из **явного списка**
файлов. Новый backend runtime-модуль необходимо добавить в package list и syntax check.
Workflow не разворачивает Cloud Function или API Gateway. `Secret scan (advisory)`
информационный и не блокирует публикацию. Workflows не доказывают состояние live-инфраструктуры.
