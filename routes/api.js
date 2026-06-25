'use strict'

const express = require('express')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

const { processBatch } = require('../lib/batch')
const { checkOrder, parsePositions } = require('../lib/check')
const {
  findOrderByShipmentNum,
  getOrderFullForCreate,
  getDemand
} = require('../lib/order')
const { createPayment } = require('../lib/payment')
const { createPartialPayment } = require('../lib/payment')
const { createDemand } = require('../lib/demand')
const { createReturn } = require('../lib/return')
const { cancelOrder } = require('../lib/cancel')
const { findProductByCode } = require('../lib/product')
const { exportStickerPdf } = require('../lib/print')
const {
  loadOrdersState,
  saveOrdersState,
  updateOrderState
} = require('../lib/server-utils')
const supplies = require('../lib/supplies')
const { getApi } = require('../lib/api-utils')

/**
 * REST API роутер
 * @param {Object} deps - Зависимости
 * @param {import('../lib/TtlMap').TtlMap} deps.abortSignals - Хранилище сигналов отмены
 * @param {Set} deps.sseConnections - Активные SSE соединения
 * @param {Function} deps.log - Функция логирования
 * @param {Function} deps.initApi - Функция инициализации API
 * @param {string} deps.moduleRoot - Корневая директория модуля
 * @param {string} deps.STATE_FILE - Путь к файлу состояния заказов
 * @param {boolean} deps.isShuttingDown - Флаг завершения работы
 * @param {Object} deps.wb - WB модуль
 * @param {Object} deps.ozon - Ozon модуль
 * @param {Object} deps.wbOzonSync - Модуль синхронизации WB/Ozon
 * @param {string} deps.startBatPath - Путь к start.bat
 * @param {Function} deps.gracefulShutdown - Функция graceful shutdown
 * @returns {import('express').Router}
 */
module.exports = function(deps) {
  const router = express.Router()
  const { abortSignals, log, initApi, moduleRoot, STATE_FILE, isShuttingDown, wb, ozon, wbOzonSync, startBatPath, gracefulShutdown } = deps

  // ─── Health check ───
  /**
   * GET /api/health — Проверка работоспособности сервера
   * @returns {{ status: string, time: string }} { status: 'ok', time: ISO-строка }
   */
  router.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() })
  })

  // ─── Abort ───
  /**
   * POST /api/abort — Установка сигнала отмены для активного процесса
   * @param {Object} req.body - Тело запроса
   * @param {string} req.body.abortId - Идентификатор процесса для отмены
   * @returns {{ success: boolean }}
   */
  router.post('/abort', (req, res) => {
    const { abortId } = req.body
    if (abortId) {
      abortSignals.set(abortId, true)
      log(`Abort requested for: ${abortId}`)
    }
    res.json({ success: true })
  })

  // ─── Process numbers ───
  /**
   * POST /api/process — Проверка (check) одного или нескольких заказов по номерам отправлений
   * @param {Object} req.body - Тело запроса
   * @param {string[]} req.body.numbers - Массив номеров отправлений
   * @param {string} req.headers.x-api-token - Токен API МойСклад
   * @returns {Object} Результат проверки заказов (массив orders со статусами)
   * @throws {{ error: string }} При отсутствии токена, некорректных данных или ошибке
   */
  router.post('/process', async (req, res) => {
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

  // ─── Batch action ───
  /**
   * POST /api/batch — Пакетное выполнение действия (demand, payment, return, cancel) над заказами
   * @param {Object} req.body - Тело запроса
   * @param {string[]} req.body.numbers - Массив номеров отправлений
   * @param {string} req.body.action - Действие: demand | payment | return | cancel
   * @param {string} req.headers.x-api-token - Токен API МойСклад
   * @returns {Object} Результат пакетной операции
   * @throws {{ error: string }} При отсутствии токена, неверном action или ошибке
   */
  router.post('/batch', async (req, res) => {
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

  // ─── Save report ───
  /**
   * POST /api/save-report — Сохранение отчёта о проверке/операциях в JSON-файл
   * @param {Object} req.body - Тело запроса
   * @param {Object[]} req.body.ordersData - Данные заказов
   * @param {Object[]} req.body.resultsData - Результаты операций
   * @returns {{ success: boolean, file: string }} Путь к сохранённому файлу отчёта
   */
  router.post('/save-report', async (req, res) => {
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

  // ─── Create payment ───
  /**
   * POST /api/create-payment — Создание платежа в МойСклад для заказа
   * @param {Object} req.body - Тело запроса
   * @param {string} req.body.shipmentNum - Номер отправления
   * @param {string} [req.body.orderId] - ID заказа (если известен, поиск пропускается)
   * @param {string} req.headers.x-api-token - Токен API МойСклад
   * @returns {{ success: boolean, paymentName: string }}
   * @throws {{ error: string }} При отсутствии токена, номера отправления или ошибке
   */
  router.post('/create-payment', async (req, res) => {
    const { shipmentNum, orderId: directOrderId } = req.body
    const token = req.headers['x-api-token']

    if (!token || !shipmentNum) {
      return res.json({ error: 'Требуется токен и номер отправления' })
    }

    initApi(token)
    log(`Создание платежа: ${shipmentNum}${directOrderId ? ` (orderId: ${directOrderId})` : ''}`, { token: token.slice(0, 8) + '...' })

    try {
      let orderId = directOrderId

      if (!orderId) {
        log(`Проверка заказа: ${shipmentNum}`)
        const checkResult = await checkOrder(shipmentNum, log)

        if (!checkResult.canPayment) {
          log(`Нельзя создать платёж: ${checkResult.statusName}`, {
            shipmentNum,
            status: checkResult.status
          })
          updateOrderState(shipmentNum, 'payment_check', 'skipped: ' + checkResult.statusName, {}, STATE_FILE, log)
          return res.json({ error: 'Невозможно создать платёж: ' + checkResult.statusName })
        }
        orderId = checkResult.orderId
      }

      log(`Заказ найден, создаю платёж: ${shipmentNum} (orderId: ${orderId})`)
      const payment = await createPayment(orderId)
      log(`Платёж создан: ${payment.name}`, { shipmentNum })

      // Получаем данные для обновления состояния
      const orderFull = await getOrderFullForCreate(orderId)
      const demandId = orderFull.demands[0].meta.href.split('/').pop()
      const demand = await getDemand(demandId)

      updateOrderState(shipmentNum, 'payment_created', payment.name, {
        orderName: orderFull.name,
        sum: demand.sum / 100,
        paid: demand.payedSum / 100,
        orderId: orderFull.id,
        orderUrl: `https://online.moysklad.ru/app/#customerorder/${orderFull.id}`
      }, STATE_FILE, log)

      res.json({ success: true, paymentName: payment.name })
    } catch (e) {
      log(`Ошибка: ${e.message}`, { shipmentNum, stack: e.stack })
      updateOrderState(shipmentNum, 'payment_error', e.message, {}, STATE_FILE, log)
      res.json({ error: e.message })
    }
  })

  // ─── Create partial payment ───
  /**
   * POST /api/create-partial-payment — Создание частичного платежа по возврату
   * @param {Object} req.body - Тело запроса
   * @param {string} req.body.shipmentNum - Номер отправления
   * @param {string} [req.body.orderId] - ID заказа (если известен)
   * @param {string} req.headers.x-api-token - Токен API МойСклад
   * @returns {{ success: boolean, paymentName: string, paymentSum: number }}
   * @throws {{ error: string }}
   */
  router.post('/create-partial-payment', async (req, res) => {
    const { shipmentNum, orderId: directOrderId } = req.body
    const token = req.headers['x-api-token']

    if (!token || !shipmentNum) {
      return res.json({ error: 'Требуется токен и номер отправления' })
    }

    initApi(token)
    log(`Создание частичного платежа: ${shipmentNum}${directOrderId ? ` (orderId: ${directOrderId})` : ''}`, { token: token.slice(0, 8) + '...' })

    try {
      let orderId = directOrderId

      if (!orderId) {
        log(`Проверка заказа: ${shipmentNum}`)
        const order = await findOrderByShipmentNum(shipmentNum, log)
        if (!order) {
          log(`Заказ не найден: ${shipmentNum}`)
          updateOrderState(shipmentNum, 'partial_payment_check', 'order_not_found', {}, STATE_FILE, log)
          return res.json({ error: 'Заказ не найден' })
        }
        orderId = order.id
      }

      log(`Создаю частичный платёж: ${shipmentNum}`, { orderId })
      const result = await createPartialPayment(orderId)
      log(`Частичный платёж создан: ${result.name}`, {
        shipmentNum,
        paymentId: result.id,
        paymentSum: result.paymentSum
      })

      const orderFull = await getOrderFullForCreate(orderId)

      updateOrderState(shipmentNum, 'partial_payment_created', result.name, {
        orderName: orderFull.name,
        orderId: orderFull.id,
        paymentSum: result.paymentSum,
        orderUrl: `https://online.moysklad.ru/app/#customerorder/${orderFull.id}`
      }, STATE_FILE, log)

      res.json({ success: true, paymentName: result.name, paymentSum: result.paymentSum })
    } catch (e) {
      log(`Ошибка создания частичного платежа: ${e.message}`, { shipmentNum, stack: e.stack })
      updateOrderState(shipmentNum, 'partial_payment_error', e.message, {}, STATE_FILE, log)
      res.json({ error: e.message })
    }
  })

  // ─── WB sales refresh ───
  /**
   * POST /api/wb-sales/refresh — Принудительное обновление всех кэшей Wildberries
   * @param {Object} req.body - (пусто)
   * @param {string} req.headers.x-wb-token - Токен API Wildberries
   * @returns {{ success: boolean, message: string }}
   * @throws {{ error: string }} При отсутствии WB токена
   */
  router.post('/wb-sales/refresh', async (req, res) => {
    const wbToken = req.headers['x-wb-token']

    if (!wbToken) {
      return res.json({ error: 'Требуется WB токен (x-wb-token)' })
    }

    log('WB cache: manual refresh requested')

    try {
      await wb.refreshAll(wbToken, log)
      log('WB cache: refresh completed')
      res.json({ success: true, message: 'Кэш WB обновлён' })
    } catch (e) {
      log(`WB cache: refresh error — ${e.message}`, 'error')
      res.json({ error: e.message })
    }
  })

  // ─── WB returns refresh (legacy alias) ───
  /**
   * POST /api/wb-returns/refresh — Алиас для wb-sales/refresh (legacy)
   * @param {string} req.headers.x-wb-token - Токен API Wildberries
   * @returns {{ success: boolean, message: string }}
   */
  router.post('/wb-returns/refresh', async (req, res) => {
    const wbToken = req.headers['x-wb-token']

    if (!wbToken) {
      return res.json({ error: 'Требуется WB токен (x-wb-token)' })
    }

    log('WB cache: manual refresh requested (returns alias)')

    try {
      await wb.refreshAll(wbToken, log)
      log('WB cache: refresh completed')
      res.json({ success: true, message: 'Кэш WB обновлён' })
    } catch (e) {
      log(`WB cache: refresh error — ${e.message}`, 'error')
      res.json({ error: e.message })
    }
  })

  // ─── Create demand ───
  /**
   * POST /api/create-demand — Создание отгрузки (demand) в МойСклад
   * @param {Object} req.body - Тело запроса
   * @param {string} req.body.shipmentNum - Номер отправления
   * @param {string} [req.body.orderId] - ID заказа (если известен)
   * @param {string} req.headers.x-api-token - Токен API МойСклад
   * @returns {{ success: boolean, demandName: string }}
   * @throws {{ error: string }}
   */
  router.post('/create-demand', async (req, res) => {
    const { shipmentNum, orderId: directOrderId } = req.body
    const token = req.headers['x-api-token']

    if (!token || !shipmentNum) {
      return res.json({ error: 'Требуется токен и номер отправления' })
    }

    initApi(token)
    log(`Создание отгрузки: ${shipmentNum}${directOrderId ? ` (orderId: ${directOrderId})` : ''}`, { token: token.slice(0, 8) + '...' })

    try {
      let orderId = directOrderId

      if (!orderId) {
        log(`Поиск заказа: ${shipmentNum}`)
        const order = await findOrderByShipmentNum(shipmentNum, log)
        if (!order) {
          log(`Заказ не найден: ${shipmentNum}`)
          updateOrderState(shipmentNum, 'demand_check', 'order_not_found', {}, STATE_FILE, log)
          return res.json({ error: 'Заказ не найден' })
        }
        orderId = order.id
      }

      log(`Создаю отгрузку: ${shipmentNum}`, { orderId })
      const demand = await createDemand(orderId)
      log(`Отгрузка создана: ${demand.name}`, { shipmentNum, demandId: demand.id })

      const orderFull = await getOrderFullForCreate(orderId)

      updateOrderState(shipmentNum, 'demand_created', demand.name, {
        orderName: orderFull.name,
        orderId: orderFull.id,
        orderUrl: `https://online.moysklad.ru/app/#customerorder/${orderFull.id}`
      }, STATE_FILE, log)

      res.json({ success: true, demandName: demand.name })
    } catch (e) {
      log(`Ошибка создания отгрузки: ${e.message}`, { shipmentNum, stack: e.stack })
      updateOrderState(shipmentNum, 'demand_error', e.message, {}, STATE_FILE, log)
      res.json({ error: e.message })
    }
  })

  // ─── Create return ───
  /**
   * POST /api/create-return — Создание возврата (salesReturn) в МойСклад
   * @param {Object} req.body - Тело запроса
   * @param {string} req.body.shipmentNum - Номер отправления
   * @param {string} [req.body.orderId] - ID заказа (если известен)
   * @param {string} req.headers.x-api-token - Токен API МойСклад
   * @returns {{ success: boolean, returnName: string, returnSum: number }}
   * @throws {{ error: string }}
   */
  router.post('/create-return', async (req, res) => {
    const { shipmentNum, orderId: directOrderId, selectedItems } = req.body
    const token = req.headers['x-api-token']

    if (!token || !shipmentNum) {
      return res.json({ error: 'Требуется токен и номер отправления' })
    }

    initApi(token)
    log(`Создание возврата: ${shipmentNum}${directOrderId ? ` (orderId: ${directOrderId})` : ''}${selectedItems?.length ? ` (выбрано ${selectedItems.length} товаров)` : ''}`, { token: token.slice(0, 8) + '...' })

    try {
      let orderId = directOrderId

      if (!orderId) {
        log(`Поиск заказа для возврата: ${shipmentNum}`)
        const order = await findOrderByShipmentNum(shipmentNum, log)
        if (!order) {
          log(`Заказ не найден для возврата: ${shipmentNum}`)
          updateOrderState(shipmentNum, 'return_check', 'order_not_found', {}, STATE_FILE, log)
          return res.json({ error: 'Заказ не найден' })
        }
        orderId = order.id
      }

      log(`Создаю возврат: ${shipmentNum}`, { orderId })
      const salesReturn = await createReturn(orderId, null, null, selectedItems)
      log(`Возврат создан: ${salesReturn.name}`, { shipmentNum, returnId: salesReturn.id })

      const orderFull = await getOrderFullForCreate(orderId)

      updateOrderState(shipmentNum, 'return_created', salesReturn.name, {
        orderName: orderFull.name,
        orderId: orderFull.id,
        orderUrl: `https://online.moysklad.ru/app/#customerorder/${orderFull.id}`,
        returnSum: salesReturn.sum / 100
      }, STATE_FILE, log)

      res.json({ success: true, returnName: salesReturn.name, returnSum: salesReturn.sum / 100 })
    } catch (e) {
      log(`Ошибка создания возврата: ${e.message}`, { shipmentNum, stack: e.stack })
      updateOrderState(shipmentNum, 'return_error', e.message, {}, STATE_FILE, log)
      res.json({ error: e.message })
    }
  })

  // ─── Cancel order ───
  /**
   * POST /api/cancel-order — Отмена заказа в МойСклад (сброс резерва)
   * @param {Object} req.body - Тело запроса
   * @param {string} req.body.shipmentNum - Номер отправления
   * @param {string} [req.body.orderId] - ID заказа (если известен)
   * @param {string} req.headers.x-api-token - Токен API МойСклад
   * @returns {{ success: boolean, ... }}
   * @throws {{ error: string }}
   */
  router.post('/cancel-order', async (req, res) => {
    const { shipmentNum, orderId: directOrderId } = req.body
    const token = req.headers['x-api-token']

    if (!token || !shipmentNum) {
      return res.json({ error: 'Требуется токен и номер отправления' })
    }

    initApi(token)
    log(`Отмена заказа: ${shipmentNum}${directOrderId ? ` (orderId: ${directOrderId})` : ''}`, { token: token.slice(0, 8) + '...' })

    try {
      let orderId = directOrderId

      if (!orderId) {
        log(`Поиск заказа для отмены: ${shipmentNum}`)
        const order = await findOrderByShipmentNum(shipmentNum, log)
        if (!order) {
          log(`Заказ не найден для отмены: ${shipmentNum}`)
          updateOrderState(shipmentNum, 'cancel_check', 'order_not_found', {}, STATE_FILE, log)
          return res.json({ error: 'Заказ не найден' })
        }
        orderId = order.id
      }

      log(`Отменяю заказ: ${shipmentNum}`, { orderId })
      const result = await cancelOrder(orderId)
      log(`Заказ отменён: ${shipmentNum}`, { result })

      const orderFull = await getOrderFullForCreate(orderId)

      updateOrderState(shipmentNum, 'order_cancelled', 'success', {
        orderName: orderFull.name,
        orderId: orderFull.id,
        orderUrl: `https://online.moysklad.ru/app/#customerorder/${orderFull.id}`,
        sum: orderFull.sum / 100
      }, STATE_FILE, log)

      res.json({ success: true, ...result })
    } catch (e) {
      log(`Ошибка: ${e.message}`)
      updateOrderState(shipmentNum, 'cancel_error', e.message, {}, STATE_FILE, log)
      res.json({ error: e.message })
    }
  })

  // ─── Print sticker ───
  /**
   * POST /api/print-sticker — Генерация и получение PDF-стикера для товара по коду
   * @param {Object} req.body - Тело запроса
   * @param {string} req.body.code - Код товара (OEM/артикул)
   * @param {string} req.headers.x-api-token - Токен API МойСклад
   * @returns {{ success: boolean, pdfUrl?: string }} PDF-файл или URL
   * @throws {{ error: string }} При отсутствии токена, кода или ошибке генерации
   */
  router.post('/print-sticker', async (req, res) => {
    const { code } = req.body
    const token = req.headers['x-api-token']

    if (!token || !code) {
      return res.json({ error: 'Требуется токен и код товара' })
    }

    initApi(token)
    log(`Печать стикера: ${code}`, { token: token.slice(0, 8) + '...' })

    try {
      log(`Поиск товара по коду: ${code}`)
      const product = await findProductByCode(code)

      if (!product || !product.id) {
        log(`Товар не найден: ${code}`)
        return res.json({ error: 'Товар не найден' })
      }

      log(`Товар найден: ${product.name}, ID: ${product.id}, type: ${product.meta?.type || 'product'}`)

      log(`Генерация PDF стикера для товара: ${product.id}`)
      const entityType = product.meta?.type || 'product'
      const result = await exportStickerPdf(product.id, token, entityType)

      if (!result) {
        throw new Error('Не удалось получить PDF')
      }

      if (result.startsWith('http')) {
        log(`PDF URL: ${result}`)
        res.json({ success: true, pdfUrl: result })
      } else {
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

  // ─── Restart server ───
  /**
   * POST /api/restart — Перезапуск сервера через gracefulShutdown с флагом shouldRestart
   * @returns {{ success: boolean, message: string }}
   */
  router.post('/restart', (req, res) => {
    log('Запрошен перезапуск сервера')
    res.json({ success: true, message: 'Перезапуск сервера...' })

    setTimeout(() => {
      gracefulShutdown('RESTART', true)
    }, 1000)
  })

  // ─── Status ───
  /**
   * GET /api/status — Получение статуса сервера (запущен, PID, uptime)
   * @returns {{ running: boolean, pid: number, uptime: number }}
   */
  router.get('/status', (req, res) => {
    res.json({
      running: !isShuttingDown(),
      pid: process.pid,
      uptime: process.uptime()
    })
  })

  // ─── Start server ───
  /**
   * POST /api/start — Запуск нового экземпляра сервера в отдельном окне/процессе
   * @returns {{ success: boolean, message: string }}
   */
  router.post('/start', (req, res) => {
    const isWindows = process.platform === 'win32'

    if (isWindows) {
      spawn('cmd.exe', ['/c', 'start "" "' + startBatPath + '"'], {
        cwd: path.dirname(startBatPath),
        detached: true,
        stdio: 'ignore',
        shell: true
      }).unref()
      res.json({ success: true, message: 'Сервер запущен в новом окне' })
    } else {
      spawn('open', ['-a', 'Terminal', startBatPath], {
        cwd: path.dirname(startBatPath),
        detached: true
      }).unref()
      res.json({ success: true, message: 'Сервер запущен' })
    }
  })

  // ─── Get logs ───
  /**
   * GET /api/logs — Получение последних 100 строк лога за текущий день
   * @returns {{ logs: string, file: string }} Содержимое лога и путь к файлу
   */
  router.get('/logs', (req, res) => {
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

  // ─── Sync products ───
  /**
   * POST /api/sync-products — Синхронизация товаров: поиск на WB и Ozon по кодам, агрегация
   * @param {Object} req.body - Тело запроса
   * @param {string[]} [req.body.wbCodes] - Коды для поиска на Wildberries
   * @param {string[]} [req.body.ozonCodes] - Коды для поиска на Ozon
   * @returns {{ success: boolean, merged: Object }}
   */
  router.post('/sync-products', async (req, res) => {
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

  // ─── Get orders state ───
  /**
   * GET /api/orders-state — Получение сохранённого состояния заказов из JSON-файла
   * @returns {Object} Объект с состоянием заказов (ключ — номер отправления)
   */
  router.get('/orders-state', (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    const state = loadOrdersState(STATE_FILE, log)
    res.json(state)
  })

  // ─── Save orders state ───
  /**
   * POST /api/orders-state — Сохранение состояния заказов (результат сканирования) или
   * обновление статуса одного заказа
   * @param {Object} req.body - Тело запроса
   * @param {Object[]} [req.body.orders] - Массив заказов для полного сохранения
   * @param {string} [req.body.shipmentNum] - Номер отправления (для одного заказа)
   * @param {string} [req.body.action] - Действие для одного заказа
   * @param {string} [req.body.result] - Результат действия
   * @returns {{ success: boolean, count?: number, state?: Object }}
   */
  router.post('/orders-state', (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    log('API: save scan, body keys: ' + (req.body?.orders?.length || 0))
    const { orders } = req.body
    if (orders && Array.isArray(orders)) {
      const state = {}
      for (const order of orders) {
        state[order.shipmentNum] = {
          ...order,
          savedAt: new Date().toISOString(),
          orderPositions: order.orderPositions || [],
          demandPositions: order.demandPositions || []
        }
      }
      saveOrdersState(state, STATE_FILE, log)
      log(`Сохранено последнее сканирование: ${orders.length} заказов`)
      return res.json({ success: true, count: orders.length })
    }

    const { shipmentNum, action, result } = req.body
    if (!shipmentNum || !action) {
      return res.json({ error: 'Требуется shipmentNum и action' })
    }
    const orderState = updateOrderState(shipmentNum, action, result, {}, STATE_FILE, log)
    res.json({ success: true, state: orderState })
  })

  // ─── Delete orders state ───
  /**
   * DELETE /api/orders-state — Очистка всего сохранённого состояния заказов
   * @returns {{ success: boolean }}
   */
  router.delete('/orders-state', (req, res) => {
    saveOrdersState({}, STATE_FILE, log)
    res.json({ success: true })
  })

  // ─── Supplies scan ───
  /**
   * POST /api/supplies/scan — Сканирование новых поставок (REST-версия)
   *
   * @header {string} x-api-token - Токен API МойСклад
   * @header {string} x-wb-token - Токен API Wildberries
   * @header {string} x-ozon-client-id - Client-ID Ozon
   * @header {string} x-ozon-api-key - API-Key Ozon
   * @returns {{ orders: Array, stats: Object }}
   * @throws {{ error: string }}
   */
  router.post('/supplies/scan', async (req, res) => {
    const msToken = req.headers['x-api-token']
    const wbToken = req.headers['x-wb-token']
    const ozonClientId = req.headers['x-ozon-client-id']
    const ozonApiKey = req.headers['x-ozon-api-key']

    if (!msToken) return res.json({ error: 'Требуется токен МС' })
    if (!wbToken) return res.json({ error: 'Требуется WB токен' })
    if (!ozonClientId || !ozonApiKey) return res.json({ error: 'Требуются Ozon credentials' })

    try {
      const result = await supplies.scanNewOrders(msToken, wbToken, ozonClientId, ozonApiKey, log)
      res.json(result)
    } catch (e) {
      res.json({ error: e.message })
    }
  })

  /**
   * GET /api/supplies/stores — возвращает список складов (для настройки сканирования).
   * @param {string} req.query.token - Токен API МойСклад
   * @returns {Array<{id: string, name: string}>}
   */
  router.get('/supplies/stores', async (req, res) => {
    try {
      const token = req.query.token
      if (!token) return res.json({ stores: [] })
      process.env.MOYSKLAD_TOKEN = token
      initApi(token)
      const API = getApi()
      const storesRes = await API.GET('entity/store?limit=100').catch(() => ({ rows: [] }))
      const stores = (storesRes.rows || []).map(function(s) {
        return { id: s.id, name: s.name || '—' }
      })
      res.json({ stores })
    } catch (e) {
      log('Supplies stores error: ' + e.message)
      res.json({ stores: [] })
    }
  })

  return router
}
