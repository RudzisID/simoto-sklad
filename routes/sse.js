'use strict'

const express = require('express')

const { setupSSE, checkAbort, sendSSE, endSSE, makeOnProgress } = require('../lib/sse-helper')
const { processBatch } = require('../lib/batch')
const { checkOrder, parsePositions } = require('../lib/check')
const {
  findOrderByShipmentNum,
  getOrderFull,
  getOrderFullForCreate,
  getDemand
} = require('../lib/order')

/**
 * SSE роутер
 * @param {Object} deps - Зависимости
 * @param {Set} deps.sseConnections - Активные SSE соединения
 * @param {import('../lib/TtlMap').TtlMap} deps.abortSignals - Хранилище сигналов отмены
 * @param {Function} deps.log - Функция логирования
 * @param {Function} deps.initApi - Функция инициализации API
 * @param {string} deps.moduleRoot - Корневая директория модуля
 * @param {Object} deps.wb - WB модуль
 * @param {Object} deps.ozon - Ozon модуль
 * @returns {import('express').Router}
 */
module.exports = function(deps) {
  const router = express.Router()
  const { sseConnections, abortSignals, log, initApi, moduleRoot, wb, ozon } = deps

  // ─── SSE: process check ───
  /**
   * GET /sse/process/stream — SSE-поток для проверки (check) заказов в реальном времени
   * 
   * @query {string} token - Токен API МойСклад
   * @query {string} numbers - Номера отправлений через запятую
   * @query {string} [abortId] - ID для возможности отмены
   * 
   * События SSE: progress (промежуточные результаты), done (завершено), error (ошибка), aborted (отменено)
   */
  router.get('/process/stream', (req, res) => {
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

    setupSSE(res, sseConnections)

    log(`=== SSE: start check ${numbers.length} orders ===`)

    process.env.MOYSKLAD_TOKEN = token
    initApi(token)

    const onProgress = makeOnProgress(res)

    processBatch(numbers, 'check', log, onProgress, { onAbort: () => checkAbort(abortId, abortSignals) })
      .then((result) => {
        if (result.aborted) {
          endSSE(res, 'aborted', { processed: result.processed })
          log(`=== SSE: aborted after ${result.processed} orders ===`)
        } else {
          endSSE(res, 'done', { orders: result.orders })
          log(`=== SSE: completed ${numbers.length} orders ===`)
        }
      })
      .catch((e) => {
        log(`SSE error: ${e.message}`)
        endSSE(res, 'error', { error: e.message })
      })

    req.on('close', () => {
      log('SSE: client disconnected, setting abort flag')
      if (abortId) {
        abortSignals.set(abortId, true)
      }
    })
  })

  // ─── SSE: WB return search ───
  /**
   * GET /sse/wb-return/stream — SSE-поток для поиска возвратов Wildberries по стикерам
   * 
   * @header {string} x-wb-token - Токен API Wildberries
   * @query {string} token - Токен API МойСклад
   * @query {string} numbers - Номера стикеров через запятую
   * @query {string} [abortId] - ID для отмены
   * 
   * События: progress, search-ms, result, done, error, aborted
   */
  router.get('/wb-return/stream', async (req, res) => {
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

    setupSSE(res, sseConnections)

    log(`=== WB-Return SSE: start ${numbers.length} orders ===`)

    process.env.MOYSKLAD_TOKEN = msToken
    initApi(msToken)

    if (checkAbort(abortId, abortSignals)) {
      endSSE(res, 'aborted', { processed: 0 })
      log('=== WB-Return SSE: aborted before start ===')
      return
    }

    /**
     * Колбэк ожидания при лимите WB API — отправляет SSE-событие о задержке
     * @param {number} sec - Количество секунд ожидания
     * @param {number} attempt - Номер попытки
     */
    const onWait = (sec, attempt) => {
      sendSSE(res, {
        type: 'progress', index: 0, total: numbers.length,
        order: { shipmentNum: '⏳', orderName: `Лимит WB, попытка ${attempt}/3, ждём ${sec}с...`, sum: 0, statusName: 'Ожидание', status: 'pending' }
      })
    }

    try {
      await wb.refreshIfStale(wbToken, log)
      log('WB-Return: cache refresh completed')
    } catch (e) {
      log(`WB-Return: cache refresh error: ${e.message}`)
    }

    req.on('close', () => {
      log('WB-Return SSE: client disconnected')
      if (abortId) abortSignals.set(abortId, true)
    })

    let processed = 0
    let orders = []

    for (let index = 0; index < numbers.length; index++) {
      if (checkAbort(abortId, abortSignals)) {
        endSSE(res, 'aborted', { processed })
        log(`=== WB-Return SSE: aborted after ${processed} orders ===`)
        return
      }

      const sticker = numbers[index]
      log(`WB-Return: processing sticker ${sticker} (${index + 1}/${numbers.length})`)

      try {
        const cached = wb.findInCache(sticker)
        let record = null
        if (cached) {
          log(`WB-Return: found in WB cache: ${sticker} (source=${cached._source})`)
          record = cached
        }

        if (!record) {
          sendSSE(res, {
            type: 'result', code: sticker,
            order: {
              shipmentNum: sticker,
              orderName: '-',
              sum: 0,
              statusName: 'Не найден в WB (ни возврат, ни продажа)',
              status: 'error',
              hasReturn: false,
              hasDemand: false,
              hasPayment: false,
              isCancelled: false,
              orderPositions: [],
              returnSum: 0,
              returnType: '',
              reason: '',
              orderMoment: '',
              msFound: false,
              wbReturnInfo: '',
              srid: '',
              wbTotalPrice: 0,
              wbForPay: 0,
              lastChangeDate: ''
            },
            notFound: true,
            processed: processed + 1,
            total: numbers.length
          })
          processed++
          continue
        }

        let orderId = record.orderId

        sendSSE(res, {
          type: 'search-ms', code: sticker, msg: `Поиск в МС: ${orderId}...`
        })

        let orderResult
        try {
          orderResult = await checkOrder(orderId)
        } catch (e) {
          log(`WB-Return: checkOrder error for ${orderId}: ${e.message}`)
          orderResult = null
        }

        let statusDerived = ''
        if (orderResult) {
          if (orderResult.isCancelled) statusDerived = 'cancelled'
          else if (orderResult.hasReturn) statusDerived = 'return'
          else if ((orderResult.statusName || '').includes('отсрочк')) statusDerived = 'delayed'
          else if ((orderResult.statusName || '').includes('Отгруж') || (orderResult.statusName || '').includes('Оплач')) statusDerived = 'shipped'
        }

        const wbDate = record.completedDt || record.orderDt || record.salesDate || record.lastChangeDate || ''
        const orderDataForResult = {
          shipmentNum: orderId || sticker,
          orderName: orderResult?.orderName || (record.nmId ? String(record.nmId) : `Заказ ${orderId || sticker}`),
          sum: orderResult?.sum || record.totalPrice || 0,
          statusName: orderResult?.statusName || (record.returnType ? 'Не найден в МС' : 'Только WB (продажа)'),
          status: statusDerived || orderResult?.status || (record.returnType ? 'return' : 'shipped'),
          hasReturn: orderResult?.hasReturn || false,
          hasDemand: orderResult?.hasDemand || false,
          hasPayment: orderResult?.hasPayment || false,
          isCancelled: orderResult?.isCancelled || false,
          demandName: orderResult?.demandName || null,
          paid: orderResult?.paid || 0,
          returnSum: orderResult?.returnSum || record.totalPrice || 0,
          returnType: record.returnType || '',
          reason: record.reason || '',
          orderMoment: orderResult?.orderMoment || wbDate,
          msFound: !!orderResult,
          foundBy: orderResult?.foundBy || null,
          extractedShipmentNum: orderResult?.extractedShipmentNum || null,
          orderPositions: orderResult?.orderPositions || [],
          wbReturnInfo: record.returnType ? `↳ Возврат: ${record.reason || record.returnType} (WB)` : '',
          srid: record.srid || '',
          wbTotalPrice: record.totalPrice || 0,
          wbForPay: record.forPay || 0,
          lastChangeDate: record.lastChangeDate || '',
          wbArticle: record.nmId || '',
          wbBarcode: record.barcode || '',
          wbShkId: record.shkId || '',
          wbStickerId: record.stickerId || '',
          wbCompletedDt: record.completedDt || '',
          wbOrderDt: record.orderDt || '',
          wbSubjectName: record.subjectName || '',
          wbStatus: record.status || ''
        }

        orders.push(orderDataForResult)
        sendSSE(res, {
          type: 'result',
          code: sticker,
          order: orderDataForResult,
          notFound: !orderResult,
          processed: processed + 1,
          total: numbers.length
        })
      } catch (e) {
        log(`WB-Return: error processing ${sticker}: ${e.message}`)
        sendSSE(res, {
          type: 'result', code: sticker,
          order: {
            shipmentNum: sticker,
            orderName: '-',
            sum: 0,
            statusName: `Ошибка: ${e.message}`,
            status: 'error',
            hasReturn: false,
            hasDemand: false,
            hasPayment: false,
            isCancelled: false,
            orderPositions: [],
            returnSum: 0,
            returnType: '',
            reason: '',
            orderMoment: '',
            msFound: false,
            wbReturnInfo: '',
            srid: '',
            wbTotalPrice: 0,
            wbForPay: 0,
            lastChangeDate: ''
          },
          notFound: true,
          processed: processed + 1,
          total: numbers.length
        })
      }

      processed++
    }

    endSSE(res, 'done', { orders })
    log(`=== WB-Return SSE: completed ${numbers.length} orders ===`)
  })

  // ─── SSE: Unified search ───
  /**
   * GET /sse/unified-search/stream — Универсальный SSE-поиск заказов по МС + WB + Ozon
   * 
   * @header {string} [x-api-token] - Токен API МойСклад
   * @header {string} [x-wb-token] - Токен API Wildberries
   * @header {string} [x-ozon-client-id] - Client-ID Ozon
   * @header {string} [x-ozon-api-key] - API-Key Ozon
   * @query {string} numbers - Коды для поиска через запятую
   * @query {string} [abortId] - ID для отмены
   * 
   * События: progress, done, error, aborted
   */
  router.get('/unified-search/stream', async (req, res) => {
    const msToken = req.headers['x-api-token']
    const wbToken = req.headers['x-wb-token']
    const ozonClientId = req.headers['x-ozon-client-id']
    const ozonApiKey = req.headers['x-ozon-api-key']
    const numbersParam = req.query.numbers
    const abortId = req.query.abortId

    /**
     * Локальный логгер для unified-search с префиксом [Unified-Search]
     * @param {string} msg - Сообщение для вывода в консоль
     */
    const ulog = (msg) => console.log(`[Unified-Search] ${msg}`)

    if (!msToken && !wbToken && (!ozonClientId || !ozonApiKey)) {
      return res.status(401).json({ error: 'Требуется хотя бы один токен: МС (x-api-token), WB (x-wb-token) или Ozon (x-ozon-client-id + x-ozon-api-key)' })
    }
    if (!numbersParam) {
      return res.status(400).json({ error: 'Требуется параметр numbers (через запятую)' })
    }

    const numbers = numbersParam.split(',').map(n => n.trim()).filter(Boolean)
    if (numbers.length === 0) {
      return res.status(400).json({ error: 'Пустой массив numbers' })
    }

    setupSSE(res, sseConnections)

    ulog(`=== Unified-Search SSE: start (${numbers.length} numbers) ===`)

    if (msToken) {
      process.env.MOYSKLAD_TOKEN = msToken
      initApi(msToken)
    }

    if (checkAbort(abortId, abortSignals)) {
      endSSE(res, 'aborted', { processed: 0 })
      ulog('=== Unified-Search SSE: aborted before start ===')
      return
    }

    req.on('close', () => {
      ulog('Unified-Search SSE: client disconnected')
      if (abortId) abortSignals.set(abortId, true)
    })

    /**
     * Выводит статус заказа по данным result из checkOrder
     * @param {Object|null} orderResult - Результат проверки заказа
     * @returns {string} 'cancelled' | 'return' | 'delayed' | 'shipped' | ''
     */
    function deriveStatus(orderResult) {
      if (!orderResult) return ''
      if (orderResult.isCancelled) return 'cancelled'
      if (orderResult.hasReturn) return 'return'
      if ((orderResult.statusName || '').includes('отсрочк')) return 'delayed'
      if ((orderResult.statusName || '').includes('Отгруж') || (orderResult.statusName || '').includes('Оплач')) return 'shipped'
      return ''
    }

    /**
     * Формирует унифицированный объект заказа из данных МС и маркетплейса
     * @param {Object} params - Параметры сборки
     * @param {Object|null} params.orderResult - Результат checkOrder из МС
     * @param {string|null} params.marketplace - Тип маркетплейса ('wb' | 'ozon' | null)
     * @param {Object|null} params.marketplaceData - Данные из кэша WB/Ozon
     * @param {string} params.code - Исходный код поиска
     * @returns {Object} Унифицированный объект заказа
     */
    function buildOrderData({ orderResult, marketplace, marketplaceData, code }) {
      const orderData = {
        shipmentNum: code,
        orderId: orderResult?.orderId || null,
        orderName: orderResult?.orderName || code,
        sum: orderResult?.sum || 0,
        statusName: orderResult?.statusName || '',
        status: deriveStatus(orderResult),
        hasReturn: orderResult?.hasReturn || false,
        hasDemand: orderResult?.hasDemand || false,
        hasPayment: orderResult?.hasPayment || false,
        isCancelled: orderResult?.isCancelled || false,
        demandName: orderResult?.demandName || null,
        paid: orderResult?.paid || 0,
        returnSum: orderResult?.returnSum || 0,
        msReturnSum: orderResult?.returnSum || 0,
        marketplaceReturnPrice: 0,
        returnType: marketplaceData?.returnType || marketplaceData?.type || '',
        reason: marketplaceData?.reason || marketplaceData?.return_reason_name || '',
        orderMoment: orderResult?.orderMoment || '',
        msFound: !!orderResult,
        foundBy: orderResult?.foundBy || null,
        extractedShipmentNum: orderResult?.extractedShipmentNum || null,
        orderPositions: orderResult?.orderPositions || [],
        ozonReturnInfo: '',
        barcode: '',
        offerId: '',
        wbReturnInfo: '',
        srid: '',
        wbTotalPrice: 0,
        wbForPay: 0,
        lastChangeDate: '',
        wbArticle: '',
        wbBarcode: '',
        wbShkId: '',
        wbStickerId: '',
        wbCompletedDt: '',
        wbOrderDt: '',
        wbSubjectName: '',
        wbStatus: ''
      }

      if (marketplace === 'ozon' && marketplaceData) {
        orderData.ozonReturnInfo = `↳ Возврат: ${marketplaceData.return_reason_name || ''} (Ozon)`
        orderData.barcode = marketplaceData.barcode || ''
        orderData.offerId = marketplaceData.offer_id || ''
        orderData.marketplaceReturnPrice = marketplaceData.product_price || 0
      }

      if (marketplace === 'wb' && marketplaceData) {
        orderData.wbReturnInfo = marketplaceData.returnType ? `↳ Возврат: ${marketplaceData.reason || marketplaceData.returnType} (WB)` : ''
        orderData.srid = marketplaceData.srid || ''
        orderData.wbTotalPrice = marketplaceData.totalPrice || 0
        orderData.wbForPay = marketplaceData.forPay || 0
        orderData.marketplaceReturnPrice = marketplaceData.totalPrice || 0
        orderData.lastChangeDate = marketplaceData.lastChangeDate || ''
        orderData.wbArticle = marketplaceData.nmId || ''
        orderData.wbBarcode = marketplaceData.barcode || ''
        orderData.wbShkId = marketplaceData.shkId || ''
        orderData.wbStickerId = marketplaceData.stickerId || ''
        orderData.wbCompletedDt = marketplaceData.completedDt || ''
        orderData.wbOrderDt = marketplaceData.orderDt || ''
        orderData.wbSubjectName = marketplaceData.subjectName || ''
        orderData.wbStatus = marketplaceData.status || ''
      }

      if (marketplaceData?.return_reason_name) {
        orderData.reason = marketplaceData.return_reason_name
        orderData.returnType = marketplaceData.type || ''
      }

      return orderData
    }

    let processed = 0, errors = 0
    const total = numbers.length

    try {
      for (let i = 0; i < numbers.length; i++) {
        const code = numbers[i]

        if (checkAbort(abortId, abortSignals)) {
          endSSE(res, 'aborted', { processed })
          ulog(`=== Unified-Search SSE: aborted after ${processed} orders ===`)
          return
        }

        ulog(`Processing number ${code} (${i + 1}/${total})`)

        let orderResult = null
        let marketplace = null
        let marketplaceData = null
        try {
          if (msToken) {
            orderResult = await checkOrder(code, ulog)
            if (orderResult && orderResult.orderId) {
              marketplace = orderResult.marketplace || null

              if (!marketplace && orderResult.extractedShipmentNum) {
                if (/^\d{7,12}$/.test(orderResult.extractedShipmentNum)) {
                  marketplace = 'wb'
                } else if (/^\d+-\d+-\d+$/.test(orderResult.extractedShipmentNum)) {
                  marketplace = 'ozon'
                }
              }
              if (marketplace === 'wb') {
                marketplaceData = wb.findInCache(code)
              } else if (marketplace === 'ozon') {
                marketplaceData = ozon.findInCache(code)
              }
            }
          }

          if (orderResult && orderResult.orderId && !marketplaceData) {
            if (marketplace === 'wb') {
              marketplaceData = wb.findInCache(code)
              if (!marketplaceData && orderResult.extractedShipmentNum && orderResult.extractedShipmentNum !== code) {
                marketplaceData = wb.findInCache(orderResult.extractedShipmentNum)
              }
            } else if (marketplace === 'ozon') {
              marketplaceData = ozon.findInCache(code)
              if (!marketplaceData && orderResult.extractedShipmentNum && orderResult.extractedShipmentNum !== code) {
                marketplaceData = ozon.findInCache(orderResult.extractedShipmentNum)
              }
            } else {
              marketplaceData = wb.findInCache(code) || ozon.findInCache(code)
              if (marketplaceData) marketplace = marketplaceData._source?.includes('ozon') ? 'ozon' : 'wb'
            }
          }

          if (!orderResult || !orderResult.foundBy) {
            const ozonData = ozon.findInCache(code)
            if (ozonData) {
              marketplace = 'ozon'
              marketplaceData = ozonData
              if (ozonData.posting_number && msToken) {
                orderResult = await checkOrder(ozonData.posting_number, ulog)
              }
            }

            if (!marketplace) {
              const wbData = wb.findInCache(code)
              if (wbData) {
                marketplace = 'wb'
                marketplaceData = wbData
                const orderId = wbData.orderId
                if (orderId && msToken) {
                  orderResult = await checkOrder(orderId, ulog)
                }
              }
            }
          }

          const orderData = buildOrderData({ orderResult, marketplace, marketplaceData, code })

          sendSSE(res, {
            type: 'progress',
            order: orderData,
            index: processed + 1,
            total
          })
        } catch (e) {
          ulog(`Error processing ${code}: ${e.stack}`)
          let orderData
          if (orderResult) {
            orderData = buildOrderData({ orderResult, marketplace, marketplaceData: null, code })
            if (!orderData.statusName) orderData.statusName = 'Новый'
          } else {
            orderData = {
              shipmentNum: code, orderId: null, orderName: '-', sum: 0,
              statusName: `Ошибка: ${e.message}`, status: 'error',
              hasReturn: false, hasDemand: false, hasPayment: false, isCancelled: false,
              demandName: null, paid: 0, returnSum: 0, returnType: '', reason: '',
              orderMoment: '', msFound: false, foundBy: null, extractedShipmentNum: null,
              orderPositions: [],
              ozonReturnInfo: '', barcode: '', offerId: '',
              wbReturnInfo: '', srid: '', wbTotalPrice: 0, wbForPay: 0, lastChangeDate: '',
              wbArticle: '', wbBarcode: '', wbShkId: '', wbStickerId: '',
              wbCompletedDt: '', wbOrderDt: '', wbSubjectName: '', wbStatus: ''
            }
          }
          sendSSE(res, {
            type: 'progress',
            order: orderData,
            index: processed + 1,
            total
          })
          errors++
        }

        processed++
      }

      sendSSE(res, { type: 'done', processed, orders: [], errors })

      Promise.allSettled([
        wbToken ? wb.refreshIfStale(wbToken, ulog) : Promise.resolve(),
        ozonClientId && ozonApiKey ? ozon.refreshIfStale(ozonClientId, ozonApiKey, ulog) : Promise.resolve()
      ]).then(() => {
        ulog('Cache refresh completed (fire-and-forget)')
      }).catch(e => {
        ulog(`Cache refresh error: ${e.message}`)
      })

      ulog(`=== Unified-Search SSE: completed ${total} numbers ===`)
    } catch (e) {
      ulog(`Unified-Search fatal error: ${e.message}`)
      sendSSE(res, { type: 'error', error: e.message })
    } finally {
      res.end()
    }
  })

  // ─── SSE: Batch operations ───
  /**
   * POST /sse/batch/stream — SSE-поток для пакетного выполнения действий над заказами
   * 
   * @param {Object} req.body - Тело запроса
   * @param {string} req.body.token - Токен API МойСклад (или в x-api-token header)
   * @param {string[]} req.body.numbers - Массив номеров отправлений
   * @param {string} req.body.action - Действие: demand | payment | return | cancel
   * @param {string} [req.body.abortId] - ID для отмены
   * @param {Object} [req.body.checkData] - Дополнительные данные для проверки
   * 
   * События SSE: progress, done, error, aborted
   */
  router.post('/batch/stream', (req, res) => {
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

    setupSSE(res, sseConnections)

    log(`=== SSE: batch ${action} for ${numbers.length} orders ===`)

    process.env.MOYSKLAD_TOKEN = token
    initApi(token)

    let stats = { created: 0, skipped: 0, errors: 0 }

    /**
     * Колбэк прогресса пакетной обработки — обновляет статистику и отправляет SSE
     * @param {Object} result - Результат обработки одного заказа
     * @param {number} index - Индекс текущего заказа
     * @param {number} total - Общее количество заказов
     */
    const onProgress = (result, index, total) => {
      if (result.status === 'created') stats.created++
      else if (result.status === 'skipped') stats.skipped++
      else if (result.status === 'error') stats.errors++

      sendSSE(res, {
        type: 'progress',
        index: index + 1,
        total: total,
        action: action,
        result: result,
        stats: stats
      })
    }

    let responseEnded = false

    processBatch(numbers, action, log, onProgress, { onAbort: () => checkAbort(abortId, abortSignals), checkResults: req.body.checkData || null })
      .then((result) => {
        responseEnded = true
        if (result.aborted) {
          endSSE(res, 'aborted', { processed: result.processed, stats })
          log(`=== SSE: batch ${action} aborted after ${result.processed} orders ===`)
        } else {
          endSSE(res, 'done', { stats, orders: result.orders })
          log(
            `=== SSE: batch ${action} completed - created:${stats.created}, skipped:${stats.skipped}, errors:${stats.errors} ===`
          )
        }
      })
      .catch((e) => {
        responseEnded = true
        log(`SSE batch error: ${e.message}`)
        endSSE(res, 'error', { error: e.message })
      })

    res.on('close', () => {
      if (!responseEnded) {
        log('SSE batch: client disconnected, setting abort flag')
        if (abortId) {
          abortSignals.set(abortId, true)
        }
      }
    })
  })

  // ─── SSE: WB all ───
  /**
   * GET /sse/wb-all/stream — SSE-поток для обновления всех кэшей Wildberries
   * 
   * @header {string} x-wb-token - Токен API Wildberries
   * @query {string} token - Токен API МойСклад
   * 
   * События: progress, done, error
   */
  router.get('/wb-all/stream', async (req, res) => {
    const wbToken = req.headers['x-wb-token']
    const msToken = req.query.token

    if (!wbToken) {
      return res.status(401).json({ error: 'Требуется WB токен' })
    }
    if (!msToken) {
      return res.status(401).json({ error: 'Требуется токен API МС' })
    }

    setupSSE(res, sseConnections)

    /**
     * Локальный логгер для WB-All с префиксом [WB-All]
     * @param {string} msg - Сообщение для вывода в консоль
     */
    const wbLog = (msg) => console.log(`[WB-All] ${msg}`)
    wbLog('=== WB-All SSE: start ===')

    process.env.MOYSKLAD_TOKEN = msToken
    initApi(msToken)

    try {
      sendSSE(res, { type: 'progress', msg: 'Обновление кэшей WB...' })

      await wb.refreshAll(wbToken, wbLog)

      sendSSE(res, { type: 'done', stats: { fromCache: false } })
    } catch (e) {
      wbLog(`[WB-All] error: ${e.message}`, 'error')
      sendSSE(res, { type: 'error', error: e.message })
    } finally {
      res.end()
      wbLog('=== WB-All SSE: completed ===')
    }
  })

  // ─── SSE: Ozon all ───
  /**
   * GET /sse/ozon-all/stream — SSE-поток для обновления всех кэшей Ozon
   * 
   * @header {string} x-ozon-client-id - Client-ID Ozon
   * @header {string} x-ozon-api-key - API-Key Ozon
   * @query {string} token - Токен API МойСклад
   * 
   * События: progress, done, error
   */
  router.get('/ozon-all/stream', async (req, res) => {
    const ozonClientId = req.headers['x-ozon-client-id']
    const ozonApiKey = req.headers['x-ozon-api-key']
    const msToken = req.query.token

    if (!ozonClientId || !ozonApiKey) {
      return res.status(401).json({ error: 'Требуются Client-Id и Api-Key Ozon' })
    }
    if (!msToken) {
      return res.status(401).json({ error: 'Требуется токен API МС' })
    }

    setupSSE(res, sseConnections)

    /**
     * Локальный логгер для Ozon-All с префиксом [Ozon-All]
     * @param {string} msg - Сообщение для вывода в консоль
     */
    const ozonLog = (msg) => console.log(`[Ozon-All] ${msg}`)
    ozonLog('=== Ozon-All SSE: start ===')

    process.env.MOYSKLAD_TOKEN = msToken
    initApi(msToken)

    try {
      sendSSE(res, { type: 'progress', msg: 'Обновление кэшей Ozon...' })

      await ozon.refreshAll(ozonClientId, ozonApiKey, ozonLog)

      sendSSE(res, { type: 'done', stats: { fromCache: false } })
    } catch (e) {
      ozonLog(`[Ozon-All] error: ${e.message}`, 'error')
      sendSSE(res, { type: 'error', error: e.message })
    } finally {
      res.end()
      ozonLog('=== Ozon-All SSE: completed ===')
    }
  })

  // ─── SSE: Ozon return ───
  /**
   * GET /sse/ozon-return/stream — SSE-поток для поиска возвратов Ozon по кодам
   * 
   * @header {string} x-ozon-client-id - Client-ID Ozon
   * @header {string} x-ozon-api-key - API-Key Ozon
   * @query {string} token - Токен API МойСклад
   * @query {string} numbers - Коды возвратов через запятую
   * 
   * События: search-ms, result, error, done
   */
  router.get('/ozon-return/stream', async (req, res) => {
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

    setupSSE(res, sseConnections)

    /**
     * Локальный логгер для Ozon-Return с префиксом [Ozon-Return]
     * @param {string} msg - Сообщение для вывода в консоль
     */
    const ozonLog = (msg) => console.log(`[Ozon-Return] ${msg}`)
    ozonLog(`=== Ozon-Return SSE: start (${returnCodes.length} codes) ===`)

    process.env.MOYSKLAD_TOKEN = msToken
    initApi(msToken)

    try {
      await ozon.refreshIfStale(ozonClientId, ozonApiKey, ozonLog)

      let processed = 0
      const total = returnCodes.length

      for (const code of returnCodes) {
        if (req.destroyed) break
        processed++

        const found = ozon.findInCache(code)
        if (found) {
          ozonLog(`[Ozon-Return] found in cache: ${code} (posting=${found.posting_number || '?'})`)
        }

        if (!found) {
          sendSSE(res, {
            type: 'error', code,
            error: 'Возврат не найден в кэше Ozon',
            processed, total
          })
          continue
        }

        const postingNumber = found.posting_number
        if (!postingNumber) {
          sendSSE(res, {
            type: 'error', code,
            error: 'Возврат не содержит posting_number',
            processed, total
          })
          continue
        }

        sendSSE(res, {
          type: 'search-ms',
          code,
          postingNumber,
          msg: `Поиск в МС: ${postingNumber}...`,
          processed, total
        })

        let order = null
        let fullOrder = null
        try {
          order = await findOrderByShipmentNum(postingNumber, ozonLog)
          if (order) {
            fullOrder = await getOrderFull(order.id)
            if (fullOrder) ozonLog(`[Ozon-Return] fullOrder: demands=${fullOrder.demands?.length || 0}, payments=${fullOrder.payments?.length || 0}, returns=${fullOrder.returns?.length || fullOrder.returns?.rows?.length || 0}, positions=${fullOrder.positions?.rows?.length || 0}`)
          }
        } catch (e) {
          ozonLog(`[Ozon-Return] MS search error for ${postingNumber}: ${e.message}`)
        }

        const hasDemand = fullOrder?.demands?.length > 0
        const hasPayment = fullOrder?.payments?.length > 0
        const hasReturn = fullOrder?.returns?.length > 0 || fullOrder?.returns?.rows?.length > 0
        const demandName = hasDemand ? fullOrder.demands[0].name : null
        let paid = 0
        if (hasPayment && fullOrder.payments) {
          paid = fullOrder.payments.reduce((acc, p) => acc + (p.sum || 0), 0)
          paid = Math.round(paid / 100)
        }
        const stateMeta = fullOrder?.state?.meta
        const isCancelled = !!(stateMeta?.href?.includes('cancel') ||
            stateMeta?.href?.includes('cancelled') ||
            fullOrder?.state?.name?.toLowerCase().includes('отмен'))
        const orderPositions = parsePositions(fullOrder?.positions)

        const msStateName = fullOrder?.state?.name || ''
        let status = ''
        if (msStateName.includes('отсрочк')) status = 'delayed'
        else if (msStateName.includes('Отмен')) status = 'cancelled'
        else if (msStateName.includes('Отгруж') || msStateName.includes('Оплач')) status = 'shipped'

        const ozonReturnInfo = `↳ Возврат: ${found.return_reason_name || ''} (Ozon)`

        const msSum = order?.sum ? Math.round(order.sum / 100) : 0
        const orderDataForResult = {
          id: order?.id || '',
          name: order?.name || '',
          description: order?.description || '',
          shipmentNum: postingNumber,
          orderName: order?.name || found.product_name || found.offer_id || '',
          sum: msSum || found.product_price || 0,
          statusName: msStateName || `Возврат: ${found.return_reason_name || ''}`,
          status,
          hasReturn,
          hasDemand,
          hasPayment,
          isCancelled,
          demandName,
          paid,
          returnSum: found.product_price || 0,
          returnType: found.type || '',
          reason: found.return_reason_name || '',
          barcode: found.barcode || '',
          offerId: found.offer_id || '',
          orderMoment: order?.moment || found.return_date || '',
          msFound: !!order,
          orderPositions,
          ozonReturnInfo
        }

        ozonLog(`[Ozon-Return] SENDING result: code=${code}, posting=${postingNumber}, msFound=${!!order}, orderName=${orderDataForResult.orderName}, sum=${orderDataForResult.sum}, statusName=${orderDataForResult.statusName}`)

        sendSSE(res, {
          type: 'result',
          code,
          postingNumber,
          returnReason: found.return_reason_name || '',
          order: orderDataForResult,
          notFound: !order,
          processed, total
        })
      }

      sendSSE(res, { type: 'done', processed, orders: [], errors })
    } catch (e) {
      ozonLog(`[Ozon-Return] error: ${e.message}`, 'error')
      sendSSE(res, { type: 'error', error: e.message })
    } finally {
      res.end()
      ozonLog('=== Ozon-Return SSE: completed ===')
    }
  })

  return router
}
