---
source: Web Search (aggregated from multiple sources) + API analysis
library: Moysklad JSON API
package: moysklad-api-1.2
topic: customerorder-cancel
fetched: 2026-04-28T12:00:00Z
official_docs: https://dev.moysklad.ru/doc/api/remap/1.2/dictionaries/#dokumenty-zakaz-pokupatel-q
---

# Отмена заказа покупателя и сброс резервов

## Вопрос 4a: Сброс резервов для позиций заказа

### Метод из рабочего проекта
Пользователь указывает метод:
1. `POST /entity/customerorder/{id}/positions/delete` - удаление позиций
2. `POST /entity/customerorder/{id}/positions` с `reserve:0` - создание с нулевым резервом

### Анализ API
Согласно документации API Moysklad:

**Правильный подход для сброса резервов:**

Можно обновить позиции одним запросом через PUT к самому заказу:
```json
PUT /api/remap/1.2/entity/customerorder/{id}
{
  "positions": [
    {
      "meta": {
        "href": "https://api.moysklad.ru/api/remap/1.2/entity/customerorder/{id}/positions/{position-id}",
        "type": "customerorderposition",
        "mediaType": "application/json"
      },
      "reserve": 0
    }
  ]
}
```

Или через обновление позиций:
```
PUT /api/remap/1.2/entity/customerorder/{id}/positions/{position-id}
{
  "reserve": 0
}
```

**Важно**: Не нужно удалять позиции для сброса резервов. Достаточно обновить поле `reserve` на 0.

Метод `POST /entity/customerorder/{id}/positions` используется для **добавления** новых позиций, а не для обновления существующих.

### Вывод по вопросу 4a
- **Метод рабочего проекта (delete + POST с reserve:0)**: НЕ является корректным API подходом
- **Правильный метод**: Обновление позиций через PUT с установкой `reserve: 0`
- Можно обновить все позиции одним PUT запросом к заказу с обновленным массивом positions

## Вопрос 4b: Обновление статуса заказа на "Отменен"

### Обязательные поля при обновлении
Для обновления статуса заказа:
```json
PUT /api/remap/1.2/entity/customerorder/{id}
{
  "state": {
    "meta": {
      "href": "https://api.moysklad.ru/api/remap/1.2/entity/customerorder/metadata/states/{cancelled-state-id}",
      "type": "state",
      "mediaType": "application/json"
    }
  }
}
```

### Нужно ли включать salesChannel и attributes?
Пользователь утверждает: "orders cannot be saved without the sales channel attribute"

Согласно API:
- `salesChannel` - опциональное поле в типе
- `attributes` - опциональное поле

**Однако**: В зависимости от настроек аккаунта МойСклад, определенные атрибуты могут быть помечены как обязательные. Если в настройках атрибут ORDER_CHANNEL (ec686189-d214-11ed-0a80-0d7d00353a4e) помечен как обязательный, то при обновлении документа он должен присутствовать.

### Рекомендуемый подход
При обновлении статуса на "Отменен", лучше включить все поля, которые были в документе:
```json
PUT /api/remap/1.2/entity/customerorder/{id}
{
  "state": { ... },
  "salesChannel": { ... },  // если был в исходном заказе
  "attributes": [ ... ]     // если были в исходном заказе
}
```

### Вывод по вопросу 4b
- **salesChannel**: не обязательно по API, но может требоваться настройками аккаунта
- **attributes (ORDER_CHANNEL)**: пользователь утверждает, что обязательно. Если атрибут помечен как обязательный в настройках - да
- Рекомендуется получить текущий заказ, обновить только `state` и отправить обновление

## Вопрос 4c: Обновление статуса отгрузки (demand) на "Отменен"

Если заказ имеет отгрузку, нужно также обновить статус отгрузки:

```json
PUT /api/remap/1.2/entity/demand/{id}
{
  "state": {
    "meta": {
      "href": "https://api.moysklad.ru/api/remap/1.2/entity/demand/metadata/states/{cancelled-state-id}",
      "type": "state",
      "mediaType": "application/json"
    }
  }
}
```

### Вывод по вопросу 4c
- Обновление статуса отгрузки происходит аналогично заказу
- Используется PUT запрос к `/entity/demand/{id}`
- Аналогично, могут потребоваться `salesChannel` и `attributes` (DEMAND_CHANNEL)

## Вопрос 5: Обязательность атрибутов ORDER_CHANNEL и DEMAND_CHANNEL

Пользователь утверждает, что следующие атрибуты обязательны:
- ORDER_CHANNEL: ec686189-d214-11ed-0a80-0d7d00353a4e
- DEMAND_CHANNEL: eff314b1-d222-11ed-0a80-01240038ac64

### Анализ
Согласно API Moysklad, атрибуты (`attributes`) являются настраиваемыми полями. Они становятся обязательными, если:
1. В настройках метаданных атрибута установлен флаг "обязательное поле"
2. Это настраивается в интерфейсе МойСклад: Настройки -> Сущности -> Заказ покупателя -> Атрибуты

### Проверка обязательности
Можно проверить через API метаданных:
```
GET /api/remap/1.2/entity/customerorder/metadata
GET /api/remap/1.2/entity/demand/metadata
```

В ответе будет массив `attributes` с флагом `"required": true` для обязательных атрибутов.

### Вывод по вопросу 5
- Атрибуты становятся обязательными через настройки аккаунта
- Если пользователь утверждает, что они обязательны - значит, в аккаунте так настроено
- При обновлении/создании документов эти атрибуты должны присутствовать

## Вопрос 6: Обновление позиций заказа

### Правильный endpoint для обновления позиций
Существующие позиции НЕЛЬЗЯ обновить через `POST /entity/customerorder/{id}/positions`.

**POST** к `/positions` - только для добавления НОВЫХ позиций.

### Как обновить существующие позиции:
1. **PUT к самому заказу** с обновленным массивом positions:
```
PUT /api/remap/1.2/entity/customerorder/{id}
{
  "positions": [
    {
      "meta": { ... },  // ссылка на существующую позицию
      "reserve": 0,
      "quantity": 2
    }
  ]
}
```

2. **PUT к конкретной позиции**:
```
PUT /api/remap/1.2/entity/customerorder/{id}/positions/{position-id}
{
  "reserve": 0
}
```

### Вывод по вопросу 6
- **Нельзя** обновлять существующие позиции через POST к /positions
- **Нужно** использовать PUT к заказу или к конкретной позиции
- Удалять позиции перед обновлением НЕ нужно
