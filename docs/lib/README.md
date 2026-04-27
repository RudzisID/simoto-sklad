# Документация модулей lib/

Здесь описаны все модули бизнес-логики.

## Обзор структуры

```
lib/
├── moysklad.js      # Баррел — все экспорты
├── batch.js       # Пакетная обработка + SSE
├── order.js      # Поиск и работа с заказами
├── check.js     # Проверка статусов
├── payment.js   # Создание платежей
├── demand.js     # Создание отгрузок
├── return.js    # Создание возвратов
├── cancel.js    # Отмена заказов
├── api-utils.js  # Утилиты API
└── constants.js # Константы (UUID)
```

## Быстрый старт

```javascript
const {
    initApi,
    checkOrder,
    createPayment,
    createDemand,
    createReturn,
    cancelOrder,
    processBatch,
    ORDER_STATUS
} = require('./lib/moysklad');

// Инициализация
initApi(process.env.MOYSKLAD_TOKEN);

// Проверка заказа
const check = await checkOrder('0128545550-0011-1');
console.log(check.canPayment);

// Создание платежа
if (check.canPayment) {
    const payment = await createPayment(orderFull, demand);
}
```

## Содержание

### Основные модули

| Файл | Описание |
|------|----------|
| [moysklad.md](lib/moysklad.md) | Баррел-файл, точка входа |
| [batch.md](lib/batch.md) | Пакетная обработка, параллелизм, SSE |
| [order.md](lib/order.md) | Поиск заказов, получение данных |

### Проверка и анализ

| Файл | Описание |
|------|----------|
| [check.md](lib/check.md) | Анализ статусов заказа, canAction |

### Действия (создание документов)

| Файл | Описание |
|------|----------|
| [payment.md](lib/payment.md) | Создание входящих платежей |
| [demand.md](lib/demand.md) | Создание отгрузок (demand) |
| [return.md](lib/return.md) | Создание возвратов (salesreturn) |
| [cancel.md](lib/cancel.md) | Отмена заказов |

### Утилиты и конфигурация

| Файл | Описание |
|------|----------|
| [api-utils.md](lib/api-utils.md) | Инициализация API, утилиты |
| [constants.md](lib/constants.md) | UUID статусов и атрибутов |

## Поток работы

```
          ┌──────────────────┐
          │   initApi()     │ ← Один раз при старте
          └────────┬───────┘
                   │
          ┌────────▼───────┐
          │  checkOrder() │ ← Проверка статуса
          └────────┬───────┘
                   │
     ┌─────────────┼─────────────┐
     │             │             │
┌────▼────┐ ┌───▼────┐ ┌───▼─────┐
│ canPay  │ │canDemnd│ │canRetn │ ...определяется
└────┬───┘ └───┬────┘ └───┬────┘
     │         │           │
     ▼         ▼           ▼
┌────────┐ ┌────────┐ ┌──────────┐
│payment │ │ demand │ │ return  │
│.js     │ │.js     │ │.js      │
└───��────┘ └────────┘ └──────────┘
```

## Пример: полный цикл

```javascript
const { initApi, checkOrder, createPayment } = require('./lib/moysklad');
const { getOrderFullForCreate, getDemand } = require('./lib/order');

async function processPayment(shipmentNum) {
    // 1. Инициализация (один раз)
    initApi(process.env.MOYSKLAD_TOKEN);
    
    // 2. Проверка
    const check = await checkOrder(shipmentNum);
    if (!check.canPayment) {
        return { error: check.statusName };
    }
    
    // 3. Получение данных
    const orderFull = await getOrderFullForCreate(check.orderId);
    const demand = await getDemand(orderFull.demands[0].meta.href.split('/').pop());
    
    // 4. Создание платежа
    const payment = await createPayment(orderFull, demand);
    
    return { success: true, paymentName: payment.name };
}
```

## Связанная документация

- [README](../README.md) — Обзор проекта
- [API.md](../API.md) — API эндпойнты
- [ARCHITECTURE.md](../ARCHITECTURE.md) — Архитектура системы