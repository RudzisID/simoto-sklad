/**
 * WB cache module
 *
 * Manages 4 WB API caches (sales, analytics returns, orders, orders stickers)
 * with disk persistence, TTL-based refresh, concurrent fetch locking,
 * and 429 rate-limit handling.
 *
 * @module lib/wb
 */

const path = require('path')
const fs = require('fs')
const wbOzonSync = require('../integrations/wb_ozon_sync')

/** @type {string} */
const moduleRoot = path.join(__dirname, '..')

/** Ensure cache directory exists */
const CACHE_DIR = path.join(moduleRoot, 'cache')
try { fs.mkdirSync(CACHE_DIR, { recursive: true }) } catch (_) {}

/**
 * Default logger for module-level disk loading.
 * @param {string} msg
 */
const log = (...args) => console.log(...args)

// ═══════════════════════════════════════════════════════════════════
// Cache structures & constants
// ═══════════════════════════════════════════════════════════════════

// ── WB Sales Cache (supplier/sales) ──
/** @type {{ data: Array|null, bySticker: Map|null, lastDate: string|null, fetchedAt: number, isFetching: boolean }} */
const wbSalesCache = {
  data: null,       // массив ВСЕХ записей (объединение старых + новых)
  bySticker: null,  // Map<sticker, record> — построен из data
  byGNumber: null,  // Map<gNumber, record> — построен из data
  lastDate: null,   // string — максимальный lastChangeDate среди всех записей
  fetchedAt: 0,     // timestamp последнего успешного запроса
  isFetching: false // true пока идёт запрос (другие запросы ждут)
}
const WB_SALES_CACHE_TTL = 2 * 60 * 60 * 1000 // 2 часа
const WB_SALES_CACHE_FILE = path.join(moduleRoot, 'cache', 'wb_sales_cache.json')

// ── WB Analytics Returns cache (seller-analytics-api) ──
const WB_ANALYTICS_CACHE_TTL = 2 * 60 * 60 * 1000 // 2 часа
const WB_ANALYTICS_CACHE_FILE = path.join(moduleRoot, 'cache', 'wb_analytics_returns_cache.json')

// Загрузка кэша с диска при старте (чтобы перезапуск сервера не требовал нового запроса к API)
try {
  if (fs.existsSync(WB_SALES_CACHE_FILE)) {
    const saved = JSON.parse(fs.readFileSync(WB_SALES_CACHE_FILE, 'utf-8'))
    if (saved && Array.isArray(saved.data)) {
      wbSalesCache.data = saved.data
      wbSalesCache.lastDate = saved.lastDate || null
      wbSalesCache.fetchedAt = saved.fetchedAt || 0
      wbSalesCache.bySticker = new Map()
      for (const record of wbSalesCache.data) {
        if (record.sticker) wbSalesCache.bySticker.set(String(record.sticker), record)
      }
      wbSalesCache.byGNumber = new Map()
      for (const record of wbSalesCache.data) {
        if (record.gNumber) wbSalesCache.byGNumber.set(String(record.gNumber), record)
      }
      log(`WB cache: loaded from disk — ${wbSalesCache.data.length} records, ${wbSalesCache.bySticker.size} stickers, ${wbSalesCache.byGNumber.size} gNumbers, lastDate=${wbSalesCache.lastDate || 'none'}`)
    }
  }
} catch (e) {
   log(`WB cache: disk load error (starting fresh): ${e.message}`)
}

// ── WB returns cache ──
const WB_RETURNS_CACHE_TTL = 2 * 60 * 60 * 1000; // 2 часа
const WB_RETURNS_CACHE_FILE = path.join(moduleRoot, 'cache', 'wb_returns_cache.json');

/** @type {{ data: Array|null, bySticker: Map|null, lastDate: string|null, fetchedAt: number, isFetching: boolean }} */
const wbReturnsCache = {
  data: null,
  bySticker: null,
  lastDate: null,
  fetchedAt: 0,
  isFetching: false
};

// ── WB Analytics Returns cache (goods-return) ──
/** @type {{ data: Array|null, byOrderId: Map|null, lastDate: string|null, fetchedAt: number, isFetching: boolean }} */
const wbAnalyticsReturnsCache = {
  data: null,        // массив ВСЕХ записей (объединение старых + новых)
  byOrderId: null,   // Map<orderId, record> — построен из data
  lastDate: null,    // string (YYYY-MM-DD) — максимальный date среди всех записей
  fetchedAt: 0,      // timestamp последнего успешного запроса
  isFetching: false  // true пока идёт запрос (другие запросы ждут)
};

// Загрузка кэша с диска при старте (чтобы перезапуск сервера не требовал нового запроса к API)
try {
  if (fs.existsSync(WB_RETURNS_CACHE_FILE)) {
    const saved = JSON.parse(fs.readFileSync(WB_RETURNS_CACHE_FILE, 'utf-8'));
    if (saved && Array.isArray(saved.data)) {
      wbReturnsCache.data = saved.data;
      wbReturnsCache.lastDate = saved.lastDate || null;
      wbReturnsCache.fetchedAt = saved.fetchedAt || 0;
      wbReturnsCache.bySticker = new Map();
      for (const record of wbReturnsCache.data) {
        if (record.sticker) wbReturnsCache.bySticker.set(String(record.sticker), record);
      }
      log(`WB returns cache: loaded from disk — ${wbReturnsCache.data.length} records, ${wbReturnsCache.bySticker.size} stickers, lastDate=${wbReturnsCache.lastDate || 'none'}`);
    }
  }
} catch (e) {
   log(`WB returns cache: disk load error (starting fresh): ${e.message}`);
}

// Загрузка кэша Analytics Returns с диска при старте
try {
  if (fs.existsSync(WB_ANALYTICS_CACHE_FILE)) {
    const saved = JSON.parse(fs.readFileSync(WB_ANALYTICS_CACHE_FILE, 'utf-8'))
    if (saved && Array.isArray(saved.data)) {
      wbAnalyticsReturnsCache.data = saved.data
      wbAnalyticsReturnsCache.lastDate = saved.lastDate || null
      wbAnalyticsReturnsCache.fetchedAt = saved.fetchedAt || 0
      wbAnalyticsReturnsCache.byOrderId = new Map()
      for (const record of wbAnalyticsReturnsCache.data) {
        if (record.orderId) wbAnalyticsReturnsCache.byOrderId.set(String(record.orderId), record)
      }
      log(`[WB Analytics] loaded from disk — ${wbAnalyticsReturnsCache.data.length} records, ${wbAnalyticsReturnsCache.byOrderId.size} orderIds, lastDate=${wbAnalyticsReturnsCache.lastDate || 'none'}`)
    }
  }
} catch (e) {
   log(`[WB Analytics] disk load error (starting fresh): ${e.message}`)
}

// ── Кэш для WB Marketplace API (api/v3/orders) ──
const WB_ORDERS_CACHE_TTL = 2 * 60 * 60 * 1000 // 2 часа
const WB_ORDERS_CACHE_FILE = path.join(moduleRoot, 'cache', 'wb_orders_cache.json')

/** @type {{ data: Array|null, byRid: Map|null, byNmId: Map|null, byId: Map|null, fetchedAt: number, isFetching: boolean }} */
const wbOrdersCache = {
  data: null,        // массив ВСЕХ заказов из /api/v3/orders
  byRid: null,       // Map<rid, order> — для связки со srid из statistics
  byNmId: null,      // Map<nmId, order[]> — поиск по артикулу
  byId: null,        // Map<id, order> — поиск по Номеру сборочного задания
  fetchedAt: 0,      // timestamp последнего успешного запроса
  isFetching: false  // true пока идёт запрос
}

// Загрузка кэша Маркетплейс с диска при старте
try {
  if (fs.existsSync(WB_ORDERS_CACHE_FILE)) {
    const saved = JSON.parse(fs.readFileSync(WB_ORDERS_CACHE_FILE, 'utf-8'))
    if (saved && Array.isArray(saved.data)) {
      wbOrdersCache.data = saved.data
      wbOrdersCache.fetchedAt = saved.fetchedAt || 0
      // Восстанавливаем byRid
      wbOrdersCache.byRid = new Map()
      for (const order of wbOrdersCache.data) {
        if (order.rid) wbOrdersCache.byRid.set(order.rid, order)
      }
      // Восстанавливаем byNmId
      wbOrdersCache.byNmId = new Map()
      for (const order of wbOrdersCache.data) {
        const nmId = String(order.nmId || '')
        if (nmId) {
          if (!wbOrdersCache.byNmId.has(nmId)) wbOrdersCache.byNmId.set(nmId, [])
          wbOrdersCache.byNmId.get(nmId).push(order)
        }
      }
      // Восстанавливаем byId
      wbOrdersCache.byId = new Map()
      for (const order of wbOrdersCache.data) {
        if (order.id) wbOrdersCache.byId.set(String(order.id), order)
      }
      log(`[WB Orders] loaded from disk — ${wbOrdersCache.data.length} orders, ${wbOrdersCache.byRid.size} rids, ${wbOrdersCache.byNmId.size} nmIds, ${wbOrdersCache.byId.size} ids`)
    }
  }
} catch (e) {
  log(`[WB Orders] disk load error (starting fresh): ${e.message}`)
}

// ── Кэш для WB statistics-api (supplier/orders) — sticker + srid ──
const WB_ORDERS_STICKERS_CACHE_TTL = 2 * 60 * 60 * 1000 // 2 часа
const WB_ORDERS_STICKERS_CACHE_FILE = path.join(moduleRoot, 'cache', 'wb_orders_stickers_cache.json')

/** @type {{ data: Array|null, bySrid: Map|null, lastDate: string|null, fetchedAt: number, isFetching: boolean }} */
const wbOrdersStickersCache = {
  data: null,        // массив заказов из supplier/orders
  bySrid: null,      // Map<srid, sticker>
  lastDate: null,    // string — максимальный lastChangeDate
  fetchedAt: 0,
  isFetching: false
}

// Загрузка кэша стикеров с диска при старте
try {
  if (fs.existsSync(WB_ORDERS_STICKERS_CACHE_FILE)) {
    const saved = JSON.parse(fs.readFileSync(WB_ORDERS_STICKERS_CACHE_FILE, 'utf-8'))
    if (saved && Array.isArray(saved.data)) {
      wbOrdersStickersCache.data = saved.data
      wbOrdersStickersCache.lastDate = saved.lastDate || null
      wbOrdersStickersCache.fetchedAt = saved.fetchedAt || 0
      wbOrdersStickersCache.bySrid = new Map()
      for (const record of wbOrdersStickersCache.data) {
        if (record.srid && record.sticker) wbOrdersStickersCache.bySrid.set(record.srid, record.sticker)
      }
      log(`[WB Orders Stickers] loaded from disk — ${wbOrdersStickersCache.data.length} records, ${wbOrdersStickersCache.bySrid.size} srid→sticker, lastDate=${wbOrdersStickersCache.lastDate || 'none'}`)
    }
  }
} catch (e) {
  log(`[WB Orders Stickers] disk load error (starting fresh): ${e.message}`)
}

// ═══════════════════════════════════════════════════════════════════
// Helper functions
// ═══════════════════════════════════════════════════════════════════

/**
 * Извлекает дату из записи analytics/goods-return
 * Поля в порядке приоритета: completedDt → orderDt → readyToReturnDt
 * @param {Object} record - запись из analytics API
 * @returns {string|null} дата в ISO формате или null
 */
function getAnalyticsRecordDate(record) {
  return record.completedDt || record.orderDt || record.readyToReturnDt || null
}

/**
 * Вспомогательная функция: merge записей из отчёта Analytics Returns
 * в существующий кэш (upsert по orderId), обновление lastDate,
 * очистка записей старше 90 дней, сохранение на диск.
 * @param {Array} records - массив записей из res.body.report
 * @param {function} log - функция логирования
 * @param {string|null} dateToFallback - fallback дата, если у записей нет дат
 */
function mergeAnalyticsRecords(records, log, dateToFallback = null) {
  if (!Array.isArray(records) || records.length === 0) return

  const logPrefix = `[WB Analytics]`

  // Вспомогательная: получить дату (completedDt/orderDt/readyToReturnDt)
  const getDate = (r) => r.completedDt || r.orderDt || r.readyToReturnDt || null

  // Merge (upsert по orderId) — используем spread для иммутабельности
  if (wbAnalyticsReturnsCache.data === null) {
    wbAnalyticsReturnsCache.data = [...records]
    log(`${logPrefix} initialized cache with ${records.length} records (from null)`)
  } else {
    const beforeMerge = wbAnalyticsReturnsCache.data.length
    const existing = new Set(wbAnalyticsReturnsCache.data.map(r => r.orderId))
    let addedCount = 0
    let updatedCount = 0
    for (const record of records) {
      if (record.orderId && existing.has(record.orderId)) {
        const idx = wbAnalyticsReturnsCache.data.findIndex(r => r.orderId === record.orderId)
        if (idx !== -1) {
          wbAnalyticsReturnsCache.data[idx] = record
          updatedCount++
        }
      } else if (record.orderId) {
        wbAnalyticsReturnsCache.data.push(record)
        existing.add(record.orderId)
        addedCount++
      }
    }
    log(`${logPrefix} merge: ${addedCount} added, ${updatedCount} updated (before: ${beforeMerge}, after merge: ${wbAnalyticsReturnsCache.data.length})`)
  }

  // Обновляем lastDate = max среди дат из новых записей
  // Поля API analytics/goods-return: completedDt, orderDt, readyToReturnDt (не date!)
  const maxDate = records.reduce((max, r) => {
    const dt = getDate(r)
    if (dt && (!max || dt > max)) return dt
    return max
  }, null)
  // Fallback: если у записей нет дат, используем dateTo из запроса
  const effectiveDate = maxDate || dateToFallback
  if (effectiveDate && (!wbAnalyticsReturnsCache.lastDate || effectiveDate > wbAnalyticsReturnsCache.lastDate)) {
    wbAnalyticsReturnsCache.lastDate = effectiveDate
  }

  // Удаляем записи старше 120 дней (по completedDt/orderDt/readyToReturnDt)
  const cutoff = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString()
  const beforePurge = wbAnalyticsReturnsCache.data.length
  let countedNoDate = 0
  wbAnalyticsReturnsCache.data = wbAnalyticsReturnsCache.data.filter(r => {
    const dt = getDate(r)
    if (!dt) {
      countedNoDate++
      return true  // без даты — не удаляем
    }
    return dt >= cutoff
  })
  const purgedCount = beforePurge - wbAnalyticsReturnsCache.data.length
  if (purgedCount > 0) {
    log(`${logPrefix} purged ${purgedCount} records older than 90 days (cutoff: ${cutoff.split('T')[0]})`)
  }
  if (countedNoDate > 0) {
    log(`${logPrefix} ${countedNoDate} records have no date field (completedDt/orderDt) — preserved from purge`)
  }

  // Перестраиваем byOrderId из обновлённого data
  wbAnalyticsReturnsCache.byOrderId = new Map()
  for (const record of wbAnalyticsReturnsCache.data) {
    if (record.orderId) wbAnalyticsReturnsCache.byOrderId.set(String(record.orderId), record)
  }

  wbAnalyticsReturnsCache.fetchedAt = Date.now()

  // Сохраняем на диск
  try {
    fs.writeFileSync(WB_ANALYTICS_CACHE_FILE, JSON.stringify({
      data: wbAnalyticsReturnsCache.data,
      lastDate: wbAnalyticsReturnsCache.lastDate,
      fetchedAt: wbAnalyticsReturnsCache.fetchedAt
    }))
  } catch (e) {
    log(`${logPrefix} disk save error: ${e.message}`)
  }

  log(`${logPrefix} merged ${records.length} records → total ${wbAnalyticsReturnsCache.data.length} records, lastDate=${wbAnalyticsReturnsCache.lastDate}`)
}

// ═══════════════════════════════════════════════════════════════════
// Core fetch functions
// ═══════════════════════════════════════════════════════════════════

/**
 * Получить sticker → record из WB statistics-api (supplier/sales)
 * @param {string} wbToken - WB API token
 * @param {function} [log] - функция логирования
 * @param {function} [onWait] - callback(waitSec, attempt) при ожидании retry
 * @returns {Promise<Map<string, Object>>}
 */
async function getWBSalesMap(wbToken, log = console.log, onWait = null) {
  const now = Date.now()

  // 1. Кэш свежий — отдаём мгновенно
  if (wbSalesCache.bySticker && (now - wbSalesCache.fetchedAt) < WB_SALES_CACHE_TTL) {
    log(`WB cache: HIT (${Math.round((now - wbSalesCache.fetchedAt) / 1000)}s old, ${wbSalesCache.bySticker.size} records)`)
    return wbSalesCache.bySticker
  }

  // 2. Уже кто-то другой запрашивает — используем то что есть
  if (wbSalesCache.isFetching) {
    log('WB cache: concurrent fetch in progress, using stale cache')
    if (wbSalesCache.bySticker) return wbSalesCache.bySticker
    // Нет кэша — ждём до 10с
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 1000))
      if (!wbSalesCache.isFetching) break
    }
    if (wbSalesCache.bySticker) return wbSalesCache.bySticker
  }

  // 3. Фетчим (или обновляем кэш)
  wbSalesCache.isFetching = true

  try {
    // dateFrom:
    //   - если есть lastDate → только дельта (записи новее lastDate)
    //   - если нет (первый запуск) → забираем всё за 120 дней
    const dateFrom = wbSalesCache.lastDate
      ? wbSalesCache.lastDate
      : new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    // flag=0: все записи с lastChangeDate >= dateFrom (до 80 000 строк)
    const path = `/api/v1/supplier/sales?dateFrom=${encodeURIComponent(dateFrom)}&flag=0`

    for (let attempt = 1; attempt <= 3; attempt++) {
      log(`WB cache: fetching supplier/sales (attempt ${attempt}/3)...`)

      const res = await wbOzonSync.makeRequest({
        hostname: 'statistics-api.wildberries.ru',
        path,
        method: 'GET',
        headers: { 'Authorization': wbToken }
      })

      if (res.status === 200 && Array.isArray(res.body)) {
        if (res.body.length === 0) {
          // Пустой ответ — новых данных нет, просто обновляем timestamp
          log(`WB cache: no new data (empty response), cache is current (${wbSalesCache.bySticker?.size ?? 0} records)`)
          wbSalesCache.fetchedAt = Date.now()
          wbSalesCache.isFetching = false
          // Сохраняем обновлённый fetchedAt на диск
          try { fs.writeFileSync(WB_SALES_CACHE_FILE, JSON.stringify({ data: wbSalesCache.data, lastDate: wbSalesCache.lastDate, fetchedAt: wbSalesCache.fetchedAt })) } catch (e) { log(`WB cache: disk save error: ${e.message}`) }
          return wbSalesCache.bySticker || new Map()
        }

        // Мерджим новые записи в существующий кэш
        if (wbSalesCache.data === null) {
          // Первый запуск — просто сохраняем ответ
          wbSalesCache.data = res.body
        } else {
          // Инкремент: upsert по srid
          const existing = new Set(wbSalesCache.data.map(r => r.srid))
          for (const record of res.body) {
            if (record.srid && existing.has(record.srid)) {
              // Заменяем существующую запись
              const idx = wbSalesCache.data.findIndex(r => r.srid === record.srid)
              if (idx !== -1) wbSalesCache.data[idx] = record
            } else if (record.srid) {
              // Добавляем новую
              wbSalesCache.data.push(record)
              existing.add(record.srid)
            }
          }
        }

        // Обновляем lastDate = max последних lastChangeDate
        const lastDate = res.body.reduce((max, r) => {
          if (r.lastChangeDate && (!max || r.lastChangeDate > max)) return r.lastChangeDate
          return max
        }, null)
        if (lastDate && (!wbSalesCache.lastDate || lastDate > wbSalesCache.lastDate)) {
          wbSalesCache.lastDate = lastDate
        }

        // Удаляем записи старше 120 дней (WB гарантирует хранение не более 90 дней, но мы расширили для совместимости с XLSX)
        const cutoff = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString()
        const before = wbSalesCache.data.length
        wbSalesCache.data = wbSalesCache.data.filter(r => r.date && r.date >= cutoff)
        if (before !== wbSalesCache.data.length) {
          log(`WB cache: purged ${before - wbSalesCache.data.length} records older than 90 days`)
        }

        // Перестраиваем bySticker и byGNumber из обновлённого data
        wbSalesCache.bySticker = new Map()
        for (const record of wbSalesCache.data) {
          if (record.sticker) wbSalesCache.bySticker.set(String(record.sticker), record)
        }
        wbSalesCache.byGNumber = new Map()
        for (const record of wbSalesCache.data) {
          if (record.gNumber) wbSalesCache.byGNumber.set(String(record.gNumber), record)
        }

        wbSalesCache.fetchedAt = Date.now()
        // Сохраняем кэш на диск (данные + lastDate + fetchedAt)
        try { fs.writeFileSync(WB_SALES_CACHE_FILE, JSON.stringify({ data: wbSalesCache.data, lastDate: wbSalesCache.lastDate, fetchedAt: wbSalesCache.fetchedAt })) } catch (e) { log(`WB cache: disk save error: ${e.message}`) }
        wbSalesCache.isFetching = false
        log(`WB cache: merged ${res.body.length} new records → total ${wbSalesCache.data.length} records, lastDate=${wbSalesCache.lastDate}`)
        return wbSalesCache.bySticker
      }

      if (res.status === 429) {
        // Читаем заголовки: X-Ratelimit-Retry говорит сколько секунд ждать
        const retrySec = parseInt(res.headers?.['x-ratelimit-retry'] || res.headers?.['x-ratelimit-reset'], 10)
        const waitSec = !isNaN(retrySec) && retrySec > 0 ? retrySec : 60
        log(`WB cache: rate limited (429), attempt ${attempt}/3, X-Ratelimit-Retry: ${res.headers?.['x-ratelimit-retry'] || '?'}, waiting ${waitSec}s`)

        // Если есть просроченный кэш — отдаём его без retry (лучше старые данные, чем ничего)
        if (wbSalesCache.bySticker) {
          log(`WB cache: 429 but have stale cache (${wbSalesCache.bySticker.size} records), returning immediately`)
          wbSalesCache.fetchedAt = Date.now()
          wbSalesCache.isFetching = false
          try { fs.writeFileSync(WB_SALES_CACHE_FILE, JSON.stringify({ data: wbSalesCache.data, lastDate: wbSalesCache.lastDate, fetchedAt: wbSalesCache.fetchedAt })) } catch (e) { log(`WB cache: disk save error: ${e.message}`) }
          return wbSalesCache.bySticker
        }

        if (attempt < 3) {
          if (onWait) onWait(waitSec, attempt)
          log(`WB cache: waiting ${waitSec}s before retry...`)
          await new Promise(r => setTimeout(r, waitSec * 1000))
        }
      } else {
        log(`WB cache: unexpected status ${res.status} — not retrying`)
        break
      }
    }

    // Все попытки исчерпаны — отдаём просроченный кэш, если есть
    if (wbSalesCache.bySticker) {
      log(`WB cache: all attempts failed, using stale cache (${wbSalesCache.bySticker.size} records)`)
      return wbSalesCache.bySticker
    }
  } catch (e) {
    log(`WB cache: error: ${e.message}`)
  } finally {
    wbSalesCache.isFetching = false
  }

  return new Map() // пустой Map — ничего не найдено
}

/**
 * Получить orderId → record из Analytics API (goods-return) с кэшированием и retry при 429
 *
 * @param {string} wbToken - WB API token
 * @param {function} [log] - функция логирования
 * @param {function} [onWait] - callback(waitSec, attempt) при ожидании retry
 * @returns {Promise<Map<string, Object>>}
 */
async function getWBAnalyticsReturnsMap(wbToken, log = console.log, onWait = null) {
  const now = Date.now()

  // ── 1. Кэш свежий — отдаём мгновенно ──
  if (wbAnalyticsReturnsCache.byOrderId && (now - wbAnalyticsReturnsCache.fetchedAt) < WB_ANALYTICS_CACHE_TTL) {
    log(`[WB Analytics] HIT (${Math.round((now - wbAnalyticsReturnsCache.fetchedAt) / 1000)}s old, ${wbAnalyticsReturnsCache.byOrderId.size} records)`)
    return wbAnalyticsReturnsCache.byOrderId
  }

  // ── 2. Уже кто-то другой запрашивает — используем то что есть ──
  if (wbAnalyticsReturnsCache.isFetching) {
    log('[WB Analytics] concurrent fetch in progress, using stale cache')
    if (wbAnalyticsReturnsCache.byOrderId) return wbAnalyticsReturnsCache.byOrderId
    // Нет кэша — ждём до 10с
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 1000))
      if (!wbAnalyticsReturnsCache.isFetching) break
    }
    if (wbAnalyticsReturnsCache.byOrderId) return wbAnalyticsReturnsCache.byOrderId
  }

  // ── 3. Фетчим (или обновляем кэш) ──
  wbAnalyticsReturnsCache.isFetching = true

  try {
    // Форматируем дату как YYYY-MM-DD
    const fmtDate = (d) => {
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      return `${y}-${m}-${day}`
    }

    const today = new Date()

    if (!wbAnalyticsReturnsCache.lastDate) {
      // ── Первая загрузка: 1 диапазон — последние 120 дней ──
      log('[WB Analytics] first load: fetching 1 range covering last 120 days...')

      const ranges = [
        {
          from: fmtDate(new Date(today.getTime() - 120 * 86400000)),
          to:   fmtDate(today)
        }
      ]

      let rangeRetryCount = 0
      const MAX_RANGE_RETRIES = 3 // доп. попытки для всего диапазона при пустом кэше
      for (let rIdx = 0; rIdx < ranges.length; rIdx++) {
        const { from, to } = ranges[rIdx]
        log(`[WB Analytics] range ${rIdx + 1}/${ranges.length}: ${from} → ${to}`)

        const rangePath = `/api/v1/analytics/goods-return?dateFrom=${encodeURIComponent(from)}&dateTo=${encodeURIComponent(to)}`

        let lastError = null
        let success = false

        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            log(`[WB Analytics] fetching range ${rIdx + 1} (attempt ${attempt}/3)...`)

            const res = await wbOzonSync.makeRequest({
              hostname: 'seller-analytics-api.wildberries.ru',
              path: rangePath,
              method: 'GET',
              headers: { 'Authorization': wbToken }
            })

            if (res.status === 200 && res.body && Array.isArray(res.body.report)) {
              mergeAnalyticsRecords(res.body.report, log, to)
              success = true
              break // успех — выходим из retry-цикла
            }

            if (res.status === 429) {
              // Экспоненциальный backoff: 60с → 120с → 240с
              const backoffSec = 60 * Math.pow(2, attempt - 1)
              log(`[WB Analytics] rate limited (429) on range ${rIdx + 1}, attempt ${attempt}/3, waiting ${backoffSec}s (exponential backoff)`)

              // Если есть просроченный кэш — отдаём его
              if (wbAnalyticsReturnsCache.byOrderId) {
                log(`[WB Analytics] 429 but have stale cache (${wbAnalyticsReturnsCache.byOrderId.size} records), returning immediately`)
                wbAnalyticsReturnsCache.fetchedAt = Date.now()
                wbAnalyticsReturnsCache.isFetching = false
                try { fs.writeFileSync(WB_ANALYTICS_CACHE_FILE, JSON.stringify({ data: wbAnalyticsReturnsCache.data, lastDate: wbAnalyticsReturnsCache.lastDate, fetchedAt: wbAnalyticsReturnsCache.fetchedAt })) } catch (e) { log(`[WB Analytics] disk save error: ${e.message}`) }
                return wbAnalyticsReturnsCache.byOrderId
              }

              // Экспоненциальный backoff с onWait
              if (attempt < 3) {
                if (onWait) onWait(backoffSec, attempt)
                await new Promise(r => setTimeout(r, backoffSec * 1000))
                continue
              }
              // Третья попытка — тоже 429, выходим
              log(`[WB Analytics] rate limited (429) on range ${rIdx + 1} after ${attempt} attempts, giving up`)
              lastError = new Error(`WB Analytics rate limited (429) after ${attempt} attempts`)
              break
            }

            // Другие ошибки
            if (attempt < 3) {
              log(`[WB Analytics] attempt ${attempt}/3 failed: status ${res.status}, retrying...`)
              await new Promise(r => setTimeout(r, 1000))
              continue
            }
            lastError = new Error(`WB Analytics API error: status ${res.status}`)
          } catch (e) {
            lastError = e
            if (attempt < 3) {
              log(`[WB Analytics] attempt ${attempt}/3 error: ${e.message}, retrying...`)
              await new Promise(r => setTimeout(r, 1000))
              continue
            }
          }
        }

        if (!success) {
          // Если есть просроченный кэш — отдаём его
          if (wbAnalyticsReturnsCache.byOrderId) {
            log(`[WB Analytics] range ${rIdx + 1} failed, using stale cache (${wbAnalyticsReturnsCache.byOrderId.size} records)`)
            wbAnalyticsReturnsCache.fetchedAt = Date.now()
            wbAnalyticsReturnsCache.isFetching = false
            return wbAnalyticsReturnsCache.byOrderId
          }
          // Если нет кэша и рейт-лимит — пробуем с большим backoff вместо возврата пустоты
          if (lastError && lastError.message.includes('rate limited')) {
            if (rangeRetryCount < MAX_RANGE_RETRIES) {
              rangeRetryCount++
              log(`[WB Analytics] rate limited with empty cache — retry ${rangeRetryCount}/${MAX_RANGE_RETRIES} for range ${rIdx + 1} with extra 120s backoff...`)
              await new Promise(r => setTimeout(r, 120000))
              // Повторяем retry-цикл для этого же диапазона
              rIdx--
              continue
            }
            log(`[WB Analytics] rate limited with empty cache — max range retries (${MAX_RANGE_RETRIES}) exhausted, returning empty`)
            wbAnalyticsReturnsCache.isFetching = false
            return new Map()
          }
          throw lastError || new Error(`WB Analytics: range ${rIdx + 1} failed after 3 attempts`)
        }

        // ── Пауза 75с между запросами (кроме последнего) ──
        if (rIdx < ranges.length - 1) {
          log(`[WB Analytics] waiting 75s before next range request...`)
          await new Promise(r => setTimeout(r, 75000))
        }
      }

      // Все 3 диапазона успешно загружены
      wbAnalyticsReturnsCache.isFetching = false
      log(`[WB Analytics] first load complete: ${wbAnalyticsReturnsCache.data?.length ?? 0} records, lastDate=${wbAnalyticsReturnsCache.lastDate}`)
      return wbAnalyticsReturnsCache.byOrderId || new Map()
    }

    // ── Инкрементальная загрузка (есть lastDate) — 1 запрос ──
    const dateFrom = wbAnalyticsReturnsCache.lastDate
    const dateTo = fmtDate(today)
    const path = `/api/v1/analytics/goods-return?dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`

    log(`[WB Analytics] incremental fetch: ${dateFrom} → ${dateTo}`)

    for (let attempt = 1; attempt <= 3; attempt++) {
      log(`[WB Analytics] fetching (attempt ${attempt}/3)...`)

      const res = await wbOzonSync.makeRequest({
        hostname: 'seller-analytics-api.wildberries.ru',
        path,
        method: 'GET',
        headers: { 'Authorization': wbToken }
      })

      if (res.status === 200 && res.body && Array.isArray(res.body.report)) {
        if (res.body.report.length === 0) {
          log(`[WB Analytics] no new data (empty report), cache is current (${wbAnalyticsReturnsCache.byOrderId?.size ?? 0} records)`)
          wbAnalyticsReturnsCache.fetchedAt = Date.now()
          wbAnalyticsReturnsCache.isFetching = false
          try {
            fs.writeFileSync(WB_ANALYTICS_CACHE_FILE, JSON.stringify({
              data: wbAnalyticsReturnsCache.data,
              lastDate: wbAnalyticsReturnsCache.lastDate,
              fetchedAt: wbAnalyticsReturnsCache.fetchedAt
            }))
          } catch (e) { log(`[WB Analytics] disk save error: ${e.message}`) }
          return wbAnalyticsReturnsCache.byOrderId || new Map()
        }

        mergeAnalyticsRecords(res.body.report, log, dateTo)

        wbAnalyticsReturnsCache.isFetching = false
        log(`[WB Analytics] incremental update: merged ${res.body.report.length} records → total ${wbAnalyticsReturnsCache.data.length} records, lastDate=${wbAnalyticsReturnsCache.lastDate}`)
        return wbAnalyticsReturnsCache.byOrderId
      }

      if (res.status === 429) {
        // Экспоненциальный backoff: 60с → 120с → 240с
        const backoffSec = 60 * Math.pow(2, attempt - 1)
        log(`[WB Analytics] rate limited (429), attempt ${attempt}/3, waiting ${backoffSec}s (exponential backoff)`)

        if (wbAnalyticsReturnsCache.byOrderId) {
          log(`[WB Analytics] 429 but have stale cache, returning immediately`)
          wbAnalyticsReturnsCache.fetchedAt = Date.now()
          wbAnalyticsReturnsCache.isFetching = false
          try { fs.writeFileSync(WB_ANALYTICS_CACHE_FILE, JSON.stringify({ data: wbAnalyticsReturnsCache.data, lastDate: wbAnalyticsReturnsCache.lastDate, fetchedAt: wbAnalyticsReturnsCache.fetchedAt })) } catch (e) { log(`[WB Analytics] disk save error: ${e.message}`) }
          return wbAnalyticsReturnsCache.byOrderId
        }

        if (attempt < 3) {
          if (onWait) onWait(backoffSec, attempt)
          await new Promise(r => setTimeout(r, backoffSec * 1000))
          continue
        }
        // Третья попытка — тоже 429, выходим с тем что есть
        log(`[WB Analytics] rate limited (429) after ${attempt} attempts, returning stale cache or empty`)
        wbAnalyticsReturnsCache.fetchedAt = Date.now()
        wbAnalyticsReturnsCache.isFetching = false
        if (wbAnalyticsReturnsCache.byOrderId) {
          try { fs.writeFileSync(WB_ANALYTICS_CACHE_FILE, JSON.stringify({ data: wbAnalyticsReturnsCache.data, lastDate: wbAnalyticsReturnsCache.lastDate, fetchedAt: wbAnalyticsReturnsCache.fetchedAt })) } catch (e) { log(`[WB Analytics] disk save error: ${e.message}`) }
        }
        return wbAnalyticsReturnsCache.byOrderId || new Map()
      } else {
        log(`[WB Analytics] unexpected status ${res.status} — not retrying`)
        break
      }
    }

    // Все попытки исчерпаны — отдаём просроченный кэш
    if (wbAnalyticsReturnsCache.byOrderId) {
      log(`[WB Analytics] all attempts failed, using stale cache (${wbAnalyticsReturnsCache.byOrderId.size} records)`)
      wbAnalyticsReturnsCache.isFetching = false
      return wbAnalyticsReturnsCache.byOrderId
    }

    log(`[WB Analytics] all attempts failed, returning empty`)
    wbAnalyticsReturnsCache.isFetching = false
    return new Map()
  } catch (e) {
    wbAnalyticsReturnsCache.isFetching = false
    log(`[WB Analytics] fetch error: ${e.message}`, 'error')
    throw e
  }
}

/**
 * Получить rid → order + nmId → orders[] из Маркетплейс API (api/v3/orders)
 *
 * @param {string} wbToken - WB API token
 * @param {function} [log] - функция логирования
 * @param {function} [onWait] - callback(waitSec, attempt) при ожидании retry
 * @returns {Promise<{byRid: Map<string, Object>, byNmId: Map<string, Object[]>, byId: Map<string, Object>}>}
 */
async function getWBOrdersMap(wbToken, log = console.log, onWait = null) {
  const now = Date.now()

  // 1. Кэш свежий — отдаём мгновенно
  if (wbOrdersCache.byRid && (now - wbOrdersCache.fetchedAt) < WB_ORDERS_CACHE_TTL) {
    log(`[WB Orders] HIT (${Math.round((now - wbOrdersCache.fetchedAt) / 1000)}s old, ${wbOrdersCache.byRid.size} rids, ${wbOrdersCache.byId?.size || 0} ids)`)
    return { byRid: wbOrdersCache.byRid, byNmId: wbOrdersCache.byNmId, byId: wbOrdersCache.byId }
  }

  // 2. Уже кто-то другой запрашивает — используем то что есть
  if (wbOrdersCache.isFetching) {
    log('[WB Orders] concurrent fetch in progress, using stale cache')
    if (wbOrdersCache.byRid) return { byRid: wbOrdersCache.byRid, byNmId: wbOrdersCache.byNmId, byId: wbOrdersCache.byId }
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 1000))
      if (!wbOrdersCache.isFetching) break
    }
    if (wbOrdersCache.byRid) return { byRid: wbOrdersCache.byRid, byNmId: wbOrdersCache.byNmId, byId: wbOrdersCache.byId }
  }

  // 3. Фетчим с пагинацией
  wbOrdersCache.isFetching = true

  try {
    const MAX_PAGES = 50 // защита от бесконечного цикла (next — курсор-заказ, не номер страницы)
    let allOrders = []
    let next = 0
    let total = 0
    let hasMore = true
    let pageCount = 0
    let sameNextCount = 0
    let lastNext = 0

    while (hasMore) {
      pageCount++
      const path = `/api/v3/orders?limit=1000&next=${next}`

      if (pageCount > MAX_PAGES) {
        log(`[WB Orders] max pages (${MAX_PAGES}) reached, stopping pagination (got ${allOrders.length}/${total} orders)`)
        break
      }

      let pageSuccess = false
      for (let attempt = 1; attempt <= 3; attempt++) {
        log(`[WB Orders] fetching page ${pageCount} (next=${next}) attempt ${attempt}/3...`)

        const res = await wbOzonSync.makeRequest({
          hostname: 'marketplace-api.wildberries.ru',
          path,
          method: 'GET',
          headers: { 'Authorization': wbToken }
        })

        if (res.status === 200 && res.body && Array.isArray(res.body.orders)) {
          // Проверка: если next не меняется несколько страниц — курсор залип, выходим
          if (res.body.next && res.body.next === lastNext && res.body.orders.length <= 1) {
            sameNextCount++
          } else {
            sameNextCount = 0
          }
          if (sameNextCount >= 5) {
            log(`[WB Orders] next cursor stuck (${sameNextCount} pages with same next=${lastNext}), stopping pagination`)
            hasMore = false
            break
          }

          allOrders = allOrders.concat(res.body.orders)
          total = res.body.total || allOrders.length
          lastNext = res.body.next || 0
          next = lastNext
          hasMore = next > 0 && allOrders.length < total
          pageSuccess = true
          log(`[WB Orders] page ${pageCount}: got ${res.body.orders.length} orders, next=${next}, total=${total}`)
          break // success, exit retry loop
        }

        if (res.status === 429) {
          const retrySec = parseInt(res.headers?.['x-ratelimit-retry'] || res.headers?.['x-ratelimit-reset'], 10) || 60
          log(`[WB Orders] rate limited (429), attempt ${attempt}/3, waiting ${retrySec}s`)

          if (wbOrdersCache.byRid) {
            log(`[WB Orders] 429 but have stale cache, returning immediately`)
            wbOrdersCache.fetchedAt = Date.now()
            wbOrdersCache.isFetching = false
            try { fs.writeFileSync(WB_ORDERS_CACHE_FILE, JSON.stringify({ data: wbOrdersCache.data, fetchedAt: wbOrdersCache.fetchedAt })) } catch (e) { log(`[WB Orders] disk save error: ${e.message}`) }
            return { byRid: wbOrdersCache.byRid, byNmId: wbOrdersCache.byNmId, byId: wbOrdersCache.byId }
          }

          if (onWait) onWait(retrySec, attempt)
          await new Promise(r => setTimeout(r, retrySec * 1000))
          continue
        }

        if (attempt < 3) {
          log(`[WB Orders] attempt ${attempt}/3 failed: ${res.status} ${res.statusText}, retrying...`)
          await new Promise(r => setTimeout(r, 1000))
          continue
        }
        throw new Error(`WB Orders API error: ${res.status} ${res.statusText}`)
      }

      if (!pageSuccess) break // retries exhausted
    }

    // ── Сохраняем в кэш: MERGE + PURGE 120дн ──

    // Запоминаем XLSX-импортированные записи, чтобы не потерять их после мержа
    const xlsxRecords = (wbOrdersCache.data || []).filter(r => r._source === 'xlsx')

    // MERGE: upsert по id (как WB Sales)
    if (wbOrdersCache.data === null) {
      // Первый запуск — сохраняем что дал API
      wbOrdersCache.data = allOrders
      log(`[WB Orders] first launch: initialized with ${allOrders.length} orders`)
    } else {
      const before = wbOrdersCache.data.length
      const existing = new Set(wbOrdersCache.data.map(r => r.id))
      let added = 0, updated = 0
      for (const order of allOrders) {
        if (order.id && existing.has(order.id)) {
          const idx = wbOrdersCache.data.findIndex(r => r.id === order.id)
          if (idx !== -1) { wbOrdersCache.data[idx] = order; updated++ }
        } else if (order.id) {
          wbOrdersCache.data.push(order)
          existing.add(order.id)
          added++
        }
      }
      log(`[WB Orders] merged ${allOrders.length} API records → ${added} added, ${updated} updated (was ${before}, now ${wbOrdersCache.data.length})`)
    }

    // PURGE 120 дней по createdAt
    const cutoff = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString()
    const beforePurge = wbOrdersCache.data.length
    let noDateCount = 0
    wbOrdersCache.data = wbOrdersCache.data.filter(r => {
      if (!r.createdAt) { noDateCount++; return true }
      return r.createdAt >= cutoff
    })
    const purged = beforePurge - wbOrdersCache.data.length
    if (purged > 0) log(`[WB Orders] purged ${purged} records older than 120 days`)
    if (noDateCount > 0) log(`[WB Orders] ${noDateCount} records without createdAt — preserved`)

    // Восстанавливаем XLSX (только если их нет в обновлённых данных)
    if (xlsxRecords.length > 0) {
      let restored = 0
      for (const xr of xlsxRecords) {
        const xid = String(xr.id)
        if (wbOrdersCache.data.some(r => String(r.id) === xid)) continue
        wbOrdersCache.data.push(xr)
        restored++
      }
      if (restored > 0) log(`[WB Orders] restored ${restored} XLSX-imported records`)
    }

    // Перестраиваем byRid, byNmId, byId из wbOrdersCache.data
    wbOrdersCache.byRid = new Map()
    wbOrdersCache.byNmId = new Map()
    wbOrdersCache.byId = new Map()
    for (const order of wbOrdersCache.data) {
      if (order.rid) wbOrdersCache.byRid.set(order.rid, order)
      const nmId = String(order.nmId || '')
      if (nmId) {
        if (!wbOrdersCache.byNmId.has(nmId)) wbOrdersCache.byNmId.set(nmId, [])
        wbOrdersCache.byNmId.get(nmId).push(order)
      }
      if (order.id) wbOrdersCache.byId.set(String(order.id), order)
    }

    wbOrdersCache.fetchedAt = Date.now()

    // Сохраняем на диск
    try {
      fs.writeFileSync(WB_ORDERS_CACHE_FILE, JSON.stringify({
        data: wbOrdersCache.data,
        fetchedAt: wbOrdersCache.fetchedAt
      }))
      log(`[WB Orders] saved to disk: ${wbOrdersCache.data.length} orders`)
    } catch (e) {
      log(`[WB Orders] disk save error: ${e.message}`)
    }

    wbOrdersCache.isFetching = false
    log(`[WB Orders] fetch complete: ${wbOrdersCache.data.length} orders total, ${wbOrdersCache.byRid.size} rids, ${wbOrdersCache.byNmId.size} nmIds, ${wbOrdersCache.byId.size} ids`)
    return { byRid: wbOrdersCache.byRid, byNmId: wbOrdersCache.byNmId, byId: wbOrdersCache.byId }

  } catch (e) {
    wbOrdersCache.isFetching = false
    log(`[WB Orders] fetch error: ${e.message}`, 'error')
    if (wbOrdersCache.byRid) {
      log(`[WB Orders] returning stale cache after error`)
      wbOrdersCache.fetchedAt = Date.now()
      try { fs.writeFileSync(WB_ORDERS_CACHE_FILE, JSON.stringify({ data: wbOrdersCache.data, fetchedAt: wbOrdersCache.fetchedAt })) } catch (e2) { log(`[WB Orders] disk save error: ${e2.message}`) }
      return { byRid: wbOrdersCache.byRid, byNmId: wbOrdersCache.byNmId, byId: wbOrdersCache.byId }
    }
    return { byRid: new Map(), byNmId: new Map(), byId: new Map() }
  }
}

/**
 * Получить srid → sticker из statistics-api (supplier/orders)
 *
 * @param {string} wbToken - WB API token
 * @param {function} [log] - функция логирования
 * @param {function} [onWait] - callback(waitSec, attempt) при ожидании retry
 * @returns {Promise<Map<string, string>>} Map<srid, sticker>
 */
async function getWBOrdersStickersMap(wbToken, log = console.log, onWait = null) {
  const now = Date.now()

  // 1. Кэш свежий — отдаём мгновенно
  if (wbOrdersStickersCache.bySrid && (now - wbOrdersStickersCache.fetchedAt) < WB_ORDERS_STICKERS_CACHE_TTL) {
    log(`[WB Orders Stickers] HIT (${Math.round((now - wbOrdersStickersCache.fetchedAt) / 1000)}s old, ${wbOrdersStickersCache.bySrid.size} srids)`)
    return wbOrdersStickersCache.bySrid
  }

  // 2. Уже кто-то другой запрашивает
  if (wbOrdersStickersCache.isFetching) {
    log('[WB Orders Stickers] concurrent fetch in progress, using stale cache')
    if (wbOrdersStickersCache.bySrid) return wbOrdersStickersCache.bySrid
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 1000))
      if (!wbOrdersStickersCache.isFetching) break
    }
    if (wbOrdersStickersCache.bySrid) return wbOrdersStickersCache.bySrid
  }

  // 3. Фетчим
  wbOrdersStickersCache.isFetching = true

  try {
    const dateFrom = wbOrdersStickersCache.lastDate
      ? wbOrdersStickersCache.lastDate
      : new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    const path = `/api/v1/supplier/orders?dateFrom=${encodeURIComponent(dateFrom)}&flag=0`

    for (let attempt = 1; attempt <= 3; attempt++) {
      log(`[WB Orders Stickers] fetching (attempt ${attempt}/3)...`)

      const res = await wbOzonSync.makeRequest({
        hostname: 'statistics-api.wildberries.ru',
        path,
        method: 'GET',
        headers: { 'Authorization': wbToken }
      })

      if (res.status === 200 && Array.isArray(res.body)) {
        if (res.body.length === 0) {
          log(`[WB Orders Stickers] no new data, cache is current`)
          wbOrdersStickersCache.fetchedAt = Date.now()
          wbOrdersStickersCache.isFetching = false
          // Сохраняем обновлённый fetchedAt
          try {
            fs.writeFileSync(WB_ORDERS_STICKERS_CACHE_FILE, JSON.stringify({
              data: wbOrdersStickersCache.data,
              lastDate: wbOrdersStickersCache.lastDate,
              fetchedAt: wbOrdersStickersCache.fetchedAt
            }))
          } catch (e) { log(`[WB Orders Stickers] disk save error: ${e.message}`) }
          return wbOrdersStickersCache.bySrid || new Map()
        }

        // Merge/rebuild
        if (wbOrdersStickersCache.data === null) {
          wbOrdersStickersCache.data = res.body
        } else {
          const existing = new Set(wbOrdersStickersCache.data.map(r => r.srid))
          for (const record of res.body) {
            if (record.srid && existing.has(record.srid)) {
              const idx = wbOrdersStickersCache.data.findIndex(r => r.srid === record.srid)
              if (idx !== -1) wbOrdersStickersCache.data[idx] = record
            } else if (record.srid) {
              wbOrdersStickersCache.data.push(record)
              existing.add(record.srid)
            }
          }
        }

        // Update lastDate
        const lastDate = res.body.reduce((max, r) => {
          if (r.lastChangeDate && (!max || r.lastChangeDate > max)) return r.lastChangeDate
          return max
        }, null)
        if (lastDate && (!wbOrdersStickersCache.lastDate || lastDate > wbOrdersStickersCache.lastDate)) {
          wbOrdersStickersCache.lastDate = lastDate
        }

        // Purge records older than 120 days by lastChangeDate
        const cutoff = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString()
        const before = wbOrdersStickersCache.data.length
        wbOrdersStickersCache.data = wbOrdersStickersCache.data.filter(r => r.lastChangeDate && r.lastChangeDate >= cutoff)
        if (before !== wbOrdersStickersCache.data.length) {
          log(`[WB Orders Stickers] purged ${before - wbOrdersStickersCache.data.length} records older than 120 days`)
        }

        // Build bySrid: srid → sticker
        wbOrdersStickersCache.bySrid = new Map()
        for (const record of wbOrdersStickersCache.data) {
          if (record.srid && record.sticker) {
            wbOrdersStickersCache.bySrid.set(record.srid, record.sticker)
          }
        }

        wbOrdersStickersCache.fetchedAt = Date.now()
        wbOrdersStickersCache.isFetching = false

        // Save to disk
        try {
          fs.writeFileSync(WB_ORDERS_STICKERS_CACHE_FILE, JSON.stringify({
            data: wbOrdersStickersCache.data,
            lastDate: wbOrdersStickersCache.lastDate,
            fetchedAt: wbOrdersStickersCache.fetchedAt
          }))
          log(`[WB Orders Stickers] saved to disk: ${wbOrdersStickersCache.data.length} records`)
        } catch (e) {
          log(`[WB Orders Stickers] disk save error: ${e.message}`)
        }

        log(`[WB Orders Stickers] complete: ${wbOrdersStickersCache.bySrid.size} srid→sticker mappings, lastDate=${wbOrdersStickersCache.lastDate}`)
        return wbOrdersStickersCache.bySrid
      }

      if (res.status === 429) {
        const retrySec = parseInt(res.headers?.['x-ratelimit-retry'] || res.headers?.['x-ratelimit-reset'], 10) || 60
        log(`[WB Orders Stickers] rate limited (429), attempt ${attempt}/3, waiting ${retrySec}s`)

        if (wbOrdersStickersCache.bySrid) {
          log(`[WB Orders Stickers] 429 but have stale cache, returning immediately`)
          wbOrdersStickersCache.fetchedAt = Date.now()
          wbOrdersStickersCache.isFetching = false
          try { fs.writeFileSync(WB_ORDERS_STICKERS_CACHE_FILE, JSON.stringify({ data: wbOrdersStickersCache.data, lastDate: wbOrdersStickersCache.lastDate, fetchedAt: wbOrdersStickersCache.fetchedAt })) } catch (e) { log(`[WB Orders Stickers] disk save error: ${e.message}`) }
          return wbOrdersStickersCache.bySrid
        }

        if (onWait) onWait(retrySec, attempt)
        await new Promise(r => setTimeout(r, retrySec * 1000))
        continue
      }

      if (attempt < 3) {
        log(`[WB Orders Stickers] attempt ${attempt}/3 failed: ${res.status} ${res.statusText}, retrying...`)
        await new Promise(r => setTimeout(r, 1000))
        continue
      }
      throw new Error(`WB Orders Stickers API error: ${res.status} ${res.statusText}`)
    }
  } catch (e) {
    wbOrdersStickersCache.isFetching = false
    log(`[WB Orders Stickers] error: ${e.message}`, 'error')
    if (wbOrdersStickersCache.bySrid) {
      wbOrdersStickersCache.fetchedAt = Date.now()
      try { fs.writeFileSync(WB_ORDERS_STICKERS_CACHE_FILE, JSON.stringify({ data: wbOrdersStickersCache.data, lastDate: wbOrdersStickersCache.lastDate, fetchedAt: wbOrdersStickersCache.fetchedAt })) } catch (e2) { log(`[WB Orders Stickers] disk save error: ${e2.message}`) }
      return wbOrdersStickersCache.bySrid
    }
    return new Map()
  }

  wbOrdersStickersCache.isFetching = false
  return wbOrdersStickersCache.bySrid || new Map()
}

/**
 * Объединяет записи аналитики возвратов и продаж WB по ключу orderId/sticker.
 *
 * @param {Map<string, Object>} analyticsMap — wbAnalyticsReturnsCache.byOrderId
 * @param {Map<string, Object>} salesMap — wbSalesCache.bySticker
 * @returns {Map<string, Object>} объединённая карта: ключ = orderId/sticker
 */
function mergeAnalyticsAndSales(analyticsMap, salesMap) {
  const merged = new Map()

  // Проходим по всем записям аналитики (они — основной источник для возвратов)
  for (const [orderId, analyticsRecord] of analyticsMap) {
    const salesRecord = salesMap.get(String(orderId))
    merged.set(String(orderId), {
      // Из аналитики (все поля raw-записи API analytics/goods-return)
      orderId: analyticsRecord.orderId,
      stickerId: analyticsRecord.stickerId || '',
      nmId: analyticsRecord.nmId || analyticsRecord.nmId,
      barcode: analyticsRecord.barcode || '',
      shkId: analyticsRecord.shkId || '',
      srid: analyticsRecord.srid || '',
      returnType: analyticsRecord.returnType || '',
      reason: analyticsRecord.reason || '',
      status: analyticsRecord.status || '',
      completedDt: analyticsRecord.completedDt || '',
      orderDt: analyticsRecord.orderDt || '',
      readyToReturnDt: analyticsRecord.readyToReturnDt || '',
      subjectName: analyticsRecord.subjectName || '',
      brand: analyticsRecord.brand || '',
      techSize: analyticsRecord.techSize || '',
      dstOfficeAddress: analyticsRecord.dstOfficeAddress || '',
      dstOfficeId: analyticsRecord.dstOfficeId || '',
      // Из продаж (если есть запись с таким sticker) — дополняем
      ...(salesRecord && {
        totalPrice: salesRecord.totalPrice || 0,
        forPay: salesRecord.forPay || 0,
        salesDate: salesRecord.date || '',
        lastChangeDate: salesRecord.lastChangeDate || '',
        salesNmId: salesRecord.nmId || '',
        saleID: salesRecord.saleID || ''
      })
    })
  }

  // Добавляем записи из продаж, которых нет в аналитике (возврат без аналитики)
  for (const [sticker, salesRecord] of salesMap) {
    if (!merged.has(String(sticker))) {
      merged.set(String(sticker), {
        orderId: sticker,
        stickerId: '',
        nmId: salesRecord.nmId || '',
        barcode: salesRecord.barcode || '',
        shkId: '',
        srid: salesRecord.srid || '',
        returnType: '',
        reason: '',
        status: '',
        completedDt: '',
        orderDt: '',
        readyToReturnDt: '',
        subjectName: '',
        brand: '',
        techSize: '',
        dstOfficeAddress: '',
        dstOfficeId: '',
        supplierArticle: salesRecord.supplierArticle || '',
        sticker: salesRecord.sticker || '',
        totalPrice: salesRecord.totalPrice || 0,
        forPay: salesRecord.forPay || 0,
        salesDate: salesRecord.date || '',
        lastChangeDate: salesRecord.lastChangeDate || '',
        salesNmId: salesRecord.nmId || '',
        saleID: salesRecord.saleID || ''
      })
    }
  }

  return merged
}

// ═══════════════════════════════════════════════════════════════════
// Public API — wrapper functions
// ═══════════════════════════════════════════════════════════════════

/**
 * Search ALL WB caches for a number (instant, no API calls).
 *
 * Searches in order:
 * 1. wbOrdersCache.byId by id
 * 2. wbOrdersCache.data by skus
 * 3. mergedMap (analytics+sales) by sticker/orderId
 * 4. wbSalesCache.bySticker by sticker/barcode
 * 5. wbOrdersStickersCache.bySrid by sticker value
 *
 * @param {string|number} code - search key (order number, sticker, barcode, etc.)
 * @returns {Object|null} found record or null
 */
function findInCache(code) {
  const mergedMap = mergeAnalyticsAndSales(
    wbAnalyticsReturnsCache.byOrderId || new Map(),
    wbSalesCache.bySticker || new Map()
  )
  const salesMap = wbSalesCache.bySticker || new Map()
  const stickersBySrid = wbOrdersStickersCache.bySrid || new Map()

  // Step 1: marketplace by id
  const ordersById = wbOrdersCache.byId || new Map()
  if (ordersById.size > 0) {
    const mpRecord = ordersById.get(String(code))
    if (mpRecord) {
      // Cross-reference: rid → sticker → forPay
      let forPay = 0
      if (mpRecord.rid) {
        const sticker = stickersBySrid.get(mpRecord.rid)
        if (sticker) {
          const salesRec = salesMap.get(String(sticker))
          if (salesRec && salesRec.forPay) forPay = salesRec.forPay
        }
        // Fallback: если sticker пустой или не найден — ищем по srid напрямую
        if (!forPay) {
          for (const [, sr] of salesMap) {
            if (sr.srid === mpRecord.rid && sr.forPay) { forPay = sr.forPay; break }
          }
        }
      }
      // Дополнительно: ищем в mergedMap (аналитика+продажи) по id заказа
      // чтобы получить returnType, reason, barcode, shkId, stickerId, forPay
      let mergedRecord = mergedMap.get(String(mpRecord.id))
      if (!mergedRecord) {
        for (const [, r] of mergedMap) {
          if (String(r.orderId) === String(mpRecord.id)) { mergedRecord = r; break }
        }
      }
      if (mergedRecord && !forPay && mergedRecord.forPay) forPay = mergedRecord.forPay
      return {
        orderId: String(mpRecord.id),
        nmId: String(mpRecord.nmId || ''),
        srid: mpRecord.rid || '',
        totalPrice: (mpRecord.price || 0) / 100,
        forPay: forPay,
        barcode: mergedRecord?.barcode || '',
        shkId: mergedRecord?.shkId || '',
        stickerId: mergedRecord?.stickerId || '',
        completedDt: mpRecord.createdAt || '',
        orderDt: mergedRecord?.orderDt || '',
        returnType: mergedRecord?.returnType || '',
        reason: mergedRecord?.reason || '',
        status: mergedRecord?.status || '',
        lastChangeDate: mergedRecord?.lastChangeDate || mpRecord.createdAt || '',
        subjectName: mergedRecord?.subjectName || '',
        _source: 'marketplaceById'
      }
    }
  }

  // Step 2: marketplace by skus
  if (wbOrdersCache.data) {
    for (const order of wbOrdersCache.data) {
      if (order.skus && Array.isArray(order.skus) && order.skus.some(sku => String(sku) === String(code))) {
        // Cross-reference: rid → sticker → forPay
        let forPay = 0
        if (order.rid) {
          const sticker = stickersBySrid.get(order.rid)
          if (sticker) {
            const salesRec = salesMap.get(String(sticker))
            if (salesRec && salesRec.forPay) forPay = salesRec.forPay
          }
          // Fallback: если sticker пустой или не найден — ищем по srid напрямую
          if (!forPay) {
            for (const [, sr] of salesMap) {
              if (sr.srid === order.rid && sr.forPay) { forPay = sr.forPay; break }
            }
          }
        }
        return {
          orderId: String(order.id),
          nmId: String(order.nmId || ''),
          srid: order.rid || '',
          totalPrice: (order.price || 0) / 100,
          forPay: forPay,
          barcode: '',
          shkId: '',
          stickerId: '',
          completedDt: order.createdAt || '',
          orderDt: '',
          returnType: '',
          reason: '',
          status: '',
          lastChangeDate: order.createdAt || '',
          subjectName: '',
          _source: 'marketplaceBySkus'
        }
      }
    }
  }

  // Step 3: mergedMap by sticker/orderId
  if (mergedMap && mergedMap.size > 0) {
    let record = mergedMap.get(String(code))
    if (!record) {
      for (const [, r] of mergedMap) {
        if (String(r.stickerId) === String(code) || String(r.orderId) === String(code)) {
          record = r
          break
        }
      }
    }
    if (record) {
      // Если mergedMap-запись без totalPrice/forPay — докросс-реферим цену из маркетплейса
      if (!record.totalPrice && !record.forPay) {
        const ordersById = wbOrdersCache.byId || new Map()
        const mpOrder = ordersById.get(String(record.orderId))
        if (mpOrder && mpOrder.price) {
          record = { ...record, totalPrice: mpOrder.price / 100, forPay: mpOrder.price / 100 }
        }
      }
      return { ...record, _source: 'mergedMap' }
    }
  }

  // Step 4: salesMap by sticker/barcode
  if (salesMap && salesMap.size > 0) {
    let salesRecord = salesMap.get(String(code))
    if (!salesRecord) {
      for (const [, sr] of salesMap) {
        if (String(sr.sticker) === String(code) || String(sr.barcode) === String(code)) {
          salesRecord = sr
          break
        }
      }
    }
    if (salesRecord) {
      return {
        orderId: salesRecord.sticker || code,
        nmId: salesRecord.nmId || '',
        srid: salesRecord.srid || '',
        totalPrice: salesRecord.totalPrice || 0,
        forPay: salesRecord.forPay || 0,
        barcode: salesRecord.barcode || '',
        shkId: '',
        stickerId: '',
        completedDt: salesRecord.lastChangeDate || salesRecord.date || '',
        orderDt: salesRecord.date || '',
        returnType: '',
        reason: '',
        status: '',
        lastChangeDate: salesRecord.lastChangeDate || '',
        subjectName: '',
        _source: 'salesMap'
      }
    }
  }

  // Step 5: stickersBySrid
  const ordersByRid = wbOrdersCache.byRid || new Map()
  for (const [srid, sticker] of stickersBySrid) {
    if (String(sticker) === String(code)) {
      // Cross-reference: sticker → forPay
      let forPay = 0
      const salesRec = salesMap.get(String(sticker))
      if (salesRec && salesRec.forPay) forPay = salesRec.forPay

      const marketOrder = ordersByRid.get(srid)
      return {
        orderId: marketOrder ? String(marketOrder.id) : String(sticker),
        nmId: marketOrder ? String(marketOrder.nmId || '') : '',
        srid: srid,
        totalPrice: marketOrder ? (marketOrder.price || 0) / 100 : 0,
        forPay: forPay,
        barcode: '',
        shkId: '',
        stickerId: String(sticker),
        completedDt: marketOrder ? marketOrder.createdAt || '' : '',
        orderDt: '',
        returnType: '',
        reason: '',
        status: '',
        lastChangeDate: '',
        subjectName: '',
        _source: 'stickersBySrid'
      }
    }
  }

  // Step 5a: search byRid by srid напрямую
  // (когда code = номер сборочного задания / WB rid, а не стикер)
  const orderByRid = ordersByRid.get(String(code))
  if (orderByRid) {
    const sticker = stickersBySrid.get(String(code))
    let forPay = 0
    if (sticker) {
      const salesRec = salesMap.get(String(sticker))
      if (salesRec && salesRec.forPay) forPay = salesRec.forPay
    }
    return {
      orderId: String(orderByRid.id),
      nmId: String(orderByRid.nmId || ''),
      srid: orderByRid.rid || '',
      totalPrice: (orderByRid.price || 0) / 100,
      forPay: forPay,
      barcode: orderByRid.skus?.[0] || '',
      shkId: '',
      stickerId: sticker ? String(sticker) : '',
      completedDt: orderByRid.createdAt || '',
      orderDt: '',
      returnType: '',
      reason: '',
      status: '',
      lastChangeDate: orderByRid.createdAt || '',
      subjectName: '',
      _source: 'byRid'
    }
  }

  // Step 6: поиск по order.id (номер сборочного задания / первый код WB)
  // когда code = 4987258576 — это первый код, а не стикер (второй код 49254739273)
  if (wbOrdersCache.data && Array.isArray(wbOrdersCache.data)) {
    for (const order of wbOrdersCache.data) {
      if (String(order.id) === String(code)) {
        let forPay = 0
        if (order.rid) {
          const sticker = stickersBySrid.get(order.rid)
          if (sticker) {
            const salesRec = salesMap.get(String(sticker))
            if (salesRec && salesRec.forPay) forPay = salesRec.forPay
          }
          if (!forPay) {
            for (const [, sr] of salesMap) {
              if (sr.srid === order.rid && sr.forPay) { forPay = sr.forPay; break }
            }
          }
        }
        // Дополнительно: ищем в mergedMap (аналитика+продажи) по id заказа
        // чтобы получить returnType, reason, barcode, shkId, stickerId, forPay
        let mergedRecord = mergedMap.get(String(order.id))
        if (!mergedRecord) {
          for (const [, r] of mergedMap) {
            if (String(r.orderId) === String(order.id)) { mergedRecord = r; break }
          }
        }
        if (mergedRecord && !forPay && mergedRecord.forPay) forPay = mergedRecord.forPay
        return {
          orderId: String(order.id),
          nmId: String(order.nmId || ''),
          srid: order.rid || '',
          totalPrice: (order.price || 0) / 100,
          forPay: forPay,
          barcode: mergedRecord?.barcode || (order.skus && order.skus.length > 0 ? String(order.skus[0]) : ''),
          shkId: mergedRecord?.shkId || '',
          stickerId: mergedRecord?.stickerId || '',
          completedDt: order.createdAt || '',
          orderDt: mergedRecord?.orderDt || '',
          returnType: mergedRecord?.returnType || '',
          reason: mergedRecord?.reason || '',
          status: mergedRecord?.status || '',
          lastChangeDate: mergedRecord?.lastChangeDate || order.createdAt || '',
          subjectName: mergedRecord?.subjectName || '',
          _source: 'marketplaceByOrderId'
        }
      }
    }
  }

  return null
}

/**
 * Refresh all expired WB caches (sales, analytics, orders, stickers).
 * Only refreshes caches that are past their TTL.
 *
 * @param {string} wbToken - WB API token
 * @param {function} [log] - функция логирования
 * @returns {Promise<{sales: Map|null, analytics: Map|null, orders: Object|null, stickers: Map|null}>}
 */
async function refreshIfStale(wbToken, log = console.log) {
  const now = Date.now()
  const results = {}

  const promises = []

  // Проверяем каждый кэш — если просрочен, обновляем
  if (!wbSalesCache.bySticker || (now - wbSalesCache.fetchedAt) >= WB_SALES_CACHE_TTL) {
    promises.push(
      getWBSalesMap(wbToken, log).then(m => { results.sales = m }).catch(e => { log(`WB cache: refreshIfStale sales error: ${e.message}`); results.sales = wbSalesCache.bySticker || new Map() })
    )
  }

  if (!wbAnalyticsReturnsCache.byOrderId || (now - wbAnalyticsReturnsCache.fetchedAt) >= WB_ANALYTICS_CACHE_TTL) {
    promises.push(
      getWBAnalyticsReturnsMap(wbToken, log).then(m => { results.analytics = m }).catch(e => { log(`WB cache: refreshIfStale analytics error: ${e.message}`); results.analytics = wbAnalyticsReturnsCache.byOrderId || new Map() })
    )
  }

  if (!wbOrdersCache.byRid || (now - wbOrdersCache.fetchedAt) >= WB_ORDERS_CACHE_TTL) {
    promises.push(
      getWBOrdersMap(wbToken, log).then(m => { results.orders = m }).catch(e => { log(`WB cache: refreshIfStale orders error: ${e.message}`); results.orders = wbOrdersCache.byRid ? { byRid: wbOrdersCache.byRid, byNmId: wbOrdersCache.byNmId, byId: wbOrdersCache.byId } : { byRid: new Map(), byNmId: new Map(), byId: new Map() } })
    )
  }

  if (!wbOrdersStickersCache.bySrid || (now - wbOrdersStickersCache.fetchedAt) >= WB_ORDERS_STICKERS_CACHE_TTL) {
    promises.push(
      getWBOrdersStickersMap(wbToken, log).then(m => { results.stickers = m }).catch(e => { log(`WB cache: refreshIfStale stickers error: ${e.message}`); results.stickers = wbOrdersStickersCache.bySrid || new Map() })
    )
  }

  await Promise.all(promises)

  return results
}

/**
 * Force refresh ALL WB caches regardless of TTL.
 *
 * @param {string} wbToken - WB API token
 * @param {function} [log] - функция логирования
 * @returns {Promise<{sales: Map|null, analytics: Map|null, orders: Object|null, stickers: Map|null}>}
 */
async function refreshAll(wbToken, log = console.log) {
  // Сбрасываем fetchedAt, чтобы принудительно обновить
  wbSalesCache.fetchedAt = 0
  wbAnalyticsReturnsCache.fetchedAt = 0
  wbOrdersCache.fetchedAt = 0
  wbOrdersStickersCache.fetchedAt = 0

  return refreshIfStale(wbToken, log)
}

/**
 * Return merged analytics+sales map from current caches (no API calls).
 *
 * @returns {Map<string, Object>} merged map: key = orderId/sticker
 */
function getMergedMap() {
  return mergeAnalyticsAndSales(
    wbAnalyticsReturnsCache.byOrderId || new Map(),
    wbSalesCache.bySticker || new Map()
  )
}

module.exports = {
  findInCache,
  refreshIfStale,
  refreshAll,
  getMergedMap
}
