/// <reference path="./types.js" />
// @ts-check

/**
 * @file Модуль создания платежей
 * @description Содержит функции создания входящих платежей (полных и частичных с учётом возвратов)
 * для заказов МойСклад.
 */

const { getApi, getSalesChannelObj } = require('./api-utils')
const { ORDER_STATUS } = require('./constants')
const { getOrderFullForCreate, getDemand } = require('./order')

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
      demand = await getDemand(demandIdOrObj)
    } else {
      // Это уже готовый объект demand
      demand = demandIdOrObj
    }
  } else if (orderFull.demands && orderFull.demands.length > 0) {
    // Получаем первую отгрузку из заказа, если не передана явно
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

  // Если заказ в статусе "На отправке с отсрочкой", меняем на "Отгружен"
  const currentStateId = orderFull.state?.meta?.href?.split('/').pop()
  if (currentStateId === ORDER_STATUS.DELAYED) {
    const API = getApi()
    await API.PUT('entity/customerorder/' + orderFull.id, {
      state: {
        meta: {
          href: `https://api.moysklad.ru/api/remap/1.2/entity/customerorder/metadata/states/${ORDER_STATUS.SHIPPED}`,
          type: 'state'
        }
      },
      salesChannel: getSalesChannelObj(orderFull)
    })
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

/**
 * Создаёт частичный входящий платёж с учётом возвратов
 * Сумма = Сумма отгрузки - Сумма всех возвратов
 * @param {string|Order} orderIdOrFull - ID заказа или полные данные
 * @param {string|Demand} [demandIdOrObj] - ID отгрузки или объект
 * @returns {Promise<Payment & {paymentSum: number}>} - Созданный платёж + сумма в рублях
 * @throws {Error} - Если нет возвратов, полный возврат, или платёж уже существует
 */
async function createPartialPayment(orderIdOrFull, demandIdOrObj) {
  // Определяем orderFull
  let orderFull
  if (typeof orderIdOrFull === 'string') {
    orderFull = await getOrderFullForCreate(orderIdOrFull)
  } else {
    orderFull = orderIdOrFull
  }

  // Определяем demandId
  let demandId
  if (demandIdOrObj) {
    if (typeof demandIdOrObj === 'string') {
      demandId = demandIdOrObj
    } else {
      // Это объект demand, получаем ID
      demandId = demandIdOrObj.id
    }
  } else if (orderFull.demands && orderFull.demands.length > 0) {
    demandId = orderFull.demands[0].meta.href.split('/').pop()
  }

  if (!orderFull) {
    throw new Error('Не удалось получить данные заказа')
  }
  if (!demandId) {
    throw new Error('Не удалось определить отгрузку для частичного платежа')
  }

  const API = getApi()

  // Получаем отгрузку с возвратами
  const demand = await API.GET('entity/demand/' + demandId + '?expand=returns,positions')

  // Проверяем существование платежа
  if (demand.payments?.rows?.length > 0) {
    throw new Error('Платёж уже существует')
  }

  // Считаем сумму всех возвратов (из отгрузки и заказа, с дедупликацией)
  const allReturns = [
    ...(Array.isArray(demand?.returns) ? demand.returns : (demand?.returns?.rows || [])),
    ...(orderFull?.returns?.rows || [])
  ]
  const seen = new Map()
  allReturns.forEach(r => { if (!seen.has(r.id)) seen.set(r.id, r) })
  const uniqueReturns = [...seen.values()]
  const returnSumKopeks = uniqueReturns.reduce((acc, r) => acc + (r.sum || 0), 0)

  // Сумма к оплате
  const paymentSumKopeks = demand.sum - returnSumKopeks

  if (paymentSumKopeks <= 0) {
    throw new Error('Полный возврат — нечего оплачивать')
  }

  // Пропорциональный НДС
  const vatSum = Math.round(demand.vatSum * (paymentSumKopeks / demand.sum))

  // Если заказ в статусе "На отправке с отсрочкой", меняем на "Отгружен"
  const currentStateId = orderFull.state?.meta?.href?.split('/').pop()
  if (currentStateId === ORDER_STATUS.DELAYED) {
    await API.PUT('entity/customerorder/' + orderFull.id, {
      state: {
        meta: {
          href: `https://api.moysklad.ru/api/remap/1.2/entity/customerorder/metadata/states/${ORDER_STATUS.SHIPPED}`,
          type: 'state'
        }
      },
      salesChannel: getSalesChannelObj(orderFull)
    })
  }

  try {
    const payment = await API.POST('entity/paymentin', {
      agent: { meta: orderFull.agent.meta },
      organization: { meta: orderFull.organization.meta },
      sum: paymentSumKopeks,
      vatSum: vatSum,
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
          linkedSum: paymentSumKopeks
        }
      ],
      description: orderFull.description,
      organizationAccount: { meta: orderFull.organizationAccount.meta }
    })

    return { ...payment, paymentSum: paymentSumKopeks / 100 }
  } catch (error) {
    throw new Error(`Ошибка создания частичного платежа: ${error.message}`)
  }
}

module.exports = { createPayment, createPartialPayment }
