# План: Исправление статусов WB в поставках

> Создан: 2026-06-23
> Версия для запуска в новой сессии

## Проблема

На вкладке «Поставки» у всех заказов Wildberries в колонке «Статус маркета»
отображается «Не найден», хотя заказы в МойСклад есть, кэши WB на диске есть,
Ozon работает нормально.

## Корневая причина (две связанных)

### 1. Повреждённые кэши (data: null)
Два ключевых WB-кэша перезаписаны с `data: null`:
- `cache/wb_sales_cache.json` — 55B, `{"data":null,"lastDate":null,"fetchedAt":...}`
- `cache/wb_orders_stickers_cache.json` — 55B, `{"data":null,"lastDate":null,"fetchedAt":...}`

При загрузке такого файла модуль создаёт пустые `bySticker: Map{}` и `bySrid: Map{}`.
 `fetchedAt` стоит недавний → TTL не истёк → `refreshIfStale()` пропускает обновление →
сканирование идёт с пустыми кэшами → ни один WB-заказ не найден.

Прочие кэши не повреждены: `wb_analytics_returns_cache.json` (45KB),
`wb_orders_cache.json` (328KB, но без поля status — только XLSX-импорт),
`wb_returns_cache.json` (218B).

### 2. Неверный источник статусов для WB
Текущая WB-секция в `supplies.js:184-229` использует ТОЛЬКО statistics-api
(`supplier/sales`, `supplier/orders`, `supplier/returns`):

```js
const salesRec = wb.wbSalesCache?.bySticker?.get(String(shipmentNum))
const returnsRec = wb.wbReturnsCache?.bySticker?.get(String(shipmentNum))
// поиск в stickers по srid
const analyticsRec = wb.wbAnalyticsReturnsCache?.byOrderId?.get(String(shipmentNum))
```

**Marketplace API v3 (`wbOrdersCache`) игнорируется**, хотя это самый точный
источник — он возвращает реальный статус заказа на площадке:
`status: new | accepted | confirm | complete | cancel`

`wb_orders_cache.json` сейчас забит данными из XLSX-импорта (без поля `status`).
API v3/orders ни разу не дёрнулся успешно.

## Схема связи для подключения Marketplace API v3

```
shipmentNum (стикер из description в МС)
    → wbOrdersStickersCache.bySrid (ищем запись, где sticker == shipmentNum)
        → получаем srid (он же rid заказа)
            → wbOrdersCache.byRid.get(srid)
                → order { status, orderStatus } ← точный статус с площадки
```

(Эта связка уже реализована в `findInCache()` шаг 1, но supplies.js её не использует)

---

## План изменений

### Файл 1: `lib/constants.js` — уменьшить TTL

```diff
- const CACHE_TTL = 2 * 60 * 60 * 1000  // 2 часа
+ const CACHE_TTL = 30 * 60 * 1000       // 30 минут
```

**Зачем:** 2 часа — слишком долго для поставок FBS, заказ может быть отменён
до того, как кэш обновится. 30 мин — баланс между актуальностью и нагрузкой
на API WB (48 запросов/сутки вместо 12, всё ещё далеко от лимита 60/мин).

---

### Файл 2: `lib/wb.js` — защита от пустого кэша

#### 2.1 `getWBSalesMap()` — строки ~361-470

Проблема: если `wbSalesCache.bySticker` — пустой Map (из data:null на диске),
TTL-проверка на строке 365 проходит (пустой Map truthy), и кэш не обновляется.

**Изменить условие HIT** (строка 365):
```diff
- if (wbSalesCache.bySticker && (now - wbSalesCache.fetchedAt) < WB_SALES_CACHE_TTL) {
+ if (wbSalesCache.bySticker && wbSalesCache.bySticker.size > 0 && (now - wbSalesCache.fetchedAt) < WB_SALES_CACHE_TTL) {
```

**Изменить условие concurrent fetch** (строка 371):
```diff
- if (wbSalesCache.isFetching) {
+ if (wbSalesCache.isFetching && wbSalesCache.bySticker && wbSalesCache.bySticker.size > 0) {
```

**Защита сохранения** — перед `writeFileSync` проверять, что data не null:
```js
// После строки 466, перед save:
const dataToSave = wbSalesCache.data
if (dataToSave !== null) {
  try { fs.writeFileSync(WB_SALES_CACHE_FILE, JSON.stringify({ ... })) }
  catch (e) { log(`WB cache: disk save error: ${e.message}`) }
}
```

Аналогично для пустого ответа (строка 409-413):
```diff
- if (res.body.length === 0) {
+ if (res.body.length === 0 && wbSalesCache.data !== null) {
```

#### 2.2 `getWBOrdersStickersMap()` — строки ~1204-1376

Те же изменения для `wbOrdersStickersCache`:

**Условие HIT** (строка 1208):
```diff
- if (wbOrdersStickersCache.bySrid && (now - wbOrdersStickersCache.fetchedAt) < WB_ORDERS_STICKERS_CACHE_TTL) {
+ if (wbOrdersStickersCache.bySrid && wbOrdersStickersCache.bySrid.size > 0 && (now - wbOrdersStickersCache.fetchedAt) < WB_ORDERS_STICKERS_CACHE_TTL) {
```

**Условие concurrent fetch** (строка 1214):
```diff
- if (wbOrdersStickersCache.isFetching) {
+ if (wbOrdersStickersCache.isFetching && wbOrdersStickersCache.bySrid && wbOrdersStickersCache.bySrid.size > 0) {
```

**Защита сохранения** — не сохранять data: null.

**Пустой ответ** (строка 1244-1257):
```diff
- if (res.body.length === 0) {
+ if (res.body.length === 0 && wbOrdersStickersCache.data !== null) {
```

#### 2.3 `refreshIfStale()` — строки ~1859-1899

Сейчас условие проверяет `!cache.bySticker` — при пустом Map оно `false`.
Добавить проверку на размер:

```diff
- if (!wbSalesCache.bySticker || (now - wbSalesCache.fetchedAt) >= WB_SALES_CACHE_TTL) {
+ if (!wbSalesCache.bySticker || wbSalesCache.bySticker.size === 0 || (now - wbSalesCache.fetchedAt) >= WB_SALES_CACHE_TTL) {
```

Аналогично для `wbOrdersStickersCache`:
```diff
- if (!wbOrdersStickersCache.bySrid || (now - wbOrdersStickersCache.fetchedAt) >= WB_ORDERS_STICKERS_CACHE_TTL) {
+ if (!wbOrdersStickersCache.bySrid || wbOrdersStickersCache.bySrid.size === 0 || (now - wbOrdersStickersCache.fetchedAt) >= WB_ORDERS_STICKERS_CACHE_TTL) {
```

#### 2.4 Аналогичные защиты для других кэшей (опционально)

Для единообразия стоит добавить те же проверки для:
- `getWBReturnsMap()` — `wbReturnsCache.bySticker`
- `getWBAnalyticsReturnsMap()` — `wbAnalyticsReturnsCache.byOrderId`
- `getWBOrdersMap()` — `wbOrdersCache.byRid`

По тем же шаблонам: проверка `size > 0` + защита сохранения.

---

### Файл 3: `lib/supplies.js` — новый приоритет статусов WB

Переписать WB-секцию в `scanNewOrders()` (~строки 184-229)
и в `recheckOrder()` (~строки 403-485).

**Новый алгоритм поиска в wbOrdersCache:**

```js
// Поиск в wbOrdersCache
let orderRec = null
// Прямой поиск по byId (если shipmentNum = id сборочного задания)
orderRec = wb.wbOrdersCache?.byId?.get(String(shipmentNum))
// Поиск через stickers → byRid (если shipmentNum = стикер)
if (!orderRec) {
  const stickersBySrid = wb.wbOrdersStickersCache?.bySrid || new Map()
  for (const [srid, stickerObj] of stickersBySrid) {
    const stickerVal = stickerObj.sticker || srid
    if (String(stickerVal) === String(shipmentNum)) {
      orderRec = wb.wbOrdersCache?.byRid?.get(srid)
      break
    }
  }
}
const mpStatus = orderRec?.status || orderRec?.orderStatus || ''
```

**Новый приоритет статусов:**

```js
// Приоритет: return → cancelled (orders) → cancelled (sticker)
//          → delivered (orders) → delivered (sales) → delivered (sticker)
//          → processing

if (returnsRec) {
  marketplaceIsReturn = true
  marketplaceStatus = 'return'
} else if (mpStatus === 'cancel') {
  marketplaceIsCancelled = true
  marketplaceStatus = 'cancelled'
} else if (stickerInfo?.isCancel) {
  marketplaceIsCancelled = true
  marketplaceStatus = 'cancelled'
} else if (mpStatus === 'complete') {
  marketplaceIsDelivered = true
  marketplaceStatus = 'delivered'
} else if (salesRec && (salesRec.status === 'sale' || salesRec.status === 'delivered')) {
  marketplaceIsDelivered = true
  marketplaceStatus = 'delivered'
} else if (stickerInfo?.isRealization) {
  marketplaceIsDelivered = true
  marketplaceStatus = 'delivered'
} else if (mpStatus && !['new', 'accepted', 'confirm'].includes(mpStatus)) {
  // Любой другой определённый статус из API
  marketplaceStatus = mpStatus
  marketplaceFound = true  // уже будет true, но на всякий
}
```

**Важно:** `marketplaceFound` теперь устанавливается в `true` не только
при нахождении в sales/returns/stickers, но и при нахождении в wbOrdersCache.

```js
marketplaceFound = !!(salesRec || returnsRec || stickerInfo || analyticsRec || orderRec)
```

---

### Тестирование

После всех изменений:
1. Запустить сервер
2. Открыть вкладку «Поставки»
3. Нажать «Сканировать поставки»
4. Проверить, что WB-заказы нашли статус (не «Не найден»)
5. Проверить, что Ozon продолжает работать как раньше

---

### Ожидаемый результат

| Заказ | Статус | Условие |
|-------|--------|---------|
| Отменён в WB | `cancelled` | `wbOrdersCache.status === 'cancel'` |
| Отменён (только в стикерах) | `cancelled` | `stickerInfo?.isCancel` (fallback) |
| Доставлен (complete в API) | `delivered` | `wbOrdersCache.status === 'complete'` |
| Доставлен (sale в statistics) | `delivered` | `salesRec.status === 'sale'` (fallback) |
| Есть возврат | `return` | `returnsRec` (высший приоритет) |
| В обработке на площадке | `processing` | `status === 'new'/'accepted'/'confirm'` |
| Не найден нигде | `Не найден` | ничего не найдено (крайний случай) |

---

## Порядок запуска

1. Прочитать и применить изменения из этого плана
2. Запустить `npm test`
3. Запустить сервер и проверить
