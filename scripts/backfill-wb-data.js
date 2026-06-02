/**
 * Backfill старых данных из WB API
 *
 * 1. supplier/sales?dateFrom=2026-01-27 — продажи (статистика, лимит выше)
 * 2. goods-return?dateFrom=2026-01-27&dateTo=2026-02-25 — возвраты (аналитика, ~1 req/2мин)
 *
 * Merge в существующие кэши (upsert по srid / orderId).
 * Запуск: node scripts/backfill-wb-data.js
 */

const fs = require('fs')
const path = require('path')
const https = require('https')

const moduleRoot = path.resolve(__dirname, '..')

// ── Файлы кэша ──
const SALES_CACHE_FILE = path.join(moduleRoot, 'cache', 'wb_sales_cache.json')
const ANALYTICS_CACHE_FILE = path.join(moduleRoot, 'cache', 'wb_analytics_returns_cache.json')
const ENV_FILE = path.join(moduleRoot, '.env')

// ── Дата для backfill ──
const BACKFILL_DATE = '2026-01-27'

// ── Простой HTTP GET ──
function httpsGet(hostname, path, token) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname,
      path,
      method: 'GET',
      headers: { 'Authorization': token }
    }
    const req = https.request(opts, (res) => {
      let body = ''
      res.on('data', chunk => body += chunk)
      res.on('end', () => {
        let parsed = null
        try { parsed = JSON.parse(body) } catch (e) { /* not JSON */ }
        resolve({ status: res.statusCode, statusText: res.statusMessage, headers: res.headers, body: parsed, raw: body })
      })
    })
    req.on('error', reject)
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('timeout')) })
    req.end()
  })
}

// ── Чтение токена из .env ──
function loadToken() {
  if (!fs.existsSync(ENV_FILE)) {
    console.error('.env не найден!')
    process.exit(1)
  }
  const content = fs.readFileSync(ENV_FILE, 'utf-8')
  const m = content.match(/^WB_TOKEN=(.+)$/m)
  if (!m) {
    console.error('WB_TOKEN не найден в .env!')
    process.exit(1)
  }
  return m[1].trim()
}

// ── Загрузка кэша ──
function loadCache(file) {
  if (fs.existsSync(file)) {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf-8'))
      if (saved && (Array.isArray(saved.data) || Array.isArray(saved))) {
        return {
          data: Array.isArray(saved.data) ? saved.data : saved,
          lastDate: saved.lastDate || null,
          fetchedAt: saved.fetchedAt || 0
        }
      }
    } catch (e) {
      console.log(`  Ошибка чтения ${file}: ${e.message}`)
    }
  }
  return { data: null, lastDate: null, fetchedAt: 0 }
}

// ── Сохранение кэша ──
function saveCache(file, data, lastDate) {
  try {
    fs.writeFileSync(file, JSON.stringify({
      data,
      lastDate: lastDate || null,
      fetchedAt: Date.now()
    }))
    console.log(`  ✓ Сохранён: ${file} (${data.length} записей, lastDate=${lastDate})`)
  } catch (e) {
    console.error(`  ✗ Ошибка сохранения ${file}: ${e.message}`)
  }
}

// ═══════════════════════════════════════════════════════════════════
// 1. BACKFILL SALES
// ═══════════════════════════════════════════════════════════════════
async function backfillSales(token) {
  console.log('\n=== 1. Backfill Sales ===')

  const cache = loadCache(SALES_CACHE_FILE)
  const salesArr = Array.isArray(cache.data) ? cache.data : []
  console.log(`Существующий кэш: ${salesArr.length} записей, lastDate=${cache.lastDate}`)

  // Строим индекс существующих srid
  const existingSrids = new Set(salesArr.map(r => r.srid).filter(Boolean))
  console.log(`Существующих srid: ${existingSrids.size}`)

  const path = `/api/v1/supplier/sales?dateFrom=${BACKFILL_DATE}&flag=0`
  console.log(`Запрос: ${path}`)

  const res = await httpsGet('statistics-api.wildberries.ru', path, token)
  console.log(`Ответ: ${res.status} ${res.statusText}`)

  if (res.status === 429) {
    const retrySec = parseInt(res.headers?.['x-ratelimit-retry'] || res.headers?.['x-ratelimit-reset'], 10) || 60
    console.log(`  Рейт-лимит (429), нужно ждать ${retrySec}с. Пропускаем.`)
    console.log(`  Текущий кэш остаётся без изменений (${salesArr.length} записей)`)
    return
  }

  if (res.status !== 200) {
    console.log(`  Ошибка: ${res.status} ${res.statusText}. Пропускаем.`)
    return
  }

  const records = Array.isArray(res.body) ? res.body : []
  if (records.length === 0) {
    console.log('  Пустой ответ — новых данных нет.')
    return
  }

  console.log(`  Получено записей: ${records.length}`)

  // Проверяем даты
  const dateRange = records.reduce((acc, r) => {
    if (r.lastChangeDate) {
      if (!acc.min || r.lastChangeDate < acc.min) acc.min = r.lastChangeDate
      if (!acc.max || r.lastChangeDate > acc.max) acc.max = r.lastChangeDate
    }
    return acc
  }, { min: null, max: null })
  console.log(`  Диапазон дат: ${dateRange.min} → ${dateRange.max}`)

  // Merge (upsert по srid)
  let added = 0
  let updated = 0
  for (const record of records) {
    if (!record.srid) continue
    if (existingSrids.has(record.srid)) {
      const idx = salesArr.findIndex(r => r.srid === record.srid)
      if (idx !== -1) {
        salesArr[idx] = record
        updated++
      }
    } else {
      salesArr.push(record)
      existingSrids.add(record.srid)
      added++
    }
  }

  console.log(`  Добавлено: ${added}, обновлено: ${updated}`)

  // Обновляем lastDate
  const maxDate = records.reduce((max, r) => {
    if (r.lastChangeDate && (!max || r.lastChangeDate > max)) return r.lastChangeDate
    return max
  }, null)
  const newLastDate = (cache.lastDate && cache.lastDate > maxDate) ? cache.lastDate : maxDate
  console.log(`  lastDate: ${cache.lastDate} → ${newLastDate}`)

  // Сохраняем
  saveCache(SALES_CACHE_FILE, salesArr, newLastDate)
  console.log(`  Итого: ${salesArr.length} записей`)
}

// ═══════════════════════════════════════════════════════════════════
// 2. BACKFILL ANALYTICS
// ═══════════════════════════════════════════════════════════════════
async function backfillAnalytics(token) {
  console.log('\n=== 2. Backfill Analytics ===')

  const cache = loadCache(ANALYTICS_CACHE_FILE)
  const analyticsArr = Array.isArray(cache.data) ? cache.data : []
  console.log(`Существующий кэш: ${analyticsArr.length} записей, lastDate=${cache.lastDate}`)

  // Строим индекс существующих orderId
  const existingOrderIds = new Set(analyticsArr.map(r => r.orderId).filter(Boolean))
  console.log(`Существующих orderId: ${existingOrderIds.size}`)

  // Фетчим диапазон с паузой между попытками
  const dateFrom = BACKFILL_DATE
  const dateTo = '2026-02-25'
  const path = `/api/v1/analytics/goods-return?dateFrom=${dateFrom}&dateTo=${dateTo}`
  console.log(`Запрос: ${path}`)

  const res = await httpsGet('seller-analytics-api.wildberries.ru', path, token)
  console.log(`Ответ: ${res.status} ${res.statusText}`)

  if (res.status === 429) {
    console.log('  Рейт-лимит (429). Пропускаем.')
    return
  }

  if (res.status !== 200) {
    console.log(`  Ошибка: ${res.status} ${res.statusText}. Пропускаем.`)
    return
  }

  const records = (res.body && Array.isArray(res.body.report)) ? res.body.report : []
  if (records.length === 0) {
    console.log('  Пустой ответ — новых данных нет.')
    return
  }

  console.log(`  Получено записей: ${records.length}`)

  // Проверяем даты
  const getDate = (r) => r.completedDt || r.orderDt || r.readyToReturnDt || null
  const dateRange = records.reduce((acc, r) => {
    const dt = getDate(r)
    if (dt) {
      if (!acc.min || dt < acc.min) acc.min = dt
      if (!acc.max || dt > acc.max) acc.max = dt
    }
    return acc
  }, { min: null, max: null })
  console.log(`  Диапазон дат: ${dateRange.min} → ${dateRange.max}`)

  // Проверяем orderId 4644675699 и другие
  const targetIds = ['4640585774', '4638447983', '4644675699', '4647090031', '4628779273']
  for (const t of targetIds) {
    const found = records.find(r => String(r.orderId) === t)
    if (found) {
      console.log(`  ✓ Найден orderId ${t}: nmId=${found.nmId}, completedDt=${found.completedDt}, status=${found.status}`)
    } else {
      console.log(`  ✗ orderId ${t} не найден в ответе аналитики`)
    }
  }

  // Merge (upsert по orderId)
  let added = 0
  let updated = 0
  for (const record of records) {
    if (!record.orderId) continue
    const key = String(record.orderId)
    if (existingOrderIds.has(key)) {
      const idx = analyticsArr.findIndex(r => String(r.orderId) === key)
      if (idx !== -1) {
        analyticsArr[idx] = record
        updated++
      }
    } else {
      analyticsArr.push(record)
      existingOrderIds.add(key)
      added++
    }
  }

  console.log(`  Добавлено: ${added}, обновлено: ${updated}`)

  // Обновляем lastDate
  const maxDate = records.reduce((max, r) => {
    const dt = getDate(r)
    if (dt && (!max || dt > max)) return dt
    return max
  }, null)
  const effectiveDate = maxDate || dateTo
  const newLastDate = (cache.lastDate && cache.lastDate > effectiveDate) ? cache.lastDate : effectiveDate
  console.log(`  lastDate: ${cache.lastDate} → ${newLastDate}`)

  // Сохраняем
  saveCache(ANALYTICS_CACHE_FILE, analyticsArr, newLastDate)
  console.log(`  Итого: ${analyticsArr.length} записей`)
}

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════
async function main() {
  console.log('=== Backfill WB Data ===')
  console.log(`Дата: ${new Date().toISOString()}`)

  const token = loadToken()
  console.log(`Токен: ${token.substring(0, 20)}... (${token.length} символов)`)

  // Сначала sales (быстрый, статистика)
  await backfillSales(token)

  // Потом analytics (медленный, селлер-аналитика)
  console.log('\nПауза 5 секунд перед analytics...')
  await new Promise(r => setTimeout(r, 5000))
  await backfillAnalytics(token)

  console.log('\n=== Backfill завершён ===')
}

main().catch(e => {
  console.error('FATAL:', e.message)
  process.exit(1)
})
