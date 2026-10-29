# PLAN-00: Обзор переработки SiMOTO-sklad → Medusa Admin Plugin

> Дата: 2026-10-28
> Статус: черновик
> Цель: Преобразовать SiMOTO-sklad из автономного Express-сервера в модуль Medusa Admin (вкладка) в проекте simoto_main.

---

## 1. Архитектурные решения

### 1.1. Целевая архитектура
```
simoto_main/
└── apps/backend/src/
    ├── modules/moysklad/              ← существующий модуль (расширяем)
    │   ├── models/moysklad-config.ts  ← +WB/Ozon encrypted credentials
    │   └── service.ts                 ← +getCustomerOrder, createDemand, createSalesReturn
    ├── modules/supplies-warehouse/    ← НОВЫЙ модуль (основной)
    │   ├── models/                    ← SuppliesOrder, WBCache, OzonCache, SuppliesAction
    │   ├── service.ts                 ← SuppliesWarehouseService
    │   ├── utils/                     ← decision-matrix.ts, ms-client.ts, wb-client.ts, ozon-client.ts
    │   ├── index.ts                   ← Module export
    │   └── migrations/
    ├── api/admin/supplies/            ← REST endpoints
    ├── admin/routes/supplies/         ← React pages
    ├── admin/components/supplies/     ← React components
    └── jobs/supplies/                 ← Background jobs
```

### 1.2. Стратегия интеграции
- **Новый модуль `supplies-warehouse`** — sibling к `moysklad`, НЕ расширяет его напрямую
- **MoySkladApiClient** — переиспользуется для всех HTTP-запросов к МС (rate-limited, retry, timeout)
- **MoySkladModuleService** — импортируется для получения токенов, mapping codes
- **Криптография** — `encrypt/decrypt` из `moysklad/utils/crypto.ts` для WB/Ozon credentials
- **Tenant context** — `getConfiguredTenantId()` из `lib/tenant-context.ts`
- **Реалтайм** — Redis pub/sub как в `useKanbanRealtime`

### 1.3. Токены

| Операция | Источник токена | Где хранится |
|----------|----------------|--------------|
| Сканирование заказов МС | `moysklad_config.api_token` (tenant) | БД, шифрование AES-256-GCM |
| Обновление WB/Ozon кэшей | `moysklad_config.api_token` (tenant) | БД |
| Создание отгрузки (demand) | `ms_user_token.token_encrypted` (user) | БД, per-user |
| Создание платежа (paymentin) | `ms_user_token.token_encrypted` (user) | БД |
| Создание возврата (salesreturn) | `ms_user_token.token_encrypted` (user) | БД |
| Отмена заказа | `ms_user_token.token_encrypted` (user) | БД |
| WB API вызовы | `moysklad_config.wb_token_encrypted` (tenant) | БД |
| Ozon API вызовы | `moysklad_config.ozon_credentials_encrypted` (tenant) | БД |

---

## 2. Переиспользование из simoto_main

### 2.1. MoySkladApiClient (lib/moysklad-api-client.ts) — 1565 строк

| Метод MoySkladApiClient | Подходит для SiMOTO-sklad? | Почему |
|------------------------|:---:|------|
| `createPaymentIn(data)` | ✅ Полностью | Логика идентична lib/payment.js |
| `getProductByCode(code)` | ✅ Полностью | Поиск товара |
| `getAssortmentByCodeOrArticle(val)` | ✅ Полностью | Поиск по коду/артикулу |
| `getStock()` / `getStockByStore(href)` | ✅ Полностью | Остатки для вкладки "Склад" |
| `listOrganizations()` | ✅ Полностью | Справочник |
| `listStores()` | ✅ Полностью | Список складов для фильтра |
| `listEmployees()` | ✅ Полностью | Справочник |
| `createCounterparty(data)` | ✅ Полностью | Создание контрагента |
| `findCounterpartyByEmail(email)` | ✅ Полностью | Поиск контрагента |
| `createStockMove(data)` | ✅ Полностью | Перемещение между складами |
| `getCustomerOrderFinance(href)` | ⚠️ Частично | Даёт sum/paidSum/shippedSum, **НО НЕ даёт** state, demands, returns |
| `getOperation(href)` | ⚠️ Частично | Даёт операцию + positions, **НО НЕ даёт** state, demands, returns |
| `findCustomerOrderByNumber(num)` | ❌ Не подходит | Ищет по `name` (номер МС "000047"), а нужен поиск по `description` (номер отправления WB "WB-1234567") |
| `createCustomerOrder(data)` | ❌ Не нужен | Заказы **уже существуют** (приходят из маркетплейсов), создавать новые не нужно |
| — | ❌ **Добавить** | `getCustomerOrder(href)` — GET customerorder с expand (state, demands, returns, payments, positions). **Необходим** для checkOrder — getCustomerOrderFinance недостаточна |
| — | ❌ **Добавить** | `createDemand(data)` — POST /entity/demand. В simoto_main нигде не создаётся |
| — | ❌ **Добавить** | `createSalesReturn(data)` — POST /entity/salesreturn. В simoto_main нигде не создаётся |
| — | ❌ **Добавить** | `changeOrderState(orderHref, stateHref)` — PUT статуса customerorder (DELAYED, CANCELLED, RETURN) |
| — | ❌ **Добавить** | `clearOrderReserves(orderHref)` — POST positions с reserve=0 (для отмены) |
| — | ❌ **Добавить** | `listCustomerOrders(filter)` — GET списка с фильтром (по контрагенту, дате, статусу) |

### 2.1.1. Безопасность добавления методов в MoySkladApiClient

Все методы для добавления (`getCustomerOrder`, `createDemand`, `createSalesReturn`, `changeOrderState`, `clearOrderReserves`, `listCustomerOrders`):

- **Не меняют** существующие методы — только добавляют новые
- **Не влияют** на существующие workflow (sync-order-to-moysklad, create-ms-task, sync-ms-task)
- **Используют** тот же `request()` с retry/rate-limit/timeout
- **Не создают** конфликтов с существующими HTTP endpoints (нет дублирования GET/POST)
- **Безопасны** для production — это общеполезные методы, которые могут использоваться другими workflow

### 2.1.2. Почему `getCustomerOrder(href)` необходим

- `getCustomerOrderFinance` — только sum/paidSum/shippedSum + позиции
- Для `checkOrder` нужны: **state** (статус заказа), **demands** (отгрузки), **returns** (возвраты), **payments** (платежи), **positions** (с reserves)
- Без `getCustomerOrder` невозможно определить: canDemand, canPayment, canReturn, canCancel
- Альтернатива — raw HTTP запрос в `utils/ms-client.ts`, но это дублирование логики retry/rate-limit

### 2.2. MoySkladModuleService — 2513 строк

| Метод | Использование |
|-------|---------------|
| `getDecryptedToken(tenantId)` | Получить tenant-токен для сканирования/кэша |
| `getDecryptedUserToken(tenantId, userId)` | Получить user-токен для действий |
| `listMsCodeMappings(filter)` | Получить mapping кодов |
| `createRealtimeEvent(data)` | Отправить realtime-событие в канбан |

### 2.3. Workflow sync-order-to-moysklad — 539 строк

Использовать как **reference** для:
- Паттерна resolve counterparty → resolve products → create order → create payment
- Структуры workflow steps
- Обработки ошибок

### 2.4. Admin UI patterns

| Компонент/паттерн | Файл | Переиспользование |
|---|---|---|
| Канбан-доска (drag-drop) | `admin/routes/tasks/page.tsx` | Шаблон для supplies kanban |
| `useKanbanRealtime` | `admin/hooks/use-kanban-realtime.ts` | Шаблон для realtime polling |
| `defineRouteConfig` | — | Регистрация admin routes |
| `Medusa SDK` | `@medusajs/js-sdk` | API вызовы из React |
| `lexorank` | `lib/lexorank.ts` | Sort keys для канбана |
| `@medusajs/ui` | — | UI компоненты (DropdownMenu, FocusModal, toast) |

---

## 3. Что создаётся с нуля (специфичное для supplies-warehouse)

### 3.1. Модели данных
- `SuppliesOrder` — заказы поставок (из MS customerorder)
- `WBCache` — кэш WB API (sales, returns, orders, analytics)
- `OzonCache` — кэш Ozon API (returns, postings)
- `SuppliesAction` — история действий над заказами

### 3.2. WB/Ozon API clients
- `wb-client.py`/`wb-client.ts` — WB Supplier API (Content, Marketplace, Analytics)
- `ozon-client.ts` — Ozon Performance API / Seller API

### 3.3. Decision matrix
- Матрица решений canDemand/canPayment/canReturn/canCancel на основе:
  - Статуса customerorder (state)
  - Наличия demands/returns
  - Данных WB/Ozon кэшей
  - Финансов (payedSum, shippedSum)

### 3.4. React UI
- `kanban-board.tsx` — канбан с колонками статусов
- `kanban-card.tsx` — карточка заказа
- `order-detail-modal.tsx` — модал деталей + кнопки действий
- `warehouse-stock-table.tsx` — таблица остатков
- `scan-controls.tsx` — управление сканированием
- `progress-modal.tsx` — прогресс polling

### 3.5. Background jobs
- `supplies-auto-scan.ts` — авто-сканирование новых заказов
- `wb-ozon-cache-refresh.ts` — обновление кэшей

---

## 4. Чего НЕ будет (удаляется)

- `routes/market.js` — маркетплейс-поиск (функционал не нужен)
- `routes/debug.js` — debug endpoint
- `public/data/versions.json` — история версий
- `scripts/auto-push.js`, `github-push.bat` — авто-пуш
- `scripts/sync-version.js`, `scripts/check-update.js`, `scripts/create-release.js`, `scripts/update.js` — версионирование
- `cert/` — самоподписанные сертификаты
- HTTPS-сервер (PORT+443)
- `lib/server-utils.js` → `loadOrdersState`/`saveOrdersState` (файловое состояние)
- `routes/sse.js` → SSE streams (замена на polling)
- `public/app.js` → 7985 строк frontend (замена на React)

---

## 5. План по этапам

| Файл | Этап | Что делаем |
|------|------|------------|
| `PLAN-00-overview.md` | Обзор | Архитектура, переиспользование, решения |
| `PLAN-01-design.md` | **Дизайн** | Переделка UI под канбан Medusa (первый этап) |
| `PLAN-02-backend.md` | Бэкенд | Модели, сервисы, API routes, интеграция с MoySkladApiClient |
| `PLAN-03-frontend.md` | Фронтенд | React компоненты, канбан, модалы, polling |
| `PLAN-04-integration.md` | Интеграция | Слияние с simoto_main, инструкция для агента |
| `PLAN-05-docker.md` | Docker | Dockerfile, compose, environment |
| `PLAN-06-cleanup.md` | Очистка | Что удалить, что заархивировать |

---

## 6. Ключевые принципы

1. **Максимальное переиспользование** — не писать заново то, что уже есть в MoySkladApiClient/MoySkladModuleService
2. **Zero duplication** — если код уже есть в simoto_main, импортировать, не копировать
3. **Medusa patterns** — следовать стандартам Medusa (Module → Service → Model → Workflow)
4. **Kanban-first** — дизайн под канбан с drag-and-drop (как tasks)
5. **Token separation** — tenant token для чтения/сканирования, user token для записи/действий
6. **SSE → Polling** — замена на React Query polling (как kanban tasks)
7. **Файловые кэши → PostgreSQL** — WB/Ozon кэши в БД с TTL через updated_at
