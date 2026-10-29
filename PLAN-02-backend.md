# PLAN-02: Бэкенд — модели, сервисы, API routes

> Дата: 2026-10-28
> Обновлено после аудита: **запрещено менять simoto_main** — разделы 1 и 2 переписаны
> Этап: Бэкенд

> ## ⚠️ ВАЖНО (аудит)
> Исходные разделы 1 «Расширение MoySkladApiClient» и 2 «Расширение MoySkladConfig»
> **противоречат требованию пользователя**: «не внедрять свои новые функции в simoto_main».
> Актуальный подход:
> - MoySkladApiClient — **только использовать** (готовые методы + публичный `request()`)
> - moysklad_config — **не расширять**; WB/Ozon креды в собственных моделях плагина
> - Недостающие операции МС — в `src/utils/ms-http.ts` плагина через `client.request()`
---

## 1. Использование MoySkladApiClient (без модификации)

### 1.1. Готовые методы (прокси в MsHttp)

`createPaymentIn`, `getProductByCode`, `getAssortmentByCodeOrArticle`, `getStock`, `getStockByStore`,
`listOrganizations`, `listStores`, `listEmployees`, `createCounterparty`, `findCounterpartyByEmail`,
`createStockMove`, `listSalesChannels`, `getCustomerOrderFinance`, `getOperation`.

### 1.2. Недостающие операции (через публичный `client.request()`)

| Операция | Путь MS |
|----------|---------|
| customerorder с expand | `GET /entity/customerorder/{id}?expand=positions,demands,returns,state,agent,store,salesChannel` |
| поиск по номеру отправления | `GET /entity/customerorder?filter=description~{num}` |
| список заказов | `GET /entity/customerorder?filter=...&expand=...` |
| создать отгрузку | `POST /entity/demand` |
| создать возврат | `POST /entity/salesreturn` |
| сменить статус заказа | `PUT /entity/customerorder/{id}` |
| сменить статус отгрузки | `PUT /entity/demand/{id}` |
| очистить резервы | `POST /entity/customerorder/{id}/positions` |

> `client.request()` уже даёт: Bearer-auth, retry ×3, timeout 30s, семафор 5.

---

## 2. WB/Ozon креды — собственные модели

Вместо расширения `moysklad_config` используем модели плагина:
- `wb_config` (tenant_id, token_encrypted, ms_counterparty_href, is_active, cache_ttl_minutes, sync_enabled)
- `ozon_config` (tenant_id, credentials_encrypted, ms_counterparty_href, is_active, ...)

Шифрование: `encrypt`/`decrypt` из `modules/moysklad/utils/crypto.ts`.

---

## 3. Модуль supplies-warehouse

### 3.1. Модели

#### `models/supplies-order.ts`
```ts
const SuppliesOrder = model.define("supplies_order", {
  id: model.id().primaryKey(),
  tenant_id: model.text().searchable(),
  
  // MS data
  ms_order_href: model.text(),
  ms_order_name: model.text().nullable(),
  ms_order_moment: model.dateTime().nullable(),
  
  // Extracted data
  shipment_number: model.text().searchable(),  // Номер отправления WB/Ozon
  marketplace: model.text(),                   // "wb" | "ozon" | "unknown"
  order_sum: model.number().default(0),        // рубли
  paid_sum: model.number().default(0),         // рубли
  shipped_sum: model.number().default(0),      // рубли
  
  // Status
  status: model.text(),                        // kanban column id
  lifecycle_status: model.text().nullable(),    // MS lifecycle state name
  
  // Decision matrix
  can_demand: model.boolean().default(false),
  can_payment: model.boolean().default(false),
  can_return: model.boolean().default(false),
  can_cancel: model.boolean().default(false),
  
  // Relations
  demand_href: model.text().nullable(),
  payment_href: model.text().nullable(),
  return_href: model.text().nullable(),
  
  // Positions
  positions: model.json().nullable(),  // [{ oem, name, quantity, price, assortmentHref }]
  
  // Metadata
  last_checked_at: model.dateTime().nullable(),
  last_action: model.text().nullable(),
  last_action_at: model.dateTime().nullable(),
  last_action_by: model.text().nullable(),
  scan_data: model.json().nullable(),  // данные из WB/Ozon кэшей
})
```

#### `models/wb-cache.ts`
```ts
const WBCache = model.define("wb_cache", {
  id: model.id().primaryKey(),
  tenant_id: model.text().searchable(),
  cache_type: model.text(),       // "sales" | "returns" | "orders" | "analytics" | "stickers"
  cache_key: model.text(),        // уникальный ключ (например, "sales:2026-10-28")
  data: model.json(),
  last_refreshed_at: model.dateTime(),
  ttl_minutes: model.number().default(120),
  source: model.text().default("api"),  // "api" | "xlsx" | "manual"
})
```

#### `models/ozon-cache.ts`
```ts
const OzonCache = model.define("ozon_cache", {
  id: model.id().primaryKey(),
  tenant_id: model.text().searchable(),
  cache_type: model.text(),       // "returns" | "postings"
  cache_key: model.text(),
  data: model.json(),
  last_refreshed_at: model.dateTime(),
  ttl_minutes: model.number().default(120),
})
```

#### `models/supplies-action.ts`
```ts
const SuppliesAction = model.define("supplies_action", {
  id: model.id().primaryKey(),
  tenant_id: model.text().searchable(),
  order_id: model.text().searchable(),  // FK → supplies_order.id
  action_type: model.text(),            // "check" | "demand" | "payment" | "return" | "cancel"
  status: model.text(),                 // "success" | "error"
  
  actor_medusa_user_id: model.text().nullable(),
  actor_name: model.text().nullable(),
  
  ms_response: model.json().nullable(),
  error_message: model.text().nullable(),
  
  // Снимок состояния до/после
  before_status: model.text().nullable(),
  after_status: model.text().nullable(),
})
```

### 3.2. Service

#### `service.ts`

```ts
export class SuppliesWarehouseService extends MedusaService({
  SuppliesOrder, WBCache, OzonCache, SuppliesAction
}) {
  protected moyskladService_: any  // MoySkladModuleService (container resolve)
  
  // ========================================
  // TOKEN MANAGEMENT
  // ========================================
  
  /** Получить tenant-токен МС для сканирования */
  async getScanToken(tenantId: string): Promise<string>
  
  /** Получить user-токен МС для действий */
  async getActionToken(tenantId: string, userId: string): Promise<string>
  
  /** Получить WB токен */
  async getWbToken(tenantId: string): Promise<string | null>
  
  /** Получить Ozon credentials */
  async getOzonCredentials(tenantId: string): Promise<{ clientId: string; apiKey: string } | null>
  
  // ========================================
  // ORDER CHECK (основная операция)
  // ========================================
  
  /**
   * Проверить заказ по номеру отправления
   * 1. Найти customerorder в MS по номеру отправления (в description)
   * 2. Получить полные данные (state, positions, demands, payments, returns)
   * 3. Определить площадку (WB/Ozon) по контрагенту
   * 4. Проверить WB/Ozon кэши
   * 5. Рассчитать decision matrix
   * 6. Сохранить результат в SuppliesOrder
   */
  async checkOrder(tenantId: string, shipmentNum: string, userId: string): Promise<SuppliesOrder>
  
  /**
   * Проверить заказ по MS href (внутренняя операция)
   */
  async checkOrderInternal(tenantId: string, orderHref: string): Promise<SuppliesOrder>
  
  // ========================================
  // ACTIONS (используют user-токен)
  // ========================================
  
  /** Создать отгрузку (demand) */
  async createDemand(tenantId: string, orderId: string, userId: string): Promise<SuppliesOrder>
  
  /** Создать входящий платёж */
  async createPayment(tenantId: string, orderId: string, userId: string): Promise<SuppliesOrder>
  
  /** Создать частичный платёж (с учётом возвратов) */
  async createPartialPayment(tenantId: string, orderId: string, userId: string): Promise<SuppliesOrder>
  
  /** Создать возврат продаж */
  async createReturn(tenantId: string, orderId: string, userId: string, selectedOfferIds?: string[]): Promise<SuppliesOrder>
  
  /** Отменить заказ */
  async cancelOrder(tenantId: string, orderId: string, userId: string): Promise<SuppliesOrder>
  
  // ========================================
  // BATCH OPERATIONS
  // ========================================
  
  /**
   * Batch-обработка заказов
   * concurrency = 3 (как в текущем batch.js)
   * abort через Redis флаг
   */
  async processBatch(
    tenantId: string,
    orderIds: string[],
    action: "demand" | "payment" | "return" | "cancel",
    userId: string,
    onProgress?: (processed: number, total: number) => void
  ): Promise<{ success: string[]; failed: { id: string; error: string }[] }>
  
  // ========================================
  // SUPPLIES SCAN
  // ========================================
  
  /**
   * Сканировать новые заказы из MS для WB/Ozon
   * 1. Запрос customerorder с фильтром (counterparty WB/Ozon, дата создания)
   * 2. Для каждого заказа — checkOrderInternal
   * 3. Сохранить результат в SuppliesOrder
   * 4. Обновить прогресс в Redis
   */
  async scanNewOrders(
    tenantId: string,
    options: {
      storeId?: string
      marketplaces?: ("wb" | "ozon")[]
      dateFrom?: string
      dateTo?: string
    },
    userId: string
  ): Promise<{ scanned: number; new: number; updated: number }>
  
  /**
   * Получить прогресс сканирования из Redis
   */
  async getScanProgress(tenantId: string): Promise<{
    processed: number
    total: number
    wb: number
    ozon: number
    status: "idle" | "running" | "completed" | "cancelled"
  } | null>
  
  /**
   * Отменить сканирование (установить флаг в Redis)
   */
  async cancelScan(tenantId: string): Promise<void>
  
  // ========================================
  // CACHE MANAGEMENT
  // ========================================
  
  /** Обновить WB кэш (force или TTL-based) */
  async refreshWBCache(
    tenantId: string,
    cacheType: "sales" | "returns" | "orders" | "analytics",
    force: boolean = false
  ): Promise<{ refreshed: boolean; records: number }>
  
  /** Обновить Ozon кэш */
  async refreshOzonCache(
    tenantId: string,
    cacheType: "returns" | "postings",
    force: boolean = false
  ): Promise<{ refreshed: boolean; records: number }>
  
  /** Найти в WB/Ozon кэше по номеру отправления */
  async findInMarketplaceCaches(
    tenantId: string,
    shipmentNum: string
  ): Promise<{ wb: any | null; ozon: any | null }>
  
  // ========================================
  // KANBAN
  // ========================================
  
  /** Получить заказы для канбана с фильтрами */
  async getOrdersForKanban(
    tenantId: string,
    filters: {
      status?: string
      marketplace?: string
      storeId?: string
      dateFrom?: string
      dateTo?: string
    }
  ): Promise<SuppliesOrder[]>
  
  /** Обновить статус заказа (для drag-and-drop) */
  async updateOrderStatus(
    tenantId: string,
    orderId: string,
    newStatus: string,
    userId: string
  ): Promise<SuppliesOrder>
  
  /** Получить список складов для фильтра */
  async getStoreFilter(tenantId: string): Promise<Array<{ id: string; name: string }>>
  
  // ========================================
  // WAREHOUSE
  // ========================================
  
  /** Получить остатки склада */
  async getWarehouseStock(
    tenantId: string,
    storeId?: string,
    filters?: {
      brand?: string
      oem?: string
      lowStock?: boolean
    }
  ): Promise<Array<{
    assortmentHref: string
    name: string
    code: string
    article: string | null
    stock: number
    reserve: number
    inTransit: number
    price: number | null
    salePrice: number | null
  }>>
  
  // ========================================
  // INTERNAL
  // ========================================
  
  /**
   * Матрица решений — определить canDemand/canPayment/canReturn/canCancel
   */
  private calculateDecisionMatrix(order: any, wbCache: any, ozonCache: any): {
    canDemand: boolean
    canPayment: boolean
    canReturn: boolean
    canCancel: boolean
  }
  
  /**
   * Извлечь номер отправления из description customerorder
   */
  private extractShipmentNum(description: string): string | null
  
  /**
   * Определить площадку по контрагенту
   */
  private detectMarketplace(counterpartyHref: string): "wb" | "ozon" | "unknown"
  
  /**
   * Отправить realtime event через Redis pub/sub
   */
  private publishRealtimeEvent(tenantId: string, event: string, data: any): Promise<void>
}
```

### 3.3. Utils

#### `utils/ms-client.ts`

Обёртка над `MoySkladApiClient` для удобного использования в service:

```ts
export class MsClient {
  private client: MoySkladApiClient
  
  constructor(token: string) {
    this.client = new MoySkladApiClient(token)
  }
  
  // Все методы проксируют в MoySkladApiClient + добавляют специфичные для supplies
  
  async findOrderByShipmentNum(shipmentNum: string, counterpartyHrefs?: string[]) {
    // 1. Поиск по filter=description содержит shipmentNum
    // 2. Фильтрация по контрагентам WB/Ozon
    // 3. Получение полных данных с expand
  }
  
  async getFullOrder(orderHref: string) {
    return this.client.getCustomerOrder(orderHref)
  }
  
  async createDemandFromOrder(order: any) {
    return this.client.createDemand({
      customerOrder: { meta: order.meta },
      agent: { meta: order.agent.meta },
      organization: { meta: order.organization.meta },
      store: { meta: order.store.meta },
      salesChannel: order.salesChannel ? { meta: order.salesChannel.meta } : null,
      positions: order.positions.rows.map(p => ({ ... })),
    })
  }
  
  async createPaymentForDemand(order: any, demand: any, amount: number) {
    return this.client.createPaymentIn({
      sum: toKopecks(amount),
      agent: { meta: order.agent.meta },
      organization: { meta: order.organization.meta },
      operations: [{ meta: demand.meta, linkedSum: toKopecks(amount) }],
      description: `Оплата заказа ${order.name}`,
      applicable: true,
    })
  }
}
```

#### `utils/wb-client.ts`

WB Supplier API client (Content, Marketplace, Analytics):

```ts
export class WbClient {
  constructor(private token: string) {}
  
  // Content API
  async fetchCardsByName(name: string)
  async fetchCardsByCode(code: string)
  
  // Marketplace API (Supplier)
  async fetchOrders(dateFrom: string): Promise<WbOrder[]>
  async fetchSupplies(dateFrom: string)
  async fetchStocks(dateFrom: string)
  
  // Analytics API
  async fetchSales(dateFrom: string, dateTo: string)
  async fetchReturns(dateFrom: string, dateTo: string)
  
  // Common
  async findOrderByShipmentId(shipmentId: string, dateFrom?: string): Promise<WbOrder | null>
}
```

#### `utils/ozon-client.ts`

Ozon Seller API / Performance API:

```ts
export class OzonClient {
  constructor(private clientId: string, private apiKey: string) {}
  
  // Returns API
  async fetchReturns(dateFrom: string): Promise<OzonReturn[]>
  
  // Postings API
  async fetchPostings(dateFrom: string, status?: string): Promise<OzonPosting[]>
  async fetchPostingStatus(postingNumber: string): Promise<{ status: string; statusName: string }>
  
  // Products API
  async fetchProductInfo(productId: string)
  async fetchPrices()
  async fetchStores()
}
```

#### `utils/decision-matrix.ts`

Чистая функция для расчёта доступных действий:

```ts
export interface DecisionInput {
  orderState: string | null       // "new" | "delayed" | "shipped" | "cancelled" | "return"
  hasDemand: boolean
  hasReturn: boolean
  hasPayment: boolean
  payedSum: number
  orderSum: number
  shippedSum: number
  wbCacheData: any | null
  ozonCacheData: any | null
}

export interface DecisionResult {
  canDemand: boolean
  canPayment: boolean
  canReturn: boolean
  canCancel: boolean
  status: string                  // kanban column
  reason: string                  // причина текущего статуса
}

export function calculateDecision(input: DecisionInput): DecisionResult {
  // Матрица решений (8+ состояний):
  // 1. Cancelled → всё false, status="cancelled"
  // 2. Return → всё false, status="returned"
  // 3. Has demand + fully paid → status="paid"
  // 4. Has demand + not paid + WB/Ozon returned → canReturn=true, status="can_return"
  // 5. Has demand + not paid → canPayment=true, status="can_pay"
  // 6. New + can ship → canDemand=true, status="can_ship"
  // 7. Delayed → canDemand=true (нужен повторный статус)
  // 8. Fully paid + shipped → status="paid"
}
```

---

## 4. API Routes

### 4.1. Структура

```
apps/backend/src/api/admin/supplies/
├── route.ts                        ← GET — заказы канбана
├── scan/route.ts                   ← POST — запуск сканирования
├── scan-progress/route.ts          ← GET — прогресс сканирования
├── scan-cancel/route.ts            ← POST — отмена сканирования
├── [id]/route.ts                   ← GET — детали заказа
├── [id]/check/route.ts             ← POST — проверить заказ
├── [id]/demand/route.ts            ← POST — создать отгрузку
├── [id]/payment/route.ts           ← POST — создать платёж
├── [id]/partial-payment/route.ts   ← POST — частичный платёж
├── [id]/return/route.ts            ← POST — создать возврат
├── [id]/cancel/route.ts            ← POST — отменить заказ
├── batch/route.ts                  ← POST — batch-операции
├── wb-cache/route.ts               ← GET — статус WB кэша
├── wb-cache/refresh/route.ts       ← POST — принудительное обновление WB
├── ozon-cache/route.ts             ← GET — статус Ozon кэша
├── ozon-cache/refresh/route.ts     ← POST — принудительное обновление Ozon
├── stores/route.ts                 ← GET — список складов
└── warehouse/route.ts              ← GET — остатки склада
```

### 4.2. Middleware для токенов

```ts
// middleware.ts
export async function suppliesTokenMiddleware(req, res, next) {
  const tenant_id = await getConfiguredTenantId()
  
  // Для действий — user token
  const authIdentityId = req.auth?.identity_id
  const userToken = authIdentityId
    ? await moyskladService.getDecryptedUserToken(tenant_id, authIdentityId)
    : null
  
  // Для сканирования/чтения — tenant token
  const scanToken = await moyskladService.getDecryptedToken(tenant_id)
  
  req.supplies = {
    tenant_id,
    user_token: userToken,
    scan_token: scanToken,
    wb_token: await moyskladService.getWbToken(tenant_id),
    ozon_credentials: await moyskladService.getOzonCredentials(tenant_id),
  }
  next()
}
```

### 4.3. Пример route

```ts
// [id]/demand/route.ts
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  const { tenant_id, user_token } = req.supplies
  
  if (!user_token) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Требуется user token")
  }
  
  const service = req.scope.resolve("suppliesWarehouse") as SuppliesWarehouseService
  const result = await service.createDemand(tenant_id, id, req.auth.identity_id)
  
  res.json(result)
}
```

---

## 5. Workflows

### 5.1. `workflows/supplies-check-order.ts`

```
check-order:
  1. findOrderByShipmentNumStep — найти заказ в MS
  2. getFullOrderStep — получить полные данные
  3. lookupMarketplaceCachesStep — проверить WB/Ozon кэши
  4. calculateDecisionStep — рассчитать матрицу решений
  5. saveSuppliesOrderStep — сохранить в БД
  6. publishRealtimeStep — отправить event
```

### 5.2. `workflows/supplies-batch.ts`

```
supplies-batch:
  1. validateBatchStep — валидация списка заказов
  2. processBatchStep — параллельная обработка (concurrency=3)
  3. reportProgressStep — обновление прогресса в Redis
  4. finalizeBatchStep — результат
```

### 5.3. `workflows/supplies-scan.ts`

```
supplies-scan:
  1. refreshCacheIfNeededStep — обновить WB/Ozon кэши если stale
  2. listNewOrdersStep — запрос customerorder из MS с фильтром
  3. checkOrdersStep — параллельная проверка каждого заказа
  4. saveResultsStep — массовое сохранение в БД
  5. finalizeScanStep — завершение, realtime event
```

---

## 6. Background Jobs

### 6.1. `jobs/supplies-auto-scan.ts`

```ts
// Cron: каждые N минут (sync_interval из moysklad_config)
export default async function suppliesAutoScan(container: ContainerType) {
  const moyskladService = container.resolve("moysklad")
  const suppliesService = container.resolve("suppliesWarehouse")
  const tenant_id = getConfiguredTenantId()
  
  // Воркфлоу supplies-scan
  await container.resolve("workflows").run("supplies-scan", { tenantId: tenant_id })
}
```

### 6.2. `jobs/wb-ozon-cache-refresh.ts`

```ts
// Cron: каждые 30 минут
export default async function wbOzonCacheRefresh(container: ContainerType) {
  const suppliesService = container.resolve("suppliesWarehouse")
  const tenant_id = getConfiguredTenantId()
  
  await suppliesService.refreshWBCache(tenant_id, "sales")
  await suppliesService.refreshWBCache(tenant_id, "returns")
  await suppliesService.refreshOzonCache(tenant_id, "returns")
  await suppliesService.refreshOzonCache(tenant_id, "postings")
}
```

---

## 7. Регистрация в medusa-config.ts

```ts
modules: [
  // ...existing modules
  {
    resolve: "./src/modules/supplies-warehouse",
  },
  {
    resolve: "./src/modules/moysklad",  // уже есть, расширяем
  },
]

jobs: [
  {
    name: "supplies-auto-scan",
    schedule: "cron */30 * * * *",  // каждые 30 минут
    resolve: "./src/jobs/supplies-auto-scan",
  },
  {
    name: "wb-ozon-cache-refresh",
    schedule: "cron */30 * * * *",
    resolve: "./src/jobs/wb-ozon-cache-refresh",
  },
]
```
