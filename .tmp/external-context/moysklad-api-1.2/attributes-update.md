---
source: Context7 + Official Docs Search
library: МойСклад JSON API
package: moysklad-api-1.2
topic: Атрибуты (attributes) и дополнительные поля
fetched: 2026-04-28T12:00:00Z
official_docs: https://dev.moysklad.ru/doc/api/remap/1.2/
---

# Работа с атрибутами (attributes) в МойСклад API 1.2

## Структура атрибута в запросе
При обновлении или создании документа с дополнительными полями, используется массив `attributes`:

```json
{
  "attributes": [
    {
      "meta": {
        "href": "https://api.moysklad.ru/api/remap/1.2/entity/customerorder/metadata/attributes/ID_АТРИБУТА",
        "type": "attributemetadata",
        "mediaType": "application/json"
      },
      "id": "ID_АТРИБУТА",
      "name": "Имя атрибута",
      "type": "string",
      "value": "Значение"
    }
  ]
}
```

## Обновление атрибута типа "Канал продаж" (customentity)

Для атрибутов, ссылающихся на другие сущности (включая Канал продаж), поле `value` должно содержать **объект с метаданными**:

```json
{
  "attributes": [
    {
      "meta": {
        "href": "https://api.moysklad.ru/api/remap/1.2/entity/customerorder/metadata/attributes/ORDER_CHANNEL_ID",
        "type": "attributemetadata",
        "mediaType": "application/json"
      },
      "value": {
        "meta": {
          "href": "https://api.moysklad.ru/api/remap/1.2/entity/saleschannel/ID_КАНАЛА",
          "type": "saleschannel",
          "mediaType": "application/json"
        }
      }
    }
  ]
}
```

## Разница между ORDER_CHANNEL и DEMAND_CHANNEL
В вашем проекте SiMOTO-sklad используются два разных ID атрибута:
- **ORDER_CHANNEL**: Для заказов покупателя (`customerorder/metadata/attributes/...`)
- **DEMAND_CHANNEL**: Для отгрузок (`demand/metadata/attributes/...`)

**Важно**: При обновлении атрибута убедитесь, что `meta.href` указывает на метаданные **того типа документа**, который вы обновляете.

## Пример обновления заказа (cancelOrder) с атрибутом

```bash
curl -X PUT "https://api.moysklad.ru/api/remap/1.2/entity/customerorder/ID_ЗАКАЗА" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "state": {
      "meta": {
        "href": "https://api.moysklad.ru/api/remap/1.2/entity/customerorder/metadata/states/ID_СТАТУСА",
        "type": "state",
        "mediaType": "application/json"
      }
    },
    "attributes": [
      {
        "meta": {
          "href": "https://api.moysklad.ru/api/remap/1.2/entity/customerorder/metadata/attributes/ORDER_CHANNEL_ID",
          "type": "attributemetadata",
          "mediaType": "application/json"
        },
        "value": {
          "meta": {
            "href": "https://api.moysklad.ru/api/remap/1.2/entity/saleschannel/ID_КАНАЛА",
            "type": "saleschannel",
            "mediaType": "application/json"
          }
        }
      }
    ]
  }'
```

## Получение метаданных атрибутов
Для получения правильных ID атрибутов используйте:
```bash
# Для заказов
curl -X GET "https://api.moysklad.ru/api/remap/1.2/entity/customerorder/metadata" \
  -H "Authorization: Bearer <token>"

# Для отгрузок
curl -X GET "https://api.moysklad.ru/api/remap/1.2/entity/demand/metadata" \
  -H "Authorization: Bearer <token>"
```

В ответе ищите массив `attributes`, где `name` соответствует вашему атрибуту (например, "Канал продаж").
