# План проекта SiMOTO-sklad

Структура, архитектура и план доработок модуля автоматизации для МойСклад.

## Общее описание

Модуль автоматизации платежей и управления заказами. Работает с API МойСклад:
- Поиск заказов по номеру отправления
- Проверка статусов, сумм, оплат
- Создание платежей, отгрузок, возвратов
- Отмена заказов
- Пакетная обработка с SSE streaming

## Структура проекта

```
SiMOTO-sklad/
├── simoto-sklad.bat        # Launcher (Windows)
├── github-push.bat       # Push to GitHub (Windows)
├── package.json          # Зависимости
├── server.js            # Express сервер (точка входа)
├── .env                # Токены (в gitignore)
│
├── scripts/            # Автоматизация
│   ├── auto-push.js    # Автопуш с версионированием
│   ├── docs-generator.js # Генератор документации
│   ├── check-update.js   # Проверка обновлений
│   └── create-release.js # GitHub release API
│
├── lib/                # Бизнес-логика
│   ├── moysklad.js     # Баррел
│   ├── batch.js       # Пакетная обработка + SSE
│   ├── order.js      # Поиск заказов
│   ├── check.js     # Проверка статусов
│   ├── payment.js   # Платежи
│   ├── demand.js   # Отгрузки
│   ├── return.js   # Возвраты
│   ├── cancel.js  # Отмена
│   ├── api-utils.js # Утилиты
│   └── constants.js # UUID статусов
│
├── integrations/        # Интеграции
│   └── wb_ozon_sync.js # WB/Ozon (скелет)
│
├── public/             # Фронтенд
├── logs/              # Логи и состояния
├── docs/              # Автодокументация
└── test/             # Тесты
```

## Основные модули

### server.js
- Назначение: точка входа, Express сервер
- Эндпойнты: `/api/process`, `/api/batch`, `/api/create-*`, `/api/cancel-order`
- SSE: `/api/process/stream`, `/api/batch/stream`
- Состояние: `logs/orders_state.json`

### lib/moysklad.js
- Назначение: баррел — экспорт всех модулей lib
- Экспортирует все функции из sub-modules

### lib/batch.js
- Назначение: пакетная обработка + SSE streaming
- Функции: `processBatch(numbers, action, log, onProgress, options)`
- Поддержка abort signals

### lib/order.js
- Назначение: поиск и работа с заказами
- Функции: `findOrderByShipmentNum`, `getOrderFull`, `getDemand`, `changeOrderStatus`

### lib/payment.js
- Назначение: создание платежей
- Функции: `createPayment(orderFull, demand)`

### lib/demand.js
- Назначение: создание отгрузок
- Функции: `createDemand(orderFull)`

### lib/return.js
- Назначение: создание возвратов
- Функции: `createReturn(orderId, orderFull, demandId)`

### lib/cancel.js
- Назначение: отмена заказов
- Функции: `cancelOrder(orderId, orderFull, demandId)`

### lib/constants.js
- Назначение: UUID статусов и атрибутов МойСклад
- Константы: `ORDER_STATUS`, `DEMAND_STATUS`, `ATTRIBUTES`

### integrations/wb_ozon_sync.js
- Назначение: синхронизация товаров WB/Ozon
- Статус: скелет (mock данные)

## Архитектура взаимодействия

```
Client (Browser) --HTTP--> server.js ---> lib/batch.js ---> lib/*.js ---> MoySklad API
                                        |
                                        +--> logs/*.log
                                        +--> logs/orders_state.json
```

```
Client (SSE) --SSE--> server.js ---> lib/batch.js (with callbacks)
```

## API эндпойнты (детали)

### Проверка заказов
- `POST /api/process` — проверка массива номеров
- `GET /api/process/stream` — SSE realtime проверка

### Пакетные операции
- `POST /api/batch` — batch с action (demand/payment/return/cancel)
- `GET /api/batch/stream` — SSE realtime batch

### Создание документов
- `POST /api/create-payment` — платёж
- `POST /api/create-demand` — отгрузка
- `POST /api/create-return` — возврат
- `POST /api/cancel-order` — отмена

### Состояние
- `GET /api/orders-state` — получить состояние
- `POST /api/orders-state` — сохранить состояние
- `DELETE /api/orders-state` — очистить

## План доработок

### V1 (текущая)
- [x] Базовый функционал платежей
- [x] Пакетная обработка
- [x] SSE streaming
- [x] Web интерфейс

### V2 (planned)
- [ ] Тесты для lib/*
- [ ] Валидация входящих данных
- [ ] Rate limiting
- [ ] Очередь операций

### V3 (future)
- [ ] CI/CD
- [ ] Мониторинг (Prometheus)
- [ ] API документация (Swagger)
- [ ] Интеграция WB полная
- [ ] Интеграция Ozon полная

## Конфигурация

### package.json (scripts)
```json
{
  "start": "node server.js",
  "test": "jest",
  "docs": "node scripts/docs-generator.js",
  "push": "node scripts/auto-push.js"
}
```

### .env (пример)
```
MOYSKLAD_TOKEN=токен_api_мойсклад
PORT=3000
GH_TOKEN=токен_github
```

## Как использовать этот план

1. Добавляйте задачи в раздел "План доработок"
2. При закрытии задачи — отмечайте выполненной с коммитом
3. При изменении структуры — обновляйте этот файл
4. Подробности в INSTRUCTION.md