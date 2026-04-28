# План проекта SiMOTO-sklad

Структура, архитектура и план доработок модуля автоматизации для МойСклад.

---

## Текущий статус

**Версия:** 1.1.5
**Статус:** Рабочий проект ✅

### Что сделано:
- [x] Базовый функционал платежей, отгрузок, возвратов, отмены
- [x] Пакетная обработка с SSE streaming
- [x] Web интерфейс (dark theme, bento design)
- [x] CI/CD скрипты (автопуш, релизы)
- [x] Структурированная документация (README, INSTRUCTION, PLAN)
- [x] Реорганизация файлов (scripts/ отдельно)

---

## Структура проекта

```
SiMOTO-sklad/
├── simoto-sklad.bat        # Launcher (Windows)
├── github-push.bat       # Push to GitHub (Windows)
├── package.json          # Зависимости
├── server.js            # Express сервер
├── .env                # Токены
├── .gitignore          # Git ignore
│
├── scripts/            # Автоматизация
│   ├── auto-push.js    # Автопуш с версионированием
│   ├── docs-generator.js # Документация
│   ├── check-update.js   # Проверка обновлений
│   └── create-release.js # GitHub release
│
├── lib/                # Бизнес-логика
│   ├── moysklad.js     # Баррел
│   ├── batch.js       # Пакетная обработка + SSE
│   ├── order.js      # Поиск заказов
│   ├── check.js     # Проверка статусов
│   ├── payment.js   # Платежи ⚠️ критично
│   ├── demand.js   # Отгрузки ⚠️ критично
│   ├── return.js   # Возвраты ⚠️ критично
│   ├── cancel.js  # Отмена ⚠️ крити��но
│   ├── api-utils.js # Утилиты
│   └── constants.js # UUID статусов
│
├── integrations/        # Интеграции
│   └── wb_ozon_sync.js # WB/Ozon (скелет)
│
├── public/             # Фронтенд
├── logs/              # Логи и состояния
├── docs/             # Автодокументация
└── test/             # Тесты (Jest)
```

---

## Архитектура

```
Client (Browser) --HTTP--> server.js ---> lib/batch.js ---> lib/*.js ---> MoySklad API
                                        |
                                        +--> logs/*.log
                                        +--> logs/orders_state.json
```

---

## План доработок

### 🔴 V2 — Качество и защита (приоритет: ВЫСОКИЙ)

> **Важно:** Ошибки создают документы в МойСклад, которые может удалить только директор.
> Тесты обязательны перед любой доработкой.

**Автовызов:** Прочитай `.opencode/context/plans/v2-execution.md` и выполни ВСЁ, вызывая нужных суб-агентов

#### 2.1 Тесты (КРИТИЧНО)
- [ ] Установить jest-mock для изоляции от МойСклад API
- [ ] Тесты для `lib/payment.js` — создание платежей
- [ ] Тесты для `lib/demand.js` — создание отгрузок
- [ ] Тесты для `lib/return.js` — создание возвратов
- [ ] Тесты для `lib/cancel.js` — отмена заказов
- [ ] Тесты для `lib/batch.js` — пакетная обработка
- [ ] CI-гайт: тесты должны проходить перед push

**Кто делает:** `TestEngineer`

**Как вызвать:**
```
@TestEngineer Напиши тесты для lib/payment.js

Требования:
- Используй jest с jest-mock
- Моки для moysklad API (не обращаться к реальному API)
- Положительные и отрицательные кейсы
- Обязательно: skip если уже оплачен
- Обязательно: error handling
```

**Структура тестов:**
```
test/
├── mocks/              # Моки API ответов
│   ├── order_found.json
│   ├── order_with_demand.json
│   ├── demand_created.json
│   └── ...
├── payment.test.js    # Тесты платежей
├── demand.test.js     # Тесты отгрузок
├── return.test.js     # Тесты возвратов
├── cancel.test.js    # Тесты отмены
└── batch.test.js    # Тесты пакетной обработки
```

**Пример мока:**
```javascript
// test/mocks/payment_already_paid.json
{
  "demand": {
    "id": "abc123",
    "sum": 150000,      // в копейках
    "payedSum": 150000  // уже оплачен
  }
}
```

#### 2.2 ESLint + Prettier
- [ ] Установить eslint, prettier
- [ ] Создать `.eslintrc.js`
- [ ] Создать `.prettierrc`
- [ ] Создать `.gitattributes` (LF endings)
- [ ] Настроить precommit hook (автоформат)
- [ ] Прогнать по всему коду

**Кто делает:** `OpenDevopsSpecialist`

**Как вызвать:**
```
@OpenDevopsSpecialist Настрой ESLint + Prettier

Требования:
- Простой конфиг (не переусердствовать)
- console.log допустим (для отладки)
- Обязательно .gitattributes для LF
- Prettier: 2 spaces, single quotes
```

#### 2.3 JSDoc типы
- [ ] Создать `lib/types.js` — документация типов
- [ ] Добавить JSDoc в `lib/payment.js`
- [ ] Добавить JSDoc в `lib/order.js`
- [ ] Добавить JSDoc в `lib/batch.js`
- [ ] IDE автодополнение заработает автоматически

**Кто делает:** `DocWriter`

**Как вызвать:**
```
@DocWriter Добавь JSDoc типы

Файлы:
- lib/types.js (создать)
- lib/payment.js
- lib/order.js
- lib/batch.js

Используй JSDoc @typedef для Order, Demand, Payment и т.д.
```

**Пример:**
```javascript
// lib/types.js
/**
 * @typedef {Object} Order
 * @property {string} id - ID заказа в МойСклад
 * @property {string} name - Название
 * @property {number} sum - Сумма (в копейках)
 * @property {Demand[]} demands - Отгрузки
 */

/**
 * @typedef {Object} Demand
 * @property {string} id
 * @property {number} sum - Сумма отгрузки
 * @property {number} payedSum - Оплаченная сумма
 */

/**
 * @typedef {Object} Payment
 * @property {string} name - Название платежа
 * @property {number} sum - Сумма
 */
```

---

### 🟡 V3 — Новые фичи (приоритет: СРЕДНИЙ)

> **Важно:** Перед V3 убедись что V2 завершён (тесты проходят, линтеры настроены)

**Автовызов:** Создать `.opencode/context/plans/v3-execution.md` и выполнить ВСЁ, вызывая нужных суб-агентов

#### 3.1 Excel интеграция
- [ ] Выбор файла Excel (frontend)
- [ ] Парсинг xlsx (backend)
- [ ] Маппинг колонок → номера отправлений
- [ ] Импорт в `/api/process`
- [ ] Экспорт результатов в Excel

**Стек:** `xlsx` npm пакет

**Кто делает:** `CoderAgent`

**Как вызвать:**
```
@CoderAgent Добавь Excel интеграцию

Требования:
- Frontend: выбор файла через input type="file"
- Backend: xlsx парсинг, маппинг колонок
- Интеграция с /api/process
- Экспорт результатов в Excel
- Тесты обязательны
```

#### 3.2 Логика с API запросами
- [ ] Схема работы: вход → обработка → выход
- [ ] Retry логика при сбоях
- [ ] Rate limiting (не спамить МС)
- [ ] Очередь операций

**Кто делает:** `CoderAgent` + `CodeReviewer`

#### 3.3 Нейронка для текстов
- [ ] Интеграция API (OpenAI/Claude)
- [ ] Обработка текстов заказов
- [ ] Автозаполнение/корректировка
- [ ] Схема промтов

**Варианты:**
- OpenAI API (проще, платно)
- Yandex GPT (российское)

**Кто делает:** `CoderAgent` (после консультации)

---

### 🟢 V4 — Инфраструктура (приоритет: НИЗКИЙ)

- [ ] CI/CD с тестами
- [ ] Мониторинг (логи, метрики)
- [ ] Swagger документация
- [ ] Интеграция WB полная
- [ ] Интеграция Ozon полная

**Кто делает:** `OpenDevopsSpecialist`

---

## Конфигурация

### package.json

```json
{
  "scripts": {
    "start": "node server.js",
    "test": "jest",
    "test:watch": "jest --watch",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "docs": "node scripts/docs-generator.js",
    "push": "node scripts/auto-push.js"
  }
}
```

### .env (пример)

```
MOYSKLAD_TOKEN=токен_api_мойсклад
PORT=3000
GH_TOKEN=токен_github
# Для нейронки (опционально)
OPENAI_API_KEY=ваш_ключ
```

---

## Как использовать этот план

### Режимы работы

#### Режим 1: Ручной (пошаговый)
```
Ты: Прочитай PLAN.md
Ты: @TestEngineer напиши тесты для payment.js
Ты: @OpenDevopsSpecialist настрой ESLint
...и так по каждому пункту...
```

#### Режим 2: Автовызов (рекомендуется)
```
Ты: Прочитай .opencode/context/plans/v2-execution.md и выполни ВСЁ, вызывая нужных суб-агентов
Агент: Читает чеклист → вызывает TestEngineer для шага 1
Агент: Ждёт результат → вызывает OpenDevopsSpecialist для шага 2
Агент: Ждёт результат → вызывает DocWriter для шага 3
Агент: Финальный review → CodeReviewer для шага 4
Агент: Готов к коммиту
```

### Порядок выполнения
1. **V2 первым** — тесты критичны для защиты от ошибок
2. **ESLint + Prettier** — перед V3 (унификация)
3. **V3 фичи** — после стабилизации V2
4. При закрытии задачи — отмечать `[x]`
5. При изменении структуры — обновить этот файл

---

## Суб-агенты и их задачи

| Суб-агент | Когда использовать | Задачи в плане |
|-----------|--------------|---------------|
| **TestEngineer** | Написание тестов | V2.1 Тесты |
| **OpenDevopsSpecialist** | Конфиги, CI/CD | V2.2 ESLint+Prettier, V4.1 CI/CD |
| **DocWriter** | Документация | V2.3 JSDoc, docs |
| **CoderAgent** | Кодогенерация | V3.1 Excel, V3.3 Нейронка |
| **CodeReviewer** | Проверка кода | Перед коммитом критичных изменений |

### Как вызывать

```javascript
// Простой вызов
task(subagent_type="TestEngineer", description="Тесты для payment.js", prompt="...")

// С контекстом
task(subagent_type="CoderAgent", description="Excel парсинг", prompt="Load context from .tmp/context/bundle.md...")

// Сессия для сложных задач
task(subagent_type="OpenDevopsSpecialist", prompt="...", task_id="existing_session")
```

### Правила

1. **Тесты** — всегда вызывать TestEngineer первым
2. **Рефакторинг payment/demand/return/cancel** — CodeReviewer после
3. **Новые фичи** — CoderAgent с контекстом из PLAN.md
4. **Конфиги CI/CD** — OpenDevopsSpecialist

---

## Автовызов чеклистов

### Файлы чеклистов
```
.opencode/context/plans/
├── v2-execution.md   ← V2: тесты, линтеры, типы
├── v3-execution.md  ← V3: Excel, нейронка (создать позже)
└── v4-execution.md  ← V4: CI/CD, мониторинг (создать позже)
```

### Как запустить V2:
```
Прочитай .opencode/context/plans/v2-execution.md и выполни ВСЁ, вызывая нужных суб-агентов
```

### Как продолжить сессию:
```bash
# Взять task_id из чеклиста
task(task_id="ses_v2_tests")  // продолжить тесты

# Или попросить агента
Продолжи работу над тестами из сессии ses_v2_tests
```

### Статус в чеклисте:
```
✓ или [x] = выполнено
− или [ ] = в ожидании
● или [~] = в процессе
✗       = ошибка
```

---

## Контакты

- **Репозиторий:** https://github.com/RudzisID/simoto-sklad
- **Документация:** docs/API.md, docs/ARCHITECTURE.md
- **Инструкция:** INSTRUCTION.md
- **Дата обновления:** 2026-04-27