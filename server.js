const express = require('express')
const path = require('path')
const fs = require('fs')
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

// In-memory store for abort signals
const abortSignals = new Map()

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
const LOG_DIR = path.join(moduleRoot, 'logs')
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

// ANSI цвета для консоли
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
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m'
}

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
    'Страна производства',
    'Бренд',
    'Материал',
    'Пол',
    'Сезон',
    'Состав',
    'Комплектация',
    'Количество предметов в упаковке (шт.)',
  ]

  // Алиасы: названия атрибутов, которые означают одно и то же в разных системах
  const aliasMap = {
    'Страна производства': ['Страна-изготовитель'],
    'Количество предметов в упаковке (шт.)': ['Количество, штук'],
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

// Serve static files from public folder
app.use(express.static(path.join(moduleRoot, 'public')))

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
  const { vendorCode, price, title, description, characteristics } = req.body

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

    // 2. Update price via WB Prices API
    if (price !== undefined && price > 0) {
      updates.push(wbOzonSync.pushWBPrice(wbToken, nmId, price))
    }

    // 3. Update card data (description + characteristics) via Content API
    if (description !== undefined || (characteristics && characteristics.length > 0)) {
      updates.push(wbOzonSync.pushWBCard(wbToken, nmId, vendorCode, description, characteristics))
    }

    await Promise.all(updates)
    log(`[Market] WB push: updated ${vendorCode} (nmId: ${nmId})`)
    res.json({ success: true, message: '✅ Товар обновлён в Wildberries' })
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
  const { offerId, productId, price, title, description, attributes } = req.body

  if (!ozonClientId || !ozonApiKey) return res.status(401).json({ error: 'Требуются Client-Id и Api-Key Ozon' })
  if (!offerId && !productId) return res.status(400).json({ error: 'Нет offerId или productId' })

  try {
    const updates = []

    // 1. Update price — требуется числовой product_id
    if (price !== undefined && price > 0) {
      if (!productId) return res.status(400).json({ error: 'Для обновления цены нужен productId (числовой ID товара в Ozon). Перезагрузите результаты поиска.' })
      updates.push(wbOzonSync.pushOzonPrice(ozonClientId, ozonApiKey, productId, price))
    }

    // 2. Update title + description через асинхронный импорт (task_id)
    //    /v3/product/import принимает name и description одновременно
    if (title || description) {
      updates.push(wbOzonSync.pushOzonTitle(ozonClientId, ozonApiKey, offerId, title, description))
    }

    // 3. Update attributes (характеристики) через /v1/product/attributes/update
    if (attributes && Array.isArray(attributes) && attributes.length > 0 && productId) {
      updates.push(wbOzonSync.pushOzonAttributes(ozonClientId, ozonApiKey, productId, attributes))
    }

    await Promise.all(updates)
    log(`[Market] Ozon push: updated ${offerId}`)
    res.json({ success: true, message: '✅ Товар обновлён в Ozon' })
  } catch (e) {
    log(`[Market] Ozon push error: ${e.message}`)
    res.status(500).json({ error: e.message })
  }
})

// Start server
const server = app.listen(PORT, () => {
  log(`=== Сервер запущен на http://localhost:${PORT} ===`, {
    pid: process.pid,
    keepLogsDays: LOG_DAYS_KEEP
  })
  const { serverStarted } = require('./lib/logger')
  serverStarted(PORT)
})

// Handle server errors (e.g., EADDRINUSE)
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    log(`[CRITICAL] Порт ${PORT} уже занят! Сервер не может запуститься.`)
    console.error(`[CRITICAL] Порт ${PORT} уже занят! Проверьте, что другой экземпляр сервера не запущен.`)
    console.error(`Выполните: taskkill /PID <PID> /F`)
    process.exit(1)
  } else {
    log(`Ошибка сервера: ${err.message}`)
    console.error('Ошибка сервера:', err)
  }
})
