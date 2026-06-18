# План исправлений: 4 проблемы

> Дата: 2026-06-18
> Предыдущая сессия (анализ): контекст сохранён
> Статус: ✅ Выполнено

---

## Проблема 1: Анимация строк при массовой отгрузке поставок ✅

**Файлы:** `public/app.js`, `public/styles.css`

**Что сделано:**
1. CSS: добавлены классы `#suppliesTableBody tr.processing` (пульсация outline) и `#suppliesTableBody tr.completed` (зелёная ✔)
2. JS: перед fetch — `processing` на все строки; после `replaceWith` — `completed` на 2с; при done/aborted/error — `processing` снимается

---

## Проблема 2: Статусы WB не определяются ✅

**Файл:** `lib/supplies.js`

**Что сделано:** Заменён `findInCache` на прямой независимый поиск по каждому кэшу
в `scanNewOrders()` и `recheckOrder()`. Алгоритм:
1. `salesRec = wbSalesCache.bySticker?.get(shipmentNum)`
2. `returnsRec = wbReturnsCache.bySticker?.get(shipmentNum)`
3. Перебор `wbOrdersStickersCache.bySrid` → stickerVal === shipmentNum
4. `analyticsRec` из `wbAnalyticsReturnsCache.byOrderId`
5. `marketplaceFound = !!(salesRec || returnsRec || stickerInfo || analyticsRec)`
6. Приоритет статусов: возврат → отмена → доставлен → принят

---

## Проблема 3: FBO номера для техподдержки ✅

**Файл:** `public/app.js`

**Что сделано:**
1. `buildReportMap()` — добавлен сбор FBO-номеров: строки с `colE === 'fbo'`,
   номера из колонки C собираются в `fboOrderNumbers`, возвращаются в объекте
2. `runComparison()` — `reportResult.fboOrderNumbers` сохраняется в `window._fboOrderNumbers`
3. UI и export — заменён `details.filter(... storeName === 'FBO')` на прямое чтение
   `window._fboOrderNumbers` (данные из отчёта, а не из скана)
4. `compareWithReport()` — не тронут, FBO не участвует в сравнении

---

## Проблема 4: Полные возвраты считаются частичными ✅

**Файл:** `public/app.js`

**Что сделано:** Исправлено условие в `compareWithReport()`:
- `partial` теперь требует `returnSum < sum` (действительно частичный возврат)
- `return` включает `order.isCancelled || (returnSum >= sum)` (отмена или полный возврат)

---

## Порядок выполнения

1. **Проблема 4** (самая простая, одно условие в `compareWithReport`)
2. **Проблема 3** (FBO — добавить сбор в `buildReportMap`)
3. **Проблема 2** (WB статусы — переписать блок поиска в `lib/supplies.js`)
4. **Проблема 1** (анимация — CSS + JS в `supplyBatchAction`)

---

<!-- Дата последней сверки: 2026-06-18 -->
