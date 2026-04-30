# Создание отгрузок

**Файл**: `demand.js`

Модуль для создания отгрузок (demand) в МойСклад. Автоматически меняет статус заказа на "На отправку с отсрочкой платежа".

## Экспортируемые функции

| Функция | Описание |
|--------|----------|
| `createDemand(orderIdOrFull)` | Создание отгрузки для заказа |

## Параметры createDemand

| Параметр | Тип | Описание |
|----------|-----|----------|
| `orderIdOrFull` | `string\|object` | ID заказа (string) или полные данные заказа (object) |

## Примеры использования

### Создание отгрузки по ID заказа

```javascript
const { createDemand } = require('./lib/demand')

// Просто передаем ID — всё остальное получится автоматически
const demand = await createDemand('12345678-1234-1234-1234-123456789012')
console.log(`Отгрузка создана: ${demand.name}`)
```

### Создание отгрузки с полными данными

```javascript
const { createDemand } = require('./lib/demand')
const { getOrderFullForCreate } = require('./lib/order')

// Получаем полные данные заказа
const orderFull = await getOrderFullForCreate('12345678-1234-1234-1234-123456789012')

// Передаем объект заказа
const demand = await createDemand(orderFull)
```

## Что делает функция

1. **Определяет тип входных данных** — ID или объект заказа
2. **Проверяет существование** — если отгрузка уже есть, выбрасывает ошибку
3. **Получает позиции** — загружает позиции заказа
4. **Создает отгрузку** — копирует позиции, цены, скидки, НДС
5. **Меняет статус заказа** — на "На отправку с отсрочкой платежа" (ORDER_STATUS.DELAYED)
6. **Обновляет атрибуты** — устанавливает канал продаж (DEMAND_CHANNEL, ORDER_CHANNEL)

## Использование в API

```javascript
// POST /api/create-demand
app.post('/api/create-demand', async (req, res) => {
  const { shipmentNum } = req.body
  const order = await findOrderByShipmentNum(shipmentNum)
  const demand = await createDemand(order.id)
  res.json({ success: true, demandName: demand.name })
})
```
