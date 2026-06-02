/**
 * Импорт XLSX-отчётов WB "Сборочные задания" в кэш Маркетплейс
 *
 * Читает файлы из tmp/Отчёты/*.xlsx, маппит колонки,
 * merge в wbOrdersCache.data (upsert по id), перестраивает индексы.
 *
 * Запуск: node scripts/import-wb-orders-xlsx.js
 */

const fs = require('fs')
const path = require('path')
const XLSX = require('xlsx')

const moduleRoot = path.resolve(__dirname, '..')

// ── Файлы ──
const XLSX_DIR = path.join(moduleRoot, 'tmp', 'Отчёты')
const CACHE_FILE = path.join(moduleRoot, 'cache', 'wb_orders_cache.json')

// ── Маппинг колонок XLSX → поле в объекте ──
const COLUMN_MAP = {
  '№ задания': 'id',
  'Артикул Wildberries': 'nmId',
  'Стоимость': 'price',
  'Стикер': 'sticker',
  'Дата создания': 'createdAt',
  'Баркод': 'barcode',
  'Статус задания': 'status',
  'Артикул продавца': 'article',
  'QR-код поставки': 'supplyId',
  'Наименование': 'goodsName',
  'Размер': 'techSize',
  'Склад продавца': 'warehouseName'
}

/**
 * Конвертирует дату из формата XLSX в ISO
 * Вход: "19:59:33 03.04.2026" или "19:25:58 26.05.2026"
 * Выход: "2026-04-03T19:59:33Z"
 */
function parseXlsxDate(raw) {
  if (!raw || raw === '-' || raw === '') return ''
  const str = String(raw).trim()
  // XLSX может отдать дату как число (серийный номер Excel)
  if (!isNaN(str) && str.length < 10) {
    // Excel serial date — конвертируем
    try {
      const excelEpoch = new Date(1899, 11, 30)
      const d = new Date(excelEpoch.getTime() + parseFloat(str) * 86400000)
      if (!isNaN(d.getTime())) return d.toISOString()
    } catch (e) { /* fall through */ }
  }
  // "HH:mm:ss DD.MM.YYYY"
  const m = str.match(/^(\d{2}):(\d{2}):(\d{2})\s+(\d{2})\.(\d{2})\.(\d{4})$/)
  if (m) {
    const [, hh, mm, ss, dd, MM, yyyy] = m
    return `${yyyy}-${MM}-${dd}T${hh}:${mm}:${ss}Z`
  }
  // "DD.MM.YYYY" (без времени)
  const m2 = str.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (m2) {
    const [, dd, MM, yyyy] = m2
    return `${yyyy}-${MM}-${dd}T00:00:00Z`
  }
  return str // as-is, может уже ISO
}

/**
 * Парсит число из XLSX (строки или числа)
 */
function parseNumber(raw) {
  if (raw === undefined || raw === null || raw === '' || raw === '-') return 0
  const str = String(raw).replace(/[^0-9.,-]/g, '').replace(',', '.')
  const n = parseFloat(str)
  return isNaN(n) ? 0 : n
}

// ── Основной скрипт ──
function main() {
  console.log('=== Импорт XLSX → Маркетплейс кэш ===\n')

  // 1. Читаем существующий кэш
  let cache = { data: [], fetchedAt: 0 }
  if (fs.existsSync(CACHE_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'))
      if (saved && Array.isArray(saved.data)) {
        cache = saved
        console.log(`Существующий кэш: ${cache.data.length} записей (fetchedAt: ${new Date(cache.fetchedAt).toISOString()})`)
      }
    } catch (e) {
      console.log(`Ошибка чтения кэша: ${e.message}, начинаем с нуля`)
    }
  } else {
    console.log('Кэш не найден, начинаем с нуля')
  }

  // 2. Индекс существующих id для upsert
  const existingIds = new Set(cache.data.map(r => String(r.id)))
  console.log(`Существующих уникальных id: ${existingIds.size}`)

  // 3. Читаем все XLSX файлы
  if (!fs.existsSync(XLSX_DIR)) {
    console.error(`Директория не найдена: ${XLSX_DIR}`)
    process.exit(1)
  }

  const files = fs.readdirSync(XLSX_DIR).filter(f => f.endsWith('.xlsx')).sort()
  console.log(`Найдено файлов: ${files.length}\n`)

  let totalRows = 0
  let newRows = 0
  let updatedRows = 0
  let importedOrders = []

  for (const file of files) {
    const filePath = path.join(XLSX_DIR, file)
    console.log(`--- ${file} ---`)

    const wb = XLSX.readFile(filePath)
    const ws = wb.Sheets['Сборочные задания']
    if (!ws) {
      console.log('  Пропущен: нет листа "Сборочные задания"')
      continue
    }

    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
    const headers = rows[0]
    if (!headers || headers.length === 0) {
      console.log('  Пропущен: нет заголовков')
      continue
    }

    // Строим маппинг колонок
    const colIdx = {}
    for (const [xlsxCol, field] of Object.entries(COLUMN_MAP)) {
      const idx = headers.indexOf(xlsxCol)
      if (idx !== -1) colIdx[field] = idx
    }
    if (colIdx.id === undefined) {
      console.log('  Пропущен: нет колонки "№ задания"')
      continue
    }

    let fileNew = 0
    let fileUpdated = 0

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]
      const rawId = row[colIdx.id]
      if (rawId === undefined || rawId === null || rawId === '' || rawId === '-') continue

      const id = String(rawId).trim()
      if (!id) continue
      totalRows++

      // Парсим поля
      const order = {
        id: parseNumber(rawId),
        nmId: parseNumber(row[colIdx.nmId]),
        price: parseNumber(row[colIdx.price]),
        sticker: String(row[colIdx.sticker] || '').trim(),
        createdAt: parseXlsxDate(row[colIdx.createdAt]),
        barcode: String(row[colIdx.barcode] || '').trim(),
        status: String(row[colIdx.status] || '').trim(),
        article: String(row[colIdx.article] || '').trim(),
        supplyId: String(row[colIdx.supplyId] || '').trim(),
        goodsName: String(row[colIdx.goodsName] || '').trim(),
        techSize: String(row[colIdx.techSize] || '').trim(),
        warehouseName: String(row[colIdx.warehouseName] || '').trim(),
        _source: 'xlsx' // пометка, что из CSV/XLSX
      }

      // Очищаем пустые строки
      for (const k of Object.keys(order)) {
        if (order[k] === '' || order[k] === '-') order[k] = ''
      }

      importedOrders.push(order)
    }

    console.log(`  Прочитано строк: ${rows.length - 1}, импортировано: ${importedOrders.length - (totalRows - (rows.length - 1))}`)
  }

  console.log('\n=== Merge ===')
  console.log(`Всего прочитано: ${totalRows} строк из XLSX`)

  // 4. Merge в кэш (upsert по id)
  // Приоритет: существующие записи из API (с полным набором полей)
  // XLSX-записи добавляются только если id нет в кэше
  const existingIndex = new Map(cache.data.map(r => [String(r.id), r]))

  for (const order of importedOrders) {
    const key = String(order.id)
    if (existingIndex.has(key)) {
      // Обновляем только если у существующей записи нет каких-то полей
      const existing = existingIndex.get(key)
      let changed = false
      for (const k of ['sticker', 'barcode', 'status', 'article', 'goodsName', 'supplyId', 'createdAt']) {
        if (order[k] && !existing[k]) {
          existing[k] = order[k]
          changed = true
        }
      }
      if (changed) updatedRows++
      // price из XLSX НЕ перезаписываем (у API точнее)
    } else {
      // Новая запись — добавляем
      cache.data.push(order)
      existingIndex.set(key, order)
      newRows++
    }
  }

  console.log(`Новых записей: ${newRows}`)
  console.log(`Обновлено (дополнено полей): ${updatedRows}`)
  console.log(`Всего в кэше: ${cache.data.length} записей`)

  // 5. Перестраиваем индексы
  const byRid = new Map()
  const byNmId = new Map()
  const byId = new Map()

  for (const order of cache.data) {
    byId.set(String(order.id), order)
    if (order.rid) byRid.set(order.rid, order)

    const nmId = String(order.nmId || '')
    if (nmId && nmId !== '0') {
      if (!byNmId.has(nmId)) byNmId.set(nmId, [])
      byNmId.get(nmId).push(order)
    }
  }

  console.log('\n=== Итоговые индексы ===')
  console.log(`byId: ${byId.size}`)
  console.log(`byRid: ${byRid.size}`)
  console.log(`byNmId: ${byNmId.size} nmIds`)

  // 6. Сохраняем на диск
  cache.fetchedAt = Date.now()
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify({
      data: cache.data,
      fetchedAt: cache.fetchedAt
    }))
    console.log(`\n✓ Кэш сохранён: ${CACHE_FILE} (${cache.data.length} записей)`)

    // Пересоздаём файл с индексами для проверки
    const indexDump = {
      byIdSize: byId.size,
      byRidSize: byRid.size,
      byNmIdSize: byNmId.size,
      sampleNew: Array.from(byId.entries())
        .filter(([id]) => !existingIds.has(id))
        .slice(0, 5)
        .map(([id, order]) => ({ id, nmId: order.nmId, price: order.price, createdAt: order.createdAt }))
    }
    console.log('\nПримеры новых записей:')
    for (const s of indexDump.sampleNew) {
      console.log(`  id=${s.id} nmId=${s.nmId} price=${s.price} date=${s.createdAt}`)
    }
  } catch (e) {
    console.error(`\n✗ Ошибка сохранения: ${e.message}`)
    process.exit(1)
  }
}

main()
