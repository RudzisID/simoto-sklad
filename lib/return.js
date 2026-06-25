/**
 * @file Модуль создания возвратов
 * @description Содержит функцию создания возврата продаж (sales return) для отгруженного заказа
 * с копированием позиций из отгрузки и сменой статусов заказа и отгрузки.
 */

const {
  getApi,
  getSalesChannelObj
} = require('./api-utils')
const { ORDER_STATUS, DEMAND_STATUS } = require('./constants')
const { getOrderFullForCreate } = require('./order')

/**
 * Создаёт возврат продаж для заказа
 * @param {string} orderId - UUID заказа в МойСклад
 * @param {Order} [orderFull] - Полные данные заказа (если не передан, будут получены по orderId)
 * @param {string} [demandId] - UUID отгрузки (если не передан, будет определён из заказа)
 * @param {string[]} [selectedOfferIds] - Список offer_id для частичного возврата (опционально, если не указан — все позиции)
 * @returns {Promise<Object>} - Созданный объект возврата продаж (salesreturn)
 * @throws {Error} - Если отгрузка не найдена, возврат уже создан или ошибка API
 *
 * Логика:
 * 1. Определяет orderFull и demandId, если не переданы
 * 2. Проверяет, что отгрузка существует и возврат ещё не создан
 * 3. Меняет статус заказа на RETURN
 * 4. Меняет статус отгрузки на CANCELLED
 * 5. Создаёт возврат продаж с копированием выбранных позиций из отгрузки
 */
async function createReturn(orderId, orderFull, demandId, selectedOfferIds) {
  const API = getApi()

  if (!orderFull) {
    orderFull = await getOrderFullForCreate(orderId)
  }

  if (!demandId && orderFull.demands?.length > 0) {
    demandId = orderFull.demands[0].meta.href.split('/').pop()
  }

  if (!demandId) {
    throw new Error('Отгрузка не найдена')
  }

  const demand = await API.GET('entity/demand/' + demandId + '?expand=positions,returns')

  // Проверяем возвраты и из отгрузки, и из заказа (с нормализацией формата)
  const existingReturns = [
    ...(Array.isArray(demand?.returns) ? demand.returns : (demand?.returns?.rows || [])),
    ...(orderFull?.returns?.rows || [])
  ]
  if (existingReturns.length > 0) {
    throw new Error('Возврат уже создан')
  }

  await API.PUT('entity/customerorder/' + orderId, {
    state: {
      meta: {
        href: 'https://api.moysklad.ru/api/remap/1.2/entity/customerorder/metadata/states/' + ORDER_STATUS.RETURN,
        type: 'state'
      }
    },
    salesChannel: getSalesChannelObj(orderFull)
  })

  await API.PUT('entity/demand/' + demandId, {
    state: {
      meta: {
        href: 'https://api.moysklad.ru/api/remap/1.2/entity/demand/metadata/states/' + DEMAND_STATUS.CANCELLED,
        type: 'state'
      }
    },
    salesChannel: getSalesChannelObj(orderFull)
  })

  const salesReturn = await API.POST('entity/salesreturn', {
    demand: { meta: demand.meta },
    agent: { meta: orderFull.agent.meta },
    organization: { meta: orderFull.organization.meta },
    store: { meta: orderFull.store.meta },
    salesChannel: getSalesChannelObj(orderFull),
    positions: (() => {
      const allPositions = demand.positions.rows
      const filtered = selectedOfferIds?.length
        ? allPositions.filter(pos => {
            const code = pos.assortment?.code || pos.assortment?.name || ''
            return selectedOfferIds.includes(code)
          })
        : allPositions
      if (selectedOfferIds?.length && filtered.length !== selectedOfferIds.length) {
        console.log(`[Return] Предупреждение: запрошено ${selectedOfferIds.length} товаров, найдено ${filtered.length} в отгрузке`)
      }
      return filtered.map((pos) => ({
        quantity: pos.quantity,
        price: pos.price,
        vat: pos.vat,
        vatEnabled: pos.vatEnabled,
        assortment: { meta: pos.assortment.meta }
      }))
    })()
  })

  return salesReturn
}

module.exports = { createReturn }
