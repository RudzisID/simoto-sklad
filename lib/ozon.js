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
 *   lastDate: string|null,
 *   fetchedAt: number,
 *   isFetching: boolean
 * }}
 */
const ozonReturnsCache = {
  data: null,           // Array of all cached returns
  byPostingNumber: null, // Map<posting_number, record>
  byReturnId: null,     // Map<id, record>
  lastDate: null,       // string — max return_date among records
  fetchedAt: 0,         // timestamp of last successful fetch
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
      for (const r of ozonReturnsCache.data) {
        if (r.posting_number) ozonReturnsCache.byPostingNumber.set(String(r.posting_number), r)
        if (r.id) ozonReturnsCache.byReturnId.set(String(r.id), r)
      }
      auto(`[Ozon Returns] loaded from disk — ${ozonReturnsCache.data.length} records, ${ozonReturnsCache.byPostingNumber.size} posting_numbers, lastDate=${ozonReturnsCache.lastDate || 'none'}`)
    }
  }
} catch (e) {
  auto(`[Ozon Returns] disk load error (starting fresh): ${e.message}`)
}

// ── Ozon Postings (FBS Sales) Cache ──
const OZON_POSTINGS_CACHE_TTL = CACHE_TTL
const OZON_POSTINGS_CACHE_FILE = path.join(moduleRoot, 'cache', 'ozon_postings_cache.json')

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
      ? Math.min(30, Math.max(1, Math.ceil((Date.now() - new Date(ozonReturnsCache.lastDate).getTime()) / (24 * 60 * 60 * 1000))))
      : 120

    log(`[Ozon Returns] fetching returns, daysBack=${daysBack}...`)
    const records = await wbOzonSync.fetchOzonReturnsList(clientId, apiKey, daysBack)

    if (!Array.isArray(records) || records.length === 0) {
      log(`[Ozon Returns] no new data, cache is current (${ozonReturnsCache.byPostingNumber?.size ?? 0} records)`)
      ozonReturnsCache.fetchedAt = Date.now()
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
          if (idx !== -1) ozonReturnsCache.data[idx] = record
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
    for (const r of ozonReturnsCache.data) {
      if (r.posting_number) ozonReturnsCache.byPostingNumber.set(String(r.posting_number), r)
      if (r.id) ozonReturnsCache.byReturnId.set(String(r.id), r)
    }

    ozonReturnsCache.fetchedAt = Date.now()
    saveOzonCacheToDisk('returns')
    ozonReturnsCache.isFetching = false
    log(`[Ozon Returns] merged ${records.length} records → total ${ozonReturnsCache.data.length} records, lastDate=${ozonReturnsCache.lastDate || 'none'}`)
    return ozonReturnsCache.byPostingNumber
  } catch (e) {
    ozonReturnsCache.isFetching = false
    log(`[Ozon Returns] fetch error: ${e.message}`)
    if (ozonReturnsCache.byPostingNumber) {
      log(`[Ozon Returns] using stale cache (${ozonReturnsCache.byPostingNumber.size} records)`)
      ozonReturnsCache.fetchedAt = Date.now()
      saveOzonCacheToDisk('returns')
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
      ? Math.min(30, Math.max(1, Math.ceil((Date.now() - new Date(ozonPostingsCache.lastDate).getTime()) / (24 * 60 * 60 * 1000))))
      : 120

    log(`[Ozon Postings] fetching postings, daysBack=${daysBack}...`)
    const records = await wbOzonSync.fetchOzonPostingsList(clientId, apiKey, daysBack)

    if (!Array.isArray(records) || records.length === 0) {
      log(`[Ozon Postings] no new data, cache is current (${ozonPostingsCache.byPostingNumber?.size ?? 0} records)`)
      ozonPostingsCache.fetchedAt = Date.now()
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
    saveOzonCacheToDisk('postings')
    ozonPostingsCache.isFetching = false
    log(`[Ozon Postings] merged ${records.length} records → total ${ozonPostingsCache.data.length} records, lastDate=${ozonPostingsCache.lastDate || 'none'}`)
    return ozonPostingsCache.byPostingNumber
  } catch (e) {
    ozonPostingsCache.isFetching = false
    log(`[Ozon Postings] fetch error: ${e.message}`)
    if (ozonPostingsCache.byPostingNumber) {
      log(`[Ozon Postings] using stale cache (${ozonPostingsCache.byPostingNumber.size} records)`)
      ozonPostingsCache.fetchedAt = Date.now()
      saveOzonCacheToDisk('postings')
      return ozonPostingsCache.byPostingNumber
    }
    throw e
  }
}

/**
 * Поиск по обоим кэшам Ozon.
 * Сначала ищет в ozonReturnsCache (по returnId, postingNumber, barcode, id),
 * затем в ozonPostingsCache (по postingNumber).
 *
 * @param {string|number} code - Номер для поиска (номер отправления, возврата, id или штрихкод)
 * @returns {object|null} - Найденная запись или null
 */
function findInCache(code) {
  // 1. Search returns cache by returnId
  if (ozonReturnsCache.byReturnId?.has(String(code))) {
    return ozonReturnsCache.byReturnId.get(String(code))
  }
  // 2. Search returns cache by postingNumber
  if (ozonReturnsCache.byPostingNumber?.has(String(code))) {
    return ozonReturnsCache.byPostingNumber.get(String(code))
  }
  // 3. Full scan returns data by barcode or numeric id
  if (ozonReturnsCache.data) {
    const found = ozonReturnsCache.data.find(r => r.barcode === code || r.id === Number(code))
    if (found) return found
  }
  // 4. Search postings cache by postingNumber
  if (ozonPostingsCache.byPostingNumber?.has(String(code))) {
    return ozonPostingsCache.byPostingNumber.get(String(code))
  }
  return null
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
 * Принудительное обновление всех кэшей Ozon.
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
  await Promise.all([
    getOzonReturnsMap(ozonClientId, ozonApiKey, log),
    getOzonPostingsMap(ozonClientId, ozonApiKey, log)
  ])
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

module.exports = {
  findInCache,
  refreshIfStale,
  refreshAll,
  getMergedMap,
  ozonReturnsCache,
  ozonPostingsCache
}
