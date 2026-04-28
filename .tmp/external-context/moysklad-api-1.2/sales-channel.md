---
source: Context7 + Official Docs Search
library: МойСклад JSON API
package: moysklad-api-1.2
topic: salesChannel (Каналы продаж)
fetched: 2026-04-28T12:00:00Z
official_docs: https://dev.moysklad.ru/doc/api/remap/1.2/
---

# Каналы продаж (salesChannel) в МойСклад API 1.2

## Общая информация
Поле `salesChannel` присутствует в документах:
- **Заказ покупателя** (CustomerOrder)
- **Отгрузка** (Demand)
- **Возврат покупателя** (SalesReturn)
- **Входящие платежи** (PaymentIn)

## Структура поля `salesChannel`
Поле является метаданными и передается в формате JSON-объекта:

```json
{
  "salesChannel": {
    "meta": {
      "href": "https://api.moysklad.ru/api/remap/1.2/entity/saleschannel/ID_КАНАЛА",
      "type": "saleschannel",
      "mediaType": "application/json"
    }
  }
}
```

## Пример создания Заказа покупателя с salesChannel

```bash
curl -X POST "https://api.moysklad.ru/api/remap/1.2/entity/customerorder" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Заказ №123",
    "organization": {
      "meta": {
        "href": "https://api.moysklad.ru/api/remap/1.2/entity/organization/ID_ОРГАНИЗАЦИИ",
        "type": "organization",
        "mediaType": "application/json"
      }
    },
    "agent": {
      "meta": {
        "href": "https://api.moysklad.ru/api/remap/1.2/entity/counterparty/ID_КОНТРАГЕНТА",
        "type": "counterparty",
        "mediaType": "application/json"
      }
    },
    "salesChannel": {
      "meta": {
        "href": "https://api.moysklad.ru/api/remap/1.2/entity/saleschannel/ID_КАНАЛА",
        "type": "saleschannel",
        "mediaType": "application/json"
      }
    }
  }'
```

## Пример создания Отгрузки с salesChannel

```bash
curl -X POST "https://api.moysklad.ru/api/remap/1.2/entity/demand" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "organization": {
      "meta": {
        "href": "https://api.moysklad.ru/api/remap/1.2/entity/organization/ID_ОРГАНИЗАЦИИ",
        "type": "organization",
        "mediaType": "application/json"
      }
    },
    "agent": {
      "meta": {
        "href": "https://api.moysklad.ru/api/remap/1.2/entity/counterparty/ID_КОНТРАГЕНТА",
        "type": "counterparty",
        "mediaType": "application/json"
      }
    },
    "store": {
      "meta": {
        "href": "https://api.moysklad.ru/api/remap/1.2/entity/store/ID_СКЛАДА",
        "type": "store",
        "mediaType": "application/json"
      }
    },
    "salesChannel": {
      "meta": {
        "href": "https://api.moysklad.ru/api/remap/1.2/entity/saleschannel/ID_КАНАЛА",
        "type": "saleschannel",
        "mediaType": "application/json"
      }
    }
  }'
```

## Получение списка каналов продаж
```bash
curl -X GET "https://api.moysklad.ru/api/remap/1.2/entity/saleschannel" \
  -H "Authorization: Bearer <token>"
```

## Важные замечания
1. **При обновлении документа** (PUT), если вы не хотите менять канал продаж, не включайте поле `salesChannel` в тело запроса.
2. **Для удаления/обнуления** канала продаж передайте `"salesChannel": null`.
3. **Ошибка "неправильное значение href"**: убедитесь, что `href` указывает именно на ресурс `saleschannel`, а не на `metadata` или другую сущность.
