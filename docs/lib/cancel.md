# Отмена заказов

**Файл**: `cancel.js`

Модуль для отмены заказов в МойСклад. Очищает резервы и устанавливает статус "Отменён".

## Экспортируемые функции

| Функция | Описание |
|--------|----------|
| `cancelOrder(orderIdOrFull, orderFull, demandId)` | Отмена заказа и очистка резервов |

## Параметры cancelOrder

| Параметр | Тип | Описание |
|----------|-----|----------|
| `orderIdOrFull` | `string\|object` | ID заказа (string) или полные данные (object) |
| `orderFull` | `object` | Полные данные заказа (для legacy mode) |
| `demandId` | `string` | ID отгрузки (если есть — отмена невозможна) |

## Примеры использования

### Отмена по ID заказа (рекомендуемый способ)

```javascript
const { cancelOrder } = require('./lib/cancel')

// Просто передаем ID — всё остальное получится автоматически
const result = await cancelOrder('12345678-1234-1234-1234-123456789012')
console.log(result)
// { orderId: '...', demandId: null, status: 'cancelled', reserveCleared: true }
```

### Отмена с полными данными (legacy mode)

```javascript
const { cancelOrder } = require('./lib/cancel')
const { getOrderFullForCreate } = require('./lib/order')

const orderFull = await getOrderFullForCreate('12345678-1234-1234-1234-123456789012')
const result = await cancelOrder(orderFull.id, orderFull, null)
```

## Что делает функция

1. **Определяет тип входных данных** — ID (string) или объект заказа
2. **Проверяет отгрузку** — если есть отгрузка, выбрасывает ошибку (нужно использовать возврат)
3. **Очищает резервы** — обнуляет `reserve` для всех позиций заказа
4. **Меняет статус** — на "Отменён" (ORDER_STATUS.CANCELLED)
5. **Обновляет атрибуты** — устанавливает канал продаж (ORDER_CHANNEL)

## Обработка ошибок

Функция выбрасывает понятные ошибки:

| Ошибка | Причина |
|--------|--------|
| `Нельзя отменить — отгрузка уже создана` | Есть отгрузка, нужно делать возврат |
| `Ошибка аутентификации в МойСклад` | Неверный токен |
| `Ошибка формата state` | Неверный UUID статуса в constants.js |

## Использование в API

```javascript
// POST /api/cancel-order
app.post('/api/cancel-order', async (req, res) => {
  const { shipmentNum } = req.body
  const order = await findOrderByShipmentNum(shipmentNum)
  const result = await cancelOrder(order.id)
  res.json({ success: true, ...result })
})
```
