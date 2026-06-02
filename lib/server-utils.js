'use strict'

const path = require('path')
const fs = require('fs')
const { error, info } = require('./logger')

/**
 * @file Вспомогательные функции для server.js и не только
 * @module lib/server-utils
 *
 * Общие утилиты, используемые сервером и роутами:
 * - wbUrlToDataUri — конвертация WB CDN URL в data URI
 * - findSharedAttributes — поиск общих атрибутов товаров MS/WB/Ozon
 * - orderState — управление состоянием заказов (load/save/update)
 * - cleanOldLogs / cleanOldUploads — очистка устаревших файлов
 * - findPidByPort / killPid — управление процессами по порту
 *
 * @requires path
 * @requires fs
 */

const LOG_DAYS_KEEP = 10

/**
 * Преобразование WB CDN URL (basket-*.wb.ru) в base64 Data URI,
 * чтобы WB /media/save API мог переиспользовать изображения уже на серверах WB.
 * При ошибке возвращает оригинальный URL.
 * @param {string} imageUrl - WB CDN URL
 * @param {Function} [log=console.log] - Функция логирования
 * @returns {Promise<string>} Base64 Data URI or original URL on error
 */
function wbUrlToDataUri(imageUrl, log = console.log) {
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
    const mod = imageUrl.startsWith('https') ? require('https') : require('http')
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

/**
 * Генерирует уникальный ID для abort signal
 * @returns {string} Случайный ID
 */
function generateAbortId() {
  return Math.random().toString(36).substring(2, 15)
}

/**
 * Удаление старых логов при запуске
 * @param {string} LOG_DIR - Путь к директории логов
 * @param {Function} [log=console.log] - Функция логирования
 */
function cleanOldLogs(LOG_DIR, log = console.log) {
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

    log(`[Startup] Удалено старых логов: ${deleted}`)
  } catch (e) {
    error(`[Startup] Ошибка очистки логов: ${e.message}`)
  }
}

/**
 * Загрузка состояния заказов из файла
 * @param {string} stateFile - Путь к файлу состояния
 * @param {Function} [log=console.log] - Функция логирования
 * @returns {Object} Состояние заказов
 */
function loadOrdersState(stateFile, log = console.log) {
  try {
    if (fs.existsSync(stateFile)) {
      const data = JSON.parse(fs.readFileSync(stateFile, 'utf-8'))
      log(`Loaded orders state from file: ${stateFile} - count: ${Object.keys(data).length}`)
      return data
    }
    log(`Orders state file not found: ${stateFile}`)
  } catch (e) {
    error(`Error loading state: ${e.message}`)
  }
  return {}
}

/**
 * Сохранение состояния заказов в файл
 * @param {Object} state - Состояние для сохранения
 * @param {string} stateFile - Путь к файлу состояния
 * @param {Function} [log=console.log] - Функция логирования
 */
function saveOrdersState(state, stateFile, log = console.log) {
  try {
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2))
    log(`Saved orders state to file: ${stateFile} - count: ${Object.keys(state).length}`)
  } catch (e) {
    error(`Error saving state: ${e.message}`)
  }
}

/**
 * Обновление состояния заказа (action, result, extraData)
 * @param {string} shipmentNum - Номер отправления
 * @param {string} action - Выполненное действие
 * @param {string} result - Результат действия
 * @param {Object} [extraData={}] - Дополнительные данные
 * @param {string} stateFile - Путь к файлу состояния
 * @param {Function} [log=console.log] - Функция логирования
 * @returns {Object} Обновлённое состояние заказа
 */
function updateOrderState(shipmentNum, action, result, extraData = {}, stateFile, log) {
  const state = loadOrdersState(stateFile, log)
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

  saveOrdersState(state, stateFile, log)
  return state[shipmentNum]
}

/**
 * Поиск общих полей по названиям в товарах МС, WB, Ozon
 * @param {Object|null} msProduct - Товар из МойСклад
 * @param {Object|null} wbProduct - Товар из Wildberries
 * @param {Object|null} ozonProduct - Товар из Ozon
 * @returns {Array<{name: string, systems: {ms: Object, ozon: Object, wb: Object}}>}
 */
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

/**
 * Очистка HTML-описания для отображения
 * Убирает теги, заменяет <br>/</p> на \n, схлопывает пробелы
 * @param {string} rawHtml - Исходный HTML
 * @returns {string} Очищенный текст
 */
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

/**
 * Очистка старых загрузок (>1 часа) при запуске сервера
 * @param {string} UPLOAD_DIR - Путь к директории загрузок
 * @param {Function} [log=console.log] - Функция логирования
 */
function cleanOldUploads(UPLOAD_DIR, log = console.log) {
  try {
    if (!fs.existsSync(UPLOAD_DIR)) return
    const files = fs.readdirSync(UPLOAD_DIR)
    const now = Date.now()
    let deleted = 0
    for (const file of files) {
      const filePath = path.join(UPLOAD_DIR, file)
      const stats = fs.statSync(filePath)
      const ageHours = (now - stats.mtimeMs) / (1000 * 60 * 60)
      if (ageHours > 1) {
        fs.unlinkSync(filePath)
        deleted++
      }
    }
    if (deleted > 0) log(`[Upload] Cleaned ${deleted} old upload files`, 'info')
  } catch (e) {
    log(`[Upload] Cleanup error: ${e.message}`, 'error')
  }
}

/**
 * Поиск PID процесса, слушающего указанный порт
 * @param {number} port - Номер порта
 * @returns {string|null} PID или null
 */
function findPidByPort(port) {
  try {
    const { execSync } = require('child_process')
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
 * Завершение процесса по PID
 * @param {string|number} pid - Идентификатор процесса
 * @param {number} port - Номер порта (для логирования)
 */
function killPid(pid, port) {
  try {
    const { execSync } = require('child_process')
    const cmd = process.platform === 'win32'
      ? `taskkill /PID ${pid} /F`
      : `kill -9 ${pid}`
    execSync(cmd, { timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] })
    info(`[Startup] Завершён процесс PID ${pid}, занимавший порт ${port}`)
  } catch (e) {
    error(`[Startup] Не удалось завершить процесс PID ${pid}: ${e.message}`)
  }
}

module.exports = {
  wbUrlToDataUri,
  generateAbortId,
  cleanOldLogs,
  loadOrdersState,
  saveOrdersState,
  updateOrderState,
  findSharedAttributes,
  formatDescriptionForDisplay,
  cleanOldUploads,
  findPidByPort,
  killPid
}
