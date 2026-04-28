/// <reference path="./types.js" />
// @ts-check

const { getApi, getSalesChannelObj } = require('./api-utils')

/**
 * Создаёт входящий платёж для заказа
 * @param {string|Order} orderIdOrFull - ID заказа (string) или полные данные заказа (object)
 * @param {string|Demand} [demandIdOrObj] - ID отгрузки (string), объект отгрузки (object) или undefined
 * @returns {Promise<Payment>} - Созданный платёж
 * @throws {Error} - Если платёж уже существует или отгрузка уже оплачена
 */
async function createPayment(orderIdOrFull, demandIdOrObj) {
  // Определяем orderFull
  let orderFull
  if (typeof orderIdOrFull === 'string') {
    // Это orderId, получаем полные данные
    const { getOrderFullForCreate } = require('./order')
    orderFull = await getOrderFullForCreate(orderIdOrFull)
  } else {
    // Это уже готовый объект orderFull
    orderFull = orderIdOrFull
  }

  // Определяем demand
  let demand
  if (demandIdOrObj) {
    if (typeof demandIdOrObj === 'string') {
      // Это demandId, получаем данные отгрузки
      const { getDemand } = require('./order')
      demand = await getDemand(demandIdOrObj)
    } else {
      // Это уже готовый объект demand
      demand = demandIdOrObj
    }
  } else if (orderFull.demands && orderFull.demands.length > 0) {
    // Получаем первую отгрузку из заказа, если не передана явно
    const { getDemand } = require('./order')
    const demandId = orderFull.demands[0].meta.href.split('/').pop()
    demand = await getDemand(demandId)
  }

  // Проверяем, что orderFull и demand определены
  if (!orderFull) {
    throw new Error('Не удалось получить данные заказа')
  }
  if (!demand) {
    throw new Error('Не удалось определить отгрузку для создания платежа')
  }

  // Проверяем существование платежа
  if (demand.payments?.rows?.length > 0) {
    throw new Error('Платёж уже существует')
  }

  // Проверяем оплаченность
  if (demand.payedSum >= demand.sum) {
    throw new Error('Отгрузка уже оплачена')
  }

  const API = getApi()
  try {
    const payment = await API.POST('entity/paymentin', {
      agent: { meta: orderFull.agent.meta },
      organization: { meta: orderFull.organization.meta },
      sum: demand.sum,
      vatSum: demand.vatSum,
      salesChannel:
        getSalesChannelObj(orderFull) ||
        (demand.salesChannel ? { meta: demand.salesChannel.meta } : undefined),
      operations: [
        {
          meta: {
            href: 'https://api.moysklad.ru/api/remap/1.2/entity/customerorder/' + orderFull.id,
            type: 'customerorder',
            mediaType: 'application/json'
          },
          linkedSum: demand.sum
        }
      ],
      description: orderFull.description,
      organizationAccount: { meta: orderFull.organizationAccount.meta }
    })
    return payment
  } catch (error) {
    throw new Error(`Ошибка создания платежа: ${error.message}`)
  }
}

module.exports = { createPayment }
