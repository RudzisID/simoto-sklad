'use strict';

/**
 * @file Вспомогательные функции для SSE-эндпоинтов.
 * Содержит утилиты для установки SSE-соединения, отправки событий,
 * проверки отмены и фабрику onProgress-колбэков.
 */

/**
 * Устанавливает SSE-заголовки и добавляет соединение в tracking-сет.
 * @param {import('express').Response} res - Express response
 * @param {Set<import('express').Response>} sseConnections - Множество активных SSE-соединений
 * @returns {void}
 */
function setupSSE(res, sseConnections) {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  sseConnections.add(res)
  res.on('close', () => { sseConnections.delete(res) })
}

/**
 * Проверяет и удаляет сигнал отмены.
 * @param {string|undefined} abortId - Идентификатор отмены
 * @param {import('./TtlMap').TtlMap} abortSignals - Хранилище сигналов отмены
 * @returns {boolean} true если запрошена отмена
 */
function checkAbort(abortId, abortSignals) {
  if (abortId && abortSignals.get(abortId)) {
    abortSignals.delete(abortId)
    return true
  }
  return false
}

/**
 * Отправляет JSON-SSE событие и выполняет flush.
 * @param {import('express').Response} res - Express response
 * @param {Object} data - Данные для отправки (будет сериализовано в JSON)
 * @returns {void}
 */
function sendSSE(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`)
  if (res.flush) res.flush()
}

/**
 * Отправляет финальное SSE-событие и завершает ответ.
 * @param {import('express').Response} res - Express response
 * @param {string} type - Тип события (done, error, aborted и т.д.)
 * @param {Object} [extraData={}] - Дополнительные поля к событию
 * @returns {void}
 */
function endSSE(res, type, extraData = {}) {
  sendSSE(res, { type, ...extraData })
  res.end()
}

/**
 * Фабрика onProgress-колбэка для processBatch.
 * @param {import('express').Response} res - Express response
 * @returns {Function} onProgress-колбэк (result, index, total) => void
 */
function makeOnProgress(res) {
  return (result, index, total) => {
    sendSSE(res, { type: 'progress', index: index + 1, total, order: result })
  }
}

/**
 * Быстрый JSON-ответ для случаев, когда SSE не может быть установлен.
 * @param {import('express').Response} res - Express response
 * @param {number} statusCode - HTTP статус-код
 * @param {Object} data - Данные ответа
 * @returns {void}
 */
function sseJsonResponse(res, statusCode, data) {
  res.status(statusCode).json(data)
}

module.exports = { setupSSE, checkAbort, sendSSE, endSSE, makeOnProgress, sseJsonResponse }
