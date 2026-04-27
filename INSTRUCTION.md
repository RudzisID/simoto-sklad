# Инструкция разработчика SiMOTO-sklad

Техническая документация для работы с модулем автоматизации МойСклад.

## Обзор

SiMOTO-sklad — модуль для автоматизации создания платежей, отгрузок, возвратов и отмены заказов в МойСклад по номерам отправлений.

## Архитектура

```
server.js (Express)
  ├── lib/moysklad.js (баррел)
  │     ├── lib/order.js      — поиск заказов
  │     ├── lib/check.js     — проверка статусов
  │     ├── lib/batch.js    — пакетная обработка + SSE
  │     ├── lib/payment.js  — создание платежей
  │     ├── lib/demand.js   — создани�� отгрузок
  │     ├── lib/return.js  — создание возвратов
  │     ├── lib/cancel.js — отмена заказов
  │     ├── lib/api-utils.js — утилиты API
  │     └── lib/constants.js — UUID статусов
  │
  └── integrations/wb_ozon_sync.js (скелет)
```

## Запуск

### Windows Launcher
```bash
simoto-sklad.bat
```
Автоматически:
- Проверяет Node.js
- Устанавливает зависимости (если нужно)
- Проверяет .env
- Создаёт logs/
- Проверяет обновления на GitHub
- Запускает server.js

### Ручной запуск
```bash
npm start
# или
node server.js
```

### GitHub Push
```bash
github-push.bat
```
Автоматически:
- Проверяет изменения
- Bump версии
- Коммитит
- Пушит
- Создаёт тег
- Создаёт GitHub release

## API Token

Токен передаётся в заголовке:
```
X-API-TOKEN: ваш_токен
```

Или через query (для SSE):
```
/api/process/stream?token=ваш_токен&numbers=...
```

## Константы (lib/constants.js)

```javascript
ORDER_STATUS = {
  SHIPPED: 'e98e02bb-b1c2-11ed-0a80-004e000a8440',
  DELAYED: '91cb9364-d7c5-11ed-0a80-05b5003aa5c4',
  RETURN: '444c3246-91e8-11f0-0a80-11be007306ce',
  CANCELLED: 'fb56e2b4-2e58-11e6-8a84-bae50000006f'
}

DEMAND_STATUS = {
  CANCELLED: 'b1de4f91-a3ca-11ee-0a80-1547000a8e4c'
}

ATTRIBUTES = {
  DEMAND_CHANNEL: 'eff314b1-d222-11ed-0a80-01240038ac64',
  ORDER_CHANNEL: 'ec686189-d214-11ed-0a80-0d7d00353a4e'
}
```

##业务流程

### 1. Проверка заказов

```javascript
POST /api/process
{
  "numbers": ["12345678-IL", "87654321-IL"]
}
// Returns: массив {shipmentNum, orderId, orderName, sum, status, ...}
```

```javascript
GET /api/process/stream?token=X&numbers=123,456
// SSE events:
// {type: 'progress', index, total, order: {...}}
// {type: 'done', orders: [...]}
// {type: 'aborted', processed: N}
```

### 2. Пакетная операция

```javascript
POST /api/batch
{
  "numbers": ["12345678-IL"],
  "action": "payment" // | "demand" | "return" | "cancel"
}
```

```javascript
GET /api/batch/stream?token=X&numbers=123&action=payment
// SSE events:
// {type: 'progress', index, total, result: {...}, stats: {...}}
// {type: 'done', stats: {...}}
```

### 3. Создание платежа

```javascript
POST /api/create-payment
{
  "shipmentNum": "12345678-IL"
}
// Returns: {success: true, paymentName: "Входящий платеж ..."}
```

**Логика:**
1. Найти заказ по shipmentNum
2. Проверить статус
3. Если "На отправке с отсрочкой" → изменить на "Отгружен"
4. Создать платёж с привязкой к заказу

### 4. Создание отгрузки

```javascript
POST /api/create-demand
{
  "shipmentNum": "12345678-IL"
}
// Returns: {success: true, demandName: "Отгрузка ..."}
```

### 5. Создание возврата

```javascript
POST /api/create-return
{
  "shipmentNum": "12345678-IL"
}
// Returns: {success: true, returnName: "Возврат ..."}
```

**Требования:**
- Заказ должен иметь отгрузку (demand)

### 6. Отмена заказа

```javascript
POST /api/cancel-order
{
  "shipmentNum": "12345678-IL"
}
// Returns: {success: true, ...}
```

**Логика:**
- Изменить статус на "Отменён"
- Если есть demand → изменить его статус на "Отменён"
- Сбросить резерв

## Состояние заказов

Состояние сохраняется в `logs/orders_state.json`:

```javascript
{
  "12345678-IL": {
    "orderName": "Заказ покупателя №123",
    "sum": 1500.00,
    "paid": 0,
    "status": "shipped",
    "canCreate": true,
    "orderId": "abc123",
    "orderUrl": "https://online.moysklad.ru/app/#customerorder/abc123",
    "lastAction": "payment_created",
    "lastResult": "Входящий платеж ...",
    "history": [
      {"action": "check", "result": "ok", "time": "2024-..."}
    ]
  }
}
```

### Эндпойнты состояния

```javascript
GET /api/orders-state   // Получить всё
POST /api/orders-state // Сохранить
DELETE /api/orders-state // Очистить
```

## SSE Streaming

SSE (Server-Sent Events) для realtime обновлений:

### Проверка (process/stream)
```
GET /api/process/stream?token=X&numbers=123,456
```

### Batch (batch/stream)
```
GET /api/batch/stream?token=X&numbers=123&action=payment
```

### Abort (отмена)
```
POST /api/abort
{"abortId": "abc123"}
```

При disconnect клиента автоматически устанавливается abort flag.

## Логирование

Логи в `logs/payments_YYYY-MM-DD.log`:

```
[2024-04-27 10:30:00] === Начало check ===
[2024-04-27 10:30:01] Количество: 10
[2024-04-27 10:30:02] Заказ найден: 12345678-IL
```

## Тестирование

```bash
npm test
```

## Документация API

Генерируется автоматически:
```bash
npm run docs
```

Выход: `docs/API.md`, `docs/ARCHITECTURE.md`, `docs/lib/*.md`

## Важные правила

1. **Не создавать дубли платежей** — проверять `payedSum >= sum`
2. **Копировать данные** — organizationAccount, vatSum, salesChannel из source
3. **Менять статус** — только если "На отправке с отсрочкой"
4. **Привязывать платёж** — через operations с linkedSum
5. **Обрабатывать ошибки** — все API вызовы в try/catch

## Возможные ошибки

| Код | Сообщение | Решение |
|------|----------|---------|
| 401 | Unauthorized | Проверить токен |
| 404 | Заказ не найден | Проверить номер |
| 409 | Уже существует | Пропустить |
| 422 | Невозможно создать | Проверить статус заказа |

## Ссылки

- МойСклад API: https://api.moysklad.ru/api/remap/1.2/
- Репозиторий: https://github.com/RudzisID/simoto-sklad