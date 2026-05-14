/// <reference path="./types.js" />
// @ts-check

const {
  getATTR_ORDER_CHANNEL,
  getATTR_DEMAND_CHANNEL,
  getSalesChannelObj,
  getChannelAttrValue,
  initApi,
  getApi
} = require('./api-utils')
const { ORDER_STATUS } = require('./constants')

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
  const attrValue = getChannelAttrValue(orderFull)

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
      salesChannel: getSalesChannelObj(orderFull),
      attributes: [
        {
          meta: {
            href: `https://api.moysklad.ru/api/remap/1.2/entity/customerorder/metadata/attributes/${getATTR_ORDER_CHANNEL()}`,
            type: 'attributemetadata'
          },
          id: getATTR_ORDER_CHANNEL(),
          value: attrValue
        }
      ]
    })
  }
  return false
}

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
    console.error('Error getting order full:', e.message)
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
    console.error('Error getting order full:', e.message)
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
    console.error('Error getting demand:', e.message)
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
    console.error('Error finding sales returns by demand:', e.message)
    return { rows: [] }
  }
}

// Функция оставлена для обратной совместимости (вызов из return.js)
function invalidateReturnsCache() {
  // Кеш больше не используется
}

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
    console.error('Error finding sales returns by order:', e.message)
    return null
  }
}

async function findSalesReturns(query, options = {}) {
  /**
   * Унифицированный поиск возвратов
   * @param {string} query - номер для поиска (номер покупателя или номер заказа МС)
   * @param {object} options - опции
   * @param {boolean} options.exactName - искать по name (точное совпадение), по умолчанию false
   * @returns {Promise<{rows: Array}>} - результат поиска
   *
   * Логика:
   * 1. Если exactName=true → ищем ТОЛЬКО по name (точное совпадение)
   * 2. Иначе:
   *    a) Сначала ищем по description (частичное contains) — это номер покупателя
   *    b) Потом ищем по name (точное equals) — это номер заказа МС
   *    c) Возвращаем первый найденный результат
   */
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
    console.error('Error finding sales return:', e.message)
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
