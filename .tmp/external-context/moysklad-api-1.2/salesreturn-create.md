---
source: Web Search (aggregated from multiple sources)
library: Moysklad JSON API
package: moysklad-api-1.2
topic: salesreturn-create
fetched: 2026-04-28T12:00:00Z
official_docs: https://dev.moysklad.ru/doc/api/remap/1.2/dictionaries/#dokumenty-vozvrat-pokupatel-q
---

# Создание возврата покупателя (entity/salesreturn)

## Обязательные поля при создании
Согласно типам из `@moysklad/moysklad-ts`:
- `agent` - Метаданные контрагента
- `organization` - Метаданные юрлица
- `store` - Метаданные склада

## Связь с отгрузкой (demand)
```typescript
demand?: Meta<Entity.Demand>
```

Пример связи с отгрузкой:
```json
{
  "demand": {
    "meta": {
      "href": "https://api.moysklad.ru/api/remap/1.2/entity/demand/{demand-id}",
      "type": "demand",
      "mediaType": "application/json"
    }
  }
}
```

Можно также создать возврат на основе отгрузки через шаблон:
```
POST /api/remap/1.2/entity/salesreturn/template
{
  "demand": {
    "meta": {
      "href": "https://api.moysklad.ru/api/remap/1.2/entity/demand/{demand-id}",
      "type": "demand",
      "mediaType": "application/json"
    }
  }
}
```

## positions (Позиции)
```typescript
positions: SalesReturnPositionModel
```

Пример positions:
```json
{
  "positions": [
    {
      "quantity": 1,
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

## Обновление статусов родительских документов
При создании возврата покупателя:
- Статус заказа покупателя может автоматически обновиться (зависит от настроек)
- Статус отгрузки может автоматически обновиться

Для явного обновления статуса заказа:
```
PUT /api/remap/1.2/entity/customerorder/{id}
{
  "state": {
    "meta": {
      "href": "https://api.moysklad.ru/api/remap/1.2/entity/customerorder/metadata/states/{state-id}",
      "type": "state",
      "mediaType": "application/json"
    }
  }
}
```

## Пример создания возврата покупателя
```json
POST /api/remap/1.2/entity/salesreturn
{
  "name": "Возврат по заказу №123",
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
  "demand": {
    "meta": {
      "href": "https://api.moysklad.ru/api/remap/1.2/entity/demand/{demand-id}",
      "type": "demand",
      "mediaType": "application/json"
    }
  },
  "positions": [
    {
      "quantity": 1,
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

## Вывод по вопросу 3
- **Обязательные поля**: `agent`, `organization`, `store`
- **Связь с отгрузкой**: через поле `demand` или шаблон
- **positions**: массив с `quantity`, `price`, `assortment`
- **Статусы**: обновляются автоматически или через явный PUT запрос к родительским документам
