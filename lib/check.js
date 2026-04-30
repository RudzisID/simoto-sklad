const {
  findOrderByShipmentNum,
  getOrderFull,
  getOrderFullForCreate,
  getDemand,
  findSalesReturnsByDemand_v2,
  findSalesReturns
} = require('./order')
const { ORDER_STATUS } = require('./constants')

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
      foundBy: null
    }
  }

  // Извлекаем номер заказа из description (WB/Ozon)
  const extractedShipmentNum = extractShipmentNumFromDescription(order.description)

  const orderFull = await getOrderFull(order.id)

  // Проверяем статус заказа (даже если нет отгрузки)
  const stateId = orderFull?.state?.meta?.href?.split('/').pop()
  const stateName = orderFull?.state?.name || ''
  const isNewOrder = !stateName || stateName === 'Новый'
  const isCancelled =
    stateId === ORDER_STATUS.CANCELLED || stateName.toLowerCase().includes('отмен')

  // Если нет отгрузки - проверяем статус заказа
  if (!orderFull || !orderFull.demands?.length) {
    let statusName = 'Новый'
    if (isCancelled) {
      statusName = 'Отменён'
    } else if (stateName) {
      statusName = stateName
    }

    // Получаем позиции из заказа (даже без отгрузки)
    const orderPositions = parsePositions(orderFull?.positions)

    return {
      shipmentNum,
      orderId: order.id,
      orderName: order.name,
      // Для заказов без отгрузки берём сумму из самого заказа (в копейках, делим на 100)
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
      orderPositions,
      demandPositions: []
    }
  }

  const demand = await getDemand(orderFull.demands[0].meta.href.split('/').pop())
  if (!demand) {
    return {
      shipmentNum,
      orderName: order.name,
      sum: 0,
      paid: 0,
      status: 'error',
      statusName: 'Ошибка',
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
      foundBy
    }
  }
  let returnNameFromDemand = null
  if (demand?.returns?.rows?.length > 0) {
    returnNameFromDemand = demand.returns.rows[0].name
  }

  // stateId и stateName уже объявлены выше
  statusName = stateName || 'Новый'
  // isCancelled уже объявлен выше

  const orderReturns = orderFull.returns || (demand && demand.returns)
  let hasReturn = orderReturns && orderReturns.rows && orderReturns.rows.length > 0
  if (!hasReturn && Array.isArray(orderReturns)) {
    hasReturn = orderReturns.length > 0
  }
  if (!hasReturn) {
    hasReturn = stateName.toLowerCase().includes('возврат')
  }

  let returnName = returnNameFromDemand
  if (!returnName && hasReturn && orderReturns?.rows?.[0]) {
    returnName = orderReturns.rows[0].name
  } else if (!returnName && hasReturn && Array.isArray(orderReturns) && orderReturns[0]) {
    returnName = orderReturns[0].name
  }

  if (
    !returnName &&
    !hasReturn &&
    orderFull.demands &&
    orderFull.demands.length > 0 &&
    (isCancelled || stateName.toLowerCase().includes('возврат'))
  ) {
    const demandId = orderFull.demands[0].meta.href.split('/').pop()
    const sr = await findSalesReturnsByDemand_v2(demandId, demand.name, shipmentNum)
    if (sr && sr.rows && sr.rows.length > 0) {
      hasReturn = true
      returnName = sr.rows[0].name
    }
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

  const demandReturns = demand?.returns
  if (!returnName && demandReturns && demandReturns.rows && demandReturns.rows.length > 0) {
    returnName = demandReturns.rows[0].name
  }

  if (
    !returnName &&
    orderFull.returns &&
    orderFull.returns.rows &&
    orderFull.returns.rows.length > 0
  ) {
    returnName = orderFull.returns.rows[0].name
  }

  if (!returnName && orderFull.demands && orderFull.demands.length > 0) {
    const demandId = orderFull.demands[0].meta.href.split('/').pop()
    const demandNameLocal = demand.name
    const sr = await findSalesReturnsByDemand_v2(demandId, demandNameLocal, shipmentNum)
    if (sr && sr.rows && sr.rows.length > 0) {
      returnName = sr.rows[0].name
    }
  }

  const canDemand = !hasDemand && !isCancelled
  const canPayment = hasDemand && !hasPayment && !hasReturn && !isCancelled
  const canReturn = hasDemand && !hasReturn && !isCancelled
  const canCancel = !hasDemand && !isCancelled

  const orderPositions = parsePositions(orderFull.positions)
  const demandPositions = parsePositions(demand.positions)

  return {
    shipmentNum,
    orderName: order.name,
    sum: demand.sum / 100,
    paid: demand.payedSum / 100,
    status: 'other',
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
    orderPositions,
    demandPositions
  }
}

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
 * Извлекает номер заказа покупателя из комментария (description)
 * Ozon: ищем после "в Ozon" или "номер отправления в Ozon"
 * WB: ищем после "в Wildberries" или "Номер задания в Wildberries"
 */
function extractShipmentNumFromDescription(description) {
  if (!description) return null

  // Ozon: ищем после "в Ozon" или "номер отправления в Ozon" → номер XXXXX-XXXX-XX
  const ozonMatch = description.match(/(?:номер отправления в |в )Ozon[,:]?\s*(\d+-\d+-\d+)/i)
  if (ozonMatch) return ozonMatch[1]

  // WB: ищем после "Номер задания в Wildberries" → номер из 7-12 цифр
  const wbMatch = description.match(/Номер задания в Wildberries[,:]?\s*(\d{7,12})/i)
  if (wbMatch) return wbMatch[1]

  // Fallback: если только одна группа цифр с дефисами - считаем Ozon
  const dashMatch = description.match(/\b(\d+-\d+-\d+)\b/)
  if (dashMatch) return dashMatch[1]

  return null
}

module.exports = { checkOrder, parsePositions, extractShipmentNumFromDescription }
