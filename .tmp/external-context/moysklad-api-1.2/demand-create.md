---
source: Web Search (aggregated from multiple sources)
library: Moysklad JSON API
package: moysklad-api-1.2
topic: demand-create
fetched: 2026-04-28T12:00:00Z
official_docs: https://dev.moysklad.ru/doc/api/remap/1.2/dictionaries/#dokumenty-otgruzka
---

# Создание отгрузки (entity/demand)

## Обязательные поля при создании
Согласно типам из `@moysklad/moysklad-ts`:
- `agent` - Метаданные контрагента (CounterpartyModel)
- `organization` - Метаданные юрлица (OrganizationModel)
- `store` - Метаданные склада (StoreModel)

## Связь с заказом покупателя
Отгрузку можно создать на основе заказа покупателя через шаблон:
```
POST /api/remap/1.2/entity/demand/template
{
  "customerOrder": {
    "meta": {
      "href": "https://api.moysklad.ru/api/remap/1.2/entity/customerorder/{order-id}",
      "type": "customerorder",
      "mediaType": "application/json"
    }
  }
}
```

Или указать ссылку на заказ в поле `customerOrder` при создании.

## positions (Позиции)
```typescript
positions: DemandPositionModel
```

Пример positions:
```json
{
  "positions": [
    {
      "quantity": 2,
      "price": 50000,
      "assortment": {
        "meta": {
          "href": "https://api.moysklad.ru/api/remap/1.2/entity/product/{product-id}",
          "type": "product",
          "mediaType": "application/json"
        }
      }
    }
  ]
}
```

## salesChannel (Канал продаж)
```typescript
salesChannel?: Meta<Entity.SalesChannel>
```

Поле присутствует в типе Demand и может быть заполнено при создании.

## attributes (Атрибуты)
Для атрибута DEMAND_CHANNEL (как указано пользователем: eff314b1-d222-11ed-0a80-01240038ac64):

```json
{
  "attributes": [
    {
      "meta": {
        "href": "https://api.moysklad.ru/api/remap/1.2/entity/demand/metadata/attributes/{attribute-id}",
        "type": "attributemetadata",
        "mediaType": "application/json"
      },
      "value": "DEMAND_CHANNEL_VALUE"
    }
  ]
}
```

## Пример создания отгрузки
```json
POST /api/remap/1.2/entity/demand
{
  "name": "Отгрузка по заказу №123",
  "applicable": true,
  "moment": "2026-04-28 12:00:00",
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
  "store": {
    "meta": {
      "href": "https://api.moysklad.ru/api/remap/1.2/entity/store/{store-id}",
      "type": "store",
      "mediaType": "application/json"
    }
  },
  "salesChannel": {
    "meta": {
      "href": "https://api.moysklad.ru/api/remap/1.2/entity/saleschannel/{channel-id}",
      "type": "saleschannel",
      "mediaType": "application/json"
    }
  },
  "attributes": [
    {
      "meta": {
        "href": "https://api.moysklad.ru/api/remap/1.2/entity/demand/metadata/attributes/eff314b1-d222-11ed-0a80-01240038ac64",
        "type": "attributemetadata",
        "mediaType": "application/json"
      },
      "value": "some_value"
    }
  ],
  "positions": [
    {
      "quantity": 2,
      "price": 50000,
      "assortment": {
        "meta": {
          "href": "https://api.moysklad.ru/api/remap/1.2/entity/product/{product-id}",
          "type": "product",
          "mediaType": "application/json"
        }
      }
    }
  ]
}
```

## Вывод по вопросу 2
- **Обязательные поля**: `agent`, `organization`, `store`
- **Связь с заказом**: через шаблон или поле `customerOrder`
- **positions**: массив с `quantity`, `price`, `assortment`
- **salesChannel**: опционально, но может требоваться
- **attributes (DEMAND_CHANNEL)**: пользователь утверждает, что обязательно. Согласно API - это настраиваемый атрибут, может быть обязательным в зависимости от настроек аккаунта
