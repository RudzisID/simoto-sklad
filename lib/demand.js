/// <reference path="./types.js" />
// @ts-check

const {
  getApi,
  getSalesChannelObj,
  getATTR_DEMAND_CHANNEL,
  getChannelAttrValue
} = require('./api-utils')

/**
 * Создаёт отгрузку для заказа
 * @param {string|Order} orderIdOrFull - ID заказа (string) или полные данные заказа (Order)
 * @returns {Promise<Demand>} - Созданная отгрузка
 * @throws {Error} - Если отгрузка уже существует или ошибка API
 */
async function createDemand(orderIdOrFull) {
  const API = getApi()

  // Определяем тип аргумента и получаем полные данные заказа
  let orderFull
  if (typeof orderIdOrFull === 'string') {
    // Это orderId - получаем полные данные
    const { getOrderFullForCreate } = require('./order')
    orderFull = await getOrderFullForCreate(orderIdOrFull)
    if (!orderFull) {
      throw new Error('Не удалось получить данные заказа')
    }
  } else {
    // Это orderFull - используем как есть
    orderFull = orderIdOrFull
  }

  if (orderFull.demands && orderFull.demands.length > 0) {
    throw new Error('Отгрузка уже существует')
  }

  try {
    const positions = await API.GET('entity/customerorder/' + orderFull.id + '/positions')
    const attrValue = getChannelAttrValue(orderFull)

    const demand = await API.POST('entity/demand', {
      customerOrder: { meta: orderFull.meta },
      agent: { meta: orderFull.agent.meta },
      organization: { meta: orderFull.organization.meta },
      store: { meta: orderFull.store.meta },
      salesChannel: getSalesChannelObj(orderFull),
      attributes: [
        {
          meta: {
            href: `https://api.moysklad.ru/api/remap/1.2/entity/demand/metadata/attributes/${getATTR_DEMAND_CHANNEL()}`,
            type: 'attributemetadata'
          },
          id: getATTR_DEMAND_CHANNEL(),
          value: attrValue
        }
      ],
      positions: positions.rows.map((pos) => ({
        quantity: pos.quantity,
        price: pos.price,
        discount: pos.discount,
        vat: pos.vat,
        vatEnabled: pos.vatEnabled,
        assortment: { meta: pos.assortment.meta }
      }))
    })

    return demand
  } catch (error) {
    throw new Error(`Ошибка создания отгрузки: ${error.message}`)
  }
}

module.exports = { createDemand }
