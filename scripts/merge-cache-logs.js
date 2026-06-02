/**
 * @file merge-cache-logs.js — Одноразовый merge cache-файлов из logs/ → cache/
 *
 * Переносит записи из logs/*cache*.json в cache/*cache*.json, если их там нет.
 * cache/ — authoritative (в случае дубликата приоритет у cache/).
 * После успешного merge все дубликаты в logs/ можно удалить.
 *
 * Запуск: node scripts/merge-cache-logs.js
 */

const fs = require('fs')
const path = require('path')

const moduleRoot = path.resolve(__dirname, '..')
const CACHE_DIR = path.join(moduleRoot, 'cache')
const LOGS_DIR = path.join(moduleRoot, 'logs')

// ── Пары файлов и ключи для upsert ──
// { name, key: уникальное поле записи, idKeyType: 'number'|'string' (для приведения к строке при сравнении) }
const PAIRS = [
  { name: 'wb_orders_cache.json',          key: 'id',              idKeyType: 'number' },
  { name: 'wb_sales_cache.json',           key: 'srid',            idKeyType: 'string' },
  { name: 'wb_analytics_returns_cache.json', key: 'orderId',       idKeyType: 'string' },
  { name: 'wb_orders_stickers_cache.json',  key: 'srid',           idKeyType: 'string' },
  { name: 'ozon_postings_cache.json',       key: 'posting_number', idKeyType: 'string' },
  { name: 'ozon_returns_cache.json',        key: 'id',             idKeyType: 'number' }
]

// ── Helper: загрузить JSON из файла ──
function loadJson(filePath) {
  if (!fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch (e) {
    console.error(`  [ERR] Ошибка чтения ${filePath}: ${e.message}`)
    return null
  }
}

// ── Helper: нормализовать ключ для сравнения ──
function normalizeId(value, idKeyType) {
  if (value === null || value === undefined) return null
  const str = String(value).trim()
  if (!str) return null
  return str
}

// ── Merge одного файла ──
function mergeFile(pair) {
  const { name, key, idKeyType } = pair
  const cachePath = path.join(CACHE_DIR, name)
  const logsPath = path.join(LOGS_DIR, name)

  const cacheJson = loadJson(cachePath)
  const logsJson = loadJson(logsPath)

  if (!cacheJson && !logsJson) {
    console.log(`  ${name}: нет ни cache/, ни logs/ — пропуск`)
    return null
  }
  if (!logsJson) {
    console.log(`  ${name}: нет в logs/ — cache/ без изменений`)
    return null
  }
  if (!cacheJson) {
    console.log(`  ${name}: нет в cache/ — перенос из logs/`)    // copy logs → cache
    fs.writeFileSync(cachePath, JSON.stringify(logsJson, null, 2))
    return { name, fromDir: 'logs', added: logsJson.data ? logsJson.data.length : 0, updated: 0 }
  }

  // Есть оба файла — merge
  const cacheData = Array.isArray(cacheJson.data) ? cacheJson.data : []
  const logsData = Array.isArray(logsJson.data) ? logsJson.data : []
  const cacheFetchedAt = cacheJson.fetchedAt || 0
  const logsFetchedAt = logsJson.fetchedAt || 0

  // Строим индекс существующих в cache/ по ключу
  const existingKeys = new Map()
  for (const record of cacheData) {
    const id = normalizeId(record[key], idKeyType)
    if (id) existingKeys.set(id, true)
  }

  let added = 0
  let updated = 0
  const mergedData = [...cacheData]

  for (const record of logsData) {
    const id = normalizeId(record[key], idKeyType)
    if (!id) continue
    if (!existingKeys.has(id)) {
      mergedData.push(record)
      existingKeys.set(id, true)
      added++
    }
  }

  // lastDate — max из обоих
  const cacheLastDate = cacheJson.lastDate || null
  const logsLastDate = logsJson.lastDate || null
  let mergedLastDate = cacheLastDate
  if (logsLastDate && (!mergedLastDate || logsLastDate > mergedLastDate)) {
    mergedLastDate = logsLastDate
  }

  // fetchedAt — max
  const mergedFetchedAt = Math.max(cacheFetchedAt, logsFetchedAt) || Date.now()

  const result = { data: mergedData }
  if (mergedLastDate) result.lastDate = mergedLastDate
  result.fetchedAt = mergedFetchedAt

  fs.writeFileSync(cachePath, JSON.stringify(result, null, 2))
  return { name, fromDir: 'merge', added, updated, cacheCount: cacheData.length, logsCount: logsData.length, mergedCount: mergedData.length }
}

// ── Main ──
function main() {
  console.log('=== Merge cache/logs → cache ===\n')
  console.log(`cache/: ${CACHE_DIR}`)
  console.log(`logs/:  ${LOGS_DIR}\n`)

  let totalAdded = 0
  const results = []

  for (const pair of PAIRS) {
    console.log(`--- ${pair.name} (key: ${pair.key}) ---`)
    const result = mergeFile(pair)
    if (result) {
      results.push(result)
      if (result.added) {
        totalAdded += result.added
        console.log(`  ✓ Добавлено: ${result.added} записей из logs/ (было ${result.cacheCount}, стало ${result.mergedCount})`)
      } else {
        console.log(`  ✓ Все записи уже есть в cache/ (${result.cacheCount} записей, без изменений)`)
      }
    }
    console.log('')
  }

  console.log('=== Итого ===')
  console.log(`Всего добавлено записей из logs/: ${totalAdded}`)
  console.log('Файлы cache/ обновлены.')
  console.log('\nТеперь можно удалить дубликаты из logs/ командой:')
  console.log('  node scripts/merge-cache-logs.js --cleanup')
}

// ── Cleanup ──
function cleanup() {
  console.log('=== Cleanup: удаление дубликатов cache из logs/ ===\n')

  for (const pair of PAIRS) {
    const logsPath = path.join(LOGS_DIR, pair.name)
    if (fs.existsSync(logsPath)) {
      const stat = fs.statSync(logsPath)
      fs.unlinkSync(logsPath)
      console.log(`  ✗ Удалён: ${pair.name} (${(stat.size / 1024).toFixed(1)} KB)`)
    } else {
      console.log(`  - Нет: ${pair.name}`)
    }
  }

  console.log('\n✓ Очистка завершена.')
  console.log('  logs/ теперь содержит только:')
  console.log('  - orders_state.json')
  console.log('  - payments_*.log')
}

// ── Entry ──
if (process.argv.includes('--cleanup')) {
  cleanup()
} else {
  main()
}
