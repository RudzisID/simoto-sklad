# PLAN-04: Интеграция с simoto_main

> Дата: 2026-10-28
> Этап: Интеграция (слияние)
> Зависимости: PLAN-01..03 (одобрены)
> Цель: Подробнейшая инструкция для агента по добавлению supplies-warehouse в simoto_main

---

## 1. Предварительные проверки

Перед началом интеграции агент должен проверить:

- [ ] simoto_main на ветке `main`, `git status` чистый
- [ ] Node.js >= 24, npm >= 11
- [ ] PostgreSQL запущен и доступен
- [ ] Redis запущен (для webhooks и realtime)
- [ ] `npx medusa develop` запускается без ошибок

---

## 2. Шаг 1: ~~Расширить MoySkladApiClient~~ — ОТМЕНЕНО

> ⚠️ Аудит: этот шаг **запрещён** (нельзя менять simoto_main).
> Вместо расширения класса — недостающие операции живут в `supplies-warehouse/src/utils/ms-http.ts`
> и вызываются через публичный `MoySkladApiClient.request()`.

## 3. Шаг 2: ~~Расширить MoySkladConfig model~~ — ОТМЕНЕНО

> ⚠️ Аудит: `moysklad_config` **не трогаем**.
> WB/Ozon креды храним в собственных моделях плагина: `wb_config`, `ozon_config`.
## 4. Шаг 3: Создать миграции

```bash
cd apps/backend
npx medusa db:generate moysklad
npx medusa db:generate supplies-warehouse
```

---

## 5. Шаг 4: Создать модуль supplies-warehouse

### 5.1. Структория

```
apps/backend/src/modules/supplies-warehouse/
├── index.ts
├── service.ts
├── models/
│   ├── index.ts
│   ├── supplies-order.ts
│   ├── wb-cache.ts
│   ├── ozon-cache.ts
│   └── supplies-action.ts
├── utils/
│   ├── decision-matrix.ts
│   ├── ms-client.ts
│   ├── wb-client.ts
│   └── ozon-client.ts
└── migrations/
```

### 5.2. index.ts

```ts
import { SuppliesWarehouseService } from "./service"
import { SuppliesOrder, WBCache, OzonCache, SuppliesAction } from "./models"

const ModuleService = SuppliesWarehouseService

export const Module = "suppliesWarehouse"

export default {
  service: ModuleService,
  model: [SuppliesOrder, WBCache, OzonCache, SuppliesAction],
}
```

---

## 6. Шаг 5: Создать API routes

**Директория:** `apps/backend/src/api/admin/supplies/`

Копировать структуру из PLAN-02 §4.1. Каждый route.ts:

```ts
// Шаблон для всех routes
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, ContainerRegistrationKeys } from "@medusajs/framework/utils"

export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const suppliesService = req.scope.resolve("suppliesWarehouse") as SuppliesWarehouseService
  
  // Tenant из контекста
  const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as any
  const tenant = await knex("moysklad_config")
    .where("is_active", true)
    .whereNull("deleted_at")
    .first()
  const tenantId = tenant?.tenant_id ?? "default"
  
  // User из auth
  const userId = req.auth?.identity_id ?? ""
  
  // Вызов сервиса
  const result = await suppliesService.createDemand(tenantId, req.params.id, userId)
  
  res.json(result)
}
```

---

## 7. Шаг 6: Создать admin routes (React)

**Директория:** `apps/backend/src/admin/routes/supplies/supplies/`

```tsx
// page.tsx
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Medusa } from "@medusajs/js-sdk"
import { useQuery } from "@tanstack/react-query"
import { KanbanBoard } from "../../components/supplies/kanban-board"
import { ScanControls } from "../../components/supplies/scan-controls"

export const config = defineRouteConfig({ label: "Канбан поставок", rank: 50 })

// ... (полная реализация из PLAN-03 §2.1)
```

---

## 8. Шаг 7: Зарегистрировать в medusa-config.ts

```ts
// medusa-config.ts
modules: [
  // ...existing modules
  {
    resolve: "./src/modules/supplies-warehouse",
    options: {
      // если нужны опции
    },
  },
]

// Jobs (если используется Medusa jobs scheduler)
// Или через отдельный scheduler (node-cron)
```

---

## 9. Шаг 8: Создать background jobs

**Директория:** `apps/backend/src/jobs/supplies/`

```ts
// auto-scan.ts
import { MedusaContainer } from "@medusajs/framework/types"

export default async function suppliesAutoScan(container: MedusaContainer) {
  const suppliesService = container.resolve("suppliesWarehouse")
  const moyskladService = container.resolve("moysklad")
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  
  // Получить все активные тенанты
  const configs = await moyskladService.listMoySkladConfigs({ is_active: true })
  
  for (const config of configs) {
    try {
      logger.info(`[Supplies] Auto-scan for tenant ${config.tenant_id}`)
      const result = await suppliesService.scanNewOrders(
        config.tenant_id,
        { dateFrom: new Date(Date.now() - 14 * 86400000).toISOString() },
        "system"
      )
      logger.info(`[Supplies] Scan complete: ${result.scanned} orders`)
    } catch (err: any) {
      logger.error(`[Supplies] Scan error for ${config.tenant_id}: ${err.message}`)
    }
  }
}
```

---

## 10. Шаг 9: Настройки WB/Ozon — внутри плагина (НЕ в settings/moysklad)

> ⚠️ Аудит: страницу `admin/routes/settings/moysklad/page.tsx` **не трогаем**.

Собственная страница плагина: `admin/routes/supplies/settings/page.tsx`
- WB API Token (шифруется через `encrypt()` из moysklad/utils)
- Ozon Client ID / API Key
- MS counterparty href для WB и Ozon
- TTL кэшей, вкл/выкл синхронизацию

---

## 11. Шаг 10: Тестирование

```bash
# 1. Миграции
npx medusa db:migrate

# 2. Сборка
npx medusa build

# 3. Запуск
npx medusa develop

# 4. Проверка
# - Открыть /app/supplies — таблица поставок (НЕ канбан)
# - Открыть /app/warehouse — остатки
# - Открыть /app/supplies/settings — настройки WB/Ozon плагина

# 5. API curl
curl -X POST http://localhost:9000/admin/supplies/scan \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"marketplaces":["wb","ozon"]}'
```

---

## 12. Контрольный список слияния

**Запрещено:**
- [ ] ❌ MoySkladApiClient НЕ изменён (проверить `git status` в simoto_main — файл должен быть чистым)
- [ ] ❌ `moysklad_config` НЕ изменён
- [ ] ❌ `settings/moysklad/page.tsx` НЕ изменён
- [ ] ❌ Никаких правок в `lib/` simoto_main

**Обязательно:**
- [ ] Модуль `supplies-warehouse` скопирован в `apps/backend/src/modules/`
- [ ] Одна строка регистрации в `medusa-config.ts`
- [ ] Миграции сгенерированы и выполнены
- [ ] API routes созданы и отвечают
- [ ] Admin routes открываются (/app/supplies, /app/warehouse, /app/supplies/settings)
- [ ] Background jobs зарегистрированы
- [ ] `npx medusa build` проходит без ошибок
- [ ] `npx medusa develop` запускается
- [ ] Токены берутся из существующего moysklad-модуля (tenant + user)
- [ ] Склад отображается в админке
- [ ] Проверка заказа работает (checkOrder)
- [ ] Отгрузка работает (createDemand)
- [ ] Платёж работает (createPayment)
- [ ] Возврат работает (createReturn)
- [ ] Отмена работает (cancelOrder)
- [ ] Batch-операции работают
- [ ] Polling работает (5 секунд)
- [ ] WB/Ozon кэши обновляются
- [ ] Docker сборка успешна
