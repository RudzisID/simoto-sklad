# Создание входящих платежей

**Файл**: `payment.js`

Модуль для создания входящих платежей (paymentin) в МойСклад. Привязывает платеж к заказу и отгрузке.

## Экспортируемые функции

| Функция | Описание |
|--------|----------|
| `createPayment(orderIdOrFull, demandIdOrObj)` | Создание входящего платежа |

## Параметры createPayment

| Параметр | Тип | Описание |
|----------|-----|----------|
| `orderIdOrFull` | `string\|object` | ID заказа (string) или полные данные (object) |
| `demandIdOrObj` | `string\|object` | ID отгрузки (string), объект отгрузки или undefined |

## Примеры использования

### Создание платежа по ID заказа

```javascript
const { createPayment } = require('./lib/payment')

// Просто передаем ID заказа — отгрузка найдется автоматически
const payment = await createPayment('12345678-1234-1234-1234-123456789012')
console.log(`Платеж создан: ${payment.name}`)
```

### Создание платежа с полными данными

```javascript
const { createPayment } = require('./lib/payment')
const { getOrderFullForCreate, getDemand } = require('./lib/order')

// Получаем данные
const orderFull = await getOrderFullForCreate('12345678-1234-1234-1234-123456789012')
const demandId = orderFull.demands[0].meta.href.split('/').pop()
const demand = await getDemand(demandId)

// Передаем всё явно
const payment = await createPayment(orderFull, demand)
```

## Что делает функция

1. **Определяет тип входных данных** — ID или объект заказа/отгрузки
2. **Проверяет отгрузку** — если не передана, берет первую из заказа
3. **Проверяет существование** — если платеж уже есть, выбрасывает ошибку
4. **Проверяет оплату** — если отгрузка уже оплачена, выбрасывает ошибку
5. **Меняет статус заказа** — если был "На отправке с отсрочкой", меняет на "Отгружен"
6. **Создает платеж** — сумма = сумма отгрузки, привязка к заказу

## Использование в API

```javascript
// POST /api/create-payment
app.post('/api/create-payment', async (req, res) => {
  const { shipmentNum } = req.body
  const checkResult = await checkOrder(shipmentNum)
  
  if (!checkResult.canPayment) {
    return res.json({ error: 'Невозможно создать платеж' })
  }
  
  const payment = await createPayment(checkResult.orderId)
  res.json({ success: true, paymentName: payment.name })
})
```
