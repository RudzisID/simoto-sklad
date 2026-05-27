# Analysis of wbSalesCache Structure and getWBSalesMap Function

## wbSalesCache Object Structure
The `wbSalesCache` object is defined as:
```javascript
const wbSalesCache = {
  data: null,       // массив ВСЕХ записей (объединение старых + новых)
  bySticker: null,  // Map<sticker, record> — построен из data
  lastDate: null,   // string — максимальный lastChangeDate среди всех записей
  fetchedAt: 0,     // timestamp последнего успешного запроса
  isFetching: false // true пока идёт запрос (другие запросы ждут)
}
```

## Key Characteristics of getWBSalesMap Function
1. **Cache Validation**: Returns cached data if fresh (within TTL) and not currently fetching
2. **Concurrent Request Handling**: If another request is fetching, waits for its result (up to 60 seconds)
3. **Fetching Logic**:
   - Constructs API endpoint: `/api/v1/supplier/sales?dateFrom=${encodeURIComponent(dateFrom)}&flag=0`
   - `dateFrom` is either `lastDate` (for incremental updates) or 90 days ago (initial load)
   - Implements 3 retry attempts with exponential backoff for rate limiting (429)
4. **Data Processing**:
   - Merges new records using `srid` for deduplication (upsert)
   - Updates `lastDate` to maximum `lastChangeDate` from new data
   - Purges records older than 90 days using `date` field
   - Rebuilds `bySticker` Map from `data` using `sticker` as key
5. **Persistence**: Saves cache to disk (`wb_sales_cache.json`) after successful fetch and on empty responses
6. **Error Handling**: Returns stale cache on failures; empty Map only if no cache exists

## Template for wbReturnsCache

Based on the analysis, here is the template for `wbReturnsCache` mirroring `wbSalesCache` structure but adapted for WB returns data:

### Constants to Add (near WB_SALES_CACHE_* constants)
```javascript
const WB_RETURNS_CACHE_TTL = 2 * 60 * 60 * 1000 // 2 часа
const WB_RETURNS_CACHE_FILE = path.join(moduleRoot, 'logs', 'wb_returns_cache.json')
```

### Cache Object Declaration (to place near wbSalesCache declaration)
```javascript
const wbReturnsCache = {
  data: null,       // массив ВСЕХ записей возвратов (объединение старых + новых)
  bySticker: null,  // Map<sticker, record> — построен из data
  lastDate: null,   // string — максимальный lastChangeDate среди всех записей
  fetchedAt: 0,     // timestamp последнего успешного запроса
  isFetching: false // true пока идёт запрос (другие запросы ждут)
}
```

### getWBR returnsMap Function (to place after getWBSalesMap function)
```javascript
async function getWBR returnsMap(wbToken, log = console.log, onWait = null) {
  const now = Date.now()

  // 1. Кэш свежий — отдаём мгновенно
  if (wbReturnsCache.bySticker && (now - wbReturnsCache.fetchedAt) < WB_RETURNS_CACHE_TTL) {
    log(`WB returns cache: HIT (${Math.round((now - wbReturnsCache.fetchedAt) / 1000)}s old, ${wbReturnsCache.bySticker.size} records)`)
    return wbReturnsCache.bySticker
  }

  // 2. Уже кто-то другой запрашивает — ждём его результат
  if (wbReturnsCache.isFetching) {
    log('WB returns cache: waiting for concurrent fetch...')
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 1000))
      if (!wbReturnsCache.isFetching) break
    }
    if (wbReturnsCache.bySticker) return wbReturnsCache.bySticker
  }

  // 3. Фетчим (или обновляем кэш)
  wbReturnsCache.isFetching = true

  try {
    // dateFrom:
    //   - если есть lastDate → только дельта (записи новее lastDate)
    //   - если нет (первый запуск) → забираем всё за 90 дней
    const dateFrom = wbReturnsCache.lastDate
      ? wbReturnsCache.lastDate
      : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    // flag=0: все записи с lastChangeDate >= dateFrom (до 80 000 строк)
    const path = `/api/v1/supplier/returns?dateFrom=${encodeURIComponent(dateFrom)}&flag=0`

    for (let attempt = 1; attempt <= 3; attempt++) {
      log(`WB returns cache: fetching supplier/returns (attempt ${attempt}/3)...`)

      const res = await wbOzonSync.makeRequest({
        hostname: 'statistics-api.wildberries.ru',
        path,
        method: 'GET',
        headers: { 'Authorization': wbToken }
      })

      if (res.status === 200 && Array.isArray(res.body)) {
        if (res.body.length === 0) {
          // Пустой ответ — новых данных нет, просто обновляем timestamp
          log(`WB returns cache: no new data (empty response), cache is current (${wbReturnsCache.bySticker?.size ?? 0} records)`)
          wbReturnsCache.fetchedAt = Date.now()
          wbReturnsCache.isFetching = false
          // Сохраняем обновлённый fetchedAt на диск
          try { fs.writeFileSync(WB_RETURNS_CACHE_FILE, JSON.stringify({ data: wbReturnsCache.data, lastDate: wbReturnsCache.lastDate, fetchedAt: wbReturnsCache.fetchedAt })) } catch (e) { log(`WB returns cache: disk save error: ${e.message}`) }
          return wbReturnsCache.bySticker || new Map()
        }

        // Мерджим новые записи в существующий кэш
        if (wbReturnsCache.data === null) {
          // Первый запуск — просто сохраняем ответ
          wbReturnsCache.data = res.body
        } else {
          // Инкремент: upsert по srid
          const existing = new Set(wbReturnsCache.data.map(r => r.srid))
          for (const record of res.body) {
            if (record.srid && existing.has(record.srid)) {
              // Заменяем существующую запись
              const idx = wbReturnsCache.data.findIndex(r => r.srid === record.srid)
              if (idx !== -1) wbReturnsCache.data[idx] = record
            } else if (record.srid) {
              // Добавляем новую
              wbReturnsCache.data.push(record)
              existing.add(record.srid)
            }
          }
        }

        // Обновляем lastDate = max последних lastChangeDate
        const lastDate = res.body.reduce((max, r) => {
          if (r.lastChangeDate && (!max || r.lastChangeDate > max)) return r.lastChangeDate
          return max
        }, null)
        if (lastDate && (!wbReturnsCache.lastDate || lastDate > wbReturnsCache.lastDate)) {
          wbReturnsCache.lastDate = lastDate
        }

        // Удаляем записи старше 90 дней (WB гарантирует хранение не более 90 дней)
        const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
        const before = wbReturnsCache.data.length
        wbReturnsCache.data = wbReturnsCache.data.filter(r => r.date && r.date >= cutoff)
        if (before !== wbReturnsCache.data.length) {
          log(`WB returns cache: purged ${before - wbReturnsCache.data.length} records older than 90 days`)
        }

        // Перестраиваем bySticker из обновлённого data
        wbReturnsCache.bySticker = new Map()
        for (const record of wbReturnsCache.data) {
          if (record.sticker) wbReturnsCache.bySticker.set(String(record.sticker), record)
        }

        wbReturnsCache.fetchedAt = Date.now()
        // Сохраняем кэш на диск (данные + lastDate + fetchedAt)
        try { fs.writeFileSync(WB_RETURNS_CACHE_FILE, JSON.stringify({ data: wbReturnsCache.data, lastDate: wbReturnsCache.lastDate, fetchedAt: wbReturnsCache.fetchedAt })) } catch (e) { log(`WB returns cache: disk save error: ${e.message}`) }
        wbReturnsCache.isFetching = false
        log(`WB returns cache: merged ${res.body.length} new records → total ${wbReturnsCache.data.length} records, lastDate=${wbReturnsCache.lastDate}`)
        return wbReturnsCache.bySticker
      }

      if (res.status === 429) {
        // Читаем заголовки: X-Ratelimit-Retry говорит сколько секунд ждать
        const retrySec = parseInt(res.headers?.['x-ratelimit-retry'] || res.headers?.['x-ratelimit-reset'], 10)
        const waitSec = !isNaN(retrySec) && retrySec > 0 ? retrySec : 60
        log(`WB returns cache: rate limited (429), attempt ${attempt}/3, X-Ratelimit-Retry: ${res.headers?.['x-ratelimit-retry'] || '?'}, waiting ${waitSec}s`)

        // Если есть просроченный кэш — отдаём его без retry (лучше старые данные, чем ничего)
        if (wbReturnsCache.bySticker) {
          log(`WB returns cache: 429 but have stale cache (${wbReturnsCache.bySticker.size} records), returning immediately`)
          wbReturnsCache.isFetching = false
          // Сохраняем как есть — хоть fetchedAt старый, но данные остаются
          return wbReturnsCache.bySticker
        }

        if (attempt < 3) {
          if (onWait) onWait(waitSec, attempt)
          log(`WB returns cache: waiting ${waitSec}s before retry...`)
          await new Promise(r => setTimeout(r, waitSec * 1000))
        }
      } else {
        log(`WB returns cache: unexpected status ${res.status} — not retrying`)
        break
      }
    }

    // Все попытки исчерпаны — отдаём просроченный кэш, если есть
    if (wbReturnsCache.bySticker) {
      log(`WB returns cache: all attempts failed, using stale cache (${wbReturnsCache.bySticker.size} records)`)
      return wbReturnsCache.bySticker
    }
  } catch (e) {
    log(`WB returns cache: error: ${e.message}`)
  } finally {
    wbReturnsCache.isFetching = false
  }

  return new Map() // пустой Map — ничего не найдено
}
```

## Notes on Differences and Assumptions
1. **Endpoint**: Changed from `/api/v1/supplier/sales` to `/api/v1/supplier/returns`
2. **Field Names**: Assumed returns data uses same field names as sales (`srid`, `sticker`, `lastChangeDate`, `date`). If actual returns API differs, these must be adjusted in:
   - Deduplication (`srid`)
   - Mapping key (`sticker`)
   - Last date calculation (`lastChangeDate`)
   - 90-day purge (`date`)
3. **TTL and File**: Used same TTL (2 hours) but separate cache file (`wb_returns_cache.json`)
4. **Initialization**: Similar disk initialization code must be added for `wbReturnsCache` (reading from `WB_RETURNS_CACHE_FILE` on startup)
5. **Naming**: Function name `getWBR returnsMap` uses camelCase with "returns" to mirror `getWBSalesMap`

## Placement Instructions
1. Add constants near existing `WB_SALES_CACHE_TTL` and `WB_SALES_CACHE_FILE` (around line 99-100)
2. Add `wbReturnsCache` declaration near `wbSalesCache` (around line 98)
3. Add `getWBR returnsMap` function after `getWBSalesMap` function (around line 297)
4. Add disk initialization for `wbReturnsCache` in the same block as `wbSalesCache` initialization (not shown in provided lines but inferred to exist)