# Создание возвратов

**Файл**: `return.js`

Модуль для создания возврата покупателя (salesreturn) в МойСклад. Автоматически меняет статус заказа и отгрузки.

## Экспортируемые функции

| Функция | Описание |
|--------|----------|
| `createReturn(orderId, orderFull, demandId)` | Создание возврата покупателя |

## Параметры createReturn

| Параметр | Тип | Описание |
|----------|-----|----------|
| `orderId` | `string` | ID заказа в МойСклад |
| `orderFull` | `object` | Полные данные заказа (опционально, если не передан — будет получен автоматически) |
| `demandId` | `string` | ID отгрузки (опционально, если не передан — берется из orderFull) |

## Примеры использования

### Создание возврата (минимум параметров)

```javascript
const { createReturn } = require('./lib/return')

// Только orderId — остальное получится автоматически
const salesReturn = await createReturn('12345678-1234-1234-1234-123456789012')
console.log(`Возврат создан: ${salesReturn.name}`)
```

### Создание возврата с полными данными

```javascript
const { createReturn } = require('./lib/return')
const { getOrderFullForCreate } = require('./lib/order')

// Получаем данные заказа
const orderFull = await getOrderFullForCreate('12345678-1234-1234-1234-123456789012')
const demandId = orderFull.demands[0].meta.href.split('/').pop()

// Передаем всё явно
const salesReturn = await createReturn(orderFull.id, orderFull, demandId)
```

## Что делает функция

1. **Получает данные** — если `orderFull` не передан, получает через `getOrderFullForCreate()`
2. **Проверяет отгрузку** — если `demandId` не передан, берет первую отгрузку из заказа
3. **Проверяет существование** — если возврат уже создан, выбрасывает ошибку
4. **Меняет статус заказа** — на "Возврат" (ORDER_STATUS.RETURN)
5. **Меняет статус отгрузки** — на "Отменён" (DEMAND_STATUS.CANCELLED)
6. **Создает возврат** — копирует позиции из отгрузки

## Использование в API

```javascript
// POST /api/create-return
app.post('/api/create-return', async (req, res) => {
  const { shipmentNum } = req.body
  const order = await findOrderByShipmentNum(shipmentNum)
  const salesReturn = await createReturn(order.id)
  res.json({ success: true, returnName: salesReturn.name })
})
```
