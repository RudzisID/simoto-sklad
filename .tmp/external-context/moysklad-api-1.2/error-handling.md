---
source: Context7 + GitHub Issues Analysis
library: МойСклад JSON API
package: moysklad-api-1.2
topic: Обработка ошибок (href, state, meta)
fetched: 2026-04-28T12:00:00Z
official_docs: https://dev.moysklad.ru/doc/api/remap/1.2/
---

# Типичные ошибки при работе с МойСклад API 1.2

## Ошибка: "неправильное значение href для meta поля 'state'"

### Причина
Ошибка возникает, когда в поле `state` передается неверная ссылка (href). Чаще всего это происходит из-за:
1. Использования ссылки на сам документ вместо ссылки на статус
2. Неверной версии API в ссылке
3. Использования `metadataHref` вместо `href` для конкретного статуса

### Правильный формат для обновления статуса (state)

```json
{
  "state": {
    "meta": {
      "href": "https://api.moysklad.ru/api/remap/1.2/entity/customerorder/metadata/states/ID_СТАТУСА",
      "type": "state",
      "mediaType": "application/json"
    }
  }
}
```

**Важно**: 
- `href` должен указывать на `.../metadata/states/ID`, а не на `.../metadata` или на сам документ.
- `type` должен быть `"state"`, а не `"customerorder"`.

### Как получить правильный ID статуса
```bash
curl -X GET "https://api.moysklad.ru/api/remap/1.2/entity/customerorder/metadata" \
  -H "Authorization: Bearer <token>"
```

В ответе найдите:
```json
{
  "states": [
    {
      "meta": {
        "href": "https://api.moysklad.ru/api/remap/1.2/entity/customerorder/metadata/states/0083bea7-8e06-11eb-0a80-0292000000c8",
        "type": "state",
        "mediaType": "application/json"
      },
      "id": "0083bea7-8e06-11eb-0a80-0292000000c8",
      "name": "Отменен",
      "color": 15106398,
      "stateType": "regular"
    }
  ]
}
```

## Ошибка: "отсутствует href для meta поля"

Убедитесь, что все объекты в поле `meta` содержат:
- `href` (обязательно)
- `type` (обязательно)
- `mediaType` (обычно `"application/json"`)

## Ошибка: "Поле не совпадает с указанным в href для meta"

Проверьте соответствие между `type` в meta и сущностью, на которую указывает `href`.

| Поле | Ожидаемый type | Пример href |
|------|----------------|-------------|
| `state` | `state` | `.../entity/customerorder/metadata/states/ID` |
| `agent` | `counterparty` | `.../entity/counterparty/ID` |
| `organization` | `organization` | `.../entity/organization/ID` |
| `salesChannel` | `saleschannel` | `.../entity/saleschannel/ID` |
| `store` | `store` | `.../entity/store/ID` |

## Сравнение createPayment и cancelOrder/createDemand

### Правильно (как в createPayment):
```json
{
  "salesChannel": {
    "meta": {
      "href": "https://api.moysklad.ru/api/remap/1.2/entity/saleschannel/ID",
      "type": "saleschannel",
      "mediaType": "application/json"
    }
  }
}
```

### Неправильно (типичные ошибки в cancelOrder/createDemand):
1. **Неверный type**: `"type": "customentity"` вместо `"type": "saleschannel"`
2. **Неверный href**: ссылка на метаданные атрибута вместо сущности канала продаж
3. **Вложенность**: передача канала продаж внутри `attributes[].value` с неправильной структурой

## Рекомендации для SiMOTO-sklad
1. При отмене заказа (`cancelOrder`) используйте **только** обновление поля `state` с правильным `href` статуса.
2. Если нужно обновить `salesChannel` в заказе, используйте структуру из `sales-channel.md`.
3. Для отгрузок (`createDemand`) убедитесь, что используете `demand/metadata/attributes/DEMAND_CHANNEL_ID`, а не `customerorder/...`.
