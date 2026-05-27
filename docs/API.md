# API Documentation

Справочник по всем API эндпойнтам SiMOTO-sklad.

## Общие сведения

- **Базовый URL**: `http://localhost:3000`
- **Формат**: JSON
- **Аутентификация**: Токен передаётся в заголовке `X-Api-Token` или `token` (query)
- **Кодировка**: UTF-8
- **Цветное логирование**: Сервер использует цветовую кодировку сообщений в консоли (server.js):
  - 🔴 Красный — ошибки
  - 🟢 Зеленый — успешные операции
  - 🟡 Желтый — пропущенные операции
  - 🔵 Голубой — завершение операций
  - 🟣 Пурпурный — начало batch операций

---

## Эндпойнты

### Health Check

#### `GET /api/health`

Проверка работоспособности сервера.

**Ответ:**

```json
{
  "status": "ok",
  "time": "2026-04-27T10:30:00.000Z"
}
```

---

### Проверка номеров (process)

#### `POST /api/process`

Проверка списка номеров заказов.

**Запрос:**

```json
{
  "numbers": ["0128545550-0011-1", "4965524118"]
}
```

**Заголовки:**

```
X-Api-Token: ваш_токен
```

**Ответ:**

```json
{
  "orders": [
    {
      "shipmentNum": "0128545550-0011-1",
      "orderName": "МС-000123",
      "sum": 1500.00,
      "paid": 0,
      "status": "other",
      "statusName": "Отгружен",
      "canDemand": false,
      "canPayment": true,
      "canReturn": false,
      "canCancel": false,
      "hasDemand": true,
      "hasPayment": false,
      "hasReturn": false,
      "isCancelled": false,
      "demandName": "ДО-000456"
    }
  ]
}
```

---

### SSE проверка (process/stream)

#### `GET /api/process/stream`

Проверка номеров в режиме realtime через Server-Sent Events.

**Параметры query:**

| Параметр | Тип | Обязательно | Описание |
|---------|-----|-------------|----------|
| token | string | Да | Токен API |
| numbers | string | Да | Номера через запятую |
| abortId | string | Нет | ID для отмены |

**Пример:**

```
GET /api/process/stream?token=...&numbers=0128545550-0011-1,4965524118
```

**Ответ (SSE):**

```javascript
data: {"type":"progress","index":1,"total":2,"order":{...}}
data: {"type":"progress","index":2,"total":2,"order":{...}}
data: {"type":"done","orders":[...]}
```

**События SSE:**

| Тип | Описание |
|-----|----------|
| `progress` | Промежуточный результат |
| `done` | Завершение |
| `aborted` | Отменено пользователем |
| `error` | Ошибка |

---

### Пакетная операция (batch)

#### `POST /api/batch`

Массовая операция над списком номеров.

**Запрос:**

```json
{
  "numbers": ["0128545550-0011-1", "4965524118"],
  "action": "payment"
}
```

**Действия (action):**

| Значение | Описание |
|----------|----------|
| `demand` | Создать отгрузку |
| `payment` | Создать платёж |
| `return` | Создать возврат |
| `cancel` | Отменить заказ |

**Ответ:**

```json
{
  "created": 2,
  "skipped": 0,
  "errors": 0,
  "orders": [
    { "status": "created", "paymentName": "Пл-001", ... }
  ]
}
```

---

### SSE batch (batch/stream)

#### `GET /api/batch/stream`

Массовая операция в режиме realtime.

**Параметры query:**

| Параметр | Тип | Обязательно | Описание |
|---------|-----|-------------|----------|
| token | string | Да | Токен API |
| numbers | string | Да | Номера через запятую |
| action | string | Да | Действие |
| abortId | string | Нет | ID для отмены |

**Ответ (SSE):**

```javascript
data: {"type":"progress","index":1,"total":2,"action":"payment","result":{...},"stats":{"created":1,"skipped":0,"errors":0}}
data: {"type":"done","stats":{"created":2,"skipped":0,"errors":0},"orders":[...]}
```

---

### Create Payment

#### `POST /api/create-payment`

Создание входящего платежа.

**Запрос:**

```json
{
  "shipmentNum": "0128545550-0011-1"
}
```

**Ответ:**

```json
{
  "success": true,
  "paymentName": "Пл-000001"
}
```

**Ошибки:**

```json
{
  "error": "Невозможно создать платёж: Уже оплачено"
}
```

---

### Create Demand

#### `POST /api/create-demand`

Создание отгрузки (demand).

**Запрос:**

```json
{
  "shipmentNum": "0128545550-0011-1"
}
```

**Ответ:**

```json
{
  "success": true,
  "demandName": "ДО-000001"
}
```

---

### Create Return

#### `POST /api/create-return`

Создание возврата покупателя (salesreturn).

**Запрос:**

```json
{
  "shipmentNum": "0128545550-0011-1"
}
```

**Ответ:**

```json
{
  "success": true,
  "returnName": "РО-000001"
}
```

---

### Cancel Order

#### `POST /api/cancel-order`

Отмена заказа.

**Запрос:**

```json
{
  "shipmentNum": "0128545550-0011-1"
}
```

**Ответ:**

```json
{
  "success": true,
  "orderId": "...",
  "status": "cancelled",
  "reserveCleared": true
}
```

---

### Print Sticker (Печать этикетки)

#### `POST /api/print-sticker`

Поиск товара по коду и генерация PDF-этикетки через МойСклад.

**Запрос:**

```json
{
  "code": "ABC123"
}
```

**Заголовки:**

```
X-Api-Token: ваш_токен
```

**Ответ (успех — URL):**

```json
{
  "success": true,
  "pdfUrl": "https://api.moysklad.ru/..."
}
```

**Ответ (успех — файл):**

PDF файл отправляется напрямую с `Content-Type: application/pdf`

**Ошибки:**

```json
{
  "error": "Товар не найден"
}
```

**Процесс:**

1. Поиск товара по коду (`findProductByCode`)
2. Генерация PDF через API МойСклад (`exportStickerPdf`)
3. Возврат URL (303) или файла (200)

---

### Orders State

#### `GET /api/orders-state`

Получить состояние всех заказов.

**Ответ:**

```json
{
  "0128545550-0011-1": {
    "orderName": "МС-000123",
    "sum": 1500,
    "paid": 0,
    "status": "other",
    "lastAction": "payment_created",
    "lastResult": "Пл-000001"
  }
}
```

---

#### `POST /api/orders-state`

Сохранить состояние заказов.

**Запрос (полный скан):**

```json
{
  "orders": [
    {
      "shipmentNum": "0128545550-0011-1",
      "orderName": "МС-000123",
      "sum": 1500,
      "paid": 0,
      "status": "other",
      "canCreate": true
    }
  ]
}
```

**Запрос (единичный):**

```json
{
  "shipmentNum": "0128545550-0011-1",
  "action": "payment_created",
  "result": "Пл-000001"
}
```

---

#### `DELETE /api/orders-state`

Очистить состояние заказов.

**Ответ:**

```json
{
  "success": true
}
```

---

### Логи

#### `GET /api/logs`

Получить логи за текущий день.

**Ответ:**

```json
{
  "logs": "[2026-04-27 10:30:00] Проверен: 0128545550-0011-1",
  "file": "C:/.../logs/payments_2026-04-27.log"
}
```

---

### Управление сервером

#### `POST /api/restart`

Перезапустить сервер.

**Ответ:**

```json
{
  "success": true,
  "message": "Перезапуск сервера..."
}
```

---

#### `GET /api/status`

Получить статус сервера.

**Ответ:**

```json
{
  "running": true,
  "pid": 12345,
  "uptime": 3600
}
```

---

### Abort

#### `POST /api/abort`

Прервать текущую операцию.

**Запрос:**

```json
{
  "abortId": "abc123"
}
```

**Ответ:**

```json
{
  "success": true
}
```

---

## Коды ошибок

| Код | Сообщение | Причина |
|-----|-----------|--------|
| 400 | Некорректные данные | Неверный формат запроса |
| 401 | Требуется токен API | Отсутствует токен |
| 404 | Заказ не найден | Заказ не существует |
| 500 | Ошибка: ... | Внутренняя ошибка сервера |

---

## Примеры использования

### cURL

```bash
# Проверка номеров
curl -X POST http://localhost:3000/api/process \
  -H "Content-Type: application/json" \
  -H "X-Api-Token: ваш_токен" \
  -d '{"numbers": ["0128545550-0011-1"]}'

# Создание платежа
curl -X POST http://localhost:3000/api/create-payment \
  -H "Content-Type: application/json" \
  -H "X-Api-Token: ваш_токен" \
  -d '{"shipmentNum": "0128545550-0011-1"}'
```

### JavaScript
 
```javascript
const token = 'ваш_токен';
const shipmentNum = '0128545550-0011-1';
 
// Создание платежа
const response = await fetch('/api/create-payment', {
   method: 'POST',
   headers: {
     'Content-Type': 'application/json',
     'X-Api-Token': token
   },
   body: JSON.stringify({ shipmentNum })
});
 
const result = await response.json();
console.log(result);
```
```
 
---
 
### WB Sales Cache (supplier/sales)
 
Эндпоинт для получения отчёта о продажах Wildberries, используется для
сопоставления входящих платежей со стикерами заказов.
 
#### Источник данных
 
```http
GET https://statistics-api.wildberries.ru/api/v1/supplier/sales?dateFrom=YYYY-MM-DD&flag=0
```
 
**Параметры**:
- `dateFrom` — дата начала (по `lastChangeDate`)
- `flag=0` — все записи (не агрегированные)
 
**Назначение**: Отчёт о продажах, используется для сопоставления платежей
по стикерам (поле `sticker`).
 
#### Кэширование
 
- **Тип**: In-memory (`wbSalesCache` в `server.js`)
- **Персистентность**: Сохраняется на диск в `logs/wb_sales_cache.json`
  (автоматически загружается при перезапуске сервера)
- **TTL**: 2 часа (`WB_SALES_CACHE_TTL`)
- **Обновление**: Инкрементальное — только записи с `lastChangeDate > lastDate`
- **Очистка**: Записи старше 90 дней удаляются (лимит WB API)
 
#### Rate Limiting
 
- **Лимит**: ~1 запрос в минуту
- **Обработка 429**: Читает заголовок `X-Ratelimit-Retry`, ожидает указанное
   количество секунд. До 3 попыток. Если есть просроченный кэш — отдаёт его
   без повторных попыток.
- **Логика повтора** (в `getWBSalesMap()`):
   - Есть кэш (даже просроченный) → отдаём сразу, не ждём
   - Нет кэша → retry по заголовку, fallback 60s, до 3 попыток
 
#### Ключевые поля записи
 
| Поле | Тип | Описание |
|------|-----|----------|
| `sticker` | string | Стикер заказа |
| `srid` | string | ID заказа в системе WB |
| `nmId` | number | ID товара в WB |
| `barcode` | string | Штрих-код |
| `supplierArticle` | string | Артикул поставщика |
| `lastChangeDate` | string | Дата последнего изменения |
| `date` | string | Дата продажи |
| `totalPrice` | number | Цена с учётом скидки (коп.) |
 
#### Принудительное обновление
 
```http
POST /api/wb-sales/refresh
Headers:
   x-wb-token: <WB API token>
 
Response:
{
   "success": true,
   "records": 15000,
   "bySticker": 14500,
   "lastDate": "2026-05-20T10:30:00"
}
```
 
Сбрасывает TTL кэша (`fetchedAt = 0`) и принудительно загружает новые данные
из WB API через `getWBSalesMap()`.

---

### WB Returns Cache (supplier/returns)

Эндпоинт для получения отчёта о возвратах Wildberries, используется для
сопоставления входящих платежей со стикерами заказов при обработке возвратов.

#### Источник данных

```http
GET https://statistics-api.wildberries.ru/api/v1/supplier/returns?dateFrom=YYYY-MM-DD&flag=0
```

**Параметры**:
- `dateFrom` — дата начала (по `lastChangeDate`)
- `flag=0` — все записи (не агрегированные)

**Назначение**: Отчёт о возвратах, используется для сопоставления платежей
по стикерам (поле `sticker`) при обработке возвратов покупателя.

#### Кэширование

- **Тип**: In-memory (`wbReturnsCache` в `server.js`)
- **Персистентность**: Сохраняется на диск в `logs/wb_returns_cache.json`
  (автоматически загружается при перезапуске сервера)
- **TTL**: 2 часа (`WB_RETURNS_CACHE_TTL`)
- **Обновление**: Инкрементальное — только записи с `lastChangeDate > lastDate`
- **Очистка**: Записи старше 90 дней удаляются (лимит WB API)

#### Rate Limiting

- **Лимит**: ~1 запрос в минуту
- **Обработка 429**: Читает заголовок `X-Ratelimit-Retry`, ожидает указанное
  количество секунд. До 3 попыток. Если есть просроченный кэш — отдаёт его
  без повторных попыток.
- **Логика повтора** (в `getWBRReturnsMap()`):
   - Есть кэш (даже просроченный) → отдаём сразу, не ждём
   - Нет кэша → retry по заголовку, fallback 60s, до 3 попыток

#### Ключевые поля записи

| Поле | Тип | Описание |
|------|-----|----------|
| `sticker` | string | Стикер заказа |
| `srid` | string | ID заказа в системе WB |
| `nmId` | number | ID товара в WB |
| `barcode` | string | Штрих-код |
| `supplierArticle` | string | Артикул поставщика |
| `lastChangeDate` | string | Дата последнего изменения |
| `date` | string | Дата возврата |
| `totalPrice` | number | Сумма возврата с учётом скидки (коп.) |

#### Принудительное обновление

```http
POST /api/wb-returns/refresh
Headers:
  x-wb-token: <WB API token>

Response:
{
   "success": true,
   "records": 15000,
   "bySticker": 14500,
   "lastDate": "2026-05-20T10:30:00"
}
```

Сбрасывает TTL кэша (`fetchedAt = 0`) и принудительно загружает новые данные
из WB API через `getWBRReturnsMap()`.
```