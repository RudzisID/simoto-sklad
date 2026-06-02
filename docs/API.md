# API Documentation

Справочник по всем REST API и SSE эндпойнтам SiMOTO-sklad v1.6.1.

## Общие сведения

- **Базовый URL**: `http://localhost:3000`
- **Формат**: JSON (кроме SSE — `text/event-stream`)
- **Аутентификация**: Токен в заголовке `X-Api-Token` или query-параметре `token`
- **Кодировка**: UTF-8

## Содержание

- [REST API (routes/api.js)](#rest-api)
  - [Health & Status](#health--status)
  - [Проверка заказов](#проверка-заказов)
  - [Пакетные операции](#пакетные-операции)
  - [Создание документов](#создание-документов)
  - [Состояние заказов](#состояние-заказов)
  - [Управление сервером](#управление-сервером)
  - [Интеграции](#интеграции)
- [SSE Endpoints (routes/sse.js)](#sse-endpoints)
  - [SSE: Проверка](#sse-проверка-processstream)
  - [SSE: Пакетная обработка](#sse-пакетная-обработка-batchstream)
  - [SSE: WB Return](#sse-wb-return-wb-returnstream)
  - [SSE: Unified Search](#sse-unified-search-unified-searchstream)
  - [SSE: WB All](#sse-wb-all-wb-allstream)
  - [SSE: Ozon All](#sse-ozon-all-ozon-allstream)
  - [SSE: Ozon Return](#sse-ozon-return-ozon-returnstream)
- [Market Endpoints (routes/market.js)](#market-endpoints)
  - [Поиск товаров](#поиск-товаров)
  - [Обновление товаров](#обновление-товаров)
  - [Синхронизация изображений](#синхронизация-изображений)
- [Debug (routes/debug.js)](#debug-endpoints)
- [Коды ошибок](#коды-ошибок)

---

## REST API

### Health & Status

#### `GET /api/health`

Проверка работоспособности сервера.

**Ответ:**
```json
{ "status": "ok", "time": "2026-05-30T10:30:00.000Z" }
```

#### `GET /api/status`

Состояние сервера (PID, uptime).

**Ответ:**
```json
{ "running": true, "pid": 12345, "uptime": 3600 }
```

#### `GET /api/logs`

Последние 100 строк лога за текущий день.

**Ответ:**
```json
{
  "logs": "[2026-05-30 10:30:00] === Начало check ===\n...",
  "file": "C:/.../logs/payments_2026-05-30.log"
}
```

#### `POST /api/abort`

Установка сигнала отмены для активного процесса.

**Запрос:**
```json
{ "abortId": "abc123" }
```
**Ответ:** `{ "success": true }`

---

### Проверка заказов

#### `POST /api/process`

Проверка (check) одного или нескольких заказов по номерам отправлений.

**Заголовки:** `X-Api-Token: <токен МойСклад>`

**Параметры:**

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| `numbers` | `string[]` | Да | Массив номеров отправлений |

**Пример запроса:**
```json
{ "numbers": ["0128545550-0011-1", "4965524118"] }
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
      "demandName": "ДО-000456",
      "orderPositions": [],
      "demandPositions": []
    }
  ]
}
```

---

### Пакетные операции

#### `POST /api/batch`

Пакетное выполнение действия над списком заказов.

**Заголовки:** `X-Api-Token: <токен МойСклад>`

**Параметры:**

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| `numbers` | `string[]` | Да | Массив номеров отправлений |
| `action` | `string` | Да | `demand` \| `payment` \| `return` \| `cancel` |

**Пример запроса:**
```json
{ "numbers": ["0128545550-0011-1"], "action": "payment" }
```

**Ответ:**
```json
{
  "created": 1,
  "skipped": 0,
  "errors": 0,
  "orders": [
    { "status": "created", "paymentName": "Пл-000001", "shipmentNum": "0128545550-0011-1" }
  ]
}
```

#### `POST /api/save-report`

Сохранение отчёта проверки/операций в JSON-файл (`logs/report_YYYY-MM-DD.json`).

**Параметры:**

| Поле | Тип | Описание |
|------|-----|----------|
| `ordersData` | `object[]` | Данные заказов |
| `resultsData` | `object[]` | Результаты операций |

**Ответ:** `{ "success": true, "file": "logs/report_2026-05-30.json" }`

---

### Создание документов

Общие параметры для всех эндпойнтов создания:

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| `shipmentNum` | `string` | Да | Номер отправления |
| `orderId` | `string` | Нет | UUID заказа (пропускает поиск) |
| `X-Api-Token` | header | Да | Токен МойСклад |

#### `POST /api/create-payment`

Создание входящего платежа. Автоматически проверяет возможность оплаты.

**Ответ:**
```json
{ "success": true, "paymentName": "Пл-000001" }
```

#### `POST /api/create-partial-payment`

Создание частичного платежа по возврату.

**Ответ:**
```json
{ "success": true, "paymentName": "Пл-000001", "paymentSum": 500 }
```

#### `POST /api/create-demand`

Создание отгрузки (demand) с копированием позиций из заказа.

**Ответ:**
```json
{ "success": true, "demandName": "ДО-000001" }
```

#### `POST /api/create-return`

Создание возврата (salesReturn) с копированием позиций из отгрузки.

**Ответ:**
```json
{ "success": true, "returnName": "РО-000001", "returnSum": 1500 }
```

#### `POST /api/cancel-order`

Отмена заказа со сбросом резерва позиций.

**Ответ:**
```json
{ "success": true, "orderId": "...", "status": "cancelled", "reserveCleared": true }
```

#### `POST /api/print-sticker`

Генерация PDF-стикера для товара по коду (OEM/артикул).

**Заголовки:** `X-Api-Token: <токен МойСклад>`

**Параметры:**

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| `code` | `string` | Да | Код товара (OEM/артикул) |

**Ответ (URL):**
```json
{ "success": true, "pdfUrl": "https://api.moysklad.ru/..." }
```
**Ответ (файл):** PDF с `Content-Type: application/pdf` и `Content-Disposition: inline`

---

### Состояние заказов

#### `GET /api/orders-state`

Получить сохранённое состояние заказов.

**Ответ:**
```json
{
  "0128545550-0011-1": {
    "orderName": "МС-000123",
    "sum": 1500,
    "paid": 0,
    "status": "other",
    "statusName": "Отгружен",
    "canCreate": true,
    "orderId": "...",
    "savedAt": "2026-05-30T10:30:00.000Z",
    "lastAction": "payment_created",
    "lastResult": "Пл-000001"
  }
}
```

#### `POST /api/orders-state`

Сохранить состояние (полный скан или обновление одного заказа).

**Полный скан:**
```json
{
  "orders": [
    {
      "shipmentNum": "0128545550-0011-1",
      "orderName": "МС-000123",
      "sum": 1500,
      "paid": 0,
      "status": "other",
      "statusName": "Отгружен",
      "canCreate": true,
      "orderPositions": [],
      "demandPositions": []
    }
  ]
}
```

**Обновление одного:**
```json
{
  "shipmentNum": "0128545550-0011-1",
  "action": "payment_created",
  "result": "Пл-000001"
}
```

**Ответ:** `{ "success": true, "count": 1 }`

#### `DELETE /api/orders-state`

Очистка всего сохранённого состояния.

**Ответ:** `{ "success": true }`

---

### Управление сервером

#### `POST /api/restart`

Перезапуск сервера через graceful shutdown с флагом `shouldRestart`.

**Ответ:**
```json
{ "success": true, "message": "Перезапуск сервера..." }
```

#### `POST /api/start`

Запуск нового экземпляра сервера в отдельном процессе (через `simoto-sklad.bat`).

**Ответ:**
```json
{ "success": true, "message": "Сервер запущен в новом окне" }
```

---

### Интеграции

#### `POST /api/wb-sales/refresh`

Принудительное обновление всех кэшей Wildberries (сброс TTL).

**Заголовки:** `X-Wb-Token: <токен WB>`

**Ответ:**
```json
{ "success": true, "message": "Кэш WB обновлён" }
```

#### `POST /api/wb-returns/refresh`

Алиас для `/api/wb-sales/refresh` (legacy).

#### `POST /api/sync-products`

Синхронизация товаров: поиск на WB и Ozon по кодам, агрегация.

**Параметры:**

| Поле | Тип | Описание |
|------|-----|----------|
| `wbCodes` | `string[]` | Коды для поиска на Wildberries |
| `ozonCodes` | `string[]` | Коды для поиска на Ozon |

**Ответ:**
```json
{ "success": true, "merged": { ... } }
```

---

## SSE Endpoints

SSE (Server-Sent Events) — потоковая передача данных в реальном времени. Поддерживает отмену через `abortId`.

Все SSE эндпойнты монтируются на `/api`.

### SSE: Проверка (`/api/process/stream`)

**Метод:** `GET`

**Query-параметры:**

| Параметр | Тип | Обязательно | Описание |
|----------|-----|-------------|----------|
| `token` | `string` | Да | Токен API МойСклад |
| `numbers` | `string` | Да | Номера отправлений через запятую |
| `abortId` | `string` | Нет | ID для отмены |

**События SSE:**

| Тип | Описание |
|-----|----------|
| `progress` | Промежуточный результат (index, total, order) |
| `done` | Завершение (orders — массив результатов) |
| `error` | Ошибка |
| `aborted` | Отменено пользователем |

**Пример:**
```
GET /api/process/stream?token=...&numbers=0128545550-0011-1,4965524118

data: {"type":"progress","index":1,"total":2,"order":{...}}
data: {"type":"done","orders":[...]}
```

### SSE: Пакетная обработка (`/api/batch/stream`)

**Метод:** `POST`

**Параметры тела:**

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| `token` | `string` | Да | Токен API МойСклад |
| `numbers` | `string[]` | Да | Массив номеров отправлений |
| `action` | `string` | Да | `demand` \| `payment` \| `return` \| `cancel` |
| `abortId` | `string` | Нет | ID для отмены |
| `checkData` | `object` | Нет | Готовые результаты проверки (пропускает re-check) |

**События SSE:**

| Тип | Описание |
|-----|----------|
| `progress` | Результат одного заказа + статистика (created/skipped/errors) |
| `done` | Завершение с финальной статистикой |
| `error` | Ошибка |
| `aborted` | Отменено |

### SSE: WB Return (`/api/wb-return/stream`)

Поиск возвратов Wildberries по стикерам.

**Метод:** `GET`

**Заголовки:** `X-Wb-Token: <токен WB>`

**Query-параметры:**

| Параметр | Тип | Обязательно | Описание |
|----------|-----|-------------|----------|
| `token` | `string` | Да | Токен API МойСклад |
| `numbers` | `string` | Да | Номера стикеров через запятую |
| `abortId` | `string` | Нет | ID для отмены |

**События SSE:**

| Тип | Описание |
|-----|----------|
| `progress` | Ожидание при лимите WB API |
| `search-ms` | Поиск в МойСклад по orderId |
| `result` | Результат по одному стикеру |
| `done` | Завершение |
| `error` | Ошибка |
| `aborted` | Отменено |

### SSE: Unified Search (`/api/unified-search/stream`)

Универсальный поиск заказов по МойСклад + WB + Ozon. Определяет маркетплейс по описанию заказа.

**Метод:** `GET`

**Заголовки:** (хотя бы один набор)

| Заголовок | Описание |
|-----------|----------|
| `X-Api-Token` | Токен МойСклад |
| `X-Wb-Token` | Токен Wildberries |
| `X-Ozon-Client-Id` | Client-ID Ozon |
| `X-Ozon-Api-Key` | API-Key Ozon |

**Query-параметры:**

| Параметр | Тип | Обязательно | Описание |
|----------|-----|-------------|----------|
| `numbers` | `string` | Да | Коды поиска через запятую |
| `abortId` | `string` | Нет | ID для отмены |

**События SSE:** `progress`, `done`, `error`, `aborted`

### SSE: WB All (`/api/wb-all/stream`)

Обновление всех кэшей Wildberries.

**Метод:** `GET`

**Заголовки:** `X-Wb-Token: <токен WB>`

**Query:** `token` — токен МойСклад

**События SSE:** `progress`, `done`, `error`

### SSE: Ozon All (`/api/ozon-all/stream`)

Обновление всех кэшей Ozon.

**Метод:** `GET`

**Заголовки:** `X-Ozon-Client-Id`, `X-Ozon-Api-Key`

**Query:** `token` — токен МойСклад

**События SSE:** `progress`, `done`, `error`

### SSE: Ozon Return (`/api/ozon-return/stream`)

Поиск возвратов Ozon по кодам.

**Метод:** `GET`

**Заголовки:** `X-Ozon-Client-Id`, `X-Ozon-Api-Key`

**Query-параметры:**

| Параметр | Тип | Обязательно | Описание |
|----------|-----|-------------|----------|
| `token` | `string` | Да | Токен API МойСклад |
| `numbers` | `string` | Да | Коды возвратов через запятую |

**События SSE:** `search-ms`, `result`, `error`, `done`

---

## Market Endpoints

Монтируются на `/api/market`.

### Поиск товаров

#### `GET /api/market/product`

Поиск товара на МойСклад, WB и Ozon по OEM-коду.

**Заголовки:**

| Заголовок | Обязательно | Описание |
|-----------|-------------|----------|
| `X-Api-Token` | Да | Токен МойСклад |
| `X-Wb-Token` | Нет | Токен Wildberries |
| `X-Ozon-Client-Id` | Нет | Client-ID Ozon |
| `X-Ozon-Api-Key` | Нет | API-Key Ozon |

**Query:** `code` — OEM-код товара

**Ответ:**
```json
{
  "oem": "ABC123",
  "moysklad": { "id": "...", "name": "Товар", "code": "ABC123", "price": 1500, "stock": 10, "description": "...", "attributes": [] },
  "wildberries": { "nmID": 123, "vendorCode": "ABC123", "price": 1600 },
  "ozon": { "offer_id": "ABC123", "product_id": 456, "price": 1550 },
  "sharedAttributes": { "price": { "ms": 1500, "wb": 1600, "ozon": 1550 } }
}
```

#### `GET /api/market/product/full`

Полные данные товара (аналогично `/product`).

---

### Обновление товаров

#### `POST /api/market/push/ms`

Обновление товара в МойСклад (цена, название, описание, атрибуты).

**Заголовки:** `X-Api-Token: <токен МС>`

**Параметры:**

| Поле | Тип | Описание |
|------|-----|----------|
| `productId` | `string` | ID товара в МС |
| `price` | `number` | Новая цена в рублях |
| `title` | `string` | Новое название |
| `description` | `string` | Новое описание |
| `attributes` | `object[]` | Массив атрибутов `[{id, value}]` |

**Ответ:** `{ "success": true, "message": "Товар обновлён в МойСклад" }`

#### `POST /api/market/push/wb`

Обновление товара в Wildberries (описание, характеристики, изображения).

**Заголовки:** `X-Wb-Token: <токен WB>`

**Параметры:**

| Поле | Тип | Описание |
|------|-----|----------|
| `vendorCode` | `string` | Артикул товара |
| `title` | `string` | Название |
| `description` | `string` | Описание |
| `characteristics` | `object[]` | Характеристики |
| `images` | `string[]` | URL изображений |

#### `POST /api/market/push/ozon`

Обновление товара в Ozon.

**Заголовки:** `X-Ozon-Client-Id`, `X-Ozon-Api-Key`

**Параметры:**

| Поле | Тип | Описание |
|------|-----|----------|
| `offerId` | `string` | offerId товара |
| `productId` | `string` | productId товара |
| `title` | `string` | Название |
| `description` | `string` | Описание |
| `attributes` | `object[]` | Атрибуты |
| `images` | `string[]` | URL изображений |
| `typeId` | `number` | ID типа товара |

---

### Синхронизация изображений

#### `POST /api/market/sync/image`

Синхронизация изображения между WB и Ozon.

**Параметры:**

| Поле | Тип | Описание |
|------|-----|----------|
| `sourcePlatform` | `string` | `wb` \| `ozon` |
| `targetPlatform` | `string` | `wb` \| `ozon` |
| `imageUrl` | `string` | URL изображения |
| `nmId` | `string` | nmId WB (для ozon→wb) |
| `offerId` | `string` | offerId Ozon (для wb→ozon) |

#### `POST /api/market/image/upload`

Загрузка изображения на сервер (multipart/form-data).

**Поле:** `image` (файл)

**Ограничения:** макс. 10MB, форматы: jpg, png, webp, gif.

**Ответ:**
```json
{ "success": true, "filename": "upload_123.jpg", "originalName": "photo.jpg", "size": 51200, "url": "/temp/images/upload_123.jpg" }
```

---

## Debug Endpoints

#### `GET /api/debug-state`

Просмотр содержимого файла состояния заказов (`orders_state.json`).

**Ответ:**
```json
{
  "file": "C:/.../logs/orders_state.json",
  "exists": true,
  "count": 42,
  "keys": ["0128545550-0011-1", "4965524118"],
  "state": { ... }
}
```

---

## Коды ошибок

| HTTP | Тип | Причина |
|------|-----|--------|
| 400 | `Некорректные данные` | Неверный формат запроса, пустой массив |
| 400 | `Некорректное действие` | Неверный `action` (не demand/payment/return/cancel) |
| 400 | `Требуется код товара` | Отсутствует `code` для поиска товара |
| 400 | `Требуется shipmentNum и action` | Не указан номер отправления |
| 401 | `Требуется токен API` | Отсутствует `X-Api-Token` |
| 401 | `Требуется WB токен` | Отсутствует `X-Wb-Token` |
| 401 | `Требуются Client-Id и Api-Key Ozon` | Отсутствуют заголовки Ozon |
| 404 | `Заказ не найден` | Заказ с указанным номером не существует |
| 500 | `Ошибка: ...` | Внутренняя ошибка сервера |

Все ошибки возвращаются в формате:
```json
{ "error": "Текст ошибки" }
```
