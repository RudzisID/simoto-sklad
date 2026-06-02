/**
 * @file Константы UUID статусов заказов и отгрузок МойСклад.
 * Содержит хардкодные UUID для всех статусов, а также объединяет
 * их с конфигурацией из config/statuses.json (приоритет у файла конфигурации).
 */

// Попытка загрузить конфиг статусов из файла
let configOrderStatus, configDemandStatus
try {
  const statusConfig = require('../config/statuses.json')
  configOrderStatus = statusConfig.ORDER_STATUS
  configDemandStatus = statusConfig.DEMAND_STATUS
} catch (e) {
  // Если файл не найден — используем хардкодные значения
  configOrderStatus = null
  configDemandStatus = null
}

/**
 * Слить конфиг и хардкод: приоритет у конфига,
 * недостающие ключи — из хардкода
 * @param {Object|null} config
 * @param {Object} hardcoded
 * @returns {Object}
 */
function mergeStatuses(config, hardcoded) {
  if (!config) return hardcoded
  return { ...hardcoded, ...config }
}

/**
 * Возвращает хардкодные UUID статусов заказов.
 * Используется как fallback, если config/statuses.json не найден.
 * Статусы: Новый, Подтверждён, Оплачен, Собран, Отправлен, Доставлен,
 * Отгружен, Отменён, Частичная отмена и другие.
 * @returns {Object<string, string>} Объект с именами статусов в качестве ключей и UUID в качестве значений
 */
function getHardcodedOrderStatus() {
  return {
    // Статус "Новый"
    NEW: 'e98dfea2-b1c2-11ed-0a80-004e000a843d',
    // Статус "Предложение отправлено"
    OFFER_SENT: '91cb90bd-d7c5-11ed-0a80-05b5003aa5c3',
    // Статус "Подтверждён"
    CONFIRMED: 'e98dffc3-b1c2-11ed-0a80-004e000a843e',
    // Статус "Оплачен"
    PAID: '9e5c69e4-d196-11ed-0a80-02d50027a057',
    // Статус "На отправке с отсрочкой платежа"
    DELAYED: '91cb9364-d7c5-11ed-0a80-05b5003aa5c4',
    // Статус "На отправку - оплачен"
    DELAYED_PAID: '91cb9435-d7c5-11ed-0a80-05b5003aa5c5',
    // Статус "Собран"
    COLLECTED: 'e98e0238-b1c2-11ed-0a80-004e000a843f',
    // Статус "Отправлен"
    SENT: '5ef1de31-d21c-11ed-0a80-063400391971',
    // Статус "Доставлен"
    DELIVERED: 'e98e0339-b1c2-11ed-0a80-004e000a8441',
    // Статус "Отгружен"
    SHIPPED: 'e98e02bb-b1c2-11ed-0a80-004e000a8440',
    // Статус "Отменён"
    CANCELLED: 'e98e0432-b1c2-11ed-0a80-004e000a8443',
    // Статус "Частичная отмена"
    PARTIAL_CANCEL: '9eeb4024-8c71-11ef-0a80-1868000e62f4',
    // Статус "Ожидает отгрузки"
    WAIT_SHIPMENT: '4446a8c7-91e8-11f0-0a80-11be007306c9',
    // Статус "Доставляется"
    DELIVERING: '444a2907-91e8-11f0-0a80-11be007306cc',
    // Статус "Возврат"
    RETURN: '444c3246-91e8-11f0-0a80-11be007306ce',
    // Статус "Возвращается"
    RETURNING: '444e62a7-91e8-11f0-0a80-11be007306d0',
    // Статус "Возврат ожидает"
    RETURN_WAIT: '4450530f-91e8-11f0-0a80-11be007306d2',
    // Статус "ОЖДАЕТ ОЗОН (КОМПЕНСИРОВАН)"
    OZON_WAIT: '687a8020-1985-11f1-0a80-00f200145a2c'
  }
}

/**
 * Возвращает хардкодные UUID статусов отгрузок.
 * Используется как fallback, если config/statuses.json не найден.
 * Статусы: на оплате, частично оплачен, оплачен, отменён.
 * @returns {Object<string, string>} Объект с именами статусов в качестве ключей и UUID в качестве значений
 */
function getHardcodedDemandStatus() {
  return {
    // Статус "на оплате"
    ON_PAYMENT: '77788eaf-d796-11ed-0a80-02e7003512f0',
    // Статус "частично оплачен"
    PARTIALLY_PAID: 'b7d91b0c-d7c5-11ed-0a80-05b5003aa7c1',
    // Статус "оплачен"
    PAID: '77788ff5-d796-11ed-0a80-02e7003512f1',
    // Статус "отменён"
    CANCELLED: 'b1de4f91-a3ca-11ee-0a80-1547000a8e4c'
  }
}

/**
 * Сводный объект статусов заказов.
 * Приоритет у config/statuses.json, недостающие ключи — из хардкода.
 * @type {Object<string, string>}
 */
const ORDER_STATUS = mergeStatuses(configOrderStatus, getHardcodedOrderStatus())

/**
 * Сводный объект статусов отгрузок.
 * Приоритет у config/statuses.json, недостающие ключи — из хардкода.
 * @type {Object<string, string>}
 */
const DEMAND_STATUS = mergeStatuses(configDemandStatus, getHardcodedDemandStatus())

/** @const {number} TTL кэша по умолчанию — 2 часа (в миллисекундах) */
const CACHE_TTL = 2 * 60 * 60 * 1000

module.exports = {
  ORDER_STATUS,
  DEMAND_STATUS,
  CACHE_TTL
}
