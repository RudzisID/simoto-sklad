const express = require('express')
const path = require('path')
const fs = require('fs')
const https = require('https')
const http = require('http')
require('dotenv').config()

const moduleRoot = __dirname

const { initApi } = require('./lib/moysklad')
const { processBatch } = require('./lib/batch')
const { checkOrder } = require('./lib/check')
const {
  findOrderByShipmentNum,
  getOrderFull,
  getOrderFullForCreate,
  getDemand,
  changeOrderStatus
} = require('./lib/order')
const { createPayment } = require('./lib/payment')
const { createDemand } = require('./lib/demand')
const { createReturn } = require('./lib/return')
const { cancelOrder } = require('./lib/cancel')
const { findProductByCode, getProductFullByCode } = require('./lib/product')
const { getApi } = require('./lib/api-utils')
const { exportStickerPdf } = require('./lib/print')
const wbOzonSync = require('./integrations/wb_ozon_sync')

/**
 * Convert a WB CDN URL (basket-*.wb.ru) to base64 Data URI
 * so the WB /media/save API can re-use images already on WB's servers.
 * Falls back to the original URL on error.
 */
function wbUrlToDataUri(imageUrl) {
  // Only convert WB CDN URLs — external URLs pass through
  try {
    const u = new URL(imageUrl)
    if (!/(?:basket|images)\.(?:wb|wildberries)\.ru$/i.test(u.hostname)) {
      return Promise.resolve(imageUrl)
    }
  } catch {
    return Promise.resolve(imageUrl)
  }

  return new Promise((resolve) => {
    const mod = imageUrl.startsWith('https') ? https : http
    mod.get(imageUrl, { timeout: 15000 }, (res) => {
      const contentType = res.headers['content-type'] || 'image/jpeg'
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        try {
          const buffer = Buffer.concat(chunks)
          const b64 = buffer.toString('base64')
          log(`[Media] Converted WB CDN URL to Data URI (${(buffer.length / 1024).toFixed(1)} KB)`)
          resolve(`data:${contentType};base64,${b64}`)
        } catch {
          resolve(imageUrl)
        }
      })
      res.on('error', () => resolve(imageUrl))
    }).on('error', () => resolve(imageUrl))
  })
}

// In-memory store for abort signals
const abortSignals = new Map()

// Log directory — must be defined early; log() references it at startup
const LOG_DIR = path.join(moduleRoot, 'logs')

// ANSI цвета для консоли — нужны log() с первого запуска
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
}

// Кэш для WB statistics-api (supplier/sales)
// Лимит statistics-api: ~1 запрос/мин.
// Первый запрос кэширует возвраты за 90 дней.
// Последующие обновления: только новые записи с lastChangeDate > lastDate.
// Инкрементальный подход: дельта-запросы вместо полной перезагрузки 90 дней.
// Обновление: раз в 2 часа (TTL кэша) догружаем только то, что изменилось.
const wbSalesCache = {
  data: null,       // массив ВСЕХ записей (объединение старых + новых)
  bySticker: null,  // Map<sticker, record> — построен из data
  lastDate: null,   // string — максимальный lastChangeDate среди всех записей
  fetchedAt: 0,     // timestamp последнего успешного запроса
  isFetching: false // true пока идёт запрос (другие запросы ждут)
}
const WB_SALES_CACHE_TTL = 2 * 60 * 60 * 1000 // 2 часа
const WB_SALES_CACHE_FILE = path.join(moduleRoot, 'logs', 'wb_sales_cache.json')

// Constants for WB Analytics Returns cache (seller-analytics-api)
// Endpoint: GET /api/v1/analytics/goods-return
// Limits: max 31 days per request, 1 req/min, data kept 90 days
const WB_ANALYTICS_CACHE_TTL = 2 * 60 * 60 * 1000 // 2 часа
const WB_ANALYTICS_CACHE_FILE = path.join(moduleRoot, 'logs', 'wb_analytics_returns_cache.json')

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
      log(`WB cache: loaded from disk — ${wbSalesCache.data.length} records, ${wbSalesCache.bySticker.size} stickers, lastDate=${wbSalesCache.lastDate || 'none'}`)
    }
  }
} catch (e) {
   log(`WB cache: disk load error (starting fresh): ${e.message}`)
}

// Constants for WB returns cache
const WB_RETURNS_CACHE_TTL = 2 * 60 * 60 * 1000; // 2 часа
const WB_RETURNS_CACHE_FILE = path.join(moduleRoot, 'logs', 'wb_returns_cache.json');

// Кэш для WB statistics-api (returns)
const wbReturnsCache = {
  data: null,
  bySticker: null,
  lastDate: null,
  fetchedAt: 0,
  isFetching: false
};

// Кэш для WB Analytics API (goods-return)
// Использует seller-analytics-api.wildberries.ru
// Ключ: orderId (не srid, не sticker)
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
// Endpoint: GET /api/v3/orders — возвращает id = Номер сборочного задания
// Связка со statistics: srid (statistics) = rid (маркетплейс)
const WB_ORDERS_CACHE_TTL = 2 * 60 * 60 * 1000 // 2 часа
const WB_ORDERS_CACHE_FILE = path.join(moduleRoot, 'logs', 'wb_orders_cache.json')

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
// Endpoint: GET /api/v1/supplier/orders — возвращает sticker и srid
const WB_ORDERS_STICKERS_CACHE_TTL = 2 * 60 * 60 * 1000 // 2 часа
const WB_ORDERS_STICKERS_CACHE_FILE = path.join(moduleRoot, 'logs', 'wb_orders_stickers_cache.json')

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

// ── Ozon Returns Cache ──
const OZON_RETURNS_CACHE_TTL = 2 * 60 * 60 * 1000 // 2 hours
const OZON_RETURNS_CACHE_FILE = path.join(moduleRoot, 'logs', 'ozon_returns_cache.json')

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
      console.log(`[Ozon Returns] loaded from disk — ${ozonReturnsCache.data.length} records, ${ozonReturnsCache.byPostingNumber.size} posting_numbers, lastDate=${ozonReturnsCache.lastDate || 'none'}`)
    }
  }
} catch (e) {
  console.log(`[Ozon Returns] disk load error (starting fresh): ${e.message}`)
}

// ── Ozon Postings (FBS Sales) Cache ──
const OZON_POSTINGS_CACHE_TTL = 2 * 60 * 60 * 1000 // 2 hours
const OZON_POSTINGS_CACHE_FILE = path.join(moduleRoot, 'logs', 'ozon_postings_cache.json')

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
      console.log(`[Ozon Postings] loaded from disk — ${ozonPostingsCache.data.length} records, ${ozonPostingsCache.byPostingNumber.size} posting_numbers, lastDate=${ozonPostingsCache.lastDate || 'none'}`)
    }
  }
} catch (e) {
  console.log(`[Ozon Postings] disk load error (starting fresh): ${e.message}`)
}

/**
 * Save Ozon cache to disk
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
    console.log(`[Ozon ${cacheName}] disk save error: ${e.message}`)
  }
}

/**
 * Get Ozon returns byPostingNumber map with caching
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
      return ozonReturnsCache.byPostingNumber
    }
    throw e
  }
}

/**
 * Get Ozon postings (FBS sales) byPostingNumber map with caching
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
      return ozonPostingsCache.byPostingNumber
    }
    throw e
  }
}

/**
 * Получить sticker → record из returns с кэшированием и retry при 429
 *
 * Алгоритм:
 *  1. Если кэш свежий (<2ч) — моментальный возврат, 0 запросов к API
 *  2. Если кэш просрочен — пробуем обновить:
 *     a) Если есть lastDate → dateFrom = lastDate (только дельта)
 *     b) Если нет lastDate (первый запуск) → забираем всё за 90 дней
 *  3. Новые записи merge в существующий кэш (upsert по srid)
 *  4. При 429 читаем X-Ratelimit-Retry (или X-Ratelimit-Reset) из заголовка
 *  5. Если есть просроченный кэш — отдаём его сразу, без retry
 *  6. Если кэша нет — retry по заголовку (fallback 60с), до 3 попыток
 *  7. Кэш сохраняется на диск (logs/wb_returns_cache.json) после каждого обновления
 *
 * @param {string} wbToken - WB API token (raw, без Bearer — statistics-api)
 * @param {function} [log] - функция логирования
 * @param {function} [onWait] - callback(waitSec, attempt) при ожидании retry
 * @returns {Promise<Map<string, object>>}
 */
async function getWBRReturnsMap(wbToken, log = console.log, onWait = null) {
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
       log(`WB returns cache: fetching returns (attempt ${attempt}/3)...`)

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
           return wbReturnsCache.bySticker
         }
         // Нет кэша — ждём и retry
         if (onWait) onWait(waitSec, attempt)
         await new Promise(r => setTimeout(r, waitSec * 1000))
         continue
       }

       // Другие ошибки (сетевые, 5xx и т.д.)
       if (attempt < 3) {
         log(`WB returns cache: attempt ${attempt}/3 failed: ${res.status} ${res.statusText}, retrying...`)
         await new Promise(r => setTimeout(r, 1000)) // Пауза перед повтором
         continue
       }
       throw new Error(`WB returns API error: ${res.status} ${res.statusText}`)
     }
   } catch (e) {
     wbReturnsCache.isFetching = false
     log(`WB returns cache: fetch error — ${e.message}`, 'error')
     throw e
   }
 }

/**
 * Получить sticker → record из supplier/sales с кэшированием и retry при 429
 *
 * Алгоритм:
 *  1. Если кэш свежий (<2ч) — моментальный возврат, 0 запросов к API
 *  2. Если кэш просрочен — пробуем обновить:
 *     a) Если есть lastDate → dateFrom = lastDate (только дельта)
 *     b) Если нет lastDate (первый запуск) → забираем всё за 90 дней
 *  3. Новые записи merge в существующий кэш (upsert по srid)
 *  4. При 429 читаем X-Ratelimit-Retry (или X-Ratelimit-Reset) из заголовка
 *  5. Если есть просроченный кэш — отдаём его сразу, без retry
 *  6. Если кэша нет — retry по заголовку (fallback 60с), до 3 попыток
 *  7. Кэш сохраняется на диск (logs/wb_sales_cache.json) после каждого обновления
 *
 * @param {string} wbToken - WB API token (raw, без Bearer — statistics-api)
 * @param {function} [log] - функция логирования
 * @param {function} [onWait] - callback(waitSec, attempt) при ожидании retry
 * @returns {Promise<Map<string, object>>}
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

        // Перестраиваем bySticker из обновлённого data
        wbSalesCache.bySticker = new Map()
        for (const record of wbSalesCache.data) {
          if (record.sticker) wbSalesCache.bySticker.set(String(record.sticker), record)
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
          wbSalesCache.isFetching = false
          // Сохраняем как есть — хоть fetchedAt старый, но данные остаются
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
 * Отличия от статистик-API:
 *  - Хост: seller-analytics-api.wildberries.ru
 *  - Ответ: { report: [ { orderId, date, returnType, reason, nmId, price, ... } ] }
 *  - Ключ: orderId (не srid, не sticker)
 *  - Первая загрузка: 3 последовательных запроса по 30 дней, с паузами 60с между ними
 *  - Лимит: 1 запрос/мин
 *
 * Алгоритм:
 *  1. Если кэш свежий (<2ч) — моментальный возврат, 0 запросов к API
 *  2. Если кэш просрочен — пробуем обновить:
 *     a) Если есть lastDate → dateFrom = lastDate (только дельта, 1 запрос)
 *     b) Если нет lastDate (первый запуск) → 3 запроса, покрывающие 90 дней
 *  3. Новые записи merge в существующий кэш (upsert по orderId)
 *  4. При 429 читаем X-Ratelimit-Retry из заголовка
 *  5. Если есть просроченный кэш — отдаём его сразу, без retry
 *  6. Если кэша нет — retry по заголовку (fallback 60с), до 3 попыток
 *  7. Кэш сохраняется на диск после каждого обновления
 *
 * @param {string} wbToken - WB API token
 * @param {function} [log] - функция логирования
 * @param {function} [onWait] - callback(waitSec, attempt) при ожидании retry
 * @returns {Promise<Map<string, object>>}
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
                wbAnalyticsReturnsCache.isFetching = false
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
          wbAnalyticsReturnsCache.isFetching = false
          return wbAnalyticsReturnsCache.byOrderId
        }

        if (attempt < 3) {
          if (onWait) onWait(backoffSec, attempt)
          await new Promise(r => setTimeout(r, backoffSec * 1000))
          continue
        }
        // Третья попытка — тоже 429, выходим с тем что есть
        log(`[WB Analytics] rate limited (429) after ${attempt} attempts, returning stale cache or empty`)
        wbAnalyticsReturnsCache.isFetching = false
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
 * Вспомогательная функция: merge записей из отчёта Analytics Returns
 * в существующий кэш (upsert по orderId), обновление lastDate,
 * очистка записей старше 90 дней, сохранение на диск.
 *
 * @param {Array} records - массив записей из res.body.report
 * @param {function} log - функция логирования
 */
/**
 * Извлекает дату из записи analytics/goods-return
 * Поля в порядке приоритета: completedDt → orderDt → readyToReturnDt
 * @param {Object} record - запись из analytics API
 * @returns {string|null} дата в ISO формате или null
 */
function getAnalyticsRecordDate(record) {
  return record.completedDt || record.orderDt || record.readyToReturnDt || null
}

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
// WB Маркетплейс API (api/v3/orders) — получение orderId (Номер сборочного)
// ═══════════════════════════════════════════════════════════════════

/**
 * Получить rid → order + nmId → orders[] из Маркетплейс API (api/v3/orders)
 *
 * Поле id = Номер сборочного задания = то, по чему ищем в МС.
 * Поле rid = совпадает с srid из statistics-api (supplier/sales, supplier/orders).
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
            wbOrdersCache.isFetching = false
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

    // ── Сохраняем в кэш ──

    // Запоминаем XLSX-импортированные записи, чтобы не потерять их после перезаписи
    const xlsxRecords = (wbOrdersCache.data || []).filter(r => r._source === 'xlsx')

    wbOrdersCache.data = allOrders

    // Строим byRid: rid → order
    wbOrdersCache.byRid = new Map()
    for (const order of allOrders) {
      if (order.rid) wbOrdersCache.byRid.set(order.rid, order)
    }

    // Строим byNmId: nmId → [order, ...]
    wbOrdersCache.byNmId = new Map()
    for (const order of allOrders) {
      const nmId = String(order.nmId || '')
      if (nmId) {
        if (!wbOrdersCache.byNmId.has(nmId)) wbOrdersCache.byNmId.set(nmId, [])
        wbOrdersCache.byNmId.get(nmId).push(order)
      }
    }

    // Строим byId: id → order
    for (const order of allOrders) {
      if (order.id) wbOrdersCache.byId.set(String(order.id), order)
    }

    // Восстанавливаем XLSX-импортированные записи (не перезаписываем API)
    if (xlsxRecords.length > 0) {
      let restored = 0
      for (const xr of xlsxRecords) {
        const xid = String(xr.id)
        if (wbOrdersCache.byId.has(xid)) continue // API уже имеет эту запись
        allOrders.push(xr)
        wbOrdersCache.byId.set(xid, xr)
        if (xr.rid) wbOrdersCache.byRid.set(xr.rid, xr)
        if (xr.nmId) {
          const n = String(xr.nmId)
          if (!wbOrdersCache.byNmId.has(n)) wbOrdersCache.byNmId.set(n, [])
          wbOrdersCache.byNmId.get(n).push(xr)
        }
        restored++
      }
      if (restored > 0) log(`[WB Orders] restored ${restored} XLSX-imported records`)
    }

    wbOrdersCache.fetchedAt = Date.now()

    // Сохраняем на диск
    try {
      fs.writeFileSync(WB_ORDERS_CACHE_FILE, JSON.stringify({
        data: allOrders,
        fetchedAt: wbOrdersCache.fetchedAt
      }))
      log(`[WB Orders] saved to disk: ${allOrders.length} orders`)
    } catch (e) {
      log(`[WB Orders] disk save error: ${e.message}`)
    }

    wbOrdersCache.isFetching = false
    log(`[WB Orders] fetch complete: ${allOrders.length} orders total, ${wbOrdersCache.byRid.size} rids, ${wbOrdersCache.byNmId.size} nmIds, ${wbOrdersCache.byId.size} ids`)
    return { byRid: wbOrdersCache.byRid, byNmId: wbOrdersCache.byNmId, byId: wbOrdersCache.byId }

  } catch (e) {
    wbOrdersCache.isFetching = false
    log(`[WB Orders] fetch error: ${e.message}`, 'error')
    if (wbOrdersCache.byRid) {
      log(`[WB Orders] returning stale cache after error`)
      return { byRid: wbOrdersCache.byRid, byNmId: wbOrdersCache.byNmId, byId: wbOrdersCache.byId }
    }
    return { byRid: new Map(), byNmId: new Map(), byId: new Map() }
  }
}

/**
 * Получить srid → sticker из statistics-api (supplier/orders)
 *
 * Нужно для связки: srid (statistics) = rid (Маркетплейс) → sticker → orderId.
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
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

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
          wbOrdersStickersCache.isFetching = false
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
    if (wbOrdersStickersCache.bySrid) return wbOrdersStickersCache.bySrid
    return new Map()
  }

  wbOrdersStickersCache.isFetching = false
  return wbOrdersStickersCache.bySrid || new Map()
}

/**
 * Объединяет записи аналитики возвратов и продаж WB по ключу orderId/sticker.
 *
 * Ключ объединения: analytics.orderId === sales.sticker
 * (оба — номер сборочного задания WB)
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
        salesDate: salesRecord.date || '',
        lastChangeDate: salesRecord.lastChangeDate || '',
        salesNmId: salesRecord.nmId || '',
        saleID: salesRecord.saleID || ''
      })
    }
  }

  return merged
}

function generateAbortId() {
  return Math.random().toString(36).substring(2, 15)
}

const app = express()
const PORT = process.env.PORT || 3000

// Track SSE connections for proper shutdown
const sseConnections = new Set()

// Middleware для парсинга JSON (10MB — для checkData из 2000+ заказов)
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))
const LOG_DAYS_KEEP = 10

// Удаление старых логов при запуске
function cleanOldLogs() {
  try {
    if (!fs.existsSync(LOG_DIR)) return

    const files = fs.readdirSync(LOG_DIR)
    const now = Date.now()
    let deleted = 0

    for (const file of files) {
      if (!file.startsWith('payments_') || !file.endsWith('.log')) continue

      const filePath = path.join(LOG_DIR, file)
      const stats = fs.statSync(filePath)
      const ageDays = (now - stats.mtimeMs) / (1000 * 60 * 60 * 24)

      if (ageDays > LOG_DAYS_KEEP) {
        fs.unlinkSync(filePath)
        deleted++
      }
    }

    console.log(`[Startup] Удалено старых логов: ${deleted}`)
  } catch (e) {
    console.error('[Startup] Ошибка очистки логов:', e.message)
  }
}

// Запускаем очистку при старте
cleanOldLogs()

// Определение цвета по содержимому сообщения
function getColor(message) {
  if (message.includes('Ошибка') || message.includes('error') || message.includes('ERROR')) return colors.red
  if (message.includes('успешно') || message.includes('created') || message.includes('Успех') ||
      message.includes('Найдено') || message.includes('Проверен') || message.includes('Found')) return colors.green
  if (message.includes('Пропущен') || message.includes('skipped') || message.includes('возврат')) return colors.yellow
  if (message.includes('Завершено') || message.includes('completed') || message.includes('Поиск')) return colors.cyan
  if (message.includes('Начало') || message.includes('batch') || message.includes('отмен') ||
      message.includes('Сервер запущен')) return colors.magenta
  if (message.includes('Фильтр') || message.includes('WB') || message.includes('Ozon') ||
      message.includes('Market') || message.includes('[HTTP]')) return colors.blue
  return colors.white
}

// Логирование с подробностями и цветом
function log(message, details = null) {
  const now = new Date()
  const dateStr = now.toISOString().split('T')[0]
  const timeStr = now.toTimeString().split(' ')[0]

  let fullMessage = message
  if (details) {
    if (typeof details === 'object') {
      fullMessage += ' | Данные: ' + JSON.stringify(details)
    } else {
      fullMessage += ' | ' + details
    }
  }

  const logLine = `[${dateStr} ${timeStr}] ${fullMessage}\n`
  const logFile = path.join(LOG_DIR, `payments_${dateStr}.log`)

  fs.appendFileSync(logFile, logLine)

  // Цветной вывод в консоль
  const color = getColor(message)
  console.log(`${color}${fullMessage}${colors.reset}`)
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() })
})

// Abort endpoint - при отмене устанавливаем флаг
app.post('/api/abort', (req, res) => {
  const { abortId } = req.body
  if (abortId) {
    abortSignals.set(abortId, true)
    log(`Abort requested for: ${abortId}`)
  }
  res.json({ success: true })
})

// Process numbers (check) - с поддержкой SSE streaming
app.post('/api/process', async (req, res) => {
  const { numbers } = req.body
  const token = req.headers['x-api-token']
  log('API: process/check, token present: ' + !!token)

  if (!token) {
    return res.json({ error: 'Требуется токен API' })
  }

  process.env.MOYSKLAD_TOKEN = token
  initApi(token)

  if (!numbers || !Array.isArray(numbers)) {
    return res.json({ error: 'Некорректные данные' })
  }

  log('=== Начало check ===')
  log(`Количество: ${numbers.length}`)

  try {
    const result = await processBatch(numbers, 'check', log)
    log('=== Завершено ===')
    res.json(result)
  } catch (e) {
    log(`Ошибка: ${e.message}`)
    res.json({ error: e.message })
  }
})

// SSE endpoint для realtime обновлений
app.get('/api/process/stream', (req, res) => {
  const token = req.query.token || req.headers['x-api-token']
  const numbersParam = req.query.numbers
  const abortId = req.query.abortId

  if (!token) {
    return res.status(401).json({ error: 'Требуется токен API' })
  }

  if (!numbersParam) {
    return res.status(400).json({ error: 'Требуется массив numbers' })
  }

  const numbers = numbersParam
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n)

  if (numbers.length === 0) {
    return res.status(400).json({ error: 'Пустой массив numbers' })
  }

  // SSE заголовки
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no') // Отключаем nginx буферизацию

  // Track SSE connection
  sseConnections.add(res)
  res.on('close', () => {
    sseConnections.delete(res)
  })

  log(`=== SSE: start check ${numbers.length} orders ===`)

  // Инициализируем API с токеном
  process.env.MOYSKLAD_TOKEN = token
  initApi(token)

  // Callback для проверки отмены
  function checkAbort() {
    if (abortId && abortSignals.get(abortId)) {
      abortSignals.delete(abortId)
      return true
    }
    return false
  }

  // Callback для отправки каждого результата
  const onProgress = (result, index, total) => {
    const data = JSON.stringify({
      type: 'progress',
      index: index + 1,
      total: total,
      order: result
    })
    res.write(`data: ${data}\n\n`)

    // Flush для немедленной отправки
    if (res.flush) res.flush()
  }

  // Обрабатываем батч с callback и опциями abort
  processBatch(numbers, 'check', log, onProgress, { onAbort: checkAbort })
    .then((result) => {
      // Если прервано - отправляем событие abort
      if (result.aborted) {
        res.write(`data: ${JSON.stringify({ type: 'aborted', processed: result.processed })}\n\n`)
        log(`=== SSE: aborted after ${result.processed} orders ===`)
      } else {
        // Отправляем завершение
        res.write(`data: ${JSON.stringify({ type: 'done', orders: result.orders })}\n\n`)
        log(`=== SSE: completed ${numbers.length} orders ===`)
      }
      res.end()
    })
    .catch((e) => {
      log(`SSE error: ${e.message}`)
      res.write(`data: ${JSON.stringify({ type: 'error', error: e.message })}\n\n`)
      res.end()
    })

  // Cleanup при disconnect - устанавливаем флаг abort
  req.on('close', () => {
    log('SSE: client disconnected, setting abort flag')
    if (abortId) {
      abortSignals.set(abortId, true)
    }
  })
})

// SSE endpoint для поиска возвратов WB по стикеру
app.get('/api/wb-return/stream', async (req, res) => {
  const wbToken = req.headers['x-wb-token']
  const msToken = req.query.token || req.headers['x-api-token']
  const numbersParam = req.query.numbers
  const abortId = req.query.abortId

  if (!wbToken) {
    return res.status(401).json({ error: 'Требуется WB токен' })
  }
  if (!msToken) {
    return res.status(401).json({ error: 'Требуется токен API МС' })
  }
  if (!numbersParam) {
    return res.status(400).json({ error: 'Требуется массив numbers' })
  }

  const numbers = numbersParam
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n)

  if (numbers.length === 0) {
    return res.status(400).json({ error: 'Пустой массив numbers' })
  }

  // SSE заголовки
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  sseConnections.add(res)
  res.on('close', () => { sseConnections.delete(res) })

  log(`=== WB-Return SSE: start ${numbers.length} orders ===`)

  // Инициализируем API МС с токеном
  process.env.MOYSKLAD_TOKEN = msToken
  initApi(msToken)

  function checkAbort() {
    if (abortId && abortSignals.get(abortId)) {
      abortSignals.delete(abortId)
      return true
    }
    return false
  }

  if (checkAbort()) {
    res.write(`data: ${JSON.stringify({ type: 'aborted', processed: 0 })}\n\n`)
    log('=== WB-Return SSE: aborted before start ===')
    return res.end()
  }

  // onWait выносим ЗА пределы try, чтобы было доступно во всех try-блоках
  const onWait = (sec, attempt) => {
    res.write(`data: ${JSON.stringify({ type: 'progress', index: 0, total: numbers.length,
      order: { shipmentNum: '⏳', orderName: `Лимит WB, попытка ${attempt}/3, ждём ${sec}с...`, sum: 0, statusName: 'Ожидание', status: 'pending' }
    })}\n\n`)
    if (res.flush) res.flush()
  }

  // ─── 1. Получаем данные analytics/goods-return (с кэшем и retry) ───
  let orderMap = new Map()
  try {
     orderMap = await getWBAnalyticsReturnsMap(wbToken, log, onWait)
    log(`WB-Return: pre-fetched ${orderMap.size} records with orderIds`)
  } catch (e) {
    log(`WB-Return: pre-fetch error: ${e.message}`)
  }

  // ─── 1b. Получаем данные supplier/sales (с кэшем и retry) ───
  let salesMap = new Map()
  try {
    log(`WB-Return: loading sales cache...`)
    salesMap = await getWBSalesMap(wbToken, log, onWait)
    log(`WB-Return: pre-fetched ${salesMap.size} sales records`)
  } catch (e) {
    log(`WB-Return: sales pre-fetch error: ${e.message}`)
  }

  // ─── 1c. Объединяем аналитику и продажи ───
  const mergedMap = mergeAnalyticsAndSales(orderMap, salesMap)
  log(`WB-Return: merged map has ${mergedMap.size} records (analytics: ${orderMap.size}, sales: ${salesMap.size})`)

  // ─── 1d. Данные из кэша Маркетплейс (rid→orderId для связки srid=rid) ───
  // Загружаются только по кнопке "WB Обновить", здесь — только использование кэша
  const ordersByRid = wbOrdersCache.byRid || new Map()
  const ordersByNmId = wbOrdersCache.byNmId || new Map()
  const ordersById = wbOrdersCache.byId || new Map()
  const stickersBySrid = wbOrdersStickersCache.bySrid || new Map()
  if (ordersByRid.size > 0) {
    log(`WB-Return: Маркетплейс кэш доступен: ${ordersByRid.size} rids, ${ordersByNmId.size} nmIds, ${ordersById.size} ids, ${stickersBySrid.size} stickers`)
  }

  // ─── Cleanup at disconnect ───
  req.on('close', () => {
    log('WB-Return SSE: client disconnected')
    if (abortId) abortSignals.set(abortId, true)
  })

  // ─── 2. Обрабатываем каждый стикер из локальной Map ───
  let processed = 0
  let orders = []

  for (let index = 0; index < numbers.length; index++) {
    if (checkAbort()) {
      res.write(`data: ${JSON.stringify({ type: 'aborted', processed })}\n\n`)
      log(`=== WB-Return SSE: aborted after ${processed} orders ===`)
      return res.end()
    }

    const sticker = numbers[index]
    log(`WB-Return: processing sticker ${sticker} (${index + 1}/${numbers.length})`)

    try {
      // ─── Шаг 1: Поиск в Маркетплейс по id (Номер сборочного задания) ───
      let mpRecord = null
      if (ordersById.size > 0) {
        mpRecord = ordersById.get(String(sticker))
        if (mpRecord) {
          log(`WB-Return: Маркетплейс id ${sticker} → orderId ${mpRecord.id}, nmId=${mpRecord.nmId}, price=${mpRecord.price}`)
        }
      }

      // ─── Шаг 1а: Поиск в Маркетплейс по skus (штрихкод в массиве skus) ───
      if (!mpRecord && wbOrdersCache && wbOrdersCache.data) {
        for (const order of wbOrdersCache.data) {
          if (order.skus && Array.isArray(order.skus) && order.skus.some(sku => String(sku) === String(sticker))) {
            mpRecord = order
            log(`WB-Return: Маркетплейс skus ${sticker} → orderId ${mpRecord.id}, nmId=${mpRecord.nmId}, price=${mpRecord.price}`)
            break
          }
        }
      }

      // ─── Шаг 2: Поиск по ключу mergedMap (sticker/orderId) ───
      let record = mergedMap.get(String(sticker))
      // Если не найден — ищем по stickerId, orderId, srid в значениях
      if (!record) {
        for (const [, r] of mergedMap) {
          if (String(r.stickerId) === String(sticker) || 
              String(r.orderId) === String(sticker) ||
              String(r.srid) === String(sticker)) {
            record = r
            break
          }
        }
      }

      // Если не нашли в mergedMap — ищем в salesMap напрямую
      if (!record && salesMap && salesMap.size > 0) {
        let salesRecord = salesMap.get(String(sticker))
        if (!salesRecord) {
          for (const [, sr] of salesMap) {
            if (String(sr.sticker) === String(sticker) ||
                String(sr.srid) === String(sticker) ||
                String(sr.nmId) === String(sticker) ||
                String(sr.barcode) === String(sticker)) {
              salesRecord = sr
              break
            }
          }
        }
        if (salesRecord) {
          log(`WB-Return: found sticker ${sticker} in sales cache (orderId: ${salesRecord.sticker || '?'})`)
          // Формируем record из sales-записи (поля совместимые с analytics)
          record = {
            orderId: salesRecord.sticker || sticker,
            stickerId: '',
            nmId: salesRecord.nmId || '',
            barcode: salesRecord.barcode || '',
            shkId: '',
            srid: salesRecord.srid || '',
            returnType: '',
            reason: '',
            status: '',
            completedDt: salesRecord.lastChangeDate || salesRecord.date || '',
            orderDt: salesRecord.date || '',
            readyToReturnDt: '',
            subjectName: '',
            brand: '',
            techSize: '',
            dstOfficeAddress: '',
            dstOfficeId: '',
            totalPrice: salesRecord.totalPrice || 0,
            lastChangeDate: salesRecord.lastChangeDate || ''
          }
        }
      }

      // ─── Шаг 4: Если Маркетплейс знает номер, а mergedMap/salesMap нет — создаём базовый record ───
      if (!record && mpRecord) {
        log(`WB-Return: создаём record из Маркетплейс (id=${mpRecord.id}, nmId=${mpRecord.nmId})`)
        record = {
          orderId: String(mpRecord.id),
          stickerId: '',
          nmId: String(mpRecord.nmId || ''),
          barcode: '',
          shkId: '',
          srid: mpRecord.rid || '',
          returnType: '',
          reason: '',
          status: '',
          completedDt: mpRecord.createdAt || '',
          orderDt: '',
          readyToReturnDt: '',
          subjectName: '',
          brand: '',
          techSize: '',
          dstOfficeAddress: '',
          dstOfficeId: '',
          totalPrice: mpRecord.price || 0,
          lastChangeDate: mpRecord.createdAt || ''
        }
      }

      if (!record) {
        res.write(`data: ${JSON.stringify({
          type: 'progress', index: index + 1, total: numbers.length,
          order: {
            shipmentNum: sticker,
            orderName: '-',
            sum: 0,
            statusName: 'Не найден в WB (ни возврат, ни продажа)',
            status: 'error',
            hasReturn: false,
            hasDemand: false,
            hasPayment: false,
            orderPositions: [],
            returnSum: 0,
            returnType: '',
            reason: '',
            srid: '',
            wbTotalPrice: 0,
            lastChangeDate: ''
          }
        })}\n\n`)
        if (res.flush) res.flush()
        processed++
        continue
      }

      // orderId = номер сборочного задания из Analytics API, Sales или Маркетплейс
      // Пытаемся найти правильный orderId через связки Маркетплейс кэша:
      let orderId = record.orderId

      // 1. srid=rid (самый точный — прямая связка statistics ↔ marketplace)
      if (record.srid) {
        const marketOrder = ordersByRid.get(record.srid)
        if (marketOrder && marketOrder.id) {
          log(`WB-Return: Маркетплейс srid=rid ${record.srid} → orderId ${marketOrder.id} (was ${orderId})`)
          orderId = String(marketOrder.id)
        }
      }

      // 2. nmId fallback — если srid не дал результат, ищем по артикулу товара
      //    Раньше был вложен в if(srid), что пропускало его при пустом srid
      if (orderId === record.orderId && record.nmId) {
        const nmOrders = ordersByNmId.get(String(record.nmId))
        if (nmOrders && nmOrders.length > 0) {
          // Берём первый заказ — наилучшее приближение
          const nmOrder = nmOrders[0]
          if (nmOrder && nmOrder.id) {
            log(`WB-Return: Маркетплейс nmId ${record.nmId} → orderId ${nmOrder.id} (was ${orderId})`)
            orderId = String(nmOrder.id)
          }
        }
      }
      const returnType = record.returnType || ''
      const reason = record.reason || ''

      // 2. Ищем заказ в МС по номеру сборочного задания
      let orderResult
      try {
        orderResult = await checkOrder(orderId)
      } catch (e) {
        log(`WB-Return: checkOrder error for ${orderId}: ${e.message}`)
        orderResult = null
      }

      if (orderResult) {
        orderResult.shipmentNum = orderId
        // Обогащаем данными из объединённого кэша WB
        orderResult.returnType = record.returnType || ''
        orderResult.reason = record.reason || ''
        orderResult.srid = record.srid || ''
        orderResult.wbTotalPrice = record.totalPrice || 0
        orderResult.lastChangeDate = record.lastChangeDate || ''
        // WB поля (из analytics goods-return)
        orderResult.wbArticle = record.nmId || ''
        orderResult.wbBarcode = record.barcode || ''
        orderResult.wbShkId = record.shkId || ''
        orderResult.wbStickerId = record.stickerId || ''
        orderResult.wbCompletedDt = record.completedDt || ''
        orderResult.wbSubjectName = record.subjectName || ''
        orderResult.wbStatus = record.status || ''
        orders.push(orderResult)
        res.write(`data: ${JSON.stringify({
          type: 'progress', index: index + 1, total: numbers.length, order: orderResult
        })}\n\n`)
      } else {
        const wbDate = record.completedDt || record.orderDt || record.salesDate || record.lastChangeDate || ''
        res.write(`data: ${JSON.stringify({
          type: 'progress', index: index + 1, total: numbers.length,
          order: {
            shipmentNum: orderId,
            orderName: record.nmId ? String(record.nmId) : `Заказ ${orderId}`,
            sum: record.totalPrice || 0,
            statusName: record.returnType ? 'Не найден в МС' : 'Только WB (продажа)',
            status: record.returnType ? 'error' : 'shipped',
            hasReturn: false,
            hasDemand: false,
            hasPayment: false,
            orderPositions: [],
            returnSum: 0,
            returnType: record.returnType || '',
            reason: record.reason || '',
            srid: record.srid || '',
            wbTotalPrice: record.totalPrice || 0,
            lastChangeDate: record.lastChangeDate || '',
            orderMoment: wbDate,
            wbArticle: record.nmId || '',
            wbBarcode: record.barcode || '',
            wbShkId: record.shkId || '',
            wbStickerId: record.stickerId || '',
            wbCompletedDt: record.completedDt || '',
            wbOrderDt: record.orderDt || '',
            wbSubjectName: record.subjectName || '',
            wbStatus: record.status || ''
          }
        })}\n\n`)
      }
    } catch (e) {
      log(`WB-Return: error processing ${sticker}: ${e.message}`)
      res.write(`data: ${JSON.stringify({
        type: 'progress', index: index + 1, total: numbers.length,
        order: {
          shipmentNum: sticker,
          orderName: '-',
          sum: 0,
          statusName: `Ошибка: ${e.message}`,
          status: 'error',
          hasReturn: false,
          hasDemand: false,
          hasPayment: false,
          orderPositions: [],
          returnSum: 0,
          returnType: '',
          reason: '',
          srid: '',
          wbTotalPrice: 0,
          lastChangeDate: ''
        }
      })}\n\n`)
    }

    if (res.flush) res.flush()
    processed++
  }

  // Все обработаны
  res.write(`data: ${JSON.stringify({ type: 'done', orders })}\n\n`)
  log(`=== WB-Return SSE: completed ${numbers.length} orders ===`)
  res.end()
})

// Batch action
app.post('/api/batch', async (req, res) => {
  const { numbers, action } = req.body
  const token = req.headers['x-api-token']
  log('API: batch, action: ' + action + ', token present: ' + !!token)

  if (!token) {
    return res.json({ error: 'Требуется токен API' })
  }

  process.env.MOYSKLAD_TOKEN = token
  initApi(token)

  if (!numbers || !Array.isArray(numbers)) {
    return res.json({ error: 'Некорректные данные' })
  }

  const validActions = ['demand', 'payment', 'return', 'cancel']
  if (!validActions.includes(action)) {
    return res.json({ error: 'Некорректное действие. Доступно: ' + validActions.join(', ') })
  }

  log(`=== Начало batch: ${action} ===`)
  log(`Количество: ${numbers.length}`)

  try {
    const result = await processBatch(numbers, action, log)
    log('=== Завершено ===')
    res.json(result)
  } catch (e) {
    log(`Ошибка: ${e.message}`)
    res.json({ error: e.message })
  }
})

// SSE endpoint для realtime batch операций
app.post('/api/batch/stream', (req, res) => {
  const token = req.body.token || req.headers['x-api-token']
  const numbers = req.body.numbers
  const action = req.body.action
  const abortId = req.body.abortId

  if (!token) {
    return res.status(401).json({ error: 'Требуется токен API' })
  }

  if (!numbers || !Array.isArray(numbers) || numbers.length === 0) {
    return res.status(400).json({ error: 'Требуется массив numbers' })
  }
  const validActions = ['demand', 'payment', 'return', 'cancel']

  if (!validActions.includes(action)) {
    return res
      .status(400)
      .json({ error: 'Некорректное действие. Доступно: ' + validActions.join(', ') })
  }

  // SSE заголовки
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  // Track SSE connection
  sseConnections.add(res)
  res.on('close', () => {
    sseConnections.delete(res)
  })

  log(`=== SSE: batch ${action} for ${numbers.length} orders ===`)

  // Инициализируем API с токеном
  process.env.MOYSKLAD_TOKEN = token
  initApi(token)

  let stats = { created: 0, skipped: 0, errors: 0 }

  // Callback для проверки отмены
  function checkAbort() {
    if (abortId && abortSignals.get(abortId)) {
      abortSignals.delete(abortId)
      return true
    }
    return false
  }

  // Callback для отправки каждого результата
  const onProgress = (result, index, total) => {
    if (result.status === 'created') stats.created++
    else if (result.status === 'skipped') stats.skipped++
    else if (result.status === 'error') stats.errors++

    const data = JSON.stringify({
      type: 'progress',
      index: index + 1,
      total: total,
      action: action,
      result: result,
      stats: stats
    })
    res.write(`data: ${data}\n\n`)

    if (res.flush) res.flush()
  }

  // Флаг: завершён ли ответ (чтобы отличать premature close от нормального)
  let responseEnded = false

  // Обрабатываем батч с callback и опциями abort и checkResults
  processBatch(numbers, action, log, onProgress, { onAbort: checkAbort, checkResults: req.body.checkData || null })
    .then((result) => {
      responseEnded = true
      // Если прервано - отправляем событие abort
      if (result.aborted) {
        res.write(
          `data: ${JSON.stringify({ type: 'aborted', processed: result.processed, stats: stats })}\n\n`
        )
        log(`=== SSE: batch ${action} aborted after ${result.processed} orders ===`)
      } else {
        res.write(
          `data: ${JSON.stringify({ type: 'done', stats: stats, orders: result.orders })}\n\n`
        )
        log(
          `=== SSE: batch ${action} completed - created:${stats.created}, skipped:${stats.skipped}, errors:${stats.errors} ===`
        )
      }
      res.end()
    })
    .catch((e) => {
      responseEnded = true
      log(`SSE batch error: ${e.message}`)
      try { res.write(`data: ${JSON.stringify({ type: 'error', error: e.message })}\n\n`) } catch (_) {}
      res.end()
    })

  // Cleanup при disconnect - используем res.on('close'), а не req.on('close')
  // req.on('close') для POST срабатывает преждевременно (Node.js autoDestroy после чтения тела),
  // res.on('close') срабатывает при реальном отключении клиента.
  res.on('close', () => {
    if (!responseEnded) {
      log('SSE batch: client disconnected, setting abort flag')
      if (abortId) {
        abortSignals.set(abortId, true)
      }
    }
  })
})

// Save report
app.post('/api/save-report', async (req, res) => {
  const { ordersData, resultsData } = req.body
  const dateStr = new Date().toISOString().split('T')[0]
  const reportFile = path.join(moduleRoot, 'logs', `report_${dateStr}.json`)

  const report = {
    generated: new Date().toISOString(),
    results: resultsData,
    orders: ordersData
  }

  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2))
  log(`Отчёт сохранён: ${reportFile}`)

  res.json({ success: true, file: reportFile })
})

// Create single payment
app.post('/api/create-payment', async (req, res) => {
  const { shipmentNum } = req.body
  const token = req.headers['x-api-token']

  if (!token || !shipmentNum) {
    return res.json({ error: 'Требуется токен и номер отправления' })
  }

  initApi(token)
  log(`Создание платежа: ${shipmentNum}`, { token: token.slice(0, 8) + '...' })

  try {
    log(`Проверка заказа: ${shipmentNum}`)
    const checkResult = await checkOrder(shipmentNum, log)

    if (!checkResult.canPayment) {
      log(`Нельзя создать платёж: ${checkResult.statusName}`, {
        shipmentNum,
        status: checkResult.status
      })
      updateOrderState(shipmentNum, 'payment_check', 'skipped: ' + checkResult.statusName)
      return res.json({ error: 'Невозможно создать платёж: ' + checkResult.statusName })
    }

    log(`Заказ найден, создаю платёж: ${shipmentNum}`)
    const payment = await createPayment(checkResult.orderId)
    log(`Платёж создан: ${payment.name}`, { shipmentNum })

    // Получаем данные для обновления состояния
    const { getOrderFullForCreate, getDemand } = require('./lib/order')
    const orderFull = await getOrderFullForCreate(checkResult.orderId)
    const demandId = orderFull.demands[0].meta.href.split('/').pop()
    const demand = await getDemand(demandId)

    updateOrderState(shipmentNum, 'payment_created', payment.name, {
      orderName: orderFull.name,
      sum: demand.sum / 100,
      paid: demand.payedSum / 100,
      orderId: orderFull.id,
      orderUrl: `https://online.moysklad.ru/app/#customerorder/${orderFull.id}`
    })

    res.json({ success: true, paymentName: payment.name })
  } catch (e) {
    log(`Ошибка: ${e.message}`, { shipmentNum, stack: e.stack })
    updateOrderState(shipmentNum, 'payment_error', e.message)
    res.json({ error: e.message })
  }
})

// Create partial payment (with returns deduction) - manual only
app.post('/api/create-partial-payment', async (req, res) => {
  const { shipmentNum } = req.body
  const token = req.headers['x-api-token']

  if (!token || !shipmentNum) {
    return res.json({ error: 'Требуется токен и номер отправления' })
  }

  initApi(token)
  log(`Создание частичного платежа: ${shipmentNum}`, { token: token.slice(0, 8) + '...' })

  try {
    log(`Проверка заказа: ${shipmentNum}`)
    const order = await findOrderByShipmentNum(shipmentNum, log)
    if (!order) {
      log(`Заказ не найден: ${shipmentNum}`)
      updateOrderState(shipmentNum, 'partial_payment_check', 'order_not_found')
      return res.json({ error: 'Заказ не найден' })
    }

    log(`Создаю частичный платёж: ${shipmentNum}`, { orderId: order.id })
    const { createPartialPayment } = require('./lib/payment')
    const result = await createPartialPayment(order.id)
    log(`Частичный платёж создан: ${result.name}`, { 
      shipmentNum, 
      paymentId: result.id,
      paymentSum: result.paymentSum 
    })

    // Получаем данные для обновления состояния
    const { getOrderFullForCreate } = require('./lib/order')
    const orderFull = await getOrderFullForCreate(order.id)

    updateOrderState(shipmentNum, 'partial_payment_created', result.name, {
      orderName: orderFull.name,
      orderId: orderFull.id,
      paymentSum: result.paymentSum,
      orderUrl: `https://online.moysklad.ru/app/#customerorder/${orderFull.id}`
    })
    res.json({ success: true, paymentName: result.name, paymentSum: result.paymentSum })
  } catch (e) {
    log(`Ошибка создания частичного платежа: ${e.message}`, { shipmentNum, stack: e.stack })
    updateOrderState(shipmentNum, 'partial_payment_error', e.message)
    res.json({ error: e.message })
   }
 })
 
 // Refresh WB sales cache (invalidate TTL and re-fetch)
 app.post('/api/wb-sales/refresh', async (req, res) => {
   const wbToken = req.headers['x-wb-token']

   if (!wbToken) {
     return res.json({ error: 'Требуется WB токен (x-wb-token)' })
   }

   log('WB sales cache: manual refresh requested')

   try {
     // Invalidate cache TTL so getWBSalesMap re-fetches
     wbSalesCache.fetchedAt = 0

     const result = await getWBSalesMap(wbToken, log)

     const data = wbSalesCache.data || []
     const lastDate = wbSalesCache.lastDate || null

     log(`WB sales cache: refreshed — ${data.length} records, ${result.size} stickers, lastDate=${lastDate}`)

     res.json({
       success: true,
       records: data.length,
       bySticker: result.size,
       lastDate
     })
    } catch (e) {
      log(`WB sales cache: refresh error — ${e.message}`, 'error')
      res.json({ error: e.message })
    }
  })

  // Refresh WB returns cache (invalidate TTL and re-fetch)
  app.post('/api/wb-returns/refresh', async (req, res) => {
    const wbToken = req.headers['x-wb-token']

    if (!wbToken) {
      return res.json({ error: 'Требуется WB токен (x-wb-token)' })
    }

    log('WB analytics returns: manual refresh requested')

    try {
      // Invalidate cache TTL so getWBAnalyticsReturnsMap re-fetches
      wbAnalyticsReturnsCache.fetchedAt = 0

      const result = await getWBAnalyticsReturnsMap(wbToken, log)

      const data = wbAnalyticsReturnsCache.data || []
      const lastDate = wbAnalyticsReturnsCache.lastDate || null

      log(`WB analytics returns: refreshed — ${data.length} records, ${result.size} orderIds, lastDate=${lastDate}`)

      res.json({
        success: true,
        records: data.length,
        byOrderId: result.size,
        lastDate
      })
    } catch (e) {
      log(`WB analytics returns: refresh error — ${e.message}`, 'error')
      res.json({ error: e.message })
    }
  })

  // SSE endpoint для потокового обновления WB (продажи + возвраты) и отображения в таблице
  app.get('/api/wb-all/stream', async (req, res) => {
    const wbToken = req.headers['x-wb-token']
    const msToken = req.query.token

    if (!wbToken) {
      return res.status(401).json({ error: 'Требуется WB токен' })
    }
    if (!msToken) {
      return res.status(401).json({ error: 'Требуется токен API МС' })
    }

    // SSE заголовки
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')

    sseConnections.add(res)
    res.on('close', () => { sseConnections.delete(res) })

    const log = (msg) => console.log(`[WB-All] ${msg}`)
    log('=== WB-All SSE: start ===')

    // Инициализируем API МС
    process.env.MOYSKLAD_TOKEN = msToken
    initApi(msToken)

    try {
      // ── Фаза 1: Продажи WB ──
      res.write(`data: ${JSON.stringify({ type: 'progress', msg: 'Обновление продаж WB...' })}\n\n`)
      if (res.flush) res.flush()

      const oldSalesLastDate = wbSalesCache.lastDate
      wbSalesCache.fetchedAt = 0 // инвалидируем кэш
      const salesMap = await getWBSalesMap(wbToken, log)
      log(`[WB-All] sales map: ${salesMap.size} stickers, lastDate: ${wbSalesCache.lastDate}`)

      // Если кэш не обновился (лимит), показываем все записи из кэша
      let salesRecords = []
      let salesFromCache = false
      if (wbSalesCache.data) {
        if (!oldSalesLastDate || wbSalesCache.lastDate !== oldSalesLastDate) {
          // Были новые данные — фильтруем только новые
          salesRecords = wbSalesCache.data.filter(r => {
            if (!oldSalesLastDate) return true
            return r.lastChangeDate && r.lastChangeDate > oldSalesLastDate
          })
        } else {
          // Кэш не обновился (429), показываем всё что есть
          salesRecords = [...wbSalesCache.data]
          salesFromCache = true
        }
      }

      if (salesFromCache) {
        res.write(`data: ${JSON.stringify({ type: 'progress', msg: 'Лимит WB. Показываю сохранённые данные...' })}\n\n`)
        if (res.flush) res.flush()
      }

      // Потоковая отправка каждой записи продаж
      for (const record of salesRecords) {
        if (req.destroyed) break
        const isReturn = String(record.saleID || '').startsWith('R')
        res.write(`data: ${JSON.stringify({
          type: 'order',
          order: {
            shipmentNum: record.sticker || '',
            orderName: record.supplierArticle || '',
            sum: record.totalPrice ? (record.totalPrice / 100) : 0,
            statusName: isReturn ? 'Возврат' : 'Продажа',
            status: isReturn ? 'return' : 'sale',
            hasReturn: isReturn,
            hasDemand: false,
            hasPayment: false,
            orderPositions: [],
            returnSum: isReturn ? Math.abs(record.totalPrice || 0) / 100 : 0,
            date: record.date || '',
            srid: record.srid || '',
            fromCache: salesFromCache
          }
        })}\n\n`)
        if (res.flush) res.flush()
        await new Promise(r => setTimeout(r, 10))
      }

      log(`[WB-All] streamed ${salesRecords.length} sales records${salesFromCache ? ' (from cache)' : ''}`)

      // ── Фаза 2: Возвраты WB (Analytics API) ──
      res.write(`data: ${JSON.stringify({ type: 'progress', msg: 'Обновление возвратов WB...' })}\n\n`)
      if (res.flush) res.flush()

      const oldAnalyticsLastDate = wbAnalyticsReturnsCache.lastDate
      wbAnalyticsReturnsCache.fetchedAt = 0 // инвалидируем кэш
      const analyticsMap = await getWBAnalyticsReturnsMap(wbToken, log)
      log(`[WB-All] analytics map: ${analyticsMap.size} orderIds, lastDate: ${wbAnalyticsReturnsCache.lastDate}`)

      // Если кэш не обновился (лимит), показываем все записи из кэша
      let returnRecords = []
      let returnsFromCache = false
      if (wbAnalyticsReturnsCache.data) {
        if (!oldAnalyticsLastDate || wbAnalyticsReturnsCache.lastDate !== oldAnalyticsLastDate) {
          // Были новые данные — фильтруем только новые
          returnRecords = wbAnalyticsReturnsCache.data.filter(r => {
            if (!oldAnalyticsLastDate) return true
            return r.date && r.date > oldAnalyticsLastDate
          })
        } else {
          // Кэш не обновился (429), показываем всё что есть
          returnRecords = [...wbAnalyticsReturnsCache.data]
          returnsFromCache = true
        }
      }

      if (returnsFromCache) {
        res.write(`data: ${JSON.stringify({ type: 'progress', msg: 'Лимит WB. Показываю сохранённые возвраты...' })}\n\n`)
        if (res.flush) res.flush()
      }

      // Потоковая отправка каждой записи возврата
      for (const record of returnRecords) {
        if (req.destroyed) break
        const reason = record.reason || record.returnType || 'Возврат'
        const wbDate = record.completedDt || record.orderDt || ''
        res.write(`data: ${JSON.stringify({
          type: 'order',
          order: {
            shipmentNum: record.orderId || '',
            orderName: record.nmId ? String(record.nmId) : (record.supplierArticle || ''),
            sum: record.price ? (record.price / 100) : 0,
            statusName: `Возврат: ${reason}`,
            status: 'return',
            hasReturn: true,
            hasDemand: false,
            hasPayment: false,
            orderPositions: [],
            returnSum: record.price ? Math.abs(record.price) / 100 : 0,
            date: wbDate,
            returnType: record.returnType || '',
            reason: record.reason || '',
            fromCache: returnsFromCache,
            stickerId: record.stickerId || '',
            wbStatus: record.status || '',
            subjectName: record.subjectName || ''
          }
        })}\n\n`)
        if (res.flush) res.flush()
        await new Promise(r => setTimeout(r, 10))
      }

      log(`[WB-All] streamed ${returnRecords.length} return records${returnsFromCache ? ' (from cache)' : ''}`)

      // ── Фаза 3: Загрузка Маркетплейс API (rid→orderId для связки srid=rid) ──
      res.write(`data: ${JSON.stringify({ type: 'progress', msg: 'Обновление заказов Маркетплейс...' })}\n\n`)
      if (res.flush) res.flush()

      // Инвалидируем кэш Маркетплейс
      wbOrdersCache.fetchedAt = 0
      try {
        const ordersResult = await getWBOrdersMap(wbToken, log)
        log(`[WB-All] Маркетплейс orders: ${ordersResult.byRid.size} rids, ${ordersResult.byNmId.size} nmIds, ${ordersResult.byId?.size || 0} ids`)
      } catch (e) {
        log(`[WB-All] Маркетплейс orders error: ${e.message}`, 'error')
      }

      // supplier/orders (srid→sticker для связки)
      wbOrdersStickersCache.fetchedAt = 0
      try {
        const stickers = await getWBOrdersStickersMap(wbToken, log)
        log(`[WB-All] stickersBySrid: ${stickers.size} srids`)
      } catch (e) {
        log(`[WB-All] stickersBySrid error: ${e.message}`, 'error')
      }

      // ── Завершение ──
      const mktReady = (wbOrdersCache.byRid && wbOrdersCache.byRid.size > 0)
      res.write(`data: ${JSON.stringify({
        type: 'done',
        stats: {
          sales: salesRecords.length,
          returns: returnRecords.length,
          total: salesRecords.length + returnRecords.length,
          marketplaceOrders: wbOrdersCache.byId?.size || 0,
          marketplaceStickers: wbOrdersStickersCache.bySrid?.size || 0,
          fromCache: salesFromCache || returnsFromCache
        }
      })}\n\n`)

    } catch (e) {
      log(`[WB-All] error: ${e.message}`, 'error')
      res.write(`data: ${JSON.stringify({ type: 'error', error: e.message })}\n\n`)
    } finally {
      res.end()
      log('=== WB-All SSE: completed ===')
    }
  })

  // ── Ozon-all SSE: потоковая выгрузка продаж + возвратов Ozon (кнопка "Обновить") ──
  app.get('/api/ozon-all/stream', async (req, res) => {
    const ozonClientId = req.headers['x-ozon-client-id']
    const ozonApiKey = req.headers['x-ozon-api-key']
    const msToken = req.query.token

    if (!ozonClientId || !ozonApiKey) {
      return res.status(401).json({ error: 'Требуются Client-Id и Api-Key Ozon' })
    }
    if (!msToken) {
      return res.status(401).json({ error: 'Требуется токен API МС' })
    }

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')

    sseConnections.add(res)
    res.on('close', () => { sseConnections.delete(res) })

    const log = (msg) => console.log(`[Ozon-All] ${msg}`)
    log('=== Ozon-All SSE: start ===')

    // Init MS API
    process.env.MOYSKLAD_TOKEN = msToken
    initApi(msToken)

    try {
      // ── Фаза 1: Продажи Ozon (FBS отправления) ──
      res.write(`data: ${JSON.stringify({ type: 'progress', msg: 'Обновление продаж Ozon...' })}\n\n`)
      if (res.flush) res.flush()

      const oldPostingsLastDate = ozonPostingsCache.lastDate
      ozonPostingsCache.fetchedAt = 0 // invalidate cache
      const postingsMap = await getOzonPostingsMap(ozonClientId, ozonApiKey, log)
      log(`[Ozon-All] postings map: ${postingsMap.size} posting_numbers, lastDate: ${ozonPostingsCache.lastDate}`)

      let postingRecords = []
      let postingsFromCache = false
      if (ozonPostingsCache.data) {
        if (!oldPostingsLastDate || ozonPostingsCache.lastDate !== oldPostingsLastDate) {
          postingRecords = ozonPostingsCache.data.filter(r => {
            if (!oldPostingsLastDate) return true
            return r.shipment_date && r.shipment_date > oldPostingsLastDate
          })
        } else {
          postingRecords = [...ozonPostingsCache.data]
          postingsFromCache = true
        }
      }

      if (postingsFromCache) {
        res.write(`data: ${JSON.stringify({ type: 'progress', msg: 'Лимит Ozon. Показываю сохранённые данные...' })}\n\n`)
        if (res.flush) res.flush()
      }

      // Stream each posting
      for (const record of postingRecords) {
        if (req.destroyed) break
        const product = record.products && record.products[0]
        res.write(`data: ${JSON.stringify({
          type: 'order',
          order: {
            shipmentNum: record.posting_number || '',
            orderName: product ? product.name : '',
            sum: product ? parseFloat(product.price) : 0,
            statusName: record.status === 'delivered' ? 'Продажа' : record.status || '',
            status: 'sale',
            hasReturn: false,
            hasDemand: false,
            hasPayment: false,
            orderPositions: [],
            returnSum: 0,
            date: record.shipment_date || '',
            fromCache: postingsFromCache
          }
        })}\n\n`)
        if (res.flush) res.flush()
        await new Promise(r => setTimeout(r, 10))
      }

      log(`[Ozon-All] streamed ${postingRecords.length} posting records${postingsFromCache ? ' (from cache)' : ''}`)

      // ── Фаза 2: Возвраты Ozon ──
      res.write(`data: ${JSON.stringify({ type: 'progress', msg: 'Обновление возвратов Ozon...' })}\n\n`)
      if (res.flush) res.flush()

      const oldReturnsLastDate = ozonReturnsCache.lastDate
      ozonReturnsCache.fetchedAt = 0
      const returnsMap = await getOzonReturnsMap(ozonClientId, ozonApiKey, log)
      log(`[Ozon-All] returns map: ${returnsMap.size} posting_numbers, lastDate: ${ozonReturnsCache.lastDate}`)

      let returnRecords = []
      let returnsFromCache = false
      if (ozonReturnsCache.data) {
        if (!oldReturnsLastDate || ozonReturnsCache.lastDate !== oldReturnsLastDate) {
          returnRecords = ozonReturnsCache.data.filter(r => {
            if (!oldReturnsLastDate) return true
            return r.return_date && r.return_date > oldReturnsLastDate
          })
        } else {
          returnRecords = [...ozonReturnsCache.data]
          returnsFromCache = true
        }
      }

      if (returnsFromCache) {
        res.write(`data: ${JSON.stringify({ type: 'progress', msg: 'Лимит Ozon. Показываю сохранённые возвраты...' })}\n\n`)
        if (res.flush) res.flush()
      }

      // Stream each return
      for (const record of returnRecords) {
        if (req.destroyed) break
        const reason = record.return_reason_name || 'Возврат'
        res.write(`data: ${JSON.stringify({
          type: 'order',
          order: {
            shipmentNum: record.posting_number || '',
            orderName: record.offer_id || record.product_name || '',
            sum: record.product_price || 0,
            statusName: `Возврат: ${reason}`,
            status: 'return',
            hasReturn: true,
            hasDemand: false,
            hasPayment: false,
            orderPositions: [],
            returnSum: record.product_price || 0,
            date: record.return_date || '',
            returnType: record.type || '',
            reason: reason,
            returnId: record.id || '',
            fromCache: returnsFromCache
          }
        })}\n\n`)
        if (res.flush) res.flush()
        await new Promise(r => setTimeout(r, 10))
      }

      log(`[Ozon-All] streamed ${returnRecords.length} return records${returnsFromCache ? ' (from cache)' : ''}`)

      // ── Завершение ──
      res.write(`data: ${JSON.stringify({
        type: 'done',
        stats: {
          sales: postingRecords.length,
          returns: returnRecords.length,
          total: postingRecords.length + returnRecords.length,
          fromCache: postingsFromCache || returnsFromCache
        }
      })}\n\n`)

    } catch (e) {
      log(`[Ozon-All] error: ${e.message}`, 'error')
      res.write(`data: ${JSON.stringify({ type: 'error', error: e.message })}\n\n`)
    } finally {
      res.end()
      log('=== Ozon-All SSE: completed ===')
    }
  })

  // ── Ozon-return SSE: поиск возврата Ozon по коду (кнопка "Поиск") ──
  app.get('/api/ozon-return/stream', async (req, res) => {
    const ozonClientId = req.headers['x-ozon-client-id']
    const ozonApiKey = req.headers['x-ozon-api-key']
    const msToken = req.query.token || req.headers['x-api-token']
    const rawNumbers = req.query.numbers

    if (!ozonClientId || !ozonApiKey) {
      return res.status(401).json({ error: 'Требуются Client-Id и Api-Key Ozon' })
    }
    if (!msToken) {
      return res.status(401).json({ error: 'Требуется токен API МС' })
    }
    if (!rawNumbers) {
      return res.status(400).json({ error: 'Не указаны номера возвратов' })
    }

    const returnCodes = rawNumbers.split(',').map(s => s.trim()).filter(Boolean)

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')

    sseConnections.add(res)
    res.on('close', () => { sseConnections.delete(res) })

    const log = (msg) => console.log(`[Ozon-Return] ${msg}`)
    log(`=== Ozon-Return SSE: start (${returnCodes.length} codes) ===`)

    // Init MS API
    process.env.MOYSKLAD_TOKEN = msToken
    initApi(msToken)

    try {
      // Загружаем кэш возвратов (или обновляем, если просрочен)
      await getOzonReturnsMap(ozonClientId, ozonApiKey, log)

      log(`[Ozon-Return] cache: data=${ozonReturnsCache.data?.length ?? 0} records, byReturnId=${ozonReturnsCache.byReturnId?.size ?? 0}, byPostingNumber=${ozonReturnsCache.byPostingNumber?.size ?? 0}`)

      let processed = 0
      const total = returnCodes.length

      for (const code of returnCodes) {
        if (req.destroyed) break
        processed++

        let found = null

        // Search cache by id
        if (ozonReturnsCache.byReturnId && ozonReturnsCache.byReturnId.has(String(code))) {
          found = ozonReturnsCache.byReturnId.get(String(code))
          log(`[Ozon-Return] found by returnId: ${code}`)
        }

        // Search cache by posting_number
        if (!found && ozonReturnsCache.byPostingNumber && ozonReturnsCache.byPostingNumber.has(code)) {
          found = ozonReturnsCache.byPostingNumber.get(code)
          log(`[Ozon-Return] found by posting_number: ${code}`)
        }

        // Search cache by barcode (iterate)
        if (!found && ozonReturnsCache.data) {
          log(`[Ozon-Return] searching data by barcode: code=${code}, dataLen=${ozonReturnsCache.data.length}`)
          found = ozonReturnsCache.data.find(r => r.barcode === code || r.id === Number(code))
          if (found) log(`[Ozon-Return] found by barcode/id: posting=${found.posting_number}, barcode=${found.barcode}`)
          else {
            // debug: check if any record has this barcode with different casing/whitespace
            const similar = ozonReturnsCache.data.find(r => r.barcode && r.barcode.toLowerCase() === code.toLowerCase())
            if (similar) log(`[Ozon-Return] NEAR MISS: barcode case mismatch? cache="${similar.barcode}" vs input="${code}"`)
          }
        }

        if (!found) {
          res.write(`data: ${JSON.stringify({
            type: 'error', code,
            error: 'Возврат не найден в кэше Ozon',
            processed, total
          })}\n\n`)
          if (res.flush) res.flush()
          continue
        }

        const postingNumber = found.posting_number
        if (!postingNumber) {
          res.write(`data: ${JSON.stringify({
            type: 'error', code,
            error: 'Возврат не содержит posting_number',
            processed, total
          })}\n\n`)
          if (res.flush) res.flush()
          continue
        }

        // Поиск в МойСклад по posting_number
        res.write(`data: ${JSON.stringify({
          type: 'search-ms',
          code,
          postingNumber,
          msg: `Поиск в МС: ${postingNumber}...`,
          processed, total
        })}\n\n`)
        if (res.flush) res.flush()

        let order = null
        try {
          order = await findOrderByShipmentNum(postingNumber, log)
        } catch (e) {
          log(`[Ozon-Return] MS search error for ${postingNumber}: ${e.message}`)
        }

        // Build complete orderData with all fields appendOrderRow needs
        // MS sum is in kopeks, divide by 100 for display
        const msSum = order?.sum ? Math.round(order.sum / 100) : 0
        const orderDataForResult = {
          // From MS order (if found)
          id: order?.id || '',
          name: order?.name || '',
          description: order?.description || '',
          // From return cache (always available)
          shipmentNum: postingNumber,
          orderName: order?.name || found.product_name || found.offer_id || '',
          sum: msSum || found.product_price || 0,
          statusName: `Возврат: ${found.return_reason_name || ''}`,
          status: 'return',
          hasReturn: true,
          hasDemand: order?.hasDemand || false,
          hasPayment: order?.hasPayment || false,
          returnSum: found.product_price || 0,
          returnType: found.type || '',
          reason: found.return_reason_name || '',
          barcode: found.barcode || '',
          offerId: found.offer_id || '',
          orderMoment: order?.moment || found.return_date || '',
          msFound: !!order
        }

        log(`[Ozon-Return] SENDING result: code=${code}, posting=${postingNumber}, msFound=${!!order}, orderName=${orderDataForResult.orderName}, sum=${orderDataForResult.sum}, statusName=${orderDataForResult.statusName}`)

        res.write(`data: ${JSON.stringify({
          type: 'result',
          code,
          postingNumber,
          returnReason: found.return_reason_name || '',
          order: orderDataForResult,
          notFound: !order,
          processed, total
        })}\n\n`)
        if (res.flush) res.flush()
      }

      res.write(`data: ${JSON.stringify({ type: 'done', processed })}\n\n`)
    } catch (e) {
      log(`[Ozon-Return] error: ${e.message}`, 'error')
      res.write(`data: ${JSON.stringify({ type: 'error', error: e.message })}\n\n`)
    } finally {
      res.end()
      log('=== Ozon-Return SSE: completed ===')
    }
  })

  // Create demand (отгрузка) - see Skills/moysklad-demand.md
 app.post('/api/create-demand', async (req, res) => {
  const { shipmentNum } = req.body
  const token = req.headers['x-api-token']

  if (!token || !shipmentNum) {
    return res.json({ error: 'Требуется токен и номер отправления' })
  }

  initApi(token)
  log(`Создание отгрузки: ${shipmentNum}`, { token: token.slice(0, 8) + '...' })

  try {
    log(`Поиск заказа: ${shipmentNum}`)
    const order = await findOrderByShipmentNum(shipmentNum, log)
    if (!order) {
      log(`Заказ не найден: ${shipmentNum}`)
      updateOrderState(shipmentNum, 'demand_check', 'order_not_found')
      return res.json({ error: 'Заказ не найден' })
    }

    log(`Создаю отгрузку: ${shipmentNum}`, { orderId: order.id })
    const demand = await createDemand(order.id)
    log(`Отгрузка создана: ${demand.name}`, { shipmentNum, demandId: demand.id })

    // Получаем данные для обновления состояния
    const { getOrderFullForCreate } = require('./lib/order')
    const orderFull = await getOrderFullForCreate(order.id)

    updateOrderState(shipmentNum, 'demand_created', demand.name, {
      orderName: orderFull.name,
      orderId: orderFull.id,
      orderUrl: `https://online.moysklad.ru/app/#customerorder/${orderFull.id}`
    })
    res.json({ success: true, demandName: demand.name })
  } catch (e) {
    log(`Ошибка создания отгрузки: ${e.message}`, { shipmentNum, stack: e.stack })
    updateOrderState(shipmentNum, 'demand_error', e.message)
    res.json({ error: e.message })
  }
})

// Create return (возврат) - see Skills/moysklad-return.md
app.post('/api/create-return', async (req, res) => {
  const { shipmentNum } = req.body
  const token = req.headers['x-api-token']

  if (!token || !shipmentNum) {
    return res.json({ error: 'Требуется токен и номер отправления' })
  }

  initApi(token)
  log(`Создание возврата: ${shipmentNum}`, { token: token.slice(0, 8) + '...' })

  try {
    log(`Поиск заказа для возврата: ${shipmentNum}`)
    const order = await findOrderByShipmentNum(shipmentNum, log)
    if (!order) {
      log(`Заказ не найден для возврата: ${shipmentNum}`)
      updateOrderState(shipmentNum, 'return_check', 'order_not_found')
      return res.json({ error: 'Заказ не найден' })
    }

    log(`Создаю возврат: ${shipmentNum}`, { orderId: order.id })
    const salesReturn = await createReturn(order.id)
    log(`Возврат создан: ${salesReturn.name}`, { shipmentNum, returnId: salesReturn.id })

    // Получаем данные для обновления состояния
    const { getOrderFullForCreate } = require('./lib/order')
    const orderFull = await getOrderFullForCreate(order.id)

    updateOrderState(shipmentNum, 'return_created', salesReturn.name, {
      orderName: orderFull.name,
      orderId: orderFull.id,
      orderUrl: `https://online.moysklad.ru/app/#customerorder/${orderFull.id}`,
      returnSum: salesReturn.sum / 100 // Сумма возврата в рублях
    })
    res.json({ success: true, returnName: salesReturn.name, returnSum: salesReturn.sum / 100 })
  } catch (e) {
    log(`Ошибка создания возврата: ${e.message}`, { shipmentNum, stack: e.stack })
    updateOrderState(shipmentNum, 'return_error', e.message)
    res.json({ error: e.message })
  }
})

// Cancel order (отмена) - see Skills/moysklad-return.md (change status to "Отменён")
app.post('/api/cancel-order', async (req, res) => {
  const { shipmentNum } = req.body
  const token = req.headers['x-api-token']

  if (!token || !shipmentNum) {
    return res.json({ error: 'Требуется токен и номер отправления' })
  }

  initApi(token)
  log(`Отмена заказа: ${shipmentNum}`, { token: token.slice(0, 8) + '...' })

  try {
    log(`Поиск заказа для отмены: ${shipmentNum}`)
    const order = await findOrderByShipmentNum(shipmentNum, log)
    if (!order) {
      log(`Заказ не найден для отмены: ${shipmentNum}`)
      updateOrderState(shipmentNum, 'cancel_check', 'order_not_found')
      return res.json({ error: 'Заказ не найден' })
    }

    log(`Отменяю заказ: ${shipmentNum}`, { orderId: order.id })
    const result = await cancelOrder(order.id)
    log(`Заказ отменён: ${shipmentNum}`, { result })

    // Получаем данные для обновления состояния
    const { getOrderFullForCreate } = require('./lib/order')
    const orderFull = await getOrderFullForCreate(order.id)

    updateOrderState(shipmentNum, 'order_cancelled', 'success', {
      orderName: orderFull.name,
      orderId: orderFull.id,
      orderUrl: `https://online.moysklad.ru/app/#customerorder/${orderFull.id}`,
      sum: orderFull.sum / 100 // Сумма заказа в рублях
    })
    res.json({ success: true, ...result })
  } catch (e) {
    log(`Ошибка: ${e.message}`)
    updateOrderState(shipmentNum, 'cancel_error', e.message)
    res.json({ error: e.message })
  }
})

// Print sticker (печать этикетки)
app.post('/api/print-sticker', async (req, res) => {
  const { code } = req.body
  const token = req.headers['x-api-token']

  if (!token || !code) {
    return res.json({ error: 'Требуется токен и код товара' })
  }

  initApi(token)
  log(`Печать стикера: ${code}`, { token: token.slice(0, 8) + '...' })

  try {
    // 1. Find product by code
    log(`Поиск товара по коду: ${code}`)
    const product = await findProductByCode(code)

    if (!product || !product.id) {
      log(`Товар не найден: ${code}`)
      return res.json({ error: 'Товар не найден' })
    }

    log(`Товар найден: ${product.name}, ID: ${product.id}, type: ${product.meta?.type || 'product'}`)

    // 2. Export sticker PDF
    log(`Генерация PDF стикера для товара: ${product.id}`)
    const entityType = product.meta?.type || 'product'
    const result = await exportStickerPdf(product.id, token, entityType)

    if (!result) {
      throw new Error('Не удалось получить PDF')
    }

    // result может быть либо URL (303), либо путем к файлу (200)
    if (result.startsWith('http')) {
      // Это URL - возвращаем клиенту
      log(`PDF URL: ${result}`)
      res.json({ success: true, pdfUrl: result })
    } else {
      // Это путь к файлу - отправляем файл клиенту
      log(`PDF файл: ${result}`)
      res.sendFile(result, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'inline'
        }
      })
    }
  } catch (e) {
    log(`Ошибка печати стикера: ${e.message}`)
    res.json({ error: e.message })
  }
})

// Graceful shutdown
let isShuttingDown = false

function gracefulShutdown(signal, shouldRestart = false) {
  if (isShuttingDown) return
  isShuttingDown = true

  log(`Получен сигнал ${signal}, завершаю работу...`)
  console.log(`\n[${signal}] Graceful shutdown...`)

  // Close all active SSE connections
  if (sseConnections.size > 0) {
    log(`Закрываю ${sseConnections.size} активных SSE соединений...`)
    for (const res of sseConnections) {
      try {
        res.write(`data: ${JSON.stringify({
          type: 'shutdown',
          message: 'Сервер завершает работу'
        })}\n\n`)
        res.end()
      } catch (e) {
        // Ignore errors
      }
    }
    sseConnections.clear()
  }

  server.close(() => {
    log('Сервер остановлен')
    console.log('[Shutdown] Server closed')

    if (shouldRestart) {
      // Start new instance after server is closed
      const { spawn } = require('child_process')
      const isWindows = process.platform === 'win32'

      if (isWindows) {
        const startBatPath = path.join(appRoot, 'simoto-sklad.bat')
        spawn('cmd.exe', ['/c', 'start "" "' + startBatPath + '"'], {
          cwd: appRoot,
          detached: true,
          stdio: 'ignore',
          shell: true
        }).unref()
      } else {
        spawn('node', [serverFile], {
          cwd: appRoot,
          detached: true,
          stdio: 'ignore'
        }).unref()
      }

      log('Новый экземпляр сервера запущен')
    }

    process.exit(0)
  })

  // Force exit after 10 seconds
  setTimeout(() => {
    log('Принудительная остановка - не все соединения закрыты')
    process.exit(1)
  }, 10000)
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

// Restart server
const serverFile = process.argv[1]
const serverCommand = 'node "' + serverFile + '"'
const appRoot = path.dirname(process.argv[1])

app.post('/api/restart', (req, res) => {
  log('Запрошен перезапуск сервера')
  res.json({ success: true, message: 'Перезапуск сервера...' })

  // Gracefully shutdown and restart
  setTimeout(() => {
    gracefulShutdown('RESTART', true)
  }, 1000)
})

// Check if server is running
app.get('/api/status', (req, res) => {
  res.json({
    running: !isShuttingDown,
    pid: process.pid,
    uptime: process.uptime()
  })
})

// Start server (open new console via start.bat)
app.post('/api/start', (req, res) => {
  const { spawn } = require('child_process')
  const isWindows = process.platform === 'win32'

  if (isWindows) {
    spawn('cmd.exe', ['/c', 'start "" "' + startBatPath + '"'], {
      cwd: appRoot,
      detached: true,
      stdio: 'ignore',
      shell: true
    }).unref()
    res.json({ success: true, message: 'Сервер запущен в новом окне' })
  } else {
    spawn('open', ['-a', 'Terminal', serverFile], {
      cwd: appRoot,
      detached: true
    }).unref()
    res.json({ success: true, message: 'Сервер запущен' })
  }
})

// Get logs
app.get('/api/logs', (req, res) => {
  const dateStr = new Date().toISOString().split('T')[0]
  const logFile = path.join(moduleRoot, 'logs', `payments_${dateStr}.log`)

  try {
    if (fs.existsSync(logFile)) {
      const content = fs.readFileSync(logFile, 'utf-8')
      const lines = content
        .split('\n')
        .filter((l) => l)
        .slice(-100)
      res.json({ logs: lines.join('\n'), file: logFile })
    } else {
      res.json({ logs: '', file: logFile })
    }
  } catch (e) {
    res.json({ error: e.message })
  }
})

// Синхронизация товаров WB / OZON (скелет)
app.post('/api/sync-products', async (req, res) => {
  const { wbCodes, ozonCodes } = req.body || {}
  try {
    const wbData = await wbOzonSync.fetchWBData(Array.isArray(wbCodes) ? wbCodes : [])
    const ozonData = await wbOzonSync.fetchOzonData(Array.isArray(ozonCodes) ? ozonCodes : [])
    const merged = wbOzonSync.compareAndAggregate(wbData, ozonData)
    res.json({ success: true, merged })
  } catch (e) {
    log('Sync error: ' + e.message)
    res.json({ error: e.message })
  }
})

// Save orders state
const STATE_FILE = path.join(moduleRoot, 'logs', 'orders_state.json')

function loadOrdersState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
      console.log(
        'Loaded orders state from file:',
        STATE_FILE,
        '- count:',
        Object.keys(data).length
      )
      return data
    }
    console.log('Orders state file not found:', STATE_FILE)
  } catch (e) {
    console.error('Error loading state:', e)
  }
  return {}
}

function saveOrdersState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
    console.log('Saved orders state to file:', STATE_FILE, '- count:', Object.keys(state).length)
  } catch (e) {
    console.error('Error saving state:', e)
  }
}

function updateOrderState(shipmentNum, action, result, extraData = {}) {
  const state = loadOrdersState()
  const now = new Date().toISOString()

  if (!state[shipmentNum]) {
    state[shipmentNum] = { history: [] }
  }

  // Ensure history array exists
  if (!state[shipmentNum].history) {
    state[shipmentNum].history = []
  }

  state[shipmentNum].lastAction = action
  state[shipmentNum].lastResult = result
  state[shipmentNum].lastUpdate = now

  // Сохраняем имена документов
  if (action === 'payment_created') {
    state[shipmentNum].paymentName = result
  } else if (action === 'demand_created') {
    state[shipmentNum].demandName = result
  } else if (action === 'return_created') {
    state[shipmentNum].returnName = result
  }

  // Сохраняем дополнительные данные о заказе
  if (extraData.orderName) state[shipmentNum].orderName = extraData.orderName
  if (extraData.sum) state[shipmentNum].sum = extraData.sum
  if (extraData.paid) state[shipmentNum].paid = extraData.paid
  if (extraData.orderId) state[shipmentNum].orderId = extraData.orderId
  if (extraData.orderUrl) state[shipmentNum].orderUrl = extraData.orderUrl
  if (extraData.returnSum !== undefined) state[shipmentNum].returnSum = extraData.returnSum
  if (extraData.cancelledSum !== undefined) state[shipmentNum].cancelledSum = extraData.cancelledSum

  state[shipmentNum].history.push({
    action,
    result,
    time: now
  })

  saveOrdersState(state)
  return state[shipmentNum]
}

app.get('/api/orders-state', (req, res) => {
  res.setHeader('Content-Type', 'application/json')
  const state = loadOrdersState()
  res.json(state)
})

// Save entire scan (replaces previous)
app.post('/api/orders-state', (req, res) => {
  res.setHeader('Content-Type', 'application/json')
  log('API: save scan, body keys: ' + (req.body?.orders?.length || 0))
  const { orders } = req.body
  if (orders && Array.isArray(orders)) {
    // Full scan save - replace everything
    const state = {}
    for (const order of orders) {
      state[order.shipmentNum] = {
        orderName: order.orderName,
        sum: order.sum,
        paid: order.paid,
        status: order.status,
        statusName: order.statusName,
        canCreate: order.canCreate,
        orderId: order.orderId,
        orderUrl: order.orderUrl,
        hasDemand: order.hasDemand,
        hasPayment: order.hasPayment,
        hasReturn: order.hasReturn,
        isCancelled: order.isCancelled,
        demandName: order.demandName || null,
        paymentName: order.paymentName || null,
        returnName: order.returnName || null,
        returnSum: order.returnSum || 0,
        cancelledSum: order.cancelledSum || 0,
        orderMoment: order.orderMoment || null,
        savedAt: new Date().toISOString(),
        orderPositions: order.orderPositions || [],
        demandPositions: order.demandPositions || []
      }
    }
    saveOrdersState(state)
    log(`Сохранено последнее сканирование: ${orders.length} заказов`)
    return res.json({ success: true, count: orders.length })
  }

  // Single action update
  const { shipmentNum, action, result } = req.body
  if (!shipmentNum || !action) {
    return res.json({ error: 'Требуется shipmentNum и action' })
  }
  const orderState = updateOrderState(shipmentNum, action, result)
  res.json({ success: true, state: orderState })
})

app.delete('/api/orders-state', (req, res) => {
  saveOrdersState({})
  res.json({ success: true })
})

// Debug: check state file
app.get('/api/debug-state', (req, res) => {
  const state = loadOrdersState()
  res.json({
    file: STATE_FILE,
    exists: fs.existsSync(STATE_FILE),
    count: Object.keys(state).length,
    keys: Object.keys(state).slice(0, 5),
    state: state
  })
})

// ──────────────────────────────────────────
// Shared attributes: поиск общих полей по названиям
// Возвращает [{ name, systems: { ms: { id, value, found }, ozon: {...}, wb: {...} } }]
// ──────────────────────────────────────────
function findSharedAttributes(msProduct, wbProduct, ozonProduct) {
  const whitelist = [
    'Артикул производителя',
    'OEM-номер',
    'Бренд',
    'Модель',
    'Цвет',
    'Материал',
    'Вес',
    'Количество',
    'Диаметр',
    'Страна производства',
    'Комплектация',
    'ТН ВЭД',
    'Ставка НДС',
    'Совместимость',
    'Вид мототехники',
    'Марка мототехники',
    'Пол',
    'Сезон',
    'Состав',
    'Код продавца',
  ]

  // Алиасы: названия атрибутов, которые означают одно и то же в разных системах
  const aliasMap = {
    'Страна производства': ['Страна-изготовитель', 'Страна изготовитель', 'Страна изделия'],
    'Количество': ['Количество, штук', 'Количество предметов', 'Количество предметов в упаковке (шт.)'],
    'Артикул производителя': ['Партномер (артикул производителя)'],
    'OEM-номер': ['ОЕМ номер', 'OEM-номер'],
    'Модель': ['Модель мототехники'],
    'Цвет': ['Цвет товара'],
    'Материал': ['Материал изделия'],
    'Вес': ['Вес с упаковкой, г', 'Вес нетто, г', 'Вес брутто, г'],
    'Диаметр': ['Диаметр, мм'],
    'ТН ВЭД': ['ТН ВЭД коды ЕАЭС'],
  }

  // Собираем мапу name → { id, value } для каждой системы
  function buildMap(attributes) {
    const map = {}
    if (!attributes || !Array.isArray(attributes)) return map
    for (const attr of attributes) {
      const name = attr.name || ''
      const value = attr.value !== undefined ? String(attr.value) : ''
      if (name) {
        // У некоторых систем value может быть вложенным (массив объектов)
        let resolvedValue = value
        if (Array.isArray(attr.value)) {
          resolvedValue = attr.value.map(function(v) {
            return typeof v === 'object' ? (v.value || '') : v
          }).filter(Boolean).join(', ')
        }
        map[name] = { id: attr.id || attr.attribute_id || null, value: resolvedValue }
      }
    }
    return map
  }

  // Вспомогательная функция поиска в мапе с учётом алиасов
  function findInMap(map, name) {
    if (map[name]) return map[name]
    // Проверяем алиасы: ищем, чьим алиасом является name
    for (const [canonical, aliases] of Object.entries(aliasMap)) {
      if (aliases.indexOf(name) !== -1) {
        // name это алиас для canonical — ищем canonical
        return map[canonical]
      }
      // Или name это canonical — проверяем алиасы
      if (name === canonical) {
        for (const alias of aliases) {
          if (map[alias]) return map[alias]
        }
      }
    }
    return undefined
  }

  const msAttrs = buildMap(msProduct ? msProduct.attributes : null)
  const wbAttrs = buildMap(wbProduct ? (wbProduct.characteristics || wbProduct.attributes) : null)
  const ozonAttrs = buildMap(ozonProduct ? (ozonProduct.attributes || []) : null)

  const result = []

  for (const name of whitelist) {
    // Ищем сначала по прямому имени, потом по алиасам
    let ms = msAttrs[name] || findInMap(msAttrs, name)
    let wb = wbAttrs[name] || findInMap(wbAttrs, name)
    let ozon = ozonAttrs[name] || findInMap(ozonAttrs, name)

    // Пропускаем, если нет ни в одной системе
    if (!ms && !wb && !ozon) continue

    result.push({
      name: name,
      systems: {
        ms: ms ? { id: ms.id, value: ms.value, found: true } : { id: null, value: '', found: false },
        ozon: ozon ? { id: ozon.id, value: ozon.value, found: true } : { id: null, value: '', found: false },
        wb: wb ? { id: wb.id, value: wb.value, found: true } : { id: null, value: '', found: false }
      }
    })
  }

  return result
}

// ──────────────────────────────────────────
// Очистка HTML-описания для отображения
// Убирает теги, заменяет <br>/</p> на \n, схлопывает пробелы
// ──────────────────────────────────────────
function formatDescriptionForDisplay(rawHtml) {
  if (!rawHtml || typeof rawHtml !== 'string') return rawHtml || ''
  return rawHtml
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p\b[^>]*>/gi, '')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

// Serve static files from public folder (no cache for dev)
app.use(express.static(path.join(moduleRoot, 'public'), {
  maxAge: 0,
  setHeaders: function(res, path) {
    if (path.endsWith('.html') || path.endsWith('.css') || path.endsWith('.js')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
      res.setHeader('Pragma', 'no-cache')
      res.setHeader('Expires', '0')
    }
  }
}))

// Main page
app.get('/', (req, res) => {
  res.sendFile(path.join(moduleRoot, 'public', 'index.html'))
})

// Product search by OEM code (Market tab)
app.get('/api/market/product', async (req, res) => {
  const msToken = req.headers['x-api-token']
  const wbToken = req.headers['x-wb-token']
  const ozonClientId = req.headers['x-ozon-client-id']
  const ozonApiKey = req.headers['x-ozon-api-key']
  const oemCode = req.query.code

  if (!msToken) {
    return res.status(401).json({ error: 'Требуется токен API МойСклад' })
  }

  if (!oemCode) {
    return res.status(400).json({ error: 'Требуется код товара (OEM)' })
  }

  try {
    // 1. Init MoySklad API
    process.env.MOYSKLAD_TOKEN = msToken
    initApi(msToken)

    // 2. Search in MoySklad (with salePrices expanded)
    const msProduct = await getProductFullByCode(oemCode.trim())
    
    // Debug logging for MS price
    let msPrice = 0
    if (msProduct) {
      log(`[Market] MS Direct API: ${msProduct.name}, salePrices: ${JSON.stringify(msProduct.salePrices)}`)
      if (msProduct.salePrices && msProduct.salePrices.length > 0) {
        const rawCents = msProduct.salePrices[0].value
        msPrice = rawCents / 100
        log(`[Market] MS Price Debug: raw=${rawCents}, calculated=${msPrice}`)
      } else if (msProduct.price) {
        msPrice = msProduct.price / 100
        log(`[Market] MS Price fallback: ${msPrice} rub (no salePrices array)`)
      }
      log(`[Market] MS Price Final: ${msPrice} rub`)

      // Include salePrices meta for push
      msProduct._priceTypeMeta = msProduct.salePrices?.[0]?.priceType?.meta || null
    }

    // 3. Search in WB (if token provided)
    let wbResults = []
    let wbError = null
    if (wbToken) {
      try {
        wbResults = await wbOzonSync.fetchWBData([oemCode.trim()], wbToken)
      } catch (e) {
        wbError = e.message
        wbResults = [{ code: oemCode, error: 'WB API Error: ' + e.message }]
      }
    } else {
      wbResults = [{ code: oemCode, error: 'Токен WB не предоставлен' }]
    }

    // 4. Search in Ozon (if credentials provided)
    let ozonResults = []
    let ozonError = null
    if (ozonClientId && ozonApiKey) {
      try {
        ozonResults = await wbOzonSync.fetchOzonData([oemCode.trim()], ozonClientId, ozonApiKey)
      } catch (e) {
        ozonError = e.message
        ozonResults = [{ code: oemCode, error: 'Ozon API Error: ' + e.message }]
      }
    } else {
      ozonResults = [{ code: oemCode, error: 'Не указаны Client-Id и Api-Key для Ozon' }]
    }

    // 5. Prepare response
    const msData = msProduct ? {
      id: msProduct.id,
      name: msProduct.name,
      code: msProduct.code,
      article: msProduct.article || '',
      price: msPrice,
      stock: msProduct.quantity || 0,
      _priceTypeMeta: msProduct._priceTypeMeta,
      description: msProduct.description || '',
      descriptionClean: formatDescriptionForDisplay(msProduct.description),
      attributes: msProduct.attributes || [],
      images: [],
    } : null

    const wbData = (wbResults && wbResults.length > 0) ? {
      ...wbResults[0],
      descriptionClean: formatDescriptionForDisplay(wbResults[0].description)
    } : null

    const ozonData = (ozonResults && ozonResults.length > 0) ? {
      ...ozonResults[0],
      descriptionClean: formatDescriptionForDisplay(ozonResults[0].description)
    } : null

    const result = {
      oem: oemCode,
      moysklad: msData,
      wildberries: wbData,
      ozon: ozonData,
      sharedAttributes: findSharedAttributes(msData, wbData, ozonData),
      _debug: { wbError, ozonError } // Debug info
    }

    res.json(result)
  } catch (e) {
    log(`Ошибка поиска товара: ${e.message}`)
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/market/product/full', async (req, res) => {
  const msToken = req.headers['x-api-token']
  const wbToken = req.headers['x-wb-token']
  const ozonClientId = req.headers['x-ozon-client-id']
  const ozonApiKey = req.headers['x-ozon-api-key']
  const oemCode = req.query.code

  if (!msToken) {
    return res.status(401).json({ error: 'Требуется токен API МойСклад' })
  }

  if (!oemCode) {
    return res.status(400).json({ error: 'Требуется код товара (OEM)' })
  }

  try {
    process.env.MOYSKLAD_TOKEN = msToken
    initApi(msToken)

    const msProduct = await getProductFullByCode(oemCode.trim())
    
    let msPrice = 0
    if (msProduct) {
      log(`[Market] MS Direct API: ${msProduct.name}, salePrices: ${JSON.stringify(msProduct.salePrices)}`)
      if (msProduct.salePrices && msProduct.salePrices.length > 0) {
        const rawCents = msProduct.salePrices[0].value
        msPrice = rawCents / 100
        log(`[Market] MS Price Debug: raw=${rawCents}, calculated=${msPrice}`)
      } else if (msProduct.price) {
        msPrice = msProduct.price / 100
        log(`[Market] MS Price fallback: ${msPrice} rub (no salePrices array)`)
      }
      log(`[Market] MS Price Final: ${msPrice} rub`)

      msProduct._priceTypeMeta = msProduct.salePrices?.[0]?.priceType?.meta || null
    }

    let wbResults = []
    let wbError = null
    if (wbToken) {
      try {
        wbResults = await wbOzonSync.fetchWBData([oemCode.trim()], wbToken)
      } catch (e) {
        wbError = e.message
        wbResults = [{ code: oemCode, error: 'WB API Error: ' + e.message }]
      }
    } else {
      wbResults = [{ code: oemCode, error: 'Токен WB не предоставлен' }]
    }

    let ozonResults = []
    let ozonError = null
    if (ozonClientId && ozonApiKey) {
      try {
        ozonResults = await wbOzonSync.fetchOzonData([oemCode.trim()], ozonClientId, ozonApiKey)
      } catch (e) {
        ozonError = e.message
        ozonResults = [{ code: oemCode, error: 'Ozon API Error: ' + e.message }]
      }
    } else {
      ozonResults = [{ code: oemCode, error: 'Не указаны Client-Id и Api-Key для Ozon' }]
    }

    const msData = msProduct ? {
      id: msProduct.id,
      name: msProduct.name,
      code: msProduct.code,
      article: msProduct.article || '',
      price: msPrice,
      stock: msProduct.quantity || 0,
      _priceTypeMeta: msProduct._priceTypeMeta,
      description: msProduct.description || '',
      descriptionClean: formatDescriptionForDisplay(msProduct.description),
      attributes: msProduct.attributes || [],
      images: [],
    } : null

    const wbData = (wbResults && wbResults.length > 0) ? {
      ...wbResults[0],
      descriptionClean: formatDescriptionForDisplay(wbResults[0].description)
    } : null

    const ozonData = (ozonResults && ozonResults.length > 0) ? {
      ...ozonResults[0],
      descriptionClean: formatDescriptionForDisplay(ozonResults[0].description)
    } : null

    const result = {
      oem: oemCode,
      moysklad: msData,
      wildberries: wbData,
      ozon: ozonData,
      sharedAttributes: findSharedAttributes(msData, wbData, ozonData),
      _debug: { wbError, ozonError }
    }

    res.json(result)
  } catch (e) {
    log(`Ошибка поиска товара: ${e.message}`)
    res.status(500).json({ error: e.message })
  }
})

// MS images не отображаются — API требует авторизации (HTTP 415 при проксировании)

// ──────────────────────────────────────────
// Push: Обновление товара в МойСклад
// ──────────────────────────────────────────
app.post('/api/market/push/ms', async (req, res) => {
  const msToken = req.headers['x-api-token']
  const { productId, price, title, description, attributes } = req.body

  if (!msToken) return res.status(401).json({ error: 'Требуется токен МойСклад' })
  if (!productId) return res.status(400).json({ error: 'Нет ID товара' })

  try {
    process.env.MOYSKLAD_TOKEN = msToken
    initApi(msToken)
    const API = getApi()

    // Get current product to find priceType
    const product = await API.GET('entity/product/' + productId, { expand: 'salePrices' })

    const updateData = {}
    if (title) updateData.name = title
    if (description !== undefined) updateData.description = description
    if (attributes && Array.isArray(attributes) && attributes.length > 0) {
      updateData.attributes = attributes.map(function(a) {
        return { id: a.id, value: a.value }
      })
    }
    if (price !== undefined && price > 0) {
      const priceType = product.salePrices?.[0]?.priceType
      updateData.salePrices = [{
        value: Math.round(price * 100),
        priceType: priceType || { meta: { href: 'entity/pricetype/default', type: 'pricetype', mediaType: 'application/json' } }
      }]
    }

    await API.PUT('entity/product/' + productId, updateData)
    log(`[Market] MS push: updated ${productId}`)
    res.json({ success: true, message: '✅ Товар обновлён в МойСклад' })
  } catch (e) {
    log(`[Market] MS push error: ${e.message}`)
    res.status(500).json({ error: e.message })
  }
})

// ──────────────────────────────────────────
// Push: Обновление товара в Wildberries
// ──────────────────────────────────────────
app.post('/api/market/push/wb', async (req, res) => {
  const wbToken = req.headers['x-wb-token']
  const { vendorCode, title, description, characteristics, images } = req.body

  if (!wbToken) return res.status(401).json({ error: 'Требуется токен WB' })
  if (!vendorCode) return res.status(400).json({ error: 'Нет vendorCode' })

  try {
    // 1. Find product in WB to get nmID
    const wbResults = await wbOzonSync.fetchWBData([vendorCode], wbToken)
    if (!wbResults || wbResults.length === 0 || wbResults[0].error) {
      return res.status(404).json({ error: wbResults?.[0]?.error || 'Товар не найден в WB' })
    }

    const nmId = wbResults[0].nmID
    if (!nmId) return res.status(400).json({ error: 'nmID не получен для товара' })

    const updates = []

    // 2. Update card data (description + characteristics) via Content API
    if (description !== undefined || (characteristics && characteristics.length > 0)) {
      updates.push(wbOzonSync.pushWBCard(wbToken, nmId, vendorCode, description, characteristics))
    }

    await Promise.all(updates)

    // 4. Upload images if provided
    let mediaStatus = 'skipped'
    let mediaMessage = null
    if (images && Array.isArray(images) && images.length > 0) {
      try {
        // Convert WB CDN URLs (basket-*.wb.ru) to base64 Data URIs
        // so the API can re-download images already on WB's own CDN.
        const processedImages = await Promise.all(images.map(wbUrlToDataUri))
        await wbOzonSync.pushWBMedia(wbToken, nmId, processedImages)
        mediaStatus = 'ok'
      } catch (mediaErr) {
        mediaStatus = 'error'
        mediaMessage = mediaErr.message
        log(`[Market] WB media push warning: ${mediaErr.message} — continuing`)
      }
    }

    log(`[Market] WB push: updated ${vendorCode} (nmId: ${nmId})`)
    res.json({ success: true, message: '✅ Товар обновлён в Wildberries', mediaStatus, mediaMessage })
  } catch (e) {
    log(`[Market] WB push error: ${e.message}`)
    res.status(500).json({ error: e.message })
  }
})

// ──────────────────────────────────────────
// Push: Обновление товара в Ozon
// ──────────────────────────────────────────
app.post('/api/market/push/ozon', async (req, res) => {
  const ozonClientId = req.headers['x-ozon-client-id']
  const ozonApiKey = req.headers['x-ozon-api-key']
  const { offerId, productId, title, description, attributes, images, typeId } = req.body

  if (!ozonClientId || !ozonApiKey) return res.status(401).json({ error: 'Требуются Client-Id и Api-Key Ozon' })
  if (!offerId && !productId) return res.status(400).json({ error: 'Нет offerId или productId' })

  try {
    const updates = []

    // 1. Update title + description + images
    let ozonMediaStatus = 'skipped'
    let ozonMediaMessage = null
    if (title || description || (images && images.length > 0)) {
      try {
        await wbOzonSync.pushOzonImport(ozonClientId, ozonApiKey, offerId, title, description, images, typeId)
        ozonMediaStatus = 'ok'
      } catch (err) {
        ozonMediaStatus = 'error'
        ozonMediaMessage = err.message
        log(`[Market] Ozon import/images warning (non-fatal): ${err.message}`)
      }
    }

    // 3. Update attributes (характеристики) через /v1/product/attributes/update
    if (attributes && Array.isArray(attributes) && attributes.length > 0 && productId) {
      updates.push(wbOzonSync.pushOzonAttributes(ozonClientId, ozonApiKey, productId, attributes))
    }

    await Promise.all(updates)
    log(`[Market] Ozon push: updated ${offerId}`)
    res.json({ success: true, message: '✅ Товар обновлён в Ozon', mediaStatus: ozonMediaStatus, mediaMessage: ozonMediaMessage })
  } catch (e) {
    log(`[Market] Ozon push error: ${e.message}`)
    res.status(500).json({ error: e.message })
  }
})

// ──────────────────────────────────────────
// Sync image between WB and Ozon
// ──────────────────────────────────────────
app.post('/api/market/sync/image', async (req, res) => {
  const wbToken = req.headers['x-wb-token']
  const ozonClientId = req.headers['x-ozon-client-id']
  const ozonApiKey = req.headers['x-ozon-api-key']
  const { sourcePlatform, targetPlatform, imageUrl, nmId, offerId } = req.body

  // Validate required fields
  if (!sourcePlatform || !targetPlatform || !imageUrl) {
    return res.status(400).json({ error: 'Требуются sourcePlatform, targetPlatform и imageUrl' })
  }

  // MS images are not supported
  if (sourcePlatform === 'ms' || targetPlatform === 'ms') {
    return res.status(400).json({ error: 'MS images not supported' })
  }

  try {
    if (sourcePlatform === 'wb' && targetPlatform === 'ozon') {
      // Copy image from WB to Ozon
      if (!ozonClientId || !ozonApiKey) {
        return res.status(401).json({ error: 'Требуются Client-Id и Api-Key Ozon' })
      }
      if (!offerId) {
        return res.status(400).json({ error: 'Требуется offerId' })
      }

      const taskId = await wbOzonSync.syncImageToOzon(ozonClientId, ozonApiKey, offerId, imageUrl)
      log(`[Market] Image synced WB→Ozon: offer=${offerId}, task=${taskId}`)
      return res.json({ success: true, message: '✅ Изображение отправлено в Ozon', taskId })

    } else if (sourcePlatform === 'ozon' && targetPlatform === 'wb') {
      // Copy image from Ozon to WB
      if (!wbToken) {
        return res.status(401).json({ error: 'Требуется токен WB' })
      }
      if (!nmId) {
        return res.status(400).json({ error: 'Требуется nmId' })
      }

      await wbOzonSync.syncImageToWB(wbToken, nmId, imageUrl)
      log(`[Market] Image synced Ozon→WB: nmId=${nmId}`)
      return res.json({ success: true, message: '✅ Изображение отправлено в Wildberries' })

    } else {
      return res.status(400).json({ error: 'Invalid sync direction. Supported: wb→ozon, ozon→wb' })
    }
  } catch (e) {
    log(`[Market] Sync image error: ${e.message}`)
    res.status(500).json({ error: e.message })
  }
})

// ──────────────────────────────────────────
// Upload image file for market products
// ──────────────────────────────────────────
const multer = require('multer');

// Configure multer for image uploads
const UPLOAD_DIR = path.join(__dirname, 'temp', 'images');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Cleanup old uploads (>1 hour) on server startup
function cleanOldUploads() {
  try {
    if (!fs.existsSync(UPLOAD_DIR)) return;
    const files = fs.readdirSync(UPLOAD_DIR);
    const now = Date.now();
    let deleted = 0;
    for (const file of files) {
      const filePath = path.join(UPLOAD_DIR, file);
      const stats = fs.statSync(filePath);
      const ageHours = (now - stats.mtimeMs) / (1000 * 60 * 60);
      if (ageHours > 1) {
        fs.unlinkSync(filePath);
        deleted++;
      }
    }
    if (deleted > 0) log(`[Upload] Cleaned ${deleted} old upload files`, 'info');
  } catch (e) {
    log(`[Upload] Cleanup error: ${e.message}`, 'error');
  }
}
cleanOldUploads();

const imageStorage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function(req, file, cb) {
    const ext = path.extname(file.originalname) || '.jpg';
    const name = 'upload_' + Date.now() + '_' + Math.round(Math.random() * 1000) + ext;
    cb(null, name);
  }
});

const imageUpload = multer({
  storage: imageStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: function(req, file, cb) {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Недопустимый формат файла: ' + ext + '. Разрешены: jpg, png, webp, gif'));
    }
  }
});

app.post('/api/market/image/upload', imageUpload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Файл не загружен' });
    }
    
    const fileUrl = '/temp/images/' + req.file.filename;
    log(`[Upload] Image saved: ${req.file.filename} (${(req.file.size / 1024).toFixed(1)} KB)`, 'info');
    
    // Log metadata if provided (platform/vendorCode)
    if (req.body.platform || req.body.vendorCode) {
      log(`[Upload] Metadata: platform=${req.body.platform || '-'}, vendorCode=${req.body.vendorCode || '-'}`, 'info');
    }
    
    res.json({
      success: true,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      url: fileUrl,
      fullUrl: fileUrl  // same for local
    });
  } catch (e) {
    log(`[Upload] Error: ${e.message}`, 'error');
    res.status(500).json({ error: e.message });
  }
});

let server

/**
 * Start (or restart) the HTTP server.
 * If the port is already in use, find and kill the occupying process,
 * then retry once.
 * @param {number} [retryCount=0]
 */
function startServer(retryCount = 0) {
  server = app.listen(PORT, () => {
    log(`=== Сервер запущен на http://localhost:${PORT} ===`, {
      pid: process.pid,
      keepLogsDays: LOG_DAYS_KEEP
    })
    const { serverStarted } = require('./lib/logger')
    serverStarted(PORT)
  })

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      if (retryCount >= 1) {
        log(`[CRITICAL] Порт ${PORT} занят! Повторная попытка не удалась.`)
        console.error(`[CRITICAL] Порт ${PORT} занят! Не удалось освободить порт.`)
        return process.exit(1)
      }

      log(`[Startup] Порт ${PORT} занят. Попытка освободить...`)

      const pid = findPidByPort(PORT)
      if (pid) {
        killPid(pid)
      }

      // Retry after a short delay to let the OS release the port
      setTimeout(() => {
        try { server.close() } catch { /* server never opened */ }
        startServer(retryCount + 1)
      }, 500)
    } else {
      log(`Ошибка сервера: ${err.message}`)
      console.error('Ошибка сервера:', err)
    }
  })
}

/**
 * Find PID of the process listening on the given port
 * @param {number} port
 * @returns {string|null}
 */
function findPidByPort(port) {
  const { execSync } = require('child_process')
  try {
    if (process.platform === 'win32') {
      const output = execSync(
        `netstat -ano | findstr "LISTENING" | findstr ":${port}"`,
        { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] }
      )
      const pids = [...new Set(
        output.trim().split('\n')
          .map(line => line.trim().split(/\s+/).pop())
          .filter(Boolean)
      )]
      return pids[0] || null
    }
    // Unix-like: lsof returns PID(s), one per line
    const output = execSync(`lsof -ti :${port}`, {
      encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore']
    }).trim()
    const pids = output.split('\n').filter(Boolean)
    return pids[0] || null
  } catch {
    return null
  }
}

/**
 * Kill a process by PID
 * @param {string|number} pid
 */
function killPid(pid) {
  const { execSync } = require('child_process')
  try {
    const cmd = process.platform === 'win32'
      ? `taskkill /PID ${pid} /F`
      : `kill -9 ${pid}`
    execSync(cmd, { timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] })
    log(`[Startup] Завершён процесс PID ${pid}, занимавший порт ${PORT}`)
  } catch (e) {
    log(`[Startup] Не удалось завершить процесс PID ${pid}: ${e.message}`)
  }
}

// Start the server
startServer(0)
