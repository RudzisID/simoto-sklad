/**
 * @file Утилиты для инициализации и доступа к API МойСклад.
 * Предоставляет функции для создания экземпляра API-клиента moysklad,
 * получения глобального экземпляра и извлечения объекта канала продаж.
 */

let apiInstance = null
/** @type {string|null} Токен, для которого создан текущий экземпляр клиента */
let apiInstanceToken = null

/**
 * Инициализирует API-клиент МойСклад с переданным токеном.
 * Создаёт и сохраняет глобальный экземпляр клиента moysklad с планировщиком
 * запросов (rate-limited fetch) для защиты от ошибок 429 (1049/1073).
 * Повторный вызов с тем же токеном переиспользует экземпляр — это сохраняет
 * накопленное состояние лимитов в планировщике (иначе счётчик обнулялся бы
 * на каждом HTTP-запросе к нашему серверу).
 * @param {string} token - Токен доступа к API МойСклад
 * @returns {Object} Экземпляр API-клиента moysklad
 */
function initApi(token) {
  if (apiInstance && apiInstanceToken === token) {
    return apiInstance
  }
  const ms = require('moysklad')
  const { rateLimitedFetch } = require('./ms-rate-limited-fetch')
  apiInstance = ms({ token, fetch: rateLimitedFetch })
  apiInstanceToken = token
  return apiInstance
}

/**
 * Возвращает ранее инициализированный экземпляр API-клиента МойСклад.
 * @throws {Error} Если API не был инициализирован через initApi()
 * @returns {Object} Экземпляр API-клиента moysklad
 */
function getApi() {
  if (!apiInstance) {
    throw new Error('API не инициализирован')
  }
  return apiInstance
}

/**
 * Извлекает объект meta канала продаж из полных данных заказа.
 * Используется при создании отгрузок и платежей для сохранения
 * привязки к каналу продаж.
 * @param {Object} orderFull - Полные данные заказа из МойСклад
 * @param {Object} [orderFull.salesChannel] - Объект канала продаж
 * @returns {Object|undefined} Объект { meta } канала продаж или undefined, если канал не указан
 */
function getSalesChannelObj(orderFull) {
  if (!orderFull.salesChannel) return undefined
  return { meta: orderFull.salesChannel.meta }
}

module.exports = {
  initApi,
  getApi,
  getSalesChannelObj
}
