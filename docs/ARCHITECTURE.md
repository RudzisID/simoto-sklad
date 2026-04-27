# Architecture

Архитектура системы SiMOTO-sklad.

## Обзор

SiMOTO-sklad — это Node.js/Express сервер для автоматизации платежей в МойСклад. Система построена по принципу **модульной архитектуры** с чётким разделением ответственности между слоями.

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (Browser)                    │
│                    Vanilla JS, Dark Theme                  │
└─────────────────────────┬─────────────────────────────────┘
                          │ HTTP + SSE
┌─────────────────────────┴─────────────────────────────────┐
│                     Express Server (server.js)               │
│  ┌─────────────────────────────────────────────────────┐  │
│  │              API Handlers (endpoints)                │  │
│  │  /api/process, /api/batch, /api/create-*          │  │
│  └─────────────────────────────────────────────────────┘  │
└─────────────────────────┬─────────────────────────────────┘
                          │
┌─────────────────────────┴─────────────────────────────────┐
│                      Business Logic (lib/)                 │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐      │
│  │  batch  │→ │  order  │→ │  check  │→ │ action* │      │
│  │ (flow)  │  │ (find)  │  │ (eval)  │  │(create)│      │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘      │
└─────────────────────────┬─────────────────────────────────┘
                          │
┌─────────────────────────┴─────────────────────────────────┐
│                    MoySklad API (SDK)                      │
│                   moysklad.js (npm package)               │
└─────────────────────────────────────────────────────────────┘
```

## Слои системы

### 1. Presentation Layer (public/)

Фронтенд на Vanilla JS:

- `index.html` — главная страница
- `app.js` — логика UI
- `styles.css` — стили (dark theme, bento)

### 2. API Layer (server.js)

Express сервер обрабатывает HTTP запросы:

- **REST эндпойнты** — `/api/process`, `/api/batch`, `/api/create-*`
- **SSE streaming** — `/api/process/stream`, `/api/batch/stream`
- **Утилиты** — `/api/logs`, `/api/status`, `/api/restart`

### 3. Business Logic Layer (lib/)

Модульная бизнес-логика:

| Модуль | Ответственность |
|--------|-----------------|
| `batch.js` | Поток обработки, параллелизм, SSE callbacks |
| `order.js` | Поиск заказов, получение данных |
| `check.js` | Анализ состояния заказа |
| `payment.js` | Создание платежей |
| `demand.js` | Создание отгрузок |
| `return.js` | Создание возвратов |
| `cancel.js` | Отмена заказов |
| `api-utils.js` | Инициализация API, утилиты |
| `constants.js` | UUID статусов и атрибутов |

### 4. Data Layer (MoySklad API)

Взаимодействие с МойСклад через SDK `moysklad`.

## Потоки данных

### Поток 1: Проверка заказа

```
client → /api/process → batch.processBatch('check')
                            ↓
                    checkOrder(shipmentNum)
                            ↓
                    order.findOrderByShipmentNum()
                            ↓
                    order.getOrderFull()
                            ↓
                    order.getDemand()
                            ↓
                    check.js → анализ статуса
                            ↓
                    result → client
```

### Поток 2: Создание платежа

```
client → /api/create-payment
                    ↓
            checkOrder(shipmentNum)
                    ↓
            order.getOrderFullForCreate()
                    ↓
            order.changeOrderStatus() [если нужно]
                    ↓
            order.getDemand()
                    ↓
            payment.createPayment()
                    ↓
            MoySklad API (POST entity/paymentin)
                    ↓
            result → client
```

### Поток 3: Пакетная обработка

```
client → /api/batch → batch.processBatch(action)
                            ↓
                    [пакеты по BATCH_CONCURRENCY=3]
                            ↓
                    для каждого номера:
                      1. checkOrder() → проверка canAction
                      2. executeAction() → create/demand/return/cancel
                      3. onProgress() → SSE callback
                            ↓
                    результат → client (или SSE stream)
```

## Архитектура модулей

### batch.js — Поток обработки

```
processBatch(numbers, action, log, onProgress, options)
│
 ├─ BATCH_CONCURRENCY = 3 (параллельно)
 ├─ CHUNK_DELAY_MS = 200ms (задержка между пакетами)
 │
 └─ action = 'check' | 'demand' | 'payment' | 'return' | 'cancel'
```

**Алгоритм:**

1. Параллельная проверка canAction пакетами по 3
2. Для каждого номера — проверка возможности действия
3. Если canAction=true → выполнение действия
4. SSE callback после каждого результата

### order.js — Работа с заказами

```
findOrderByShipmentNum(shipmentNum)
│
 ├─ Сначала ищем точное совпадение по name (номер заказа МС)
 └─ Потом ищем частичное в description (номер покупателя)
```

```
getOrderFull(orderId) → полная информация с:
│
 ├─ demands (отгрузки)
 ├─ positions.assortment (товары)
 ├─ state (статус)
 ├─ returns (возвраты)
 └─ payments (платежи)
```

### check.js — Анализ состояния

```
checkOrder(shipmentNum)
│
 ├─ findOrderByShipmentNum() → заказ
 ├─ getOrderFull() → полные данные
 │   └─ getDemand() → отгрузка
 │
 └─ Анализ:
    ├─ canDemand   = !hasDemand && !isCancelled
    ├─ canPayment = hasDemand && !hasPayment && !hasReturn && !isCancelled
    ├─ canReturn  = hasDemand && !hasReturn && !isCancelled
    └─ canCancel  = !hasDemand && !isCancelled
```

## Параллелизм и ограничения

| Параметр | Значение | Описание |
|----------|-----------|----------|
| `BATCH_CONCURRENCY` | 3 | Макс. параллельных запросов |
| `CHUNK_DELAY_MS` | 200 | Задержка между пакетами |

Ограничения:
- Не более 3 одновременных запросов к API МойСklad
- Задержка 200ms между пакетами для избежания лимитов

## Состояние и персистентность

### orders_state.json

Файл `logs/orders_state.json` хранит состояние заказов:

```json
{
  "0128545550-0011-1": {
    "orderName": "МС-000123",
    "sum": 1500,
    "paid": 0,
    "status": "other",
    "hasDemand": true,
    "hasPayment": false,
    "lastAction": "payment_created",
    "lastResult": "Пл-000001"
  }
}
```

### Логирование

- Логи: `logs/payments_YYYY-MM-DD.log`
- Хранятся 10 дней
- Автоматическая очистка при старте

## Технологический стек

| Технология | Версия | Назначение |
|------------|-------|-----------|
| Node.js | LTS | Среда выполнения |
| Express | ^4.18.2 | HTTP сервер |
| moysklad | ^0.21.1 | SDK для API |
| dotenv | ^16.3.1 | Переменные окружения |

## Диаграмма компонентов

```
┌──────────────────────────────────────────────────────────┐
│                     server.js                          │
│                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │ REST API   │  │ SSE Stream  │  │ Utilities  │    │
│  │ /api/*    │  │ /stream    │  │ /logs etc  │    │
│  └─────┬──────┘  └─────┬──────┘  └─────────────┘    │
│        │              │                               │
└────────┼──────────────┼───────────────────────────────┘
         │              │
┌────────┼──────────────┼───────────────────────────────┐
│        ▼              ▼     lib/                  │
│  ┌──────────────────────────────────────────┐   │
│  │         Moysklad Module (barrel)          │   │
│  │  exports all modules                      │   │
│  └──────────────────────────────────────────┘   │
│                                                       │
│  ┌────────┐ ┌───��─��──┐ ┌────────┐ ┌────────┐     │
│  │ batch  │ │ order  │ │ check  │ │action* │     │
│  │        │ │ find   │ │ analyze│ │create  │     │
│  └────────┘ └────────┘ └────────┘ └────────┘     │
│         │       │        │         │               │
│         └───────┴────────┴─────────┘               │
│                        │                           │
│                        ▼                           │
│         ┌──────────────────────────┐              │
│         │    api-utils + constants│                   │
│         │    (SDK initialization │                   │
│         └──────────────────────────┘              │
└──────────────────────────────────────────────────┘
```

## Безопасность

- Токен передаётся в заголовке `X-Api-Token` или query
- Нет публичного доступа к sensitive операциям
- Graceful shutdown с SIGTERM/SIGINT