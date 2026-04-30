# SiMOTO-sklad

Модуль автоматизации платежей и управления заказами для **МойСклад**.

## Возможности

- **Поиск заказов** — по номеру отправления (Ozon, WB) или номеру заказа
- **Проверка статусов** — анализ состояния заказа, отгрузки, оплаты и возврата
- **Создание платежей** — входящие платежи с привязкой к заказу
- **Создание отгрузок** — формирование документа demand
- **Создание возвратов** — оформление возврата покупателя
- **Отмена заказов** — сброс резерва и установка статуса "Отменён"
- **Пакетная обработка** — массовые операции с SSE streaming
- **Web-интерфейс** — тёмная тема
- **Цветное логирование** — автоматическая цветовая кодировка сообщений в консоли (server.js)

## Быстрый старт

### 1. Установка зависимостей

```bash
npm install
```

### 2. Настройка переменных окружения

Создайте файл `.env` в корне проекта:

```env
MOYSKLAD_TOKEN=ваш_токен_api
PORT=3000
GH_TOKEN=токен_github (для релизов)
```

### 3. Запуск

**Windows:**
```bash
simoto-sklad.bat
```

**Или:**
```bash
npm start
```

Откройте в браузере: http://localhost:3000

## Структура проекта

```
SiMOTO-sklad/
├── simoto-sklad.bat    # Launcher (Windows) — запуск с проверкой обновлений
├── github-push.bat    # Push (Windows) — коммит и пуш на GitHub с релизом
├── package.json       # Зависимости и скрипты
├── .env               # Переменные окружения (токены)
├── .gitignore         # Git ignore
├── .opencodeignore    # OpenCode ignore
├── server.js          # Express сервер, все API эндпойнты
│
├── scripts/           # Автоматизация
│   ├── auto-push.js   # Автопуш с версионированием
│   ├── docs-generator.js  # Генератор документации
│   ├── check-update.js    # Проверка обновлений GitHub
│   └── create-release.js # Создание GitHub release
│
├── lib/               # Бизнес-логика
│   ├── moysklad.js    # Баррел — экспорт всех модулей
│   ├── batch.js       # Пакетная обработка + SSE
│   ├── order.js      # Поиск и работа с заказами
│   ├── check.js     # Проверка статусов
│   ├── payment.js   # Создание платежей
│   ├── demand.js    # Создание отгрузок
│   ├── return.js   # Создание возвратов
│   ├── cancel.js   # Отмена заказов
│   ├── api-utils.js # Утилиты API
│   └── constants.js # UUID статусов и атрибутов
│
├── integrations/      # Интеграции
│   └── wb_ozon_sync.js # Синхронизация WB/Ozon (скелет)
│
├── public/            # Фронтенд (Vanilla JS, dark theme)
├── logs/             # Логи и состояния
├── docs/             # Автогенерированная документация
└── test/            # Тесты (Jest)
```

## API эндпойнты

### Основные

| Метод | Путь | Описание |
|-------|------|---------|
| GET | `/api/health` | Проверка здоровья сервера |
| GET | `/api/status` | Статус сервера (PID, uptime) |

### Обработка заказов

| Метод | Путь | Описание |
|-------|------|---------|
| POST | `/api/process` | Проверка номеров |
| GET | `/api/process/stream` | SSE проверка (realtime) |
| POST | `/api/batch` | Пакетная операция (demand/payment/return/cancel) |
| GET | `/api/batch/stream` | SSE batch (realtime) |

### Создание документов

| Метод | Путь | Описание |
|-------|------|---------|
| POST | `/api/create-payment` | Создать платёж |
| POST | `/api/create-demand` | Создать отгрузку |
| POST | `/api/create-return` | Создать возврат |
| POST | `/api/cancel-order` | Отменить заказ |

### Состояние и логи

| Метод | Путь | Описание |
|-------|------|---------|
| GET | `/api/orders-state` | Получить состояние заказов |
| POST | `/api/orders-state` | Сохранить состояние |
| DELETE | `/api/orders-state` | Очистить состояние |
| POST | `/api/save-report` | Сохранить отчёт |
| GET | `/api/logs` | Получить логи |
| GET | `/api/debug-state` | Debug: состояние файла state |

### Управление сервером

| Метод | Путь | Описание |
|-------|------|---------|
| POST | `/api/restart` | Перезапустить сервер |
| POST | `/api/start` | Запустить в новом окне |
| POST | `/api/abort` | Прервать текущую операцию |

### Интеграции

| Метод | Путь | Описание |
|-------|------|---------|
| POST | `/api/sync-products` | Синхронизация WB/Ozon товаров |

Подробнее в [docs/API.md](docs/API.md).

## NPM скрипты

```bash
npm start        # Запуск сервера
npm test        # Запуск тестов
npm run docs     # Генерация документации
npm run push     # Пуш с патч-версией
npm run push:minor  # Пуш с минорной версией
npm run push:major  # Пуш с мажорной версией
npm run push:auto # Автоматический пуш
```

## Зависимости

| Пакет | Версия | Назначение |
|-------|-------|----------|
| express | ^4.18.2 | HTTP сервер |
| moysklad | ^0.21.1 | API клиент МойСклад |
| dotenv | ^16.3.1 | Переменные окружения |
| jest | ^29.0.0 | Тестирование |

## Документация

- [API.md](docs/API.md) — Документация всех эндпойнтов
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — Архитектура системы
- [MAINTENANCE.md](docs/MAINTENANCE.md) — Руководство по поддержке документации
- [lib/](docs/lib/) — Описание каждого модуля
  - [product.md](docs/lib/product.md) — Поиск товаров
  - [print.md](docs/lib/print.md) — Печать этикеток
- [scripts/](docs/scripts/) — Скрипты автоматизации
  - [auto-push.md](docs/scripts/auto-push.md) — Автопуш на GitHub
  - [docs-generator.md](docs/scripts/docs-generator.md) — Генератор документации
- [integrations/](docs/integrations/) — Интеграции
  - [wb_ozon_sync.md](docs/integrations/wb_ozon_sync.md) — Синхронизация WB/Ozon
- [frontend/](docs/frontend/) — Фронтенд
  - [app.md](docs/frontend/app.md) — Логика веб-интерфейса
- [PLAN.md](PLAN.md) — План и структура проекта
- [INSTRUCTION.md](INSTRUCTION.md) — Подробная инструкция

## Лицензия

MIT
