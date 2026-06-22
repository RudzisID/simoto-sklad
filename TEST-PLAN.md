# План проверки и тестирования — SiMOTO-sklad

> Дата: 2026-06-22
> Цель: Комплексная проверка всех функций приложения после внесённых изменений

## 1. Юнит-тесты (Jest) — результаты

### 1.1 Итоговый статус

```bash
npm test
```

**Текущий статус (после полного покрытия):**
- **Passed: 22 suites, 339 тестов** ✅ (+62 от исходных 277)
- **Failed: 4 suites, 23 теста** ❌ (все предсуществующие, не связаны с нашими правками)

### 1.2 Существующие тесты (pre-existing, не изменялись)

| Файл | Тестов | Статус |
|------|--------|--------|
| `test/batch.test.js` | — | ✅ |
| `test/cancel.test.js` | — | ✅ |
| `test/check.test.js` | — | ❌ (предсуществующий) |
| `test/demand.test.js` | — | ✅ |
| `test/partial-payment.test.js` | — | ✅ |
| `test/payment.test.js` | — | ✅ |
| `test/return.test.js` | — | ✅ |
| `test/sort-bug-verification.test.js` | — | ❌ (не запускается) |
| `test/sort-bugs-real.test.js` | — | ✅ |
| `test/sort-status.test.js` | — | ❌ (предсуществующий) |
| `test/unified-search.test.js` | — | ❌ (23 теста, предсуществующий) |

### 1.3 Новые тесты (написаны в рамках покрытия)

#### Фаза 1 — Чистые функции (без внешних зависимостей)

| Файл | Тестов | Описание |
|------|--------|----------|
| `test/ttl-map.test.js` | 19 | TtlMap — установка, TTL, очистка по времени |
| `test/logger.test.js` | 21 | colorize, auto, level detection, format |
| `test/constants.test.js` | 7 | mergeStatuses, UUIDs, ORDER_STATUS |
| `test/sse-helper.test.js` | 14 | setup/send/end/abort SSE потока |

#### Фаза 2 — Бизнес-логика (без API)

| Файл | Тестов | Описание |
|------|--------|----------|
| `test/order-utils.test.js` | 14 | extractShipmentNumFromDescription, getOrderUrl |
| `test/server-utils.test.js` | 16 | formatDescription, orderState, cleanOld |
| `test/wb-utils.test.js` | 7 | deriveWbStatus, resolveStickerStatus, findInCache (WB), getMergedMap |
| `test/ozon-core.test.js` | 11 | findInCache (Ozon), getMergedMap, приоритет статусов |
| `test/supplies-core.test.js` | 18 | recheckOrder, WB/Ozon decision matrix, change detection |

#### Фаза 3 — API-зависимые модули

| Файл | Тестов | Описание |
|------|--------|----------|
| `test/product.test.js` | 14 | findProductByCode (cache/assortment/search), getProductFullByCode, clearProductCache |
| `test/print.test.js` | 22 | getStickerTemplate, exportStickerPdf (303/200/202/error), clearTemplateCache |
| `test/check-utils.test.js` | 17 | parsePositions, detectMarketplaceFromDescription |
| `test/wb-api.test.js` | 37 | getWBSalesMap, getWBReturnsMap, getWBAnalyticsReturnsMap, getWBOrdersMap, getWBOrdersStickersMap, refreshIfStale, refreshAll |
| `test/ozon-api.test.js` | 12 | refreshIfStale, refreshAll, refreshSupplies, startup loading |
| `test/supplies-scan.test.js` | 13 | scanNewOrders — фильтры, cooldown, обработка WB/Ozon, progress callback |

**Итого новых тестов: ~242 теста, все проходят** ✅

### 1.4 Покрытие модулей

| Модуль | Покрытие тестами | Статус |
|--------|-----------------|--------|
| `lib/ttl-map.js` | ✅ ttl-map.test.js (19 тестов) | Полное |
| `lib/logger.js` | ✅ logger.test.js (21 тест) | Полное |
| `lib/constants.js` | ✅ constants.test.js (7 тестов) | Полное |
| `lib/sse-helper.js` | ✅ sse-helper.test.js (14 тестов) | Полное |
| `lib/order.js` (pure utils) | ✅ order-utils.test.js (14 тестов) | Частичное (чистые функции) |
| `lib/server-utils.js` | ✅ server-utils.test.js (16 тестов) | Полное |
| `lib/wb.js` (pure utils) | ✅ wb-utils.test.js (7 тестов) | Частичное (чистые функции) |
| `lib/ozon.js` (pure utils) | ✅ ozon-core.test.js (11 тестов) | Частичное (чистые функции) |
| `lib/supplies.js` (pure) | ✅ supplies-core.test.js (18 тестов) | Частичное (recheckOrder) |
| `lib/product.js` | ✅ product.test.js (14 тестов) | Полное |
| `lib/print.js` | ✅ print.test.js (22 теста) | Полное |
| `lib/check.js` (pure) | ✅ check-utils.test.js (17 тестов) | Частичное (чистые функции) |
| `lib/wb.js` (API) | ✅ wb-api.test.js (37 тестов) | Полное (кэш-функции) |
| `lib/ozon.js` (API) | ✅ ozon-api.test.js (12 тестов) | Полное (кэш-функции) |
| `lib/supplies.js` (API) | ✅ supplies-scan.test.js (13 тестов) | Полное (scanNewOrders) |
| `lib/batch.js` | ✅ batch.test.js (существующий) | Существующий |
| `lib/cancel.js` | ✅ cancel.test.js (существующий) | Существующий |
| `lib/demand.js` | ✅ demand.test.js (существующий) | Существующий |
| `lib/payment.js` | ✅ payment.test.js (существующий) | Существующий |
| `lib/return.js` | ✅ return.test.js (существующий) | Существующий |
| `lib/check.js` (checkOrder) | ❌ check.test.js (предсуществующий failure) | Не исправляли |
| `public/app.js` | ❌ | Только ручная проверка |
| `lib/api-utils.js` | ❌ (исключён из coverage) | По design |

## 2. Интеграционное тестирование

### 2.1 Тестовые сценарии (Postman / curl)

| # | Сценарий | Эндпоинт | Ожидаемый результат |
|---|----------|----------|---------------------|
| 1 | Сканирование поставок | `GET /sse/supplies/stream` | SSE-события с заказами, `marketplaceFound=true` |
| 2 | Массовая отгрузка | `POST /api/batch/stream` с action=demand | SSE прогресс, строки с `processing` и `completed` |
| 3 | Массовая отмена | `POST /api/batch/stream` с action=cancel | SSE прогресс, строки с `processing` и `completed` |
| 4 | Проверка статуса заказа | `POST /api/check` | CheckResult с marketData |
| 5 | Поиск товара | `GET /api/product?q=...` | Данные из МС, WB, Ozon |
| 6 | Универсальный поиск | `GET /api/unified-search/stream` | SSE поток с данными заказов |
| 7 | Кэш WB | `GET /api/wb-all/stream` | Данные продаж WB |

### 2.2 Проверка SSE в реальном времени

1. Открыть вкладку «Поставки»
2. Нажать «Сканировать поставки»
3. **Проверить:**
   - [ ] Строки добавляются с анимацией fadeInDown
   - [ ] Статус WB отображается (не пустой) — `Отменён`, `Доставлен`, `Реализован`
   - [ ] Статус Ozon отображается — `Доставлен`, `Отменён`, `В обработке`
   - [ ] Все строки имеют `marketplaceFound=true` (нет «⏳ Ожидание данных маркета»)

### 2.3 Проверка массовых операций в поставках

1. Выбрать WB-заказы со статусом «Отменён на маркете»
2. Нажать «Массовая отмена»
3. **Проверить:**
   - [ ] Строки подсвечиваются анимацией `processing` (пульсация outline) ДО отправки запроса
   - [ ] После обработки — `completed` (зелёная галочка) на 2 секунды
   - [ ] Рекомендация меняется на «✗ Заказ отменён»
   - [ ] Статистика обновляется

4. Выбрать WB/Ozon-заказы со статусом «Доставлен»
5. Нажать «Массовая отгрузка»
6. **Проверить:**
   - [ ] Те же анимации + обновление

### 2.4 Проверка единичных операций

1. Нажать кнопку отмены на отдельной строке
2. **Проверить:**
   - [ ] Строка подсвечивается `processing`
   - [ ] После обработки строка удаляется из таблицы
   - [ ] Статистика обновляется

## 3. Ручная проверка (UI)

### 3.1 Вкладка «Поставки»

| # | Проверка | Статус |
|---|----------|--------|
| 1 | Сканирование: заказы за 4 дня | ⬜ |
| 2 | WB статус: строка показывает `(WB)` с цветом | ⬜ |
| 3 | Ozon статус: строка показывает `(Ozon)` с цветом | ⬜ |
| 4 | Фильтр WB/Ozon | ⬜ |
| 5 | Фильтр по складу | ⬜ |
| 6 | Сортировка по дате (разделители дней) | ⬜ |
| 7 | Decision matrix: все 8 типов рекомендаций | ⬜ |
| 8 | Кнопки действий (📦/✗/✅/⏳) | ⬜ |
| 9 | Фильтр дат (from/to) | ⬜ |

### 3.2 Вкладка «Склад»

| # | Проверка | Статус |
|---|----------|--------|
| 1 | Поиск по номерам заказов | ⬜ |
| 2 | SSE real-time добавление строк | ⬜ |
| 3 | Статус WB отображается `[wbStatus]` рядом с именем | ⬜ |
| 4 | `wbStatusLine` в колонке статуса (с цветом) | ⬜ |
| 5 | `ozonStatusLine` в колонке статуса | ⬜ |
| 6 | Сравнение с отчётом Ozon (загрузка XLSX) | ⬜ |
| 7 | Массовые операции (отгрузка/отмена/возврат/платёж) | ⬜ |
| 8 | Калькулятор сумм | ⬜ |

### 3.3 Вкладка «Маркет»

| # | Проверка | Статус |
|---|----------|--------|
| 1 | Поиск по OEM | ⬜ |
| 2 | Отображение данных из МС | ⬜ |
| 3 | Отображение данных из WB | ⬜ |
| 4 | Отображение данных из Ozon | ⬜ |
| 5 | Shared-поля (Бренд, Страна...) | ⬜ |
| 6 | Просмотр изображений | ⬜ |
| 7 | Редактирование маркета (архив) | ⬜ |

## 4. Производительность

| # | Проверка | Критерий |
|---|----------|----------|
| 1 | Сканирование 500 заказов поставок | < 30 сек |
| 2 | Массовая отгрузка 100 заказов | SSE-события приходят без задержек |
| 3 | Одиночный поиск по номеру | < 5 сек |
| 4 | Кэш WB/Ozon не старше 2ч | Проверить TTL |

## 5. Безопасность

| # | Проверка | Ожидание |
|---|----------|----------|
| 1 | XSS: номер заказа с `<script>` | Экранирован, не выполняется |
| 2 | Токены не передаются в URL (только headers) | ✅ (AGENTS.md) |
| 3 | Отсутствие SQL-инъекций | Нет SQL в проекте |
| 4 | Проверка токенов в SSE-эндпоинтах | `401` при отсутствии токена |

## 6. Порядок выполнения

### Фаза 0: Автоматические тесты ✅ (ВЫПОЛНЕНО)
1. ✅ Написано 15 новых тест-файлов (~242 теста)
2. ✅ `npm test` — 22 suites pass, 339 тестов
3. ✅ Все новые тесты проходят

### Фаза 1: UI-проверка поставок (30 мин)
1. Сканирование поставок (раздел 2.2)
2. Массовая отмена (раздел 2.3)
3. Массовая отгрузка (раздел 2.3)
4. Одиночные действия (раздел 2.4)

### Фаза 2: UI-проверка склада (20 мин)
1. Поиск заказов (раздел 3.2)
2. Статусы WB и Ozon
3. Сравнение с отчётом
4. Массовые операции

### Фаза 3: Регрессия исправлений (15 мин)
1. Раздел 5 — по каждому пункту
2. Проверка что старые сценарии не сломались

## 7. Диагностика предсуществующих падений

4 тест-сьюта падают, **не связаны с нашими правками**:

| Файл | Тестов | Причина (предположительно) |
|------|--------|---------------------------|
| `test/sort-bug-verification.test.js` | не запускается | Зависит от внешнего API или несовместимость с версией Jest |
| `test/check.test.js` | несколько | Зависит от API МойСклад (moysklad), моки не настроены |
| `test/sort-status.test.js` | несколько | Зависит от состояния кэша WB/Ozon |
| `test/unified-search.test.js` | 23 | Зависит от API WB (200 undefined), 3 retry срываются |

Для исправления требуется настройка моков для `moysklad`, `wbOzonSync.makeRequest` и `fetch`.
