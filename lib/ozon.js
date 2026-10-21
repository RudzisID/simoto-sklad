'use strict'

/**
 * @file Кэш Ozon — возвраты и отправления (FBS)
 * @module lib/ozon
 *
 * Управляет 2 кэшами Ozon API (возвраты и отправления FBS)
 * с сохранением на диск, TTL-обновлением (2ч), блокировкой конкурентных запросов.
 * Предоставляет объединённую карту (returns + postings) для поиска по posting_number.
 *
 * @requires fs
 * @requires path
 * @requires ../integrations/wb_ozon_sync
 */

const fs = require('fs')
const path = require('path')
const wbOzonSync = require('../integrations/wb_ozon_sync')
const { auto } = require('./logger')
const { CACHE_TTL } = require('./constants')

const moduleRoot = path.join(__dirname, '..')

/** Ensure cache directory exists */
const CACHE_DIR = path.join(moduleRoot, 'cache')
try { fs.mkdirSync(CACHE_DIR, { recursive: true }) } catch (_) {}

// ── Ozon Returns Cache ──
const OZON_RETURNS_CACHE_TTL = CACHE_TTL
const OZON_RETURNS_CACHE_FILE = path.join(moduleRoot, 'cache', 'ozon_returns_cache.json')

/**
 * @type {{
 *   data: Array|null,
 *   byPostingNumber: Map<string,object>|null,
 *   byReturnId: Map<string,object>|null,
 *   byOrderId: Map<number,Array<object>>|null,
 *   lastDate: string|null,
 *   fetchedAt: number,
 *   isFetching: boolean
 * }}
 */
const ozonReturnsCache = {
  data: null,           // Array of all cached returns
  byPostingNumber: new Map(), // Map<posting_number, record>
  byReturnId: new Map(),     // Map<id, record>
  byOrderId: new Map(),      // Map<order_id, Array<record>>
  lastDate: null,       // string — max return_date among records
  fetchedAt: 0,         // timestamp of last successful fetch
  lastErrorAt: 0,       // timestamp of last failed fetch (для короткого backoff-повтора)
  isFetching: false     // concurrent fetch lock
}

// Load from disk on startup
try {
  if (fs.existsSync(OZON_RETURNS_CACHE_FILE)) {
    const saved = JSON.parse(fs.readFileSync(OZON_RETURNS_CACHE_FILE, 'utf-8'))
    if (saved && Array.isArray(saved.data)) {
      ozonReturnsCache.data = saved.data
      ozonReturnsCache.lastDate = saved.lastDate || null
      ozonReturnsCache.fetchedAt = saved.fetchedAt || 0
      ozonReturnsCache.byPostingNumber = new Map()
      ozonReturnsCache.byReturnId = new Map()
      ozonReturnsCache.byOrderId = new Map()
      for (const r of ozonReturnsCache.data) {
        if (r.posting_number) ozonReturnsCache.byPostingNumber.set(String(r.posting_number), r)
        if (r.id) ozonReturnsCache.byReturnId.set(String(r.id), r)
        if (r.order_id != null) {
          const oid = r.order_id
          if (!ozonReturnsCache.byOrderId.has(oid)) ozonReturnsCache.byOrderId.set(oid, [])
          ozonReturnsCache.byOrderId.get(oid).push(r)
        }
      }
      auto(`[Ozon Returns] loaded from disk — ${ozonReturnsCache.data.length} records, ${ozonReturnsCache.byPostingNumber.size} posting_numbers, ${ozonReturnsCache.byOrderId.size} orders, lastDate=${ozonReturnsCache.lastDate || 'none'}`)
    }
  }
} catch (e) {
  auto(`[Ozon Returns] disk load error (starting fresh): ${e.message}`)
}

// ── Ozon Postings (FBS Sales) Cache ──
const OZON_POSTINGS_CACHE_TTL = CACHE_TTL
const OZON_POSTINGS_CACHE_FILE = path.join(moduleRoot, 'cache', 'ozon_postings_cache.json')

// Короткий backoff после сбоя загрузки: при таймауте/сетевой ошибке отдаём
// stale-кэш, но НЕ помечаем его свежим на весь TTL. Вместо этого повторяем
// попытку через OZON_FETCH_RETRY_BACKOFF — кэш самолечится, как только сеть
// вернётся (раньше один таймаут «замораживал» неполный кэш на 30 мин, из-за
// чего свежеотгруженные поставки висели в ⏳).
const OZON_FETCH_RETRY_BACKOFF = 60 * 1000

/**
 * @type {{
 *   data: Array|null,
 *   byPostingNumber: Map<string,object>|null,
 *   lastDate: string|null,
 *   fetchedAt: number,
 *   isFetching: boolean
 * }}
 */
const ozonPostingsCache = {
  data: null,           // Array of all cached postings
  byPostingNumber: null, // Map<posting_number, record>
  lastDate: null,       // string — max shipment_date among records
  fetchedAt: 0,         // timestamp
  lastErrorAt: 0,       // timestamp последней неудачной загрузки (короткий backoff)
  isFetching: false     // lock
}

// Load from disk on startup
try {
  if (fs.existsSync(OZON_POSTINGS_CACHE_FILE)) {
    const saved = JSON.parse(fs.readFileSync(OZON_POSTINGS_CACHE_FILE, 'utf-8'))
    if (saved && Array.isArray(saved.data)) {
      ozonPostingsCache.data = saved.data
      ozonPostingsCache.lastDate = saved.lastDate || null
      ozonPostingsCache.fetchedAt = saved.fetchedAt || 0
      ozonPostingsCache.byPostingNumber = new Map()
      for (const r of ozonPostingsCache.data) {
        if (r.posting_number) ozonPostingsCache.byPostingNumber.set(String(r.posting_number), r)
      }
      auto(`[Ozon Postings] loaded from disk — ${ozonPostingsCache.data.length} records, ${ozonPostingsCache.byPostingNumber.size} posting_numbers, lastDate=${ozonPostingsCache.lastDate || 'none'}`)
    }
  }
} catch (e) {
  auto(`[Ozon Postings] disk load error (starting fresh): ${e.message}`)
}

/**
 * Сохранение кэша Ozon на диск
 * @param {string} cacheName - 'returns' or 'postings'
 */
function saveOzonCacheToDisk(cacheName) {
  const cache = cacheName === 'returns' ? ozonReturnsCache : ozonPostingsCache
  const file = cacheName === 'returns' ? OZON_RETURNS_CACHE_FILE : OZON_POSTINGS_CACHE_FILE
  try {
    fs.writeFileSync(file, JSON.stringify({
      data: cache.data,
      lastDate: cache.lastDate,
      fetchedAt: cache.fetchedAt
    }))
  } catch (e) {
    auto(`[Ozon ${cacheName}] disk save error: ${e.message}`)
  }
}

/**
 * Получение карты возвратов Ozon (byPostingNumber) с кэшированием
 *
 * Алгоритм:
 *  1. Если кэш свежий (<2ч) — моментальный возврат, 0 запросов к API
 *  2. Если кэш просрочен — загружаем дельту или полные 120 дней
 *  3. Новые записи merge в существующий кэш (upsert по id)
 *  4. Ошибки: если есть просроченный кэш — отдаём его, иначе throw
 *  5. Кэш сохраняется на диск после каждого обновления
 *
 * @param {string} clientId - Ozon Client-Id
 * @param {string} apiKey - Ozon Api-Key
 * @param {function} [log] - функция логирования
 * @returns {Promise<Map<string, object>>}
 * @throws {Error} Если запрос к API не удался и нет просроченного кэша
 */
async function getOzonReturnsMap(clientId, apiKey, log = console.log) {
  const now = Date.now()

  // 1. Cache HIT — return immediately
  if (ozonReturnsCache.byPostingNumber && (now - ozonReturnsCache.fetchedAt) < OZON_RETURNS_CACHE_TTL) {
    log(`[Ozon Returns] cache HIT (${Math.round((now - ozonReturnsCache.fetchedAt) / 1000)}s old, ${ozonReturnsCache.byPostingNumber.size} records)`)
    return ozonReturnsCache.byPostingNumber
  }

  // 1b. Backoff после сбоя: не долбим API при лежащей сети, отдаём stale,
  //     но fetchedAt НЕ обнуляем — после backoff попытка реально повторится.
  if (ozonReturnsCache.byPostingNumber && ozonReturnsCache.lastErrorAt &&
      (now - ozonReturnsCache.lastErrorAt) < OZON_FETCH_RETRY_BACKOFF) {
    log(`[Ozon Returns] backoff after fetch error (${Math.round((now - ozonReturnsCache.lastErrorAt) / 1000)}s ago), using stale`)
    return ozonReturnsCache.byPostingNumber
  }

  // 2. Concurrent fetch — wait or use stale
  if (ozonReturnsCache.isFetching) {
    log('[Ozon Returns] concurrent fetch in progress, waiting...')
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 1000))
      if (!ozonReturnsCache.isFetching) break
    }
    if (ozonReturnsCache.byPostingNumber) return ozonReturnsCache.byPostingNumber
  }

  // 3. Fetch
  ozonReturnsCache.isFetching = true

  try {
    const daysBack = ozonReturnsCache.lastDate
      ? Math.max(4, Math.ceil((Date.now() - new Date(ozonReturnsCache.lastDate).getTime()) / (24 * 60 * 60 * 1000)))
      : 120

    log(`[Ozon Returns] fetching returns, daysBack=${daysBack}...`)
    const records = await wbOzonSync.fetchOzonReturnsList(clientId, apiKey, daysBack)

    if (!Array.isArray(records) || records.length === 0) {
      if (ozonReturnsCache.data === null && ozonReturnsCache.fetchedAt === 0) {
        // Первый запуск — данных никогда не было, API вернул пусто
        // Не сохраняем fetchedAt, чтобы повторить при следующем refreshIfStale
        log(`[Ozon Returns] API returned empty on first fetch, will retry on next refresh`)
        ozonReturnsCache.isFetching = false
        return ozonReturnsCache.byPostingNumber || new Map()
      }
      log(`[Ozon Returns] no new data, cache is current (${ozonReturnsCache.byPostingNumber?.size ?? 0} records)`)
      ozonReturnsCache.fetchedAt = Date.now()
      ozonReturnsCache.lastErrorAt = 0
      saveOzonCacheToDisk('returns')
      ozonReturnsCache.isFetching = false
      return ozonReturnsCache.byPostingNumber || new Map()
    }

    // Merge: upsert by id
    if (ozonReturnsCache.data === null) {
      ozonReturnsCache.data = records
    } else {
      const existingIds = new Set(ozonReturnsCache.data.map(r => String(r.id)))
      for (const record of records) {
        const id = String(record.id)
        if (id && existingIds.has(id)) {
          const idx = ozonReturnsCache.data.findIndex(r => String(r.id) === id)
          // Сохраняем return_barcode (штрихкод возврата, добавленный live-поиском):
          // bulk-API /v1/returns/list его не отдаёт для split-возвратов, иначе тег
          // терялся бы при каждом TTL-обновлении и требовал повторных live-запросов
          if (idx !== -1) {
            const prevBarcode = ozonReturnsCache.data[idx] && ozonReturnsCache.data[idx].return_barcode
            ozonReturnsCache.data[idx] = prevBarcode
              ? { ...record, return_barcode: prevBarcode }
              : record
          }
        } else if (id) {
          ozonReturnsCache.data.push(record)
          existingIds.add(id)
        }
      }
    }

    // Update lastDate
    const lastDate = records.reduce((max, r) => {
      if (r.return_date && (!max || r.return_date > max)) return r.return_date
      return max
    }, null)
    if (lastDate && (!ozonReturnsCache.lastDate || lastDate > ozonReturnsCache.lastDate)) {
      ozonReturnsCache.lastDate = lastDate
    }

    // Purge records older than 120 days
    const cutoff = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString()
    const before = ozonReturnsCache.data.length
    ozonReturnsCache.data = ozonReturnsCache.data.filter(r => r.return_date && r.return_date >= cutoff)
    if (before !== ozonReturnsCache.data.length) {
      log(`[Ozon Returns] purged ${before - ozonReturnsCache.data.length} records older than 120 days`)
    }

    // Rebuild indexes
    ozonReturnsCache.byPostingNumber = new Map()
    ozonReturnsCache.byReturnId = new Map()
    ozonReturnsCache.byOrderId = new Map()
    for (const r of ozonReturnsCache.data) {
      if (r.posting_number) ozonReturnsCache.byPostingNumber.set(String(r.posting_number), r)
      if (r.id) ozonReturnsCache.byReturnId.set(String(r.id), r)
      if (r.order_id != null) {
        const oid = r.order_id
        if (!ozonReturnsCache.byOrderId.has(oid)) ozonReturnsCache.byOrderId.set(oid, [])
        ozonReturnsCache.byOrderId.get(oid).push(r)
      }
    }

    ozonReturnsCache.fetchedAt = Date.now()
    ozonReturnsCache.lastErrorAt = 0
    saveOzonCacheToDisk('returns')
    ozonReturnsCache.isFetching = false
    log(`[Ozon Returns] merged ${records.length} records → total ${ozonReturnsCache.data.length} records, lastDate=${ozonReturnsCache.lastDate || 'none'}`)
    return ozonReturnsCache.byPostingNumber
  } catch (e) {
    ozonReturnsCache.isFetching = false
    log(`[Ozon Returns] fetch error: ${e.message}`)
    if (ozonReturnsCache.byPostingNumber) {
      log(`[Ozon Returns] using stale cache (${ozonReturnsCache.byPostingNumber.size} records)`)
      // НЕ помечаем stale-кэш свежим: фиксируем время сбоя и повторяем через backoff
      ozonReturnsCache.lastErrorAt = Date.now()
      return ozonReturnsCache.byPostingNumber
    }
    throw e
  }
}

/**
 * Получение карты отправлений Ozon (FBS sales) по posting_number с кэшированием
 *
 * Алгоритм:
 *  1. Если кэш свежий (<2ч) — моментальный возврат, 0 запросов к API
 *  2. Если кэш просрочен — загружаем дельту или полные 120 дней
 *  3. Новые записи merge в существующий кэш (upsert по posting_number)
 *  4. Ошибки: если есть просроченный кэш — отдаём его, иначе throw
 *  5. Кэш сохраняется на диск после каждого обновления
 *
 * @param {string} clientId - Ozon Client-Id
 * @param {string} apiKey - Ozon Api-Key
 * @param {function} [log] - функция логирования
 * @returns {Promise<Map<string, object>>}
 * @throws {Error} Если запрос к API не удался и нет просроченного кэша
 */
async function getOzonPostingsMap(clientId, apiKey, log = console.log) {
  const now = Date.now()

  // 1. Cache HIT — return immediately
  if (ozonPostingsCache.byPostingNumber && (now - ozonPostingsCache.fetchedAt) < OZON_POSTINGS_CACHE_TTL) {
    log(`[Ozon Postings] cache HIT (${Math.round((now - ozonPostingsCache.fetchedAt) / 1000)}s old, ${ozonPostingsCache.byPostingNumber.size} records)`)
    return ozonPostingsCache.byPostingNumber
  }

  // 1b. Backoff после сбоя: отдаём stale, но НЕ обнуляем fetchedAt → после
  //     backoff попытка повторится и кэш самолечится (см. OZON_FETCH_RETRY_BACKOFF).
  if (ozonPostingsCache.byPostingNumber && ozonPostingsCache.lastErrorAt &&
      (now - ozonPostingsCache.lastErrorAt) < OZON_FETCH_RETRY_BACKOFF) {
    log(`[Ozon Postings] backoff after fetch error (${Math.round((now - ozonPostingsCache.lastErrorAt) / 1000)}s ago), using stale`)
    return ozonPostingsCache.byPostingNumber
  }

  // 2. Concurrent fetch — wait or use stale
  if (ozonPostingsCache.isFetching) {
    log('[Ozon Postings] concurrent fetch in progress, waiting...')
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 1000))
      if (!ozonPostingsCache.isFetching) break
    }
    if (ozonPostingsCache.byPostingNumber) return ozonPostingsCache.byPostingNumber
  }

  // 3. Fetch
  ozonPostingsCache.isFetching = true

  try {
    const daysBack = ozonPostingsCache.lastDate
      ? Math.min(30, Math.max(4, Math.ceil((Date.now() - new Date(ozonPostingsCache.lastDate).getTime()) / (24 * 60 * 60 * 1000))))
      : 120

    log(`[Ozon Postings] fetching postings, daysBack=${daysBack}...`)
    const records = await wbOzonSync.fetchOzonPostingsList(clientId, apiKey, daysBack)

    if (!Array.isArray(records) || records.length === 0) {
      log(`[Ozon Postings] no new data, cache is current (${ozonPostingsCache.byPostingNumber?.size ?? 0} records)`)
      ozonPostingsCache.fetchedAt = Date.now()
      ozonPostingsCache.lastErrorAt = 0
      saveOzonCacheToDisk('postings')
      ozonPostingsCache.isFetching = false
      return ozonPostingsCache.byPostingNumber || new Map()
    }

    // Merge: upsert by posting_number
    if (ozonPostingsCache.data === null) {
      ozonPostingsCache.data = records
    } else {
      const existing = new Set(ozonPostingsCache.data.map(r => String(r.posting_number)))
      for (const record of records) {
        const pn = String(record.posting_number)
        if (pn && existing.has(pn)) {
          const idx = ozonPostingsCache.data.findIndex(r => String(r.posting_number) === pn)
          if (idx !== -1) ozonPostingsCache.data[idx] = record
        } else if (pn) {
          ozonPostingsCache.data.push(record)
          existing.add(pn)
        }
      }
    }

    // Update lastDate
    const lastDate = records.reduce((max, r) => {
      if (r.shipment_date && (!max || r.shipment_date > max)) return r.shipment_date
      return max
    }, null)
    if (lastDate && (!ozonPostingsCache.lastDate || lastDate > ozonPostingsCache.lastDate)) {
      ozonPostingsCache.lastDate = lastDate
    }

    // Purge records older than 120 days
    const cutoff = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString()
    const before = ozonPostingsCache.data.length
    ozonPostingsCache.data = ozonPostingsCache.data.filter(r => r.shipment_date && r.shipment_date >= cutoff)
    if (before !== ozonPostingsCache.data.length) {
      log(`[Ozon Postings] purged ${before - ozonPostingsCache.data.length} records older than 120 days`)
    }

    // Rebuild index
    ozonPostingsCache.byPostingNumber = new Map()
    for (const r of ozonPostingsCache.data) {
      if (r.posting_number) ozonPostingsCache.byPostingNumber.set(String(r.posting_number), r)
    }

    ozonPostingsCache.fetchedAt = Date.now()
    ozonPostingsCache.lastErrorAt = 0
    saveOzonCacheToDisk('postings')
    ozonPostingsCache.isFetching = false
    log(`[Ozon Postings] merged ${records.length} records → total ${ozonPostingsCache.data.length} records, lastDate=${ozonPostingsCache.lastDate || 'none'}`)
    return ozonPostingsCache.byPostingNumber
  } catch (e) {
    ozonPostingsCache.isFetching = false
    log(`[Ozon Postings] fetch error: ${e.message}`)
    if (ozonPostingsCache.byPostingNumber) {
      log(`[Ozon Postings] using stale cache (${ozonPostingsCache.byPostingNumber.size} records)`)
      // НЕ помечаем stale-кэш свежим (было причиной «зависших» ⏳ отгрузок):
      // фиксируем сбой и повторяем загрузку через backoff
      ozonPostingsCache.lastErrorAt = Date.now()
      return ozonPostingsCache.byPostingNumber
    }
    throw e
  }
}

/**
 * Поиск по обоим кэшам Ozon.
 *
 * Порядок поиска (приоритет):
 * 1. ozonReturnsCache.byReturnId — прямой поиск по ID возврата (уникальный, не пересекается)
 * 2. ozonPostingsCache.byPostingNumber — постинг (первичный статус заказа)
 * 3. ozonReturnsCache.byPostingNumber — возврат по номеру отправления (только если нет постинга)
 * 4. Полный перебор ozonReturnsCache.data по barcode или id
 *
 * @param {string|number} code - Номер для поиска (номер отправления, возврата, id или штрихкод)
 * @returns {object|null} - Найденная запись или null
 */
function findInCache(code) {
  const codeStr = String(code)

  // Search all caches independently
  const returnByReturnId = ozonReturnsCache.byReturnId?.get(codeStr)
  const posting = ozonPostingsCache.byPostingNumber?.get(codeStr)
  const returnByPosting = ozonReturnsCache.byPostingNumber?.get(codeStr)

  let returnFullScan = null
  if (ozonReturnsCache.data && !returnByReturnId && !returnByPosting) {
    // Совпадение по: штрихкоду товара (barcode), штрихкоду возврата (return_barcode —
    // появляется после live-поиска split-возвратов) или числовому id возврата
    returnFullScan = ozonReturnsCache.data.find(
      r => r.barcode === code || r.return_barcode === code || r.id === Number(code)
    )
  }

  // Collect all found records
  const records = []
  if (returnByReturnId) records.push({ ...returnByReturnId, _ozonMatch: 'returnByReturnId' })
  if (posting) records.push({ ...posting, _ozonMatch: 'posting' })
  if (returnByPosting) records.push({ ...returnByPosting, _ozonMatch: 'returnByPosting' })
  if (returnFullScan) records.push({ ...returnFullScan, _ozonMatch: 'returnFullScan' })

  if (records.length === 0) return null

  // Priority: return → cancelled → delivered → processing
  const returnRec = records.find(r => r.return_reason_name || r.status === 'return' || r.status === 'returned' || r.status === 'returning')
  if (returnRec) return returnRec

  const cancelledRec = records.find(r => r.status === 'cancelled')
  if (cancelledRec) return cancelledRec

  const deliveredRec = records.find(r => r.status === 'delivered' || r.status === 'delivering')
  if (deliveredRec) return deliveredRec

  // Any other record (processing, awaiting_packaging, etc.)
  return records[0]
}

/**
 * Обновление просроченных кэшей Ozon.
 * Вызывает getOzonReturnsMap и getOzonPostingsMap — каждая проверяет TTL внутри
 * и запрашивает данные только если кэш устарел.
 *
 * @param {string} ozonClientId - Ozon Client-Id
 * @param {string} ozonApiKey - Ozon Api-Key
 * @param {function} [log] - функция логирования
 * @returns {Promise<void>}
 */
async function refreshIfStale(ozonClientId, ozonApiKey, log = console.log) {
  await Promise.all([
    getOzonReturnsMap(ozonClientId, ozonApiKey, log),
    getOzonPostingsMap(ozonClientId, ozonApiKey, log)
  ])
}

/**
 * Принудительное обновление ВСЕХ кэшей Ozon.
 * Сбрасывает fetchedAt в 0, чтобы оба кэша перезапросили данные независимо от TTL.
 *
 * @param {string} ozonClientId - Ozon Client-Id
 * @param {string} ozonApiKey - Ozon Api-Key
 * @param {function} [log] - функция логирования
 * @returns {Promise<void>}
 */
async function refreshAll(ozonClientId, ozonApiKey, log = console.log) {
  ozonReturnsCache.fetchedAt = 0
  ozonPostingsCache.fetchedAt = 0
  ozonReturnsCache.lastErrorAt = 0
  ozonPostingsCache.lastErrorAt = 0
  await Promise.all([
    getOzonReturnsMap(ozonClientId, ozonApiKey, log),
    getOzonPostingsMap(ozonClientId, ozonApiKey, log)
  ])
}

/**
 * Принудительное обновление кэша постингов для сканирования поставок.
 * Сбрасывает TTL постингов, чтобы запросить свежие статусы заказов.
 * Возвраты не трогает — они меняются реже.
 *
 * @param {string} ozonClientId - Ozon Client-Id
 * @param {string} ozonApiKey - Ozon Api-Key
 * @param {function} [log] - функция логирования
 * @returns {Promise<Map<string, object>>}
 */
async function refreshSupplies(ozonClientId, ozonApiKey, log = console.log) {
  ozonPostingsCache.fetchedAt = 0
  ozonPostingsCache.lastErrorAt = 0
  return getOzonPostingsMap(ozonClientId, ozonApiKey, log)
}

/**
 * Слить ozonReturnsCache.byPostingNumber и ozonPostingsCache.byPostingNumber
 * в единую Map<posting_number, merged_record>.
 * Записи из returnsCache имеют приоритет по пересекающимся полям.
 * @returns {Map<string, Object>}
 */
function getMergedMap() {
  const merged = new Map()

  // Сначала — постинги (отправления) — базовый слой
  if (ozonPostingsCache.byPostingNumber) {
    for (const [pn, record] of ozonPostingsCache.byPostingNumber) {
      merged.set(String(pn), { ...record })
    }
  }

  // Поверх — возвраты (дополняют / перезаписывают)
  if (ozonReturnsCache.byPostingNumber) {
    for (const [pn, record] of ozonReturnsCache.byPostingNumber) {
      const key = String(pn)
      merged.set(key, { ...(merged.get(key) || {}), ...record })
    }
  }

  return merged
}

/**
 * Live-поиск возврата Ozon по штрихкоду возврата (ii-код).
 *
 * Нужен для разделённых (split) возвратов: bulk-API /v1/returns/list кладёт в
 * logistic.barcode штрихкод ТОВАРА, а не штрихкод возврата, поэтому ii-код
 * отсутствует в кэше и findInCache по нему промахивается. Фильтр по barcode на
 * стороне Ozon умеет матчить ii-код (тем же способом работает сайт продавца).
 * Результат помечается полем return_barcode и upsert-ится в кэш (в память и на
 * диск) — повторный поиск того же ii-кода отрабатывает уже из кэша.
 * Это ленивое кэширование: ≤1 запрос к API на каждый уникальный ii-код за всё время.
 *
 * @param {string} clientId - Ozon Client-Id
 * @param {string} apiKey - Ozon Api-Key
 * @param {string} code - Штрихкод возврата (ii-код, напр. "ii19890646714")
 * @param {function} [log] - функция логирования
 * @returns {Promise<object|null>} Найденная запись возврата или null
 */
async function findReturnByBarcodeLive(clientId, apiKey, code, log = console.log) {
  const codeStr = String(code)
  if (!clientId || !apiKey || !codeStr) return null

  const rec = await wbOzonSync.fetchOzonReturnByBarcode(clientId, apiKey, codeStr)
  if (!rec || !rec.id) return null

  // Помечаем запись искомым штрихкодом возврата — ключ для будущих попаданий в кэш
  rec.return_barcode = codeStr

  // Upsert в ozonReturnsCache.data по id (сохраняя уже известные поля записи)
  if (!Array.isArray(ozonReturnsCache.data)) ozonReturnsCache.data = []
  const idx = ozonReturnsCache.data.findIndex(r => String(r.id) === String(rec.id))
  let stored
  if (idx !== -1) {
    stored = { ...ozonReturnsCache.data[idx], ...rec }
    ozonReturnsCache.data[idx] = stored
  } else {
    stored = rec
    ozonReturnsCache.data.push(rec)
  }

  // Обновляем индексы, чтобы findInCache видел запись и по posting_number, и по id
  if (stored.posting_number) ozonReturnsCache.byPostingNumber.set(String(stored.posting_number), stored)
  if (stored.id) ozonReturnsCache.byReturnId.set(String(stored.id), stored)
  if (stored.order_id != null) {
    if (!ozonReturnsCache.byOrderId.has(stored.order_id)) {
      ozonReturnsCache.byOrderId.set(stored.order_id, [])
    }
    const arr = ozonReturnsCache.byOrderId.get(stored.order_id)
    if (!arr.some(r => String(r.id) === String(stored.id))) arr.push(stored)
  }

  saveOzonCacheToDisk('returns')
  log(`[Ozon Returns] live barcode hit: ${codeStr} → id=${stored.id} (posting=${stored.posting_number || '?'})`)
  return stored
}

/**
 * Live-поиск ОДНОГО отправления Ozon по posting_number (фолбэк для поставок).
 *
 * Применяется, когда bulk-кэш отправлений не содержит отправление (например,
 * отгружено недавно, а фоновая загрузка /v3/posting/fbs/list упала по таймауту).
 * Это ВОСМОГО варианта — самый дешёвый путь это bulk-refresh (он лечится сам
 * через backoff). Поэтому live-запрос идёт только если Ozon реально отзывчив
 * (метрика отклика в wb_ozonSync.isOzonResponsive) и с коротким таймаутом и
 * без ретраев — единичный медленный ответ не заблокирует сканирование.
 * Успешный результат upsert-ится в postings-кэш (память + диск), повтор — из кэша.
 *
 * @param {string} clientId - Ozon Client-Id
 * @param {string} apiKey - Ozon Api-Key
 * @param {string} postingNumber - Номер отправления (posting_number)
 * @param {function} [log] - функция логирования
 * @returns {Promise<object|null>} Запись отправления в формате кэша или null
 */
async function findPostingByNumberLive(clientId, apiKey, postingNumber, log = console.log) {
  const pn = String(postingNumber)
  if (!clientId || !apiKey || !pn) return null

  // Уже в кэше — не дёргаем API
  if (ozonPostingsCache.byPostingNumber && ozonPostingsCache.byPostingNumber.has(pn)) {
    return ozonPostingsCache.byPostingNumber.get(pn)
  }

  // Шлюз по метрике отклика: при тормозах/падениях Ozon пропускаем live-запрос,
  // чтобы не копить очередь таймаутов и не блокировать сканирование поставок
  if (!wbOzonSync.isOzonResponsive()) return null

  // Короткий таймаут (5 с) и 0 ретраев — одиночный медленный ответ отваливается быстро
  const detail = await wbOzonSync.fetchOzonPostingDetail(clientId, apiKey, pn, { timeoutMs: 5000, maxRetries: 0 })
  if (!detail || !detail.posting_number) return null

  // Приводим сырой ответ /v3/posting/fbs/get к формату записи postings-кэша
  const firstProduct = detail.products && detail.products.length ? detail.products[0] : null
  const record = {
    posting_number: detail.posting_number || pn,
    order_id: detail.order_id,
    status: detail.status || '',
    products: (detail.products || []).map(p => ({
      offer_id: p.offer_id || '',
      name: p.name || '',
      price: p.price || '0',
      sku: p.sku,
      quantity: p.quantity || 0
    })),
    shipment_date: detail.shipment_date || '',
    delivering_date: detail.delivering_date || '',
    price: firstProduct ? parseFloat(firstProduct.price) || 0 : 0,
    is_return: (detail.analytics_data && detail.analytics_data.is_return) ?? false,
    is_cancel: (detail.analytics_data && detail.analytics_data.is_cancel) ?? false
  }

  // Upsert в postings-кэш (память + индекс + диск), чтобы повтор попал из кэша
  if (!Array.isArray(ozonPostingsCache.data)) ozonPostingsCache.data = []
  const idx = ozonPostingsCache.data.findIndex(r => String(r.posting_number) === pn)
  if (idx !== -1) ozonPostingsCache.data[idx] = record
  else ozonPostingsCache.data.push(record)
  if (!ozonPostingsCache.byPostingNumber) ozonPostingsCache.byPostingNumber = new Map()
  ozonPostingsCache.byPostingNumber.set(pn, record)
  saveOzonCacheToDisk('postings')

  log(`[Ozon Postings] live detail hit: ${pn} → status=${record.status}`)
  return record
}

module.exports = {
  findInCache,
  findReturnByBarcodeLive,
  findPostingByNumberLive,
  isOzonResponsive: wbOzonSync.isOzonResponsive,
  getOzonLatency: wbOzonSync.getOzonLatency,
  refreshIfStale,
  refreshAll,
  refreshSupplies,
  getMergedMap,
  ozonReturnsCache,
  ozonPostingsCache
}
