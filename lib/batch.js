/// <reference path="./types.js" />
// @ts-check

const BATCH_CONCURRENCY = 3 // Max 3 параллельно (5 - много для API)
const CHUNK_DELAY_MS = 200 // Delay между чанками чтобы не превышать лимиты
const { checkOrder } = require('./check')
const { createDemand } = require('./demand')
const { createPayment } = require('./payment')
const { createReturn } = require('./return')
const { cancelOrder } = require('./cancel')

/**
 * Обработка батча с callback для streaming (SSE)
 * @param {string[]} numbers - массив номеров заказов
 * @param {string} action - действие (check, demand, payment, return, cancel)
 * @param {Function} [log=console.log] - логгер
 * @param {Function} [onProgress] - callback: (result, index, total) => void - вызывается после каждого результата
 * @param {Object} [options] - дополнительные опции
 * @param {Function} [options.onAbort] - callback для проверки отмены
 * @returns {Promise<Object>} - результаты обработки { created, skipped, errors, orders }
 */
async function processBatch(numbers, action, log = console.log, onProgress = null, options = {}) {
  const { onAbort, abortId } = options
  const results = []
  let created = 0
  let skipped = 0
  let errors = 0

  // Функция проверки отмены
  function checkAbort() {
    if (onAbort && onAbort()) {
      log('Batch aborted by user')
      return true
    }
    return false
  }

  // Очищаем abort signal после завершения (если есть abortId)
  function cleanupAbort() {
    if (abortId) {
      // Проверяем, есть ли глобальный объект abortSignals (передается через замыкание из server.js)
      // В server.js abortSignals объявлен глобально
      // Но здесь мы не имеем прямого доступа, так что очистка происходит в server.js
      log(`Batch completed, abortId: ${abortId}`)
    }
  }

  if (action === 'check') {
    // Параллельная проверка пакетами
    let index = 0
    for (let i = 0; i < numbers.length; i += BATCH_CONCURRENCY) {
      if (checkAbort()) {
        log(`Aborted at index ${i}, processed ${index} of ${numbers.length}`)
        return { orders: results, aborted: true, processed: index }
      }

      const chunk = numbers.slice(i, i + BATCH_CONCURRENCY)
      const chunkResults = await Promise.all(chunk.map((num) => checkOrder(num, log)))
      for (let j = 0; j < chunk.length; j++) {
        const result = chunkResults[j]
        results.push(result)
        log(`Проверен: ${chunk[j]} - ${result.statusName}`)

        // Streaming callback - отправляем результат сразу после обработки
        if (onProgress) {
          onProgress(result, index, numbers.length)
        }
        index++
      }
      // Delay между чанками чтобы не превышать лимиты API
      if (i + BATCH_CONCURRENCY < numbers.length) {
        await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS))
      }
    }
    // Очищаем abort signal после завершения
    if (abortId) {
      // Очистка происходит в server.js через замыкание
      log(`Check batch completed, abortId: ${abortId}`)
    }
    return { orders: results }
  }
  
  // Параллельная проверка canAction пакетами
  const canActionResults = []
  for (let i = 0; i < numbers.length; i += BATCH_CONCURRENCY) {
    if (checkAbort()) {
      return { orders: results, aborted: true, processed: i }
    }

    const chunk = numbers.slice(i, i + BATCH_CONCURRENCY)
    const chunkResults = await Promise.all(chunk.map((num) => checkOrder(num, log)))
    canActionResults.push(...chunkResults)
    // Delay между чанками
    if (i + BATCH_CONCURRENCY < numbers.length) {
      await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS))
    }
  }

  for (let i = 0; i < numbers.length; i++) {
    if (checkAbort()) {
      log(`Aborted at index ${i}, processed ${i} of ${numbers.length}`)
      return { orders: results, aborted: true, processed: i }
    }

    const num = numbers[i]
    const checkResult = canActionResults[i]
    let canAction = false

    switch (action) {
    case 'demand':
      canAction = checkResult.canDemand
      break
    case 'payment':
      canAction = checkResult.canPayment
      break
    case 'return':
      canAction = checkResult.canReturn
      break
    case 'cancel':
      canAction = checkResult.canCancel
      break
    }

    if (!canAction) {
      skipped++
      log(`Пропущен: ${num} - ${checkResult.statusName}`)
      results.push({ ...checkResult, status: 'skipped' })
      continue
    }

    const result = await executeAction(checkResult, action, log)
    results.push(result)

    // Streaming callback - отправляем результат сразу после обработки
    if (onProgress) {
      onProgress(result, i, numbers.length)
    }

    if (result.status === 'created') {
      created++
    } else {
      errors++
    }
  }

  return { created, skipped, errors, orders: results }
}

/**
 * Выполняет конкретное действие над заказом
 * Делегирует выполнение функциям штучных операций, передавая только orderId
 * @param {CheckResult} checkResult - Результат проверки заказа
 * @param {string} action - Действие (demand, payment, return, cancel)
 * @param {Function} [log=console.log] - Логгер
 * @returns {Promise<Object>} - Результат выполнения
 */
async function executeAction(checkResult, action, log) {
  try {
    switch (action) {
    case 'demand': {
      const demand = await createDemand(checkResult.orderId)
      return {
        status: 'created',
        shipmentNum: checkResult.shipmentNum,
        demandName: demand.name
      }
    }
    case 'payment': {
      const payment = await createPayment(checkResult.orderId)
      return {
        status: 'created',
        shipmentNum: checkResult.shipmentNum,
        paymentName: payment.name
      }
    }
    case 'return': {
      const salesReturn = await createReturn(checkResult.orderId)
      return {
        status: 'created',
        shipmentNum: checkResult.shipmentNum,
        returnName: salesReturn.name,
        returnSum: salesReturn.sum / 100
      }
    }
    case 'cancel': {
      await cancelOrder(checkResult.orderId)
      return {
        status: 'created',
        shipmentNum: checkResult.orderId
      }
    }
    default:
      return {
        status: 'error',
        error: 'Unknown action: ' + action,
        shipmentNum: checkResult.shipmentNum
      }
    }
  } catch (e) {
    log(`Ошибка: ${checkResult.shipmentNum} - ${e.message}`)
    return {
      status: 'error',
      error: e.message,
      shipmentNum: checkResult.shipmentNum
    }
  }
}

module.exports = { processBatch }
