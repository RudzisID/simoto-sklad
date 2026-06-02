/**
 * @file Утилиты для инициализации и доступа к API МойСклад.
 * Предоставляет функции для создания экземпляра API-клиента moysklad,
 * получения глобального экземпляра и извлечения объекта канала продаж.
 */

let apiInstance = null

/**
 * Инициализирует API-клиент МойСклад с переданным токеном.
 * Создаёт и сохраняет глобальный экземпляр клиента moysklad.
 * @param {string} token - Токен доступа к API МойСклад
 * @returns {Object} Экземпляр API-клиента moysklad
 */
function initApi(token) {
  const ms = require('moysklad')
  apiInstance = ms({ token })
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
