# PLAN-00-revised: Изолированный плагин supplies-warehouse

> Дата: 2026-10-28
> Статус: пересмотрен
> Ключевое изменение: **полная изоляция — ноль изменений в simoto_main**

---

## 1. Архитектурные решения

### 1.1. Принцип изоляции

**Изменять simoto_main запрещено.** Весь новый код — в отдельном плагине внутри SiMOTO-sklad.

Единственное требование к simoto_main — **регистрация плагина** в `medusa-config.ts` (одна строка):
```ts
modules: [
  { resolve: "./src/modules/supplies-warehouse" }  // ← только добавление этой строки
]
```

### 1.2. Целевая архитектура (внутри simoto_main, после добавления строки)

```
simoto_main/apps/backend/src/
├── modules/moysklad/              ← СУЩЕСТВУЮЩИЙ, НЕ ТРОГАЕМ
│   ├── models/moysklad-config.ts  ← НЕ МЕНЯЕМ
│   └── service.ts                 ← НЕ МЕНЯЕМ
├── modules/supplies-warehouse/    ← НОВЫЙ ПЛАГИН (всё изолированно)
│   ├── models/
│   │   ├── supplies-order.ts
│   │   ├── wb-config.ts           ← WB credentials (свой, не в moysklad_config!)
│   │   ├── ozon-config.ts         ← Ozon credentials (свой)
│   │   ├── wb-cache.ts
│   │   ├── ozon-cache.ts
│   │   └── supplies-action.ts
│   ├── service.ts                 ← SuppliesWarehouseService
│   ├── utils/
│   │   ├── ms-http.ts             ← СВОЙ HTTP-клиент для МС API (не трогаем MoySkladApiClient!)
│   │   ├── wb-client.ts           ← WB API клиент
│   │   ├── ozon-client.ts         ← Ozon API клиент
│   │   ├── decision-matrix.ts     ← Матрица решений
│   │   └── crypto.ts              ← СВОЯ криптография (не импортируем из moysklad!)
│   ├── api/                       ← API routes
│   ├── admin/                     ← React routes
│   ├── jobs/                      ← Background jobs
│   ├── workflows/                 ← Medusa workflows
│   └── index.ts                   ← Module export
```

### 1.3. Стратегия интеграции — «максимальное переиспользование, ноль вторжений»

| Аспект | Подход |
|--------|--------|
| Токены МС | DI: `container.resolve("moysklad").getDecryptedToken()` / `getDecryptedUserToken()` |
| HTTP-клиент для МС | **Используем** `MoySkladApiClient` как есть: готовые методы + **публичный `client.request()`** для недостающих (retry/rate-limit/timeout из коробки). Класс НЕ модифицируем |
| Шифрование | **Импортируем** `encrypt`/`decrypt` из `modules/moysklad/utils/crypto.ts` — свой crypto.ts не нужен |
| Tenant helpers | **Импортируем** `normalizeTenantId`/`assertTenantId` из `modules/moysklad/utils/tenant.ts` |
| WB/Ozon credentials | **Свои** модели (wb-config, ozon-config) — в `moysklad_config` не лезем |
| Medusa UI patterns | Импортируем из `@medusajs/admin-sdk`, `@medusajs/ui` |
| Realtime | Redis pub/sub через свой Redis клиент |
| Код simoto_main | **Не изменяем.** Только импорт + регистрация модуля в `medusa-config.ts` |

### 1.4. Токены

| Операция | Источник | Как получить |
|----------|----------|-------------|
| Сканирование заказов МС | `moysklad_config.api_token` (tenant) | `moyskladService.getDecryptedToken(tenantId)` |
| Обновление WB/Ozon кэшей | `moysklad_config.api_token` (tenant) | `moyskladService.getDecryptedToken(tenantId)` |
| Создание отгрузки (demand) | `ms_user_token.token_encrypted` (user) | `moyskladService.getDecryptedUserToken(tenantId, userId)` |
| Создание платежа (paymentin) | `ms_user_token.token_encrypted` (user) | `moyskladService.getDecryptedUserToken(tenantId, userId)` |
| Создание возврата (salesreturn) | `ms_user_token.token_encrypted` (user) | `moyskladService.getDecryptedUserToken(tenantId, userId)` |
| Отмена заказа | `ms_user_token.token_encrypted` (user) | `moyskladService.getDecryptedUserToken(tenantId, userId)` |
| WB API вызовы | `wb_config.token_encrypted` (tenant) | Свой `wbConfig.getConfig(tenantId)` + `crypto.decrypt()` |
| Ozon API вызовы | `ozon_config.credentials_encrypted` (tenant) | Свой `ozonConfig.getConfig(tenantId)` + `crypto.decrypt()` |

---

## 2. Переиспользование из simoto_main (только как библиотека)

### 2.1. MoySkladApiClient — импортируем, не меняем

Используем существующие методы как **библиотеку** (создаём экземпляр, вызываем методы).

| Метод | Используем? | Почему |
|-------|:---:|--------|
| `createPaymentIn(data)` | ✅ | Готово, логика идентична lib/payment.js |
| `getProductByCode(code)` | ✅ | Поиск товара |
| `getAssortmentByCodeOrArticle(val)` | ✅ | Поиск по коду/артикулю |
| `getStock()` / `getStockByStore(href)` | ✅ | Остатки для "Склад" |
| `listOrganizations()` | ✅ | Справочник |
| `listStores()` | ✅ | Список складов для фильтра |
| `listEmployees()` | ✅ | Справочник |
| `createCounterparty(data)` | ✅ | Создание контрагента |
| `findCounterpartyByEmail(email)` | ✅ | Поиск контрагента |
| `createStockMove(data)` | ✅ | Перемещение |
| `getCustomerOrderFinance(href)` | ⚠️ | Только sum/paidSum/shippedSum, НЕТ state/demands/returns |
| `getOperation(href)` | ⚠️ | Только операция + positions |
| `findCustomerOrderByNumber(num)` | ❌ | Поиск по name, а нужен по description |
| `createCustomerOrder(data)` | ❌ | Не нужен (заказы уже существуют) |

### 2.2. Чего нет в MoySkladApiClient — реализуем сами

| Операция | Реализация |
|----------|-----------|
| GET customerorder с expand (state, demands, returns, payments) | Свой `MsHttp.getCustomerOrder(href)` |
| POST /entity/demand | Свой `MsHttp.createDemand(data)` |
| POST /entity/salesreturn | Свой `MsHttp.createSalesReturn(data)` |
| PUT статуса customerorder | Свой `MsHttp.changeOrderState(href, stateHref)` |
| POST /positions (очистка резервов) | Свой `MsHttp.clearReserves(href)` |
| GET customerorder с фильтром (по description) | Свой `MsHttp.listCustomerOrders(filter)` |
| POST /demand (смена статуса) | Свой `MsHttp.changeDemandState(href, stateHref)` |

### 2.3. MoySkladModuleService — только DI для токенов

```ts
// В плагине:
const moyskladService = container.resolve("moysklad") as any
const token = await moyskladService.getDecryptedToken(tenantId)
```

Используем только `getDecryptedToken` и `getDecryptedUserToken` — публичные методы, которые уже используются в workflow sync-order-to-moysklad.

### 2.4. UI patterns — импортируем как библиотеку

```ts
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Medusa } from "@medusajs/js-sdk"
import { DropdownMenu, FocusModal, toast, Badge } from "@medusajs/ui"
```

---

## 3. Структура MsHttp — обёртка над MoySkladApiClient

### 3.1. Принцип

`MsHttp` **не дублирует** HTTP-логику:
- Готовые методы `MoySkladApiClient` — проксируются напрямую
- Недостающие методы — через **публичный** `client.request<T>(path, options)`, который уже даёт Bearer-auth, retry ×3, timeout 30s и семафор на 5 конкурентных запросов
- `MoySkladApiClient` НЕ модифицируется

> Важно: `baseUrl` — **приватное** поле `MoySkladApiClient`. Использовать `${this.client.baseUrl}` нельзя (TS-ошибка). Для построения href статусов есть константа `BASE_URL` и экспорт `getMsBaseUrl()`.

```ts
class MsHttp {
  private client: MoySkladApiClient

  constructor(token: string) {
    this.client = new MoySkladApiClient(token)
  }

  // 1) Готовые методы — прокси
  createPaymentIn(data) { return this.client.createPaymentIn(data) }
  getProductByCode(code) { return this.client.getProductByCode(code) }
  getStockByStore(href) { return this.client.getStockByStore(href) }
  getCustomerOrderFinance(href) { return this.client.getCustomerOrderFinance(href) }
  listStores() { return this.client.listStores() }

  // 2) Недостающие — через публичный request()
  getCustomerOrder(href: string) {
    return this.client.request(`/entity/customerorder/${this.extractUuid(href)}?expand=positions,demands,returns,state,agent,store,salesChannel`)
  }

  createDemand(data) {
    return this.client.request("/entity/demand", { method: "POST", body: JSON.stringify(data) })
  }

  findOrderByShipmentNum(num: string) {
    return this.client.request(`/entity/customerorder?filter=description~${encodeURIComponent(num)}&expand=positions,demands,returns,state,agent`)
  }
}
```

### 3.2. Обязательные требования к expand

- `customerorder` **не имеет** поля `payments` — платежи получать из `demand.payments`
- Валидные expand: `positions`, `demands`, `returns`, `state`, `agent`, `store`, `salesChannel`
- Ответ MS нормализовать: `positions` может быть массивом или `{ rows: [] }` — нужен хелпер `normalizeRows()`
- `getOperation()` НЕ возвращает `payments` — для проверки существующих платежей запрашивать demand с `expand=payments`

---

## 4. Криптография

**Свой crypto.ts не создаём.** Импортируем существующий:

```ts
import { encrypt, decrypt } from "../../../../modules/moysklad/utils/crypto"
```

Тот же AES-256-GCM, ключ `MOYSKLAD_ENCRYPTION_KEY` (64 hex) — формат шифротекста совместим с `moysklad_config`.

---

## 5. План по этапам

| Файл | Этап | Статус |
|------|------|--------|
| `PLAN-00-revised.md` | Обзор + интеграция | ✅ актуален (обновлён) |
| `PLAN-01-design.md` | Дизайн React-версии | ⚠️ устарел: канбан отменён, нужен табличный вид |
| `PLAN-02-backend.md` | Бэкенд | ⚠️ требует правки: §1–2 противоречат запрету менять simoto_main |
| `PLAN-03-frontend.md` | Фронтенд | ⚠️ устарел: канбан-компоненты не нужны |
| `PLAN-04-integration.md` | Интеграция | ⚠️ требует правки: шаги «расширить MoySkladApiClient/Config» запрещены |
| `PLAN-05-docker.md` | Docker | ✅ актуален |
| `PLAN-06-cleanup.md` | Очистка | ✅ актуален |

**Отдельный трек (выполняется сейчас):** переделка дизайна *текущего Express-приложения* (`public/styles.css`) под storefront-canvas — чтобы визуал проверялся через `simoto-sklad.bat` без сборки Medusa.

---

## 6. Ключевые принципы

1. **Не вторгаться в simoto_main** — не добавляем методы в `MoySkladApiClient`, не меняем `moysklad_config`; только импорт и одна строка регистрации модуля
2. **MsHttp** — тонкая обёртка: прокси готовых методов + `client.request()` для недостающих
3. **Свои модели для WB/Ozon** — не расширяем `moysklad_config`
4. **Криптография — импорт** `encrypt`/`decrypt` из `modules/moysklad/utils/crypto.ts`
5. **DI для токенов** — `container.resolve("moysklad").getDecryptedToken()` (как в существующих workflow)
6. **Medusa patterns** — Module → Service → Model → Workflow → API route → Admin route

---

## 7. Обязательные исправления из ревью (блокеры)

| # | Проблема | Файл | Статус |
|---|----------|------|--------|
| 1 | `moyskladService_` не инициализируется (DI отсутствует) | `src/services/supplies-warehouse.ts` | ✅ геттер через `__container__["moysklad"]` (awilix cradle) |
| 2 | API routes отсутствуют | `src/api/admin/supplies/` | ✅ 9 route-файлов создано |
| 3 | Миграции отсутствуют | `migrations/` | ⏳ генерируются в simoto_main: `npx medusa db:generate supplies-warehouse` |
| 4 | `shipped_sum` вместо `shippedSum` | `src/services/supplies-warehouse.ts` | ✅ |
| 5 | Redis `lazyConnect: true` без `.connect()` | `src/services/supplies-warehouse.ts` | ✅ `getRedis()` + memory-fallback |
| 6 | Невалидный expand `payments` / `organization.store` | `src/utils/ms-http.ts` | ✅ + отдельный `getDemand()` с `expand=payments` |
| 7 | `getOperation()` не содержит `payments` | `src/services/supplies-warehouse.ts` | ✅ заменён на `getDemand()` |
| 8 | Нет нормализации `positions` | `src/utils/ms-http.ts` | ✅ `normalizeRows()` применён по всему сервису |
| 9 | UUID статусов из `process.env` | `src/utils/decision-matrix.ts` | ✅ модель `StatusMapping` + `resolveStateHref()` + API |
| 10 | React handlers — пустые TODO | `src/admin/routes/supplies/` | ⏳ следующий шаг |

**API routes (созданы):**
- `GET  /admin/supplies` — список (фильтры)
- `GET  /admin/supplies/:id` — детали
- `POST /admin/supplies/scan` — запуск сканирования (202 + polling)
- `GET/POST /admin/supplies/scan-progress` — прогресс / отмена
- `POST /admin/supplies/action` — demand|payment|return|cancel (user-токен)
- `GET  /admin/supplies/warehouse` — остатки
- `POST /admin/supplies/refresh` — обновление кэшей WB/Ozon
- `GET/POST /admin/supplies/settings` — настройки (секреты шифруются)
- `GET/POST /admin/supplies/status-mapping` — маппинг статусов + `?discover=1`
