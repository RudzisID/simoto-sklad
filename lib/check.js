/**
 * @file Модуль проверки статусов заказов
 * @description Содержит функции проверки статусов заказов, парсинга позиций,
 * извлечения номера отправления из описания и расчёта сумм возвратов.
 */

const {
  findOrderByShipmentNum,
  extractShipmentNumFromDescription,
  getOrderFull,
  getOrderFullForCreate,
  getDemand
} = require('./order')
const { ORDER_STATUS } = require('./constants')
const { debug, error } = require('./logger')

/**
 * Проверяет статус заказа по номеру отправления
 * @param {string} shipmentNum - Номер отправления для поиска
 * @param {Function} [log=console.log] - Функция логирования
 * @returns {Promise<Object>} - Результат проверки с полями статуса, доступных действий и сумм
 *
 * Логика:
 * 1. Ищет заказ по номеру отправления через findOrderByShipmentNum
 * 2. Если заказ не найден → возвращает статус "not_found"
 * 3. Получает полные данные заказа и определяет статус
 * 4. Если есть отгрузка (demand) — получает её данные с возвратами
 * 5. Рассчитывает доступные действия: canDemand, canPayment, canReturn, canCancel
 * 6. Собирает все возвраты (из отгрузки и заказа) и суммирует
 */
async function checkOrder(shipmentNum, log = console.log) {
  const order = await findOrderByShipmentNum(shipmentNum, log)
  const foundBy = order?.foundBy || 'description'
  
  if (!order) {
    return {
      shipmentNum,
      orderName: null,
      extractedShipmentNum: null,
      sum: 0,
      paid: 0,
      status: 'not_found',
      statusName: 'Не найден',
      canDemand: false,
      canPayment: false,
      canReturn: false,
      canCancel: false,
      hasDemand: false,
      hasReturn: false,
      isCancelled: false,
      demandName: null,
      paymentName: null,
      returnName: null,
      foundBy: null,
      orderMoment: null,
      marketplace: null,
      storeName: '',
      storeId: ''
    }
  }
  
  const extractedShipmentNum = extractShipmentNumFromDescription(order.description)
  
  const orderFull = await getOrderFull(order.id)

  const stateId = orderFull?.state?.meta?.href?.split('/').pop()
  const stateName = orderFull?.state?.name || ''
  const normalizedStateName = stateName.toLowerCase()
  const isNewOrder = !stateName || stateName === 'Новый'
  const isPartialCancel = stateId === ORDER_STATUS.PARTIAL_CANCEL ||
    (normalizedStateName.includes('частич') && normalizedStateName.includes('отмен'))
  const isCancelled = stateId === ORDER_STATUS.CANCELLED ||
    (!isPartialCancel && normalizedStateName.includes('отмен'))
  
  if (!orderFull || !orderFull.demands?.length) {
    let statusName = 'Новый'
    if (isCancelled) {
      statusName = 'Отменён'
    } else if (stateName) {
      statusName = stateName
    }
    
    const orderPositions = parsePositions(orderFull?.positions)
    
    return {
      shipmentNum,
      orderId: order.id,
      orderName: order.name,
      sum: (orderFull.sum || 0) / 100,
      paid: 0,
      status: isNewOrder ? 'new' : isCancelled ? 'cancelled' : 'no_demand',
      statusName,
      canDemand: !isCancelled,
      canPayment: false,
      canReturn: false,
      canCancel: !isCancelled,
      hasDemand: false,
      hasReturn: false,
      isCancelled,
      demandName: null,
      paymentName: null,
      returnName: null,
      foundBy,
      extractedShipmentNum: extractShipmentNumFromDescription(order.description),
      orderMoment: orderFull?.moment || order.moment || null,
      orderPositions,
      demandPositions: [],
      marketplace: detectMarketplaceFromDescription(order.description),
      storeName: orderFull?.store?.name || '',
      storeId: orderFull?.store?.id || orderFull?.store?.meta?.href?.split('/').pop() || ''
    }
  }

  const demandId = orderFull.demands[0].meta.href.split('/').pop()
  const demand = await getDemand(demandId)

  // Проверка null demand ДО обращения к demand.returns
  if (!demand) {
    return {
      shipmentNum,
      orderId: order.id,
      orderName: order.name,
      sum: 0,
      paid: 0,
      status: 'error',
      statusName: 'Ошибка: отгрузка не найдена',
      canDemand: false,
      canPayment: false,
      canReturn: false,
      canCancel: false,
      hasDemand: false,
      hasReturn: false,
      isCancelled: false,
      demandName: null,
      paymentName: null,
      returnName: null,
      foundBy,
      extractedShipmentNum: extractShipmentNumFromDescription(order.description),
      orderMoment: orderFull?.moment || order.moment || null,
      orderPositions: parsePositions(orderFull?.positions),
      demandPositions: [],
      marketplace: detectMarketplaceFromDescription(order.description),
      storeName: orderFull?.store?.name || '',
      storeId: orderFull?.store?.id || orderFull?.store?.meta?.href?.split('/').pop() || ''
    }
  }

  // Нормализуем demand.returns: если объект {rows} — разворачиваем,
  // если null/undefined — пустой массив
  if (!demand.returns) {
    demand.returns = []
  } else if (!Array.isArray(demand.returns)) {
    demand.returns = demand.returns.rows || []
  }
  const isPaid = demand.payedSum >= demand.sum
  const hasPayment = isPaid
  
  const hasDemand = true
  const demandName = demand.name

  let paymentName = null
  const paymentsArr = orderFull.payments
  if (paymentsArr && Array.isArray(paymentsArr) && paymentsArr.length > 0) {
    paymentName = paymentsArr[0].name
  }
  
  let returnSumKopeks = 0
  const demandReturns = Array.isArray(demand?.returns)
    ? demand.returns
    : demand?.returns?.rows || []
  const orderReturns = Array.isArray(orderFull?.returns)
    ? orderFull.returns
    : orderFull?.returns?.rows || []
  const allReturns = [
    ...demandReturns,
    ...orderReturns
  ]
  const seen = new Map()
  allReturns.forEach(r => { if (!seen.has(r.id)) seen.set(r.id, r) })
  const uniqueReturns = [...seen.values()]
  
  if (uniqueReturns.length > 0) {
    debug(`[check.js] Found ${uniqueReturns.length} returns for ${shipmentNum}: ${JSON.stringify(uniqueReturns.map(r => ({ name: r.name, sum: r.sum })))}`)
    returnSumKopeks = uniqueReturns.reduce((acc, r) => {
      const sum = r.sum || 0
      debug(`[check.js] Return ${r.name}: sum=${sum} (${sum/100} rub)`)
      return acc + sum
    }, 0)
    debug(`[check.js] Total returnSumKopeks for ${shipmentNum}: ${returnSumKopeks} (${returnSumKopeks/100} rub)`)
  } else {
    debug(`[check.js] No returns found for ${shipmentNum}`)
  }

  const hasReturn = uniqueReturns.length > 0
  // Нормализованный статус нужен одиночному обновлению так же, как unified-search.
  const status = isCancelled
    ? 'cancelled'
    : hasReturn
      ? 'return'
      : normalizedStateName.includes('отсрочк')
        ? 'delayed'
        : normalizedStateName.includes('отгруж') || normalizedStateName.includes('оплач') || hasDemand
          ? 'shipped'
          : 'other'
  const returnName = uniqueReturns[0]?.name || null
  let statusName = stateName || 'Новый'
  if (uniqueReturns.length > 0) {
    if (returnSumKopeks > 0 && returnSumKopeks < demand.sum) {
      statusName = 'Частичная отмена'
    } else if (returnSumKopeks >= demand.sum) {
      statusName = 'Возврат'
    }
  }
  
  const canDemand = !hasDemand && !isCancelled
  const canPayment = hasDemand && !hasPayment && !isCancelled && (!hasReturn || returnSumKopeks < demand.sum)
  const canReturn = hasDemand && !hasReturn && !isCancelled
  const canCancel = !hasDemand && !isCancelled
  
  const orderPositions = parsePositions(orderFull.positions)
  const demandPositions = parsePositions(demand.positions)
  
  return {
    shipmentNum,
    orderName: order.name,
    sum: demand.sum / 100,
    paid: demand.payedSum / 100,
    returnSum: returnSumKopeks / 100,
    status,
    statusName,
    canDemand,
    canPayment,
    canReturn,
    canCancel,
    hasDemand,
    hasPayment,
    hasReturn,
    isCancelled,
    orderId: order.id,
    demandName,
    paymentName,
    returnName,
    extractedShipmentNum: extractShipmentNumFromDescription(order.description),
    orderMoment: orderFull?.moment || order.moment || null,
    orderPositions,
    demandPositions,
    marketplace: detectMarketplaceFromDescription(order.description),
    storeName: orderFull?.store?.name || '',
    storeId: orderFull?.store?.id || orderFull?.store?.meta?.href?.split('/').pop() || ''
  }
}

/**
 * Парсит позиции заказа/отгрузки в удобный формат с кодом, названием, количеством и ценой
 * @param {Object} positions - Объект позиций из API МойСklad (содержит свойство rows)
 * @returns {Array<{code: string, name: string, quantity: number, price: number, sum: number}>} -
 *   Массив распарсенных позиций. Пустой массив, если позиции отсутствуют.
 */
function parsePositions(positions) {
  if (!positions || !positions.rows) return []
  return positions.rows
    .map((p) => {
      const assortment = p.assortment || {}
      const code = assortment.code || ''
      const product = assortment.product || {}
      const productName = product.name || ''
      const assortmentName = assortment.name || ''
      const name = productName || assortmentName || 'Товар'
      const hasData = code || (name && name !== 'Товар')
      if (!hasData) return null
      return {
        code: code,
        name: name,
        quantity: p.quantity,
        price: (p.price || 0) / 100,
        sum: ((p.price || 0) * (p.quantity || 0)) / 100
      }
    })
    .filter((p) => p !== null)
}

/**
 * Определяет маркетплейс по описанию заказа
 * @param {string|null} desc - Описание заказа
 * @returns {string|null} 'ozon' | 'wb' | null
 */
function detectMarketplaceFromDescription(desc) {
  if (!desc) return null
  if (/Ozon/i.test(desc)) return 'ozon'
  if (/Wildberries/i.test(desc)) return 'wb'
  return null
}

module.exports = { checkOrder, parsePositions, extractShipmentNumFromDescription, detectMarketplaceFromDescription }
