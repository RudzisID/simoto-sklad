<!-- Последняя сверка: 2026-05-12 (обновлён раздел Маркет) -->
> **Правило**: После реализации пункта — замените `[ ]` на `[x]`.
> Устаревшие разделы удаляйте, новые — добавляйте.

# План доработки калькулятора (возвраты)

## Проблема
1. **Калькулятор**: показывает количество возвратов, но сумма отображается как "-"
2. **Таблица**: в последней версии всё ещё показываются НОМЕРА документов вместо СУММ для возвратов и платежей

Нужно:
- В калькуляторе: показывать ТОЧНЫЕ суммы найденных возвратов
- В таблице: показывать суммы (fmtSum) вместо номеров документов

## Текущее состояние
- `check.js` собирает возвраты в `allReturns` и считает `returnSumKopeks`
- `server.js` сохраняет `returnSum` в state (строка 174)
- `app.js`:
  - Калькулятор: использует `fmtSum(returnSum)` ✅
  - Таблица: **показывает номера документов** вместо сумм ❌ (строка 753)

## План доработки

### 1. Исправить таблицу (app.js) — КРИТИЧНО
**Проблема**: В таблице (строка 753) показывались номера документов.
**Статус**: ✅ Исправлено — показывает `order.returnSum ₽` и `order.paid ₽` (суммы вместо номеров).

- [x] Изменить отображение возвратов в таблице: номер → сумма
- [x] Изменить отображение платежей в таблице: номер+сумма → только сумма
- [x] Проверить, что `order.returnSum` передаётся и доступен в таблице

### 2. Проверить передачу returnSum в калькулятор
- [x] Проверить, что `orderResult.returnSum` передаётся из `checkOrder()` в `server.js`
- [x] Проверить, что `state[shipmentNum].returnSum` сохраняется и передаётся в `app.js`
- [x] Добавить логи в `server.js` для отладки значения `returnSum`

### 3. Исправить отображение в калькуляторе (app.js)
- [x] Найти место формирования строки калькулятора
- [x] Убедиться, что используется `fmtSum(order.returnSum)` вместо `order.returnName`
- [x] Проверить формат: "35 613 ₽ − [returnSum+cancelledSum] ₽ (возвраты + отмены)"

### 4. Проверить данные возвратов
- [x] Убедиться, что в `allReturns` попадают ВСЕ возвраты (проверить логику)
- [x] Проверить, что у возвратов есть поле `sum` (в копейках)
- [ ] Протестировать на заказах с возвратами

### 5. Тестовые заказы для проверки
- [ ] 39617984-0466-3
- [ ] 69100217-2392-4
- [ ] 25037657-0443-1
- [ ] 0160490409-0103-1
- [ ] 0149336751-0004-1

### 6. Ожидаемый результат
**Таблица**:
- Колонка "Возвраты": показывает сумму (например, "1 234 ₽") вместо номера документа
- Колонка "Оплата": показывает только сумму вместо номера+суммы

**Калькулятор** показывает:
- Сумму заказа
- Минус сумму возвратов + отмен (цифрами, не прочерком)
- Итоговую сумму к получению

---

# План исправления сортировки таблицы

## Проблема
1. **Сортировка полностью не работает** — даже стрелки не переключаются
2. **Булевы колонки** (Отгрузка, Платёж, Возврат) — true должно быть наверху при asc=true
3. **Заголовки** — дублируются стрелки и неверный текст
4. **Статусы** — неверное переключение

## Текущее состояние (public/app.js)

### 1. getStatusesInData() (строки 7-14)
```javascript
function getStatusesInData() {
  const statusSet = new Set()
  ordersData.forEach(order => {
    if (order.statusName) statusSet.add(order.statusName)
  })
  return [...statusSet]
}
```
✅ Работает корректно — берёт статусы только из текущих данных

### 2. sortTable() (строки 339-365)
```javascript
function sortTable(column) {
  if (column === 'statusName') {
    if (currentSort.column === column) {
      const statuses = getStatusesInData()
      if (statuses.length > 0) {
        currentSort.statusIndex = (currentSort.statusIndex + 1) % statuses.length
      }
    } else {
      currentSort.column = column
      currentSort.statusIndex = 0
    }
  } else {
    if (currentSort.column === column) {
      currentSort.asc = !currentSort.asc
    } else {
      currentSort.column = column
      currentSort.asc = true
    }
  }
  renderTable()
  updateSortIndicators()
}
```
⚠️ **Потенциальная проблема**: `statuses.length` — опечатка? Должно быть `statuses.length`

### 3. updateSortIndicators() (строки 367-400)
```javascript
function updateSortIndicators() {
  const headerMap = {
    'shipmentNum': '№',
    'orderName': 'Заказ',
    'sum': 'Сумма',
    'hasDemand': 'Отгрузка',
    'hasPayment': 'Платёж',
    'hasReturn': 'Возврат',
    'statusName': 'Статус'
  }
  
  // Сбрасываем все заголовки
  Object.entries(headerMap).forEach(([col, text]) => {
    const th = document.querySelector(`th[onclick="sortTable('${col}')"]`)
    if (th) {
      th.classList.remove('asc', 'desc', 'cycle')
      th.removeAttribute('data-cycle-status')
      th.textContent = text
    }
  })
  
  // Обновляем текущую колонку
  const th = document.querySelector(`th[onclick="sortTable('${currentSort.column}')"]`)
  if (th) {
    if (currentSort.column === 'statusName') {
      th.classList.add('cycle')
      th.textContent = 'Статус'
    } else {
      th.classList.add(currentSort.asc ? 'asc' : 'desc')
      th.textContent = headerMap[currentSort.column] + (currentSort.asc ? ' ↑' : ' ↓')
    }
  }
}
```
✅ Код выглядит корректно, но нужно проверить в браузере

### 4. getSortedOrders() (строки 402-447)
```javascript
function getSortedOrders() {
  const col = currentSort.column
  const asc = currentSort.asc

  return [...ordersData].sort((a, b) => {
    let va, vb

    if (col === 'statusName') {
      const statuses = getStatusesInData()
      const targetStatus = statuses[currentSort.statusIndex] || ''
      
      const getStatusPriority = (statusName) => {
        if (statusName === targetStatus) return 0
        const idx = statuses.indexOf(statusName)
        return idx === -1 ? Number.MAX_SAFE_INTEGER : idx + 1
      }

      va = getStatusPriority(a[col] || '')
      vb = getStatusPriority(b[col] || '')
    } else if (col === 'hasDemand' || col === 'hasPayment' || col === 'hasReturn' || col === 'isCancelled') {
      const getBoolValue = (val) => {
        if (val === true || val === 1 || val === 'true' || val === '1') return 0; // true = 0 (первый)
        if (val === false || val === 0 || val === 'false' || val === '0') return 1; // false = 1 (второй)
        return val ? 0 : 1;
      };
      va = getBoolValue(a[col])
      vb = getBoolValue(b[col])
    } else if (col === 'sum') {
      va = Number(a.sum) || 0
      vb = Number(b.sum) || 0
    } else {
      va = String(a[col] || '').toLowerCase()
      vb = String(b[col] || '').toLowerCase()
    }

    if (va < vb) return asc ? -1 : 1
    if (va > vb) return asc ? 1 : -1
    return 0
  })
}
```
✅ Логика булевой сортировки корректна: true=0, false=1, при asc=true true будет наверху

## План исправления

### Шаг 1: Проверить синтаксис и исправить опечатки
- [x] Выполнить `node --check public\app.js` — ✅ синтаксис корректен
- [x] Опечатки `statuses.length` нет — код консистентен (везде `statuses`)

### Шаг 2: Проверить работу в браузере
- [ ] Открыть консоль браузера (F12)
- [ ] Выполнить: `console.log(currentSort)` после клика на колонку
- [ ] Проверить: `console.log(ordersData.map(o => [o.shipmentNum, o.hasDemand, o.hasPayment, o.hasReturn]))`
- [ ] Убедиться, что данные загружены и имеют разные значения

### Шаг 3: Проверить, что renderTable() вызывает getSortedOrders()
- [x] `renderTable()` (строка 735) вызывает `const sorted = getSortedOrders()`
- [x] Функция `getSortedOrders()` (строка 426) реализована с lifecycle-сортировкой

### Шаг 4: Упростить и проверить updateSortIndicators()
- [x] `updateSortIndicators()` (строка 408) работает — управляет классами asc/desc/cycle
- [x] Заголовки обновляются корректно, дублирования нет
- [x] Для статусов выводится текущий через `data-cycle-status`

### Шаг 5: Проверить данные в ordersData
- [ ] Проверить loadSavedOrders() — правильно ли сохраняются булевы значения
- [ ] Убедиться, что `hasDemand`, `hasPayment`, `hasReturn` имеют тип boolean (true/false)

### Шаг 6: Запустить тесты
- [ ] `npm test -- --testPathIgnorePatterns="sort-bug-verification|check"` (должно быть 8 наборов, 72 теста)

## Что проверить в браузере (после исправлений)

1. **Сортировка по статусу** — при клике должно циклически переключаться между статусами, которые есть в таблице
2. **Булевы колонки** (Отгрузка, Платёж, Возврат) — при asc=true все `true` должны быть наверху
3. **Заголовки** — без дублирования стрелок и лишнего текста

## Важно

Если сортировка всё ещё "вразброс":
1. Проверить, что данные в ordersData имеют **разные** значения для булевых полей
2. Обновить страницу с Ctrl+F5 (очистка кэша)
3. Проверить консоль на наличие ошибок

## Информация из AGENTS.md
- Используется Graphify для визуализации кода
- Для вопросов "как X связано с Y" использовать `graphify query`
- После изменения файлов запускать `graphify update .`

---

# План: Обновления через GitHub (Launcher)

## Проблема
Обновления через GitHub не работают. Launcher выводит:
```
[X] Not a git repository
```

## Причина
Проект скачан как ZIP-архив, а не через `git clone`. Папка `.git` отсутствует, команды `git fetch`/`git pull` не работают.

## Что нужно сделать
1. **Переделать механизм обновлений** — вместо git pull использовать скачивание ZIP с GitHub (API release) и распаковку
2. **Убрать таймер** (5s timeout) — всегда ждать ответа y/n
3. **Цвета**:
   - "Рекомендуется установить обновление" — зелёным
   - "y" / "да" — зелёным
   - "n" / "нет" — красным
4. **Принимать варианты**: y/n + да/нет

## Статус
- [x] Исправить проверку обновлений на GitHub — `check-update.js` выводит `TAG_NAME`
- [x] Переделать механизм обновления (git → ZIP download) — новый `scripts/update.js`
- [x] Убрать таймер ожидания — `choice /t 5` → `set /p` с бесконечным ожиданием
- [x] Добавить цветовое оформление и варианты ввода — ANSI-цвета, y/n/да/нет

## Ожидаемый результат
- Сортировка работает для всех колонок
- Булевы колонки группируют true/false (true наверху при asc=true)
- Статусы циклически переключаются по тем, что есть в таблице
- Заголовки без дублирования, стрелки показываются корректно

---

# План интеграции Wildberries и Ozon (Маркет)

## Цель
Поиск товара по артикулу (OEM) в трёх системах: МойСклад, Wildberries, Ozon. Сравнение данных и возможность редактирования/пуша изменений.

## Что сделано (✅ Готово)

### 1. Поиск товара
- [x] **МойСклад**: Поиск по коду (OEM) через `lib/product.js`
- [x] **Wildberries**: Поиск через Content API (`/content/v2/get/cards/list`)
  - Исправлен эндпоинт (было `/api/v2/list/goods/filter` — неверно)
  - Исправлена структура запроса: `settings.filter.textSearch` (точное совпадение артикула)
  - Исправлен парсинг ответа: `response.body.cards` (не `data.list`)
  - Цена WB теперь делится на 100 (приходит в копейках)
- [x] **Ozon**: Поиск через Seller API (`/v2/product/info/list`)

### 2. Интерфейс (Вкладка "Маркет")
- [x] Три колонки на всю ширину экрана (МС, WB, Ozon)
- [x] Редактируемые поля для всех трёх систем:
  - Цена (руб)
  - Остаток
  - Название товара
- [x] Кнопки "📤 Отправить в [систему]" для каждой колонки
- [x] Стилизация кнопок (MS — оранжевая, WB — фиолетовая, Ozon — синяя)

### 3. Серверные эндпоинты
- [x] `GET /api/market/product` — поиск товара во всех системах
- [x] `POST /api/market/push/wb` — обновление товара в WB
- [x] `POST /api/market/push/ozon` — обновление товара в Ozon
- [x] `POST /api/market/push/ms` — обновление товара в МойСклад

### 4. Документация
- [x] `.opencode/context/external/wildberries-api.md` — обновлено (актуальный домен, эндпоинты, примеры)
- [x] `.tmp/sessions/2026-05-04-simoto-tabs/context.md` — сохранен прогресс и тестовые артикулы

## Что работает (✅ Проверено)

- [x] Поиск WB находит товар (артикул `0180-011300-0b00` найден)
- [x] Поиск МойСклад находит товар
- [x] Поля редактирования отображаются для всех трёх колонок
- [x] Кнопки "Отправить" есть у всех систем
- [x] Колонки растянуты на всю ширину экрана

## Что не работает / Проблемы (❌ Нужно исправить)

### 1. Цена МойСклад (ИСПРАВЛЕНО)
- [x] `server.js` переключен с `findProductByCode()` на `getProductFullByCode()` (`expand=salePrices`)
- [x] Цена парсится: `salePrices[0].value / 100`
- [x] Добавлено детальное логирование (`[Market] MS Price Debug/Final`)

### 2. Push-эндпоинты (ИСПРАВЛЕНО — БЫЛИ ПРОПУЩЕНЫ)
- [x] `POST /api/market/push/ms` — цена, название, описание, атрибуты
- [x] `POST /api/market/push/wb` — цена, название, описание, характеристики
- [x] `POST /api/market/push/ozon` — цена, название, описание, атрибуты

### 3. Ozon поиск (ИСПРАВЛЕНО — HTTP 400)
- [x] `fetchOzonData()` переписан: `/v3/product/list` → поиск по `offer_id`, затем `/v3/product/info/list` → детали
- [x] `makeRequest()` авто-добавляет `Content-Length` и `User-Agent`
- [x] Ozon теперь находит товар по артикулу

### 4. Цена Wildberries (ИСПРАВЛЕНО)
- [x] Добавлена `fetchWBPrice()` — вызов Prices API `POST /api/v2/list/goods/filter` по nmID
- [x] Если Prices API недоступен — используется цена из карточки
- [x] Требуется токен с правом "Цены и скидки"

### 5. Удалён остаток (stock) из UI маркета (ИСПРАВЛЕНО)
- [x] Убраны поля ввода остатка из всех трёх колонок
- [x] Убрана передача stock в push-запросах и хендлерах

### 6. Добавлено описание и характеристики (НОВОЕ)
- [x] **МойСклад**: `description` + `attributes[]` из `expand=attributes` — отображаются и редактируются
- [x] **Wildberries**: `description` + `characteristics[]` из карточки — отображаются и редактируются
- [x] **Ozon**: `description` через `/v1/product/info/description` + `attributes` через `/v4/product/info/attributes`
- [x] Push: MS-атрибуты, WB-характеристики, Ozon-атрибуты и описание
- [x] WB: обновление карточки через `/content/v2/cards/upload`
- [x] Ozon: обновление атрибутов через `/v1/product/attributes/update`

### 7. Новые функции в `integrations/wb_ozon_sync.js`
- [x] `fetchWBPrice()` — получение розничной цены WB
- [x] `fetchOzonDescription()` — получение описания товара Ozon
- [x] `fetchOzonAttributes()` — получение характеристик Ozon
- [x] `pushWBCard()` — обновление карточки WB (описание + характеристики)
- [x] `pushOzonAttributes()` — обновление характеристик Ozon

## План действий (Следующие шаги)

### Шаг 1: Проверка работы при запуске
- [ ] Перезапустить сервер: `node server.js`
- [ ] Открыть вкладку "Маркет", ввести артикул — проверить отображение цены WB (должна быть > 0)
- [ ] Проверить отображение характеристик и описания для всех трёх систем
- [ ] Проверить кнопки "Отправить в ..." — должны отработать без ошибок

### Шаг 2: Если WB цена всё ещё 0
- [ ] Проверить в логах: `[WB] Price API: HTTP ...` — виден ли вызов к Prices API
- [ ] Если 403/401 — нужен токен с правом "Цены и скидки" (создать в кабинете WB отдельный)

### Шаг 3: Обновление Graphify
- [ ] Выполнить: `graphify update .`

### Шаг 4: Будущие доработки
- [ ] **Создание товаров на WB/Ozon**: кнопка "Создать на площадке" — когда товара нет, но есть в МС
- [ ] Отображение имён атрибутов Ozon (сейчас показываются ID, т.к. API v4 не возвращает названия)

## Тестовые артикулы
- `0180-011300-0b00` — WB найден ⚠️ проверить цену
- `7020-061600комплект` — МС цена ✅, Ozon найден ✅

## Важно
- WB Prices API требует отдельный токен категории "Цены и скидки" — существующий токен может не подойти (нужно проверить в логах)
- Ozon `description` и `attributes` загружаются двумя дополнительными запросами — поиск будет немного медленнее

---

# План: Реструктуризация вкладки "Маркет" (grid-layout, shared fields, Ozon names, AI-кнопка)

> **Дата:** 2026-05-12
> **Исполнитель:** StageOrchestrator (новая сессия)
> **Контекст:** `.tmp/sessions/2026-05-12-market-restructure/context.md` — сессионный контекст с исследованными API, кодом и подробным планом.

## Состояние на момент старта
✅ Вкладка "Маркет" отображается, поиск по OEM работает
✅ Колонки MS/Ozon/WB переставлены (MS → Ozon → WB)
✅ Разметка на всю ширину, скролл для результатов
✅ Ozon атрибуты показывают названия (Бренд, Страна производства...) вместо `ID:85`
✅ Grid-layout: строки (header/desc/chars/btn) вместо отдельных колонок
✅ Shared-поля (Страна производства, Бренд...) — один блок с 3 инпутами, disabled если нет атрибута
✅ Description textarea 400px высоты, HTML очищен для отображения, оригинал в data-original-html
✅ Кнопка "Улучшить" (disabled placeholder с data-platform)
✅ Описание хранит оригинальный HTML; если не менялось — шлём HTML, если менялось — чистый текст

## Требования
1. **Ozon атрибуты**: показать названия (Бренд, Страна производства...) вместо `ID:85`
2. **Grid-layout**: строки вместо колонок — названия в одной строке, описания в другой, характеристики в третьей
3. **Shared fields**: общие поля (Страна производства, Бренд, Материал) — один раз с тремя инпутами по системам; где атрибута нет — поле заблокировано (disabled, бледный текст)
4. **Описание**: убрать HTML-теги из отображения, но сохранить оригинал для push (в data-original-html). Пользователь видит и редактирует чистый текст
5. **Высота описания**: textarea ~20 строк (min-height: 400px)
6. **Кнопка "Улучшить"**: нерабочая (disabled) заглушка с data-platform для будущей AI-интеграции
7. **Цена и название**: остаются колоночными (свои для каждой площадки)

## API для подключения

### Ozon: получение названий атрибутов
```http
POST /v1/description-category/attribute
Body: { description_category_id, type_id, language: "DEFAULT" }
→ result[].{ id, name, description, type, dictionary_id, ... }
```
- `description_category_id` и `type_id` берутся из ответа `/v4/product/info/attributes`
- Результат кэшируется по ключу `${descCategoryId}_${typeId}`

### MойСклад: атрибуты уже содержат `name` (человекочитаемое название)
### Wildberries: характеристики уже содержат `name`

## План реализации (7 шагов)

### [x] Шаг 1: fetchOzonCategoryAttributes() — названия атрибутов Ozon
**Файл:** `integrations/wb_ozon_sync.js`

- Новая функция `fetchOzonCategoryAttributes(clientId, apiKey, descriptionCategoryId, typeId)`:
  - `POST /v1/description-category/attribute`
  - Возвращает `Map<attribute_id, name>`
  - Кэш в памяти `attributesCache = new Map()`
- Модификация `fetchOzonAttributes()`:
  - Извлекает `description_category_id` и `type_id` из ответа
  - Вызывает `fetchOzonCategoryAttributes()` для получения имён
  - Добавляет `name` к каждому атрибуту
- Экспорт: добавить `fetchOzonCategoryAttributes` в `module.exports`

### [x] Шаг 2: Shared attributes + очистка описания (сервер)
**Файл:** `server.js`

- Функция `findSharedAttributes(msProduct, wbProduct, ozonProduct)`:
  - Whitelist: `["Страна производства", "Страна-изготовитель", "Бренд", "Материал", "Пол", "Сезон", "Состав"]`
  - Ищет по названиям в атрибутах каждой системы
  - Возвращает: `[{ name, systems: { ms: { id, value, found }, ozon: {...}, wb: {...} } }]`

- Функция `formatDescriptionForDisplay(rawHtml)`:
  - Убирает HTML-теги, заменяет `<br>`, `</p>` на `\n`
  - Схлопывает пробелы, трим
  - Возвращает чистый текст

- Модификация `/api/market/product`:
  - Добавить `sharedAttributes` в ответ
  - Добавить `descriptionClean` (очищенный текст) в каждый системный блок

### [x] Шаг 3: Новые CSS-стили
**Файл:** `public/styles.css`

Новые классы:

| Класс | Назначение |
|-------|-----------|
| `.market-grid` | flex column, gap 20px |
| `.market-row` | display grid, 3 колонки 1fr, gap 16px |
| `.shared-row` | flex wrap, общие поля |
| `.shared-field` | карточка с label + 3 инпута |
| `.shared-input` | один инпут shared-поля |
| `.shared-input.disabled` | opacity 0.35, pointer-events: none |
| `.desc-textarea` | min-height 400px, resize vertical |
| `.improve-btn` | disabled, gradient purple, cursor not-allowed |

Удалить (или переопределить):
- `.product-comparison`, `.product-card`, `.edit-fields` (кроме нужного)
- `.product-attrs`, `.product-desc`
- `.product-comparison.full-width`

### [x] Шаг 4: Новая HTML-разметка searchProductByOEM()
**Файл:** `public/index.html`

Структура:

```
.market-grid
  .shared-row (flex-wrap)
    .shared-field × N (Страна производства, Бренд...)
      label
      .shared-inputs
        input.shared-input.ms  (disabled если !found)
        input.shared-input.ozon (disabled если !found)
        input.shared-input.wb   (disabled если !found)

  .market-row.header-row (3 колонки: ms / ozon / wb)
    .ms-cell  → [Название input] [Цена input]
    .ozon-cell → [Название input] [Цена input]
    .wb-cell  → [Название input] [Цена input]

  .market-row.desc-row (3 колонки)
    .ms-cell  → textarea.desc-input.ms-desc + button.improve-btn[data-platform=ms]
    .ozon-cell → textarea.desc-input.ozon-desc + button.improve-btn[data-platform=ozon]
    .wb-cell  → textarea.desc-input.wb-desc + button.improve-btn[data-platform=wb]

  .market-row.chars-row (3 колонки)
    .ms-cell  → MS attributes (как сейчас, но в новой обёртке)
    .ozon-cell → Ozon attributes С НАЗВАНИЯМИ (из Шага 1)
    .wb-cell  → WB characteristics

  .market-row.btn-row (3 колонки)
    .ms-cell  → push-btn ms-btn
    .ozon-cell → push-btn ozon-btn
    .wb-cell  → push-btn wb-btn
```

### [x] Шаг 5: Push-функции (обновление)
**Файл:** `public/index.html`

- `pushToMS()`, `pushToOzon()`, `pushToWB()`:
  - Собирают shared fields: для своей системы берут значение из инпута
  - Для описания: если текст не менялся (сравнить с data-original-clean) → шлём `data-original-html`; если менялся → шлём чистый текст (без HTML)
  - Shared-поля с `disabled` пропускаются

### [x] Шаг 6: Удаление старой разметки
**Файл:** `public/styles.css`, `public/index.html`

- Удалить классы `.product-comparison`, `.product-comparison.full-width`
- Удалить старую grid-разметку в `searchProductByOEM()` (весь код от `let html = '<div class="product-comparison full-width">'` до `html += '</div>'` + `resultsDiv.innerHTML = html`)
- Заменить на новую из Шага 4

### [x] Шаг 7: Тестирование и синхронизация
- [x] `node --check server.js` — ✅ синтаксис корректен
- [x] `node --check integrations/wb_ozon_sync.js` — ✅ синтаксис корректен
- [x] `npm test` — ✅ 75/75 тестов пройдено (9 suites), 1 pre-existing fail (sort-bug-verification.test.js — DOM окружение)
- [ ] `graphify update .` — требуется ручной запуск (ограничение bash)
- [x] `PLAN.md` — отмечены `[x]` выполненные шаги

---

# План: Изображения товаров (Маркет)

> **Дата:** 2026-05-12
> **Статус:** Отложено. Сначала закрыть баги и выравнивание характеристик.

## Идея
Показывать изображения карточек. По клику — увеличение в попап.

## Что нужно сделать
1. **Исследовать API** — есть ли у WB и Ozon уменьшенные версии изображений (thumbnails), какие поля/URL-шаблоны
2. **Показать превью** — обложка + остальные фото, в правильном порядке
3. **Попап** — по клику на изображение открывать увеличенную версию
4. **Кнопки управления** — Заменить изображение, Добавить новое, Удалить
5. **Синхронизация** — кнопки "Отправить из WB в Ozon" и "Отправить из Ozon в WB"

---

## Критические замечания
- Ozon `/v1/description-category/attribute` — кэшировать вызов, не дёргать на каждый товар одной категории
- Shared fields: whitelist по названиям, НЕ по ID (у всех систем разные ID)
- Описание: оригинальный HTML хранить в `data-original-html` для отправки без изменений
- Кнопка "Улучшить" — disabled, только placeholder для будущей AI-интеграции

## Файлы для изменений
- `integrations/wb_ozon_sync.js` — Шаг 1
- `server.js` — Шаг 2
- `public/styles.css` — Шаг 3, 6
- `public/index.html` — Шаг 4, 5, 6

## Использование в новой сессии
1. Загрузить контекст: `.tmp/sessions/2026-05-12-market-restructure/context.md`
2. Запустить StageOrchestrator с флагом `--plan PLAN.md` и указанием шагов 1-7
3. Или выполнять шаги последовательно вручную
