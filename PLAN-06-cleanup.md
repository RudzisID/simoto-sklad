# PLAN-06: Очистка и рефакторинг

> Дата: 2026-10-28
> Этап: Очистка (финальный)
> Зависимости: PLAN-05 (Docker собран)
> Цель: Удалить весь неиспользуемый код после переноса функциональности в simoto_main

---

## 1. Полное удаление

### 1.1. Routes (всё — Express больше не нужен)

| Файл | Причина |
|------|---------|
| `routes/api.js` | Заменено на `/admin/supplies/*` routes |
| `routes/sse.js` | Заменено на React Query polling |
| `routes/market.js` | Функционал не нужен (маркет-поиск) |
| `routes/debug.js` | Debug endpoint не нужен |

### 1.2. Lib (всё — заменено на Medusa модуль)

| Файл | Замена |
|------|--------|
| `lib/api-utils.js` | `MoySkladApiClient` + `MoySkladModuleService.getDecryptedToken()` |
| `lib/ms-rate-limited-fetch.js` | Встроено в `MoySkladApiClient` (rate limiting) |
| `lib/order.js` | `MoySkladApiClient.getCustomerOrder()`, `listCustomerOrders()` |
| `lib/check.js` | `SuppliesWarehouseService.checkOrder()` |
| `lib/demand.js` | `MoySkladApiClient.createDemand()` |
| `lib/payment.js` | `MoySkladApiClient.createPaymentIn()` |
| `lib/return.js` | `MoySkladApiClient.createSalesReturn()` |
| `lib/cancel.js` | `SuppliesWarehouseService.cancelOrder()` |
| `lib/product.js` | `MoySkladApiClient.getAssortmentByCodeOrArticle()` |
| `lib/print.js` | Не нужен (стикеры) |
| `lib/server-utils.js` | Удалено: файловое состояние; `loadOrdersState`, `saveOrdersState` |
| `lib/sort-utils.js` | Не нужен (сортировка в React) |
| `lib/sse-helper.js` | Не нужен (polling вместо SSE) |
| `lib/supplies.js` | `SuppliesWarehouseService.scanNewOrders()` |
| `lib/wb.js` | `WbClient` + `WBCache` model |
| `lib/ozon.js` | `OzonClient` + `OzonCache` model |
| `lib/TtlMap.js` | Не нужен (Redis + PostgreSQL TTL) |
| `lib/constants.js` | Не нужен (константы в Medusa workflows) |
| `lib/types.js` | Не нужен (TypeScript в simoto_main) |
| `lib/moysklad.js` | Не нужен (barrel re-export) |
| `lib/logger.js` | Заменено на Medusa Logger |

### 1.3. Integrations

| Файл | Замена |
|------|--------|
| `integrations/wb_ozon_sync.js` | `WbClient` + `OzonClient` в `modules/supplies-warehouse/utils/` |

### 1.4. Public (весь frontend)

| Файл/директория | Причина |
|---|---|
| `public/index.html` | Заменено на React Admin routes |
| `public/app.js` | Заменено на React компоненты |
| `public/styles.css` | Заменено на Tailwind CSS + @medusajs/ui |
| `public/sticker.js` | Не нужен (стикеры) |
| `public/data/versions.json` | Не нужен (история версий) |
| `public/images/` | Не нужен |
| `public/lib/xlsx*.js` | Не нужен (SheetJS через npm в simoto_main) |

### 1.5. Scripts (всё авто-пуш и версионирование)

| Файл | Причина |
|------|---------|
| `scripts/auto-push.js` | Не нужен (авто-пуш) |
| `scripts/sync-version.js` | Не нужен (версионирование) |
| `scripts/check-update.js` | Не нужен |
| `scripts/create-release.js` | Не нужен |
| `scripts/update.js` | Не нужен |
| `scripts/backfill-wb-data.js` | Не нужен (разовый скрипт) |
| `scripts/import-wb-orders-xlsx.js` | Не нужен (разовый скрипт) |
| `scripts/merge-cache-logs.js` | Не нужен (разовый скрипт) |
| `scripts/docs-generator.js` | Не нужен |
| `scripts/generate-cert.ps1` | Не нужен (certificates) |

### 1.6. Остальное

| Файл/директория | Причина |
|---|---|
| `server.js` | Заменено на Medusa backend |
| `github-push.bat` | Не нужен |
| `simoto-sklad.bat` | Не нужен |
| `cert/` | Не нужен (TLS через nginx) |
| `logs/` | Не нужен (логи в stdout) |
| `cache/` | Не нужен (PostgreSQL) |
| `node/` | Не нужен (bundled Node.js) |
| `test/` | Не нужен (тесты в simoto_main) |

---

## 2. Архивирование

| Файл | Куда |
|------|------|
| `market-push-for-future.js` | `archive/market-push-for-future.js` |
| `PLAN.md` | `archive/PLAN.md` |
| `FIX_PLAN.md` | `archive/FIX_PLAN.md` |
| `FIX-WB-STATUSES-PLAN.md` | `archive/FIX-WB-STATUSES-PLAN.md` |
| `TEST-PLAN.md` | `archive/TEST-PLAN.md` |
| `PLAN-compare-popup.md` | `archive/PLAN-compare-popup.md` |
| `CHANGELOG.md` | `archive/CHANGELOG.md` |
| `INSTRUCTION.md` | `archive/INSTRUCTION.md` |

---

## 3. Что остаётся в SiMOTO-sklad

После очистки в `SiMOTO-sklad/` останется:

```
SiMOTO-sklad/
├── PLAN-00-overview.md        ← архив плана (не удалять!)
├── PLAN-01-design.md          ← архив плана
├── PLAN-02-backend.md         ← архив плана
├── PLAN-03-frontend.md        ← архив плана
├── PLAN-04-integration.md     ← архив плана
├── PLAN-05-docker.md          ← архив плана
├── PLAN-06-cleanup.md         ← архив плана
├── README.md                  ← обновить (описать как часть simoto_main)
├── INTEGRATION.md             ← подробнейшая инструкция для агента
├── AGENTS.md                  ← оставить (правила стиля)
└── archive/                   ← архивные файлы
```

---

## 4. Обновить README.md

```markdown
# SiMOTO-sklad

> ⚠️ Этот проект был интегрирован в [simoto_main](https://github.com/...) 
> как модуль `supplies-warehouse`. Текущий код — архив плана интеграции.

## История

Автономный Express.js сервер для управления поставками и складом через 
МойСклад, Wildberries и Ozon. Интегрирован в simoto_main как модуль 
`supplies-warehouse` и вкладка в Medusa Admin.

## Документация интеграции

- [PLAN-00-overview.md](PLAN-00-overview.md) — архитектура и решения
- [PLAN-01-design.md](PLAN-01-design.md) — дизайн UI
- [PLAN-02-backend.md](PLAN-02-backend.md) — бэкенд
- [PLAN-03-frontend.md](PLAN-03-frontend.md) — фронтенд
- [PLAN-04-integration.md](PLAN-04-integration.md) — инструкция слияния
- [PLAN-05-docker.md](PLAN-05-docker.md) — Docker
- [PLAN-06-cleanup.md](PLAN-06-cleanup.md) — очистка
```

---

## 5. Создать INTEGRATION.md

Подробнейшая инструкция для агента по добавлению supplies-warehouse в simoto_main.
(Содержание из PLAN-04 + дополнительные детали)

---

## 6. Порядок выполнения

1. ✅ Перенести весь код в simoto_main (PLAN-02, PLAN-03)
2. ✅ Протестировать в simoto_main
3. ✅ Собрать Docker
4. ✅ Выкатить на staging
5. ⬜ Очистить SiMOTO-sklad (текущий план)
6. ⬜ Архивировать ненужное
7. ⬜ Обновить README.md
8. ⬜ Создать INTEGRATION.md
