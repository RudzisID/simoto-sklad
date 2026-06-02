/// <reference path="./types.js" />
// @ts-check

/**
 * @file Модуль поиска и управления заказами МойСклад
 * @description Содержит функции поиска заказов по номеру отправления, имени, UUID,
 * получения полных данных заказа, управления статусами и поиска возвратов продаж.
 */

const {
  getSalesChannelObj,
  initApi,
  getApi
} = require('./api-utils')
const { ORDER_STATUS } = require('./constants')
const { error: logError } = require('./logger')

/**
 * Изменяет статус заказа (с DELAYED на SHIPPED)
 * @param {string} orderId - ID заказа
 * @param {Order} orderFull - Полные данные заказа
 * @returns {Promise<boolean>} - true если статус изменён, false если нет
 */
async function changeOrderStatus(orderId, orderFull) {
  const API = getApi()
  if (!orderFull || !orderFull.state) {
    return false
  }
  const currentStateId = orderFull.state?.meta?.href?.split('/').pop()
  if (currentStateId === ORDER_STATUS.DELAYED) {
    await API.PUT('entity/customerorder/' + orderId, {
      state: {
        meta: {
          href:
            'https://api.moysklad.ru/api/remap/1.2/entity/customerorder/metadata/states/' +
            ORDER_STATUS.SHIPPED,
          type: 'state'
        }
      },
      salesChannel: getSalesChannelObj(orderFull)
    })
  }
  return false
}

/**
 * Формирует ссылку на заказ в веб-интерфейсе МойСклад
 * @param {Order} orderFull - Полные данные заказа
 * @returns {string} - URL заказа в формате https://online.moysklad.ru/app/#customerorder/{uuid}
 */
function getOrderUrl(orderFull) {
  if (orderFull.meta && orderFull.meta.href) {
    const uuid = orderFull.meta.href.split('/').pop()
    return `https://online.moysklad.ru/app/#customerorder/${uuid}`
  }
  return `https://online.moysklad.ru/app/#customerorder/${orderFull.id}`
}

/**
 * Ищет заказ по номеру отправления (в name или description)
 * @param {string} shipmentNum - Номер отправления
 * @param {Function} [log=console.log] - Функция логирования
 * @returns {Promise<Order|null>} - Найденный заказ или null
 */
async function findOrderByShipmentNum(shipmentNum, log = console.log) {
  try {
    const API = getApi()
    log(`Поиск заказа: ${shipmentNum}`)

    // 1. Сначала ищем частичное совпадение в description (WB/Ozon номера)
    let filter = 'description~' + shipmentNum
    log(`Фильтр: ${filter}`)
    let orders = await API.GET('entity/customerorder?limit=50&filter=' + encodeURIComponent(filter))
    log(`Найдено заказов: ${orders.rows?.length || 0}`)

    if (orders.rows?.length > 0) {
      orders.rows.forEach((o) => {
        log(`Заказ: ${o.name}, description: ${o.description}`)
      })
      const result = orders.rows[0]
      if (result) {
        return { ...result, foundBy: 'description' }
      }
    }

    // 2. Если не найден — ищем точное совпадение по name (номер заказа МС)
    filter = 'name=' + shipmentNum
    log(`Фильтр: ${filter}`)
    orders = await API.GET(
      'entity/customerorder?limit=50&filter=' + encodeURIComponent(filter)
    )
    log(`Найдено заказов: ${orders.rows?.length || 0}`)

    if (orders.rows?.length > 0) {
      const result = orders.rows[0]
      log(`Найден по name: ${result.name}, description: ${result.description}`)
      return { ...result, foundBy: 'name' }
    }

    return null
  } catch (e) {
    log(`Ошибка поиска: ${e.message}`)
    return null
  }
}

/**
 * Получает полные данные заказа (для проверки)
 * @param {string} orderId - ID заказа
 * @returns {Promise<Order|null>} - Полные данные заказа или null
 */
async function getOrderFull(orderId) {
  try {
    const API = getApi()
    return await API.GET('entity/customerorder/' + orderId + '?expand=demands,positions.assortment,state,returns,payments')
  } catch (e) {
    logError(`Error getting order full: ${e.message}`)
    return null
  }
}

/**
 * Получает полные данные заказа (для создания сущностей)
 * @param {string} orderId - ID заказа
 * @returns {Promise<Order|null>} - Полные данные заказа или null
 */
async function getOrderFullForCreate(orderId) {
  try {
    const API = getApi()
    return await API.GET('entity/customerorder/' + orderId + '?expand=demands,positions.assortment,salesChannel,agent,organization,organizationAccount,state,returns,payments')
  } catch (e) {
    logError(`Error getting order full: ${e.message}`)
    return null
  }
}

/**
 * Получает данные отгрузки (demand)
 * @param {string} demandId - ID отгрузки
 * @returns {Promise<Demand|null>} - Данные отгрузки или null
 */
async function getDemand(demandId) {
  try {
    const API = getApi()
    return await API.GET('entity/demand/' + demandId + '?expand=positions,salesChannel,returns')
  } catch (e) {
    logError(`Error getting demand: ${e.message}`)
    return null
  }
}

/**
 * Находит возвраты для отгрузки через expand
 * @param {string} demandId - ID отгрузки
 * @returns {Promise<{rows: Array}>} - Возвраты
 */
async function findSalesReturnsByDemand(demandId) {
  try {
    const API = getApi()
    const demand = await API.GET('entity/demand/' + demandId + '?expand=returns')
    const returns = Array.isArray(demand.returns) ? demand.returns : (demand.returns?.rows || [])
    return { rows: returns }
  } catch (e) {
    logError(`Error finding sales returns by demand: ${e.message}`)
    return { rows: [] }
  }
}

/**
 * Инвалидирует кеш возвратов (заглушка для обратной совместимости)
 * @description Функция сохранена для обратной совместимости с return.js.
 * Кеш возвратов больше не используется, все данные запрашиваются напрямую из API.
 * @returns {void}
 */
// Функция оставлена для обратной совместимости (вызов из return.js)
function invalidateReturnsCache() {
  // Кеш больше не используется
}

/**
 * Находит возвраты продаж по UUID заказа через связанную отгрузку
 * @param {string} orderId - UUID заказа в МойСклад
 * @returns {Promise<{rows: Array}|null>} - Объект с массивом возвратов или null, если заказ не найден
 *
 * Логика:
 * 1. Получает заказ с расширенными данными отгрузок (demands)
 * 2. Извлекает ID первой отгрузки
 * 3. Передаёт запрос в findSalesReturnsByDemand
 */
async function findSalesReturnsByOrder(orderId) {
  try {
    const API = getApi()
    const order = await API.GET('entity/customerorder/' + orderId + '?expand=demands')
    if (!order || !order.demands || order.demands.length === 0) {
      return null
    }
    const demandId = order.demands[0].meta.href.split('/').pop()
    return await findSalesReturnsByDemand(demandId)
  } catch (e) {
    logError(`Error finding sales returns by order: ${e.message}`)
    return null
  }
}

/**
 * Унифицированный поиск возвратов продаж
 * @param {string} query - Номер для поиска (номер покупателя или номер заказа МС)
 * @param {Object} [options] - Опции поиска
 * @param {boolean} [options.exactName=false] - Искать только по name (точное совпадение)
 * @returns {Promise<{rows: Array}>} - Результат поиска с массивом возвратов
 *
 * Логика:
 * 1. Если exactName=true → ищет ТОЛЬКО по name (точное совпадение с номером заказа МС)
 * 2. Иначе:
 *    a) Сначала ищет по description (частичное contains) — это номер покупателя
 *    b) Потом ищет по name (точное equals) — это номер заказа МС
 *    c) Возвращает первый найденный результат
 */
async function findSalesReturns(query, options = {}) {
  try {
    const API = getApi()
    const { exactName = false } = options

    // Вариант 1: точное совпадение по name (номер заказа МС)
    if (exactName) {
      const filter = 'name=' + query
      const result = await API.GET('entity/salesreturn', { filter: filter, limit: 3 })

      if (result?.rows?.length) {
        return { rows: [result.rows[0]] }
      }
      return { rows: [] }
    }

    // Вариант 2: поиск по description (частичное совпадение — номер покупателя)
    if (query) {
      let filter = 'description~' + query
      let result = await API.GET('entity/salesreturn', { filter: filter, limit: 3 })

      if (result?.rows?.length) {
        return { rows: [result.rows[0]] }
      }

      filter = 'description=' + query
      result = await API.GET('entity/salesreturn', { filter: filter, limit: 3 })

      if (result?.rows?.length) {
        return { rows: [result.rows[0]] }
      }

      filter = 'name=' + query
      result = await API.GET('entity/salesreturn', { filter: filter, limit: 3 })

      if (result?.rows?.length) {
        return { rows: [result.rows[0]] }
      }
    }

    return { rows: [] }
  } catch (e) {
    logError(`Error finding sales return: ${e.message}`)
    return { rows: [] }
  }
}

module.exports = {
  initApi,
  getApi,
  changeOrderStatus,
  getOrderUrl,
  findOrderByShipmentNum,
  getOrderFull,
  getOrderFullForCreate,
  getDemand,
  findSalesReturnsByDemand,
  findSalesReturnsByOrder,
  findSalesReturns,
  invalidateReturnsCache
}
