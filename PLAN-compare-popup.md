# План: Попап сравнения с отчётом Ozon + ре-компаризон после массовых действий

> Дата: 2026-06-18
> Оркестратор: StageOrchestrator (3 стадии, последовательно)
> Стадии: Stage 1 (Базовая сборка) → Stage 2 (XLSX) → Stage 3 (Re-compare)

---

## Stage 1 — Попап и кнопка «Посмотреть сравнение»

### 1.1 HTML: кнопка «Посмотреть сравнение» + модал сравнения

**Файл:** `public/index.html`

- Добавить кнопку `#btnViewComparison` с классом `btn btn-ozon btn-small` справа от кнопки «Сравнить» (line ~94)
- Стиль `display:none` — показывать только после выполнения сравнения
- Добавить модал:
  ```html
  <div id="comparisonModal" class="modal-overlay hidden">
    <div class="modal-dialog comparison-modal-dialog">
      <div class="modal-header">
        <h3>📊 Сравнение с отчётом Ozon</h3>
      </div>
      <div class="modal-body comparison-modal-body">
        <div id="comparisonModalContent"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-cancel" onclick="closeComparisonModal()">Закрыть</button>
        <button class="btn btn-accent" onclick="downloadComparisonReport()">📥 Скачать XLSX</button>
      </div>
    </div>
  </div>
  ```
- Overlay: `<div id="comparisonModalOverlay" class="modal-overlay hidden"></div>`
- Показывать модал по клику на `#btnViewComparison`
- Закрывать по overlay click / кнопке «Закрыть»

### 1.2 CSS: стили попапа

**Файл:** `public/styles.css`

- `.comparison-modal-dialog` — `max-width: 90vw; max-height: 90vh; width: 1100px`
- `.comparison-modal-body` — `max-height: 75vh; overflow-y: auto; padding: 16px`
- Все существующие стили `.comparison-summary-grid, .comparison-narrative, .comparison-detail, .row-ok/diff/missing` — сохранить
- Добавить иконки к статусам:
  - `.comparison-status-ok` → ✅ (зелёный)
  - `.comparison-status-partial` → ⚠️ (жёлтый)
  - `.comparison-status-return` → 🔄 (синий)
  - `.comparison-status-missing` → ❌ (красный)
  - `.comparison-status-mismatch` → ❓ (оранжевый)
- Цветовые блоки (как в narrative, но с фоном):
  - `.cmp-block-total` — фон `rgba(59,130,246,0.1)` для итоговых сумм
  - `.cmp-block-ok` — фон `rgba(34,197,94,0.1)` для ok-блоков
  - `.cmp-block-diff` — фон `rgba(234,179,8,0.1)` для расхождений
  - `.cmp-block-error` — фон `rgba(239,68,68,0.1)` для ошибок

### 1.3 JavaScript: переключение рендера

**Файл:** `public/app.js`

**Изменения в `renderComparisonPanel()`:**
- `renderComparisonPanel()` теперь рендерит ТОЛЬКО в модал (`#comparisonModalContent`)
- После рендера:
  - Показать `#btnViewComparison`
  - Скрыть старый инлайн `#comparisonPanel` (можно удалить из HTML позже)
  - **Не показывать модал автоматически** — ждать клика по кнопке

**Новые функции:**
- `openComparisonModal()` — получить `#comparisonModalContent`, если пусто — показать `renderComparisonPanel()` в него; открыть модал
- `closeComparisonModal()` — закрыть модал
- Привязать `onclick="openComparisonModal()"` к `#btnViewComparison`
- Overlay close: стандартный обработчик (как у других модалов)

**Формат содержимого модала** (улучшенный narrative с цветом):

```
┌─────────────────────────────────────┐
│  📊 Сравнение с отчётом Ozon        │
├─────────────────────────────────────┤
│                                     │
│  ┌─── Итоговые суммы ───────────┐   │
│  │  Total D (МойСклад): 1 644 657│   │
│  │  Total J+ (отчёт):  1 630 294│   │
│  │  Разница:             14 363 ⚠️│   │
│  └──────────────────────────────┘   │
│                                     │
│  ✅ Совпало: 512                    │
│  ⚠️ Расхождений: 3                  │
│  ❌ Не найдено в отчёте: 1          │
│  🔄 Полных возвратов: 13           │
│                                     │
│  ─── Анализ расхождений ───         │
│  1 644 657 = Total D               │
│  1 630 294 = Total J+              │
│                                     │
│  Разница 14 363 складывается из:    │
│  • 9 370 — 3 частичных возврата    │
│  • 5 507 — 495 чужих заказов      │
│  (подробнее см. таблицу ниже)       │
│                                     │
│  ┌── Таблица частичных возвратов ─┐ │
│  │ Заказ     D    F     G    J+   │ │
│  │ ...                            │ │
│  └────────────────────────────────┘ │
│                                     │
│  [Показать детали ▽]               │
│  ┌── Детальная таблица ──────────┐  │
│  │ ...                           │  │
│  └───────────────────────────────┘  │
│                                     │
├─────────────────────────────────────┤
│  [Закрыть]    [📥 Скачать XLSX]    │
└─────────────────────────────────────┘
```

### 1.4 Перенос существующего кода

- Вся `renderComparisonPanel()` логика рендера СВОДКИ, NARRATIVE, ДЕТАЛЬНОЙ ТАБЛИЦЫ полностью переносится в модал
- Старый `#comparisonPanel` с инлайн-выводом удалить или скрыть
- Сохранить `window._lastComparisonResult` для повторного открытия

---

## Stage 2 — Форматированный XLSX с объяснением

### 2.1 Обновление `downloadComparisonReport()`

**Файл:** `public/app.js`

**Текущий:** колонки A–H (заказ, D, F, G, J+, разница, статус, примечание)
**Новый:** колонки A–K (данные + форматирование), колонка L+ (объяснение)

**Структура XLSX (лист «Сравнение»):**

| A | B | C | D | E | F | G | H | I | J | K | L | M | N | O | P | ... |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Заказ | D | F | G | J+ | Разница | Статус | Примечание | | | | **=== ИТОГИ ===** | | | | | |
| ... | | | | | | | | | | | Total D: 1 644 657 | | | | | |
| | | | | | | | | | | | Total J+: 1 630 294 | | | | | |
| | | | | | | | | | | | Разница: 14 363 | | | | | |
| | | | | | | | | | | | | | | | | |
| | | | | | | | | | | | **=== АНАЛИЗ ===** | | | | | |
| | | | | | | | | | | | Совпало: 512 ✅ | | | | | |
| | | | | | | | | | | | Расхождений: 3 ⚠️ | | | | | |
| | | | | | | | | | | | Не найдено: 1 ❌ | | | | | |
| | | | | | | | | | | | Полных возвратов: 13 🔄 | | | | | |
| | | | | | | | | | | | | | | | | |
| | | | | | | | | | | | **=== ЧАСТИЧНЫЕ ВОЗВРАТЫ ===** | | | | | |
| | | | | | | | | | | | Заказ | D | F | G | J+ | Разрыв |
| | | | | | | | | | | | ... | | | | | |
| | | | | | | | | | | | Итого | | | | | |

**Форматирование (через XLSX utils):**
- Заголовки A1:K1: жирный, серый фон
- Строки с расхождениями (status=partial/mismatch): жёлтая заливка строки A–K
- Строки missing-in-report: красная заливка A–K
- Блок итогов L+: жирный, голубой фон
- Блок анализа L+: цветовые маркеры
- Числа: формат `#,##0.00` с разделителями

**Реализация:**
```javascript
// Пример создания стилизованного XLSX через XLSX.utils
// В xlsx можно использовать cell.s, но для стилей нужен xlsx-style или
// SheetJS Pro. Для базового форматирования используем:
// 1. ws['!cols'] — ширина колонок
// 2. ws['!rows'] — высота строк
// 3. s (style) через xlsx-style если доступен, или через стандартный XLSX:
//    ws[X].s = { fill: { fgColor: { rgb: "FFFF00" } }, font: { bold: true } }
```

**Альтернатива:** если XLSX full.min.js не поддерживает стили — использовать HTML-таблицу с inline-стилями и конвертировать через `XLSX.utils.html_to_sheet()` или отдельную генерацию через ExcelJS. Но лучше через стандартный XLSX:

```javascript
// Проверяем, поддерживает ли библиотека стили
const hasStyles = typeof XLSX.utils.cell_add_style === 'function'
// Если нет — выводим как plain text, но с цветовыми маркерами в тексте
// Например: ⚠️, ✅, ❌ в колонке статуса + цветной текст через Unicode
```

**План B (если XLSX стили не работают):**
- Использовать HTML → XLSX: сгенерировать HTML-таблицу с inline-стилями, сохранить как `.xls` (HTML-совместимый) через `XLSX.utils.table_to_sheet` или Blob

---

## Stage 3 — Ре-компаризон после массовых действий

### 3.1 Концепция

После выполнения массовых действий (создание платежей, возвратов, отгрузок, отмен) **данные в ordersData меняются** (поля `hasPayment`, `paid`, `hasReturn`, `returnSum`, `isCancelled`, `lastAction`). Если было запущено сравнение с отчётом (`window._reportMap` существует), повторное нажатие «Сравнить» должно:

1. **Не пересканировать API** — использовать обновлённый ordersData (без единого API-запроса)
2. **НЕ перезапускать search/SSE** — сравнение выполняется мгновенно на клиенте
3. **Показать «было → стало»** — legend с разницей до/после массовых действий
4. **Обновить модал** — новая секция «После массовых действий» с diffLog

**Важно:** re-компаризон происходит ТОЛЬКО при повторном нажатии «Сравнить», а не автоматически после batchAction.

### 3.2 Флаг сравнения и снапшот

**Файл:** `public/app.js`

- При первом `runComparison()` (если `window._comparisonBaseline` ещё нет) — сохранять `window._comparisonBaseline = JSON.parse(JSON.stringify(ordersData))` — снапшот ДО любых действий
- `window._comparisonSnapshotTaken = true` — флаг, что снапшот сделан
- После массовых действий (в SSE done) — установить `window._pendingRecompare = true` (не выполнять сравнение, только отметить)
- При повторном нажатии «Сравнить»:
  - Если `window._pendingRecompare === true` и `window._reportMap` существует:
    - **Не очищать** `#numbersInput` — не спрашивать подтверждение
    - **Не вызывать** `checkNumbers()` / SSE
    - Запустить `recompareAfterActions()` напрямую
  - Если `window._pendingRecompare === false` (нет снапшота) — поведение как сейчас (полный цикл с API)

### 3.3 Изменение `runComparison()`

```javascript
async function runComparison() {
  const fileInput = document.getElementById('reportFile')
  if (!fileInput || !fileInput.files || !fileInput.files[0]) {
    await showAlert('Сначала выберите файл отчёта Ozon (.xlsx)', 'Файл не выбран')
    return
  }

  // ── Ре-компаризон без API ──
  if (window._pendingRecompare && window._reportMap && window._comparisonSnapshotTaken) {
    window._pendingRecompare = false
    recompareAfterActions()
    return
  }

  // ── Старый поток: полный цикл с поиском ──
  if (ordersData.length > 0) {
    const confirmed = await showConfirm(
      'Будут очищены текущие данные и запущен поиск по номерам из отчёта.\nПродолжить?',
      'Очистить данные?'
    )
    if (!confirmed) return
  }

  // ... остальной код runComparison() без изменений (парсинг XLSX, fill input, checkNumbers)
  // После checkNumbers() — сохранить сравнение:
  
  // В SSE done обработчике (существующий код):
  if (window._pendingComparison && window._reportMap) {
    const comparisonResult = compareWithReport(window._reportMap)
    window._lastComparisonResult = comparisonResult
    
    // --- НОВОЕ: сохраняем снапшот для re-compare ---
    if (!window._comparisonSnapshotTaken) {
      window._comparisonBaseline = JSON.parse(JSON.stringify(ordersData))
      window._comparisonSnapshotTaken = true
    }
    // --- КОНЕЦ НОВОГО ---
    
    renderComparisonPanel(comparisonResult)
    window._pendingComparison = false
  }
}
```

### 3.4 SSE done: флаг `_pendingRecompare`

**Файл:** `public/app.js`

В SSE done-обработчике (после batchAction), если есть `window._reportMap` и `_comparisonSnapshotTaken`:

```javascript
// Внутри обработчика data.type === 'done' (batchAction):
// после всей обработки:
if (window._reportMap && window._comparisonSnapshotTaken) {
  window._pendingRecompare = true
  showStatus('✅ Массовая операция завершена. Нажмите «📊 Сравнить» для обновления отчёта')
}
```

Не выполнять сравнение автоматически — только выставить флаг.

### 3.5 Функция `recompareAfterActions()`

```javascript
function recompareAfterActions() {
  // 1. Берём window._reportMap (уже загружен из XLSX)
  // 2. Берём window._comparisonBaseline (снапшот ДО)
  // 3. Берём текущий ordersData (ПОСЛЕ)
  // 4. Сравниваем baseline vs current
  // 5. Запускаем compareWithReport(reportMap) на current ordersData
  // 6. В модале секция «📋 После массовых действий»
  
  const baseline = window._comparisonBaseline
  const reportMap = window._reportMap
  if (!baseline || !reportMap) return
  
  // Новое сравнение с текущими данными
  const newResult = compareWithReport(reportMap)
  window._lastComparisonResult = newResult
  
  // Вычисляем diff (baseline vs current)
  const diffLog = []
  for (const order of ordersData) {
    if (!order.enabled) continue
    const orderKey = String(order.shipmentNum).split('\n')[0].trim()
    const baselineOrder = baseline.find(o => 
      String(o.shipmentNum).split('\n')[0].trim() === orderKey
    )
    if (!baselineOrder) continue
    
    const changes = []
    if (baselineOrder.hasPayment !== order.hasPayment)
      changes.push(`Оплата: ${baselineOrder.hasPayment ? 'была' : 'не было'} → ${order.hasPayment ? 'создана' : 'нет'}`)
    if (baselineOrder.hasReturn !== order.hasReturn)
      changes.push(`Возврат: ${baselineOrder.hasReturn ? 'был' : 'не было'} → ${order.hasReturn ? 'создан' : 'нет'}`)
    if (baselineOrder.isCancelled !== order.isCancelled)
      changes.push(`Отмена: ${baselineOrder.isCancelled ? 'была' : 'не было'} → ${order.isCancelled ? 'отменён' : 'нет'}`)
    if (baselineOrder.paid !== order.paid && order.paid !== undefined)
      changes.push(`Сумма оплаты: ${(baselineOrder.paid || 0).toLocaleString()} → ${(order.paid || 0).toLocaleString()}`)
    if (baselineOrder.returnSum !== order.returnSum && order.returnSum !== undefined)
      changes.push(`Сумма возврата: ${(baselineOrder.returnSum || 0).toLocaleString()} → ${(order.returnSum || 0).toLocaleString()}`)
    
    if (changes.length > 0) {
      diffLog.push({ orderKey, changes })
    }
  }
  
  window._comparisonDiffLog = diffLog
  renderComparisonPanel(newResult)  // обновляет модал + секцию after-actions
}
```

### 3.6 Секция в модале

В `renderComparisonPanel()` — если есть `_comparisonDiffLog`, после сводки добавлять:

```html
<div class="cmp-section cmp-section-actions">
  <h4>📋 После массовых действий</h4>
  <p>Изменено <strong>N</strong> заказов после массовой операции (повторное нажатие «Сравнить»):</p>
  <table class="comparison-diff-table">
    <tr><th>Заказ</th><th>Изменения</th></tr>
    <!-- строки из diffLog -->
  </table>
  
  <div class="cmp-before-after">
    <div class="cmp-before">
      <h5>📌 До действий</h5>
      <p>Total D: {baseline сумма}</p>
      <p>Total J+: {baseline J+}</p>
      <p>Разница: {baseline diff} ⚠️</p>
    </div>
    <div class="cmp-after">
      <h5>✅ После действий</h5>
      <p>Total D: {текущая сумма}</p>
      <p>Total J+: {текущая J+}</p>
      <p>Разница: {текущий diff} ⚠️</p>
    </div>
  </div>
  
  <div class="cmp-legend">
    <strong>Что произошло:</strong>
    <ul>
      <li>Создано {N} платежей на сумму {X} ₽</li>
      <li>Разница: {было} → {стало} ₽ ({дельта} ₽)</li>
      <li>Осталось {M} частичных возвратов на {Y} ₽</li>
    </ul>
  </div>
</div>
```

### 3.7 CSS для секции after-actions

```css
.cmp-before-after {
  display: flex; gap: 16px; margin: 12px 0;
}
.cmp-before, .cmp-after {
  flex: 1; padding: 12px; border-radius: 6px;
}
.cmp-before { background: rgba(234,179,8,0.08); border: 1px solid rgba(234,179,8,0.2); }
.cmp-after { background: rgba(34,197,94,0.08); border: 1px solid rgba(34,197,94,0.2); }
.cmp-legend { 
  background: rgba(59,130,246,0.06); 
  border: 1px solid rgba(59,130,246,0.15);
  padding: 12px; border-radius: 6px; margin-top: 12px;
}
.cmp-legend ul { margin: 8px 0 0 16px; }
.cmp-diff-table { width: 100%; margin: 8px 0; }
.cmp-diff-table th { text-align: left; padding: 4px 8px; }
.cmp-diff-table td { padding: 4px 8px; border-top: 1px solid rgba(255,255,255,0.05); }
```

### 3.5 CSS для секции after-actions

```css
.cmp-before-after {
  display: flex; gap: 16px; margin: 12px 0;
}
.cmp-before, .cmp-after {
  flex: 1; padding: 12px; border-radius: 6px;
}
.cmp-before { background: rgba(234,179,8,0.08); border: 1px solid rgba(234,179,8,0.2); }
.cmp-after { background: rgba(34,197,94,0.08); border: 1px solid rgba(34,197,94,0.2); }
.cmp-legend { 
  background: rgba(59,130,246,0.06); 
  border: 1px solid rgba(59,130,246,0.15);
  padding: 12px; border-radius: 6px; margin-top: 12px;
}
.cmp-legend ul { margin: 8px 0 0 16px; }
.cmp-diff-table { width: 100%; margin: 8px 0; }
.cmp-diff-table th { text-align: left; padding: 4px 8px; }
.cmp-diff-table td { padding: 4px 8px; border-top: 1px solid rgba(255,255,255,0.05); }
```

---

## Порядок выполнения (StageOrchestrator)

### Stage 1: Попап + кнопка

**Батч 1A (параллельно):**
- **CoderAgent 1A-1:** HTML — кнопка `#btnViewComparison`, модал `#comparisonModal`, overlay
- **CoderAgent 1A-2:** CSS — `.comparison-modal-dialog`, `.cmp-block-*`, статус-иконки

**Батч 1B (после 1A):**
- **CoderAgent 1B:** JavaScript — `openComparisonModal()`, `closeComparisonModal()`, переключение `renderComparisonPanel()` в модал, привязка кнопок

**Gates Stage 1 → 2:**
- ✅ Модал открывается/закрывается
- ✅ При клике «Посмотреть сравнение» — рендер в модале
- ✅ Форматирование narrative с цветом/иконками

### Stage 2: XLSX с форматированием

**Батч 2 (один):**
- **CoderAgent 2:** Обновление `downloadComparisonReport()` — добавить колонки L+, стили, анализ, объяснение
- Проверить поддержку стилей XLSX библиотекой; если нет — реализовать fallback через HTML→XLSX

**Gates Stage 2 → 3:**
- ✅ XLSX скачивается с колонками A–K (данные + статус)
- ✅ Колонки L+ содержат итоги, анализ, таблицу частичных возвратов
- ✅ Цветовая маркировка строк

### Stage 3: Re-compare после действий

**Батч 3A (параллельно):**
- **CoderAgent 3A-1:** JavaScript — `_comparisonBaseline`, `recompareAfterActions()`, `diffLog`
- **CoderAgent 3A-2:** HTML + CSS — секция после действий в модале, `.cmp-before-after`, `.cmp-legend`

**Батч 3B (после 3A):**
- **CoderAgent 3B:** Интеграция — вызов `recompareAfterActions()` в SSE done + обновление модала
- **CoderAgent 3C:** Тесты — ручная проверка сценария:
  1. Загрузить отчёт Ozon → Сравнить → открыть модал ✅
  2. Создать платежи для 2 заказов → проверить обновление сравнения ✅
  3. Скачать XLSX → проверить форматирование ✅
  4. Открыть модал снова → данные актуальны ✅

---

## Файлы для изменения

| # | Файл | Stage | Что делаем |
|---|------|-------|------------|
| 1 | `public/index.html` | 1 | Кнопка `#btnViewComparison`, модал, overlay |
| 2 | `public/styles.css` | 1, 3 | Стили модала, цветовых блоков, after-actions |
| 3 | `public/app.js` | 1 | `renderComparisonPanel()` → модал, `open/closeComparisonModal()` |
| 4 | `public/app.js` | 2 | `downloadComparisonReport()` — колонки L+, стили |
| 5 | `public/app.js` | 3 | `_comparisonBaseline`, `recompareAfterActions()`, diffLog |

---

## Зависимости по данным

```
reportMap = buildReportMap(parseReportFile(file))   ← Ozon XLSX
     ↓
compareWithReport(reportMap)                        ← использует ordersData
     ↓
_lastComparisonResult = { summary, details }         ← сохраняется
     ↓
renderComparisonPanel(_lastComparisonResult)         ← рендер в модал
     ↓
downloadComparisonReport(_lastComparisonResult)      ← XLSX с L+

После mass action:
ordersData (обновлён) + reportMap (тот же)
     ↓
recompareAfterActions()                               ← новое сравнение без API
     ↓
_comparisonBaseline (было) vs _comparisonBaseline (стало)
     ↓
diffLog → секция «После массовых действий» в модале
```

---

## Тест-кейсы для ручной проверки

1. **Загрузка отчёта + Сравнение:**
   - Выбрать Ozon XLSX → нажать «Сравнить» → поиск выполняется
   - После done → появляется кнопка «Посмотреть сравнение»
   - Нажать → модал с корректными данными, цветами, иконками

2. **Обновление после действий:**
   - Выполнить сравнение (шаг 1)
   - Создать 2+ платежа → в SSE done сообщение «Сравнение обновлено»
   - Открыть модал → секция «После массовых действий» с diffLog
   - Было/Стало корректно

3. **Повторное открытие модала:**
   - Закрыть модал → открыть снова → данные не потеряны
   - Нажать «Скачать XLSX» → файл с форматированием

4. **XLSX формат:**
   - Колонки A–K с данными
   - Цветовая заливка строк
   - Колонки L+ с итогами и анализом
   - Таблица частичных возвратов

5. **Ре-компаризон не пересканирует API:**
   - После массовых действий SSE не запускается повторно
   - `_comparisonBaseline` не перезаписывается
