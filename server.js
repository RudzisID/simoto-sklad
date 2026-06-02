/**
 * @file Точка входа Express-сервера приложения SiMOTO-sklad
 * @description Инициализация сервера, подключение middleware, монтирование роутеров,
 * graceful shutdown по сигналам SIGTERM/SIGINT. Экспорт для тестов (NODE_ENV=test).
 */

const express = require('express')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

require('dotenv').config()

const moduleRoot = __dirname

const { TtlMap } = require('./lib/TtlMap')
const { initApi } = require('./lib/moysklad')
const { processBatch } = require('./lib/batch')
const { checkOrder, parsePositions } = require('./lib/check')
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
const wb = require('./lib/wb')
const ozon = require('./lib/ozon')
const {
  wbUrlToDataUri,
  formatDescriptionForDisplay,
  findSharedAttributes,
  generateAbortId,
  loadOrdersState,
  saveOrdersState,
  updateOrderState,
  cleanOldLogs,
  cleanOldUploads,
  findPidByPort,
  killPid
} = require('./lib/server-utils')

const { setupSSE, checkAbort, sendSSE, endSSE, makeOnProgress, sseJsonResponse } = require('./lib/sse-helper')

const app = express()

// ─── In-memory stores ───
const abortSignals = new TtlMap(5 * 60 * 1000)
const sseConnections = new Set()
let isShuttingDown = false

// ─── Constants ───
const LOG_DIR = path.join(moduleRoot, 'logs')
const STATE_FILE = path.join(moduleRoot, 'logs', 'orders_state.json')
const UPLOAD_DIR = path.join(moduleRoot, 'temp', 'images')
const serverFile = process.argv[1]
const appRoot = path.dirname(process.argv[1])
const startBatPath = path.join(appRoot, 'simoto-sklad.bat')

// ─── Logger ───
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

/**
 * Определяет ANSI-цвет для сообщения лога на основе ключевых слов
 * @param {string} message - Текст сообщения для анализа
 * @returns {string} ANSI-код цвета (\x1b[31m — red, \x1b[32m — green, \x1b[33m — yellow, и т.д.)
 */
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

/**
 * Записывает сообщение в лог-файл с датой и выводит в консоль с цветом
 * @param {string} message - Текст сообщения
 * @param {Object|string|null} [details] - Дополнительные данные (JSON-объект или строка)
 */
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

  const color = getColor(message)
  console.log(`${color}${fullMessage}${colors.reset}`)
}

// Clean old logs on startup
cleanOldLogs(LOG_DIR, log)

// ─── Middleware ───
/**
 * Парсинг JSON-тел запросов (лимит 10MB) и URL-encoded данных
 */
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

/**
 * Обслуживание статических frontend-файлов (HTML, CSS, JS, изображения)
 * Запрет кэширования для актуальности SPA
 */
app.use(express.static(path.join(moduleRoot, 'public'), {
  maxAge: 0,
  /**
   * Устанавливает заголовки кэширования для статических файлов (no-cache для HTML/CSS/JS)
   * @param {import('express').Response} res - Response объект
   * @param {string} path - Путь к запрашиваемому файлу
   */
  setHeaders: function(res, path) {
    if (path.endsWith('.html') || path.endsWith('.css') || path.endsWith('.js')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
      res.setHeader('Pragma', 'no-cache')
      res.setHeader('Expires', '0')
    }
  }
}))

// ─── Main page ───
/**
 * GET / — Главная страница SPA, отдаёт index.html из public/
 */
app.get('/', (req, res) => {
  res.sendFile(path.join(moduleRoot, 'public', 'index.html'))
})

// ─── Mount routers ───
/**
 * Монтирование роутеров с передачей зависимостей (deps)
 * - /api — REST (api.js), SSE (sse.js), Debug (debug.js)
 * - /api/market — Маркетплейсы (market.js)
 */
const apiDeps = {
  abortSignals, sseConnections, log, initApi, moduleRoot, STATE_FILE,
  isShuttingDown: () => isShuttingDown,
  wb, ozon, wbOzonSync, startBatPath,
  gracefulShutdown
}

app.use('/api', require('./routes/api')(apiDeps))
app.use('/api', require('./routes/sse')({ sseConnections, abortSignals, log, initApi, moduleRoot, wb, ozon }))
app.use('/api/market', require('./routes/market')({ log, moduleRoot, wb, ozon }))
app.use('/api', require('./routes/debug')({ STATE_FILE, log }))

// ─── Graceful shutdown ───
/**
 * Корректное завершение работы сервера: закрытие SSE-соединений,
 * остановка HTTP-сервера, опциональный перезапуск нового экземпляра
 * @param {string} signal - Сигнал завершения (SIGTERM, SIGINT, RESTART)
 * @param {boolean} [shouldRestart=false] - Перезапустить сервер после остановки
 */
function gracefulShutdown(signal, shouldRestart = false) {
  if (isShuttingDown) return
  isShuttingDown = true

  log(`Получен сигнал ${signal}, завершаю работу...`)
  log(`[${signal}] Graceful shutdown...`)

  if (sseConnections.size > 0) {
    log(`Закрываю ${sseConnections.size} активных SSE соединений...`)
    for (const sseRes of sseConnections) {
      try {
        sseRes.write(`data: ${JSON.stringify({
          type: 'shutdown',
          message: 'Сервер завершает работу'
        })}\n\n`)
        sseRes.end()
      } catch (e) {
        // Ignore errors
      }
    }
    sseConnections.clear()
  }

  server.close(() => {
    log('Сервер остановлен')
    log('[Shutdown] Server closed')

    if (shouldRestart) {
      const isWindows = process.platform === 'win32'

      if (isWindows) {
        const batPath = path.join(appRoot, 'simoto-sklad.bat')
        spawn('cmd.exe', ['/c', 'start "" "' + batPath + '"'], {
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

  setTimeout(() => {
    log('Принудительная остановка - не все соединения закрыты')
    process.exit(1)
  }, 10000)
}

/**
 * Обработчик сигнала SIGTERM — инициирует корректное завершение сервера
 */
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
/**
 * Обработчик сигнала SIGINT (Ctrl+C) — инициирует корректное завершение сервера
 */
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

// ─── Server start ───
const PORT = process.env.PORT || 3000
let server

/**
 * Запускает HTTP-сервер на PORT с обработкой ошибки EADDRINUSE (повторная попытка через 500мс)
 * @param {number} [retryCount=0] - Номер попытки при конфликте порта
 */
function startServer(retryCount = 0) {
  server = app.listen(PORT, () => {
    log(`=== Сервер запущен на http://localhost:${PORT} ===`, {
      pid: process.pid,
      keepLogsDays: 10
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
        killPid(pid, PORT)
      }

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

// Start or export for tests
if (process.env.NODE_ENV !== 'test') {
  startServer(0)
} else {
  module.exports = {
    app,
    abortSignals,
    sseConnections,
    wb,
    ozon
  }
}
