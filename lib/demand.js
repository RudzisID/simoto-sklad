/// <reference path="./types.js" />
// @ts-check

/**
 * @file Модуль создания отгрузок
 * @description Содержит функцию создания отгрузки (demand) для заказа МойСклад
 * с копированием позиций и сменой статуса заказа.
 */

const {
  getApi,
  getSalesChannelObj
} = require('./api-utils')
const { ORDER_STATUS } = require('./constants')
const { getOrderFullForCreate } = require('./order')

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
    const demand = await API.POST('entity/demand', {
      customerOrder: { meta: orderFull.meta },
      agent: { meta: orderFull.agent.meta },
      organization: { meta: orderFull.organization.meta },
      store: { meta: orderFull.store.meta },
      salesChannel: getSalesChannelObj(orderFull),
      positions: positions.rows.map((pos) => ({
        quantity: pos.quantity,
        price: pos.price,
        discount: pos.discount,
        vat: pos.vat,
        vatEnabled: pos.vatEnabled,
        assortment: { meta: pos.assortment.meta }
      }))
    })

    // Смена статуса заказа на "На отправку с отсрочкой платежа"
    await API.PUT('entity/customerorder/' + orderFull.id, {
      state: {
        meta: {
          href: `https://api.moysklad.ru/api/remap/1.2/entity/customerorder/metadata/states/${ORDER_STATUS.DELAYED}`,
          type: 'state'
        }
      },
      salesChannel: getSalesChannelObj(orderFull)
    })

    return demand
  } catch (error) {
    throw new Error(`Ошибка создания отгрузки: ${error.message}`)
  }
}

module.exports = { createDemand }
