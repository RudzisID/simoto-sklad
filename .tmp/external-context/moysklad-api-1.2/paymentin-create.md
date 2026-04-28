---
source: Web Search (aggregated from multiple sources)
library: Moysklad JSON API
package: moysklad-api-1.2
topic: paymentin-create
fetched: 2026-04-28T12:00:00Z
official_docs: https://dev.moysklad.ru/doc/api/remap/1.2/dictionaries/#dokumenty-vhod-platel-2
---

# Создание входящего платежа (entity/paymentin)

## Обязательные поля при создании
Согласно типам из `@moysklad/moysklad-ts`:
- `agent` - Метаданные контрагента (Meta<Entity.Counterparty>)
- `organization` - Метаданные юрлица (Meta<Entity.Organization>)

## Связь с заказом покупателя через operations
```typescript
operations?: Array<{
  meta: Meta<Entity.CustomerOrder | Entity.PurchaseReturn | Entity.Demand | Entity.InvoiceOut | Entity.CommissionReportIn | Entity.RetailShift>
  linkedSum?: number
}>
```

Для связи с заказом покупателя:
```json
{
  "operations": [
    {
      "meta": {
        "href": "https://api.moysklad.ru/api/remap/1.2/entity/customerorder/{order-id}",
        "type": "customerorder",
        "mediaType": "application/json"
      },
      "linkedSum": 100000
    }
  ]
}
```

## salesChannel (Канал продаж)
Поле `salesChannel` присутствует в типе PaymentIn:
```typescript
salesChannel?: Meta<Entity.SalesChannel>
```

Это опциональное поле при создании входящего платежа.

## organizationAccount (Счет юрлица)
Поле `organizationAccount` присутствует в типе PaymentIn:
```typescript
organizationAccount?: Meta<Entity.Account>
```

Это опциональное поле, но может быть необходимо для корректного отображения в интерфейсе.

## Пример создания входящего платежа
```json
POST /api/remap/1.2/entity/paymentin
{
  "name": "Оплата по заказу №123",
  "applicable": true,
  "moment": "2026-04-28 12:00:00",
  "sum": 100000,
  "agent": {
    "meta": {
      "href": "https://api.moysklad.ru/api/remap/1.2/entity/counterparty/{counterparty-id}",
      "type": "counterparty",
      "mediaType": "application/json"
    }
  },
  "organization": {
    "meta": {
      "href": "https://api.moysklad.ru/api/remap/1.2/entity/organization/{organization-id}",
      "type": "organization",
      "mediaType": "application/json"
    }
  },
  "organizationAccount": {
    "meta": {
      "href": "https://api.moysklad.ru/api/remap/1.2/entity/organization/{organization-id}/accounts/{account-id}",
      "type": "account",
      "mediaType": "application/json"
    }
  },
  "operations": [
    {
      "meta": {
        "href": "https://api.moysklad.ru/api/remap/1.2/entity/customerorder/{order-id}",
        "type": "customerorder",
        "mediaType": "application/json"
      },
      "linkedSum": 100000
    }
  ],
  "salesChannel": {
    "meta": {
      "href": "https://api.moysklad.ru/api/remap/1.2/entity/saleschannel/{channel-id}",
      "type": "saleschannel",
      "mediaType": "application/json"
    }
  }
}
```

## Вывод по вопросу 1
- **Обязательные поля**: `agent`, `organization`
- **Связь с заказом**: через массив `operations` с указанием `linkedSum`
- **salesChannel**: опционально при создании, но может требоваться бизнес-логикой
- **organizationAccount**: опционально, но рекомендуется для полноты данных
