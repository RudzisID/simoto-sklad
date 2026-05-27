/// <reference path="./types.js" />
// @ts-check

const {
  getApi,
  getSalesChannelObj,
  getATTR_ORDER_CHANNEL,
  getATTR_DEMAND_CHANNEL,
  getChannelAttrValue
} = require('./api-utils')
const { ORDER_STATUS, DEMAND_STATUS } = require('./constants')
const { getOrderFullForCreate } = require('./order')

/**
 * Отменяет заказ и очищает резервы
 * @param {string|Order} orderIdOrFull - ID заказа (string) или полные данные заказа (object)
 * @param {Order} [orderFull] - Полные данные заказа (для legacy mode)
 * @param {string|null} [demandId] - ID отгрузки (если есть, отмена невозможна)
 * @returns {Promise<Object>} - Результат отмены
 * @throws {Error} - Если есть отгрузка или ошибка API
 */
async function cancelOrder(orderIdOrFull, orderFull, demandId) {
  const API = getApi()

  // Self-sufficient: accept orderId (string) or orderFull (object)
  let actualOrderFull
  let actualOrderId
  let actualDemandId = demandId

  if (typeof orderIdOrFull === 'string' && arguments.length === 1) {
    // Self-sufficient mode: only orderId passed, fetch orderFull internally
    actualOrderId = orderIdOrFull
    actualOrderFull = await getOrderFullForCreate(actualOrderId)
    // Check if orderFull was fetched successfully
    if (!actualOrderFull) {
      throw new Error(`Не удалось получить данные заказа ${actualOrderId}`)
    }
    // Extract demandId from orderFull if exists
    if (actualOrderFull.demands?.length > 0) {
      actualDemandId = actualOrderFull.demands[0].meta.href.split('/').pop()
    }
  } else {
    // Legacy mode: (orderId, orderFull, demandId) from batch.js
    actualOrderId = orderIdOrFull
    actualOrderFull = orderFull
    actualDemandId = demandId
  }

   const attrValue = getChannelAttrValue(actualOrderFull)

  // 1. Если есть отгрузка — отмена невозможна
  if (actualDemandId) {
    throw new Error('Нельзя отменить — отгрузка уже создана. Используйте возврат.')
  }

  try {
    // 2. Обнуляем резерв для всех позиций
    const positions = await API.GET('entity/customerorder/' + actualOrderId + '/positions')
    if (positions.rows && positions.rows.length > 0) {
      const positionsToUpdate = positions.rows.map((pos) => ({
        meta: pos.meta,
        reserve: 0
      }))
      await API.POST('entity/customerorder/' + actualOrderId + '/positions', positionsToUpdate)
    }

    // 3. Смена статуса + ОБЯЗАТЕЛЬНЫЙ salesChannel
    const updatePayload = {
      state: {
        meta: {
          href: `https://api.moysklad.ru/api/remap/1.2/entity/customerorder/metadata/states/${ORDER_STATUS.CANCELLED}`,
          type: 'state'
        }
      },
       // Всегда включаем salesChannel (если нет в заказе — будет undefined, что корректно обрабатывается API)
       salesChannel: getSalesChannelObj(actualOrderFull),
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
    }

    await API.PUT('entity/customerorder/' + actualOrderId, updatePayload)

    return { orderId: actualOrderId, demandId: actualDemandId, status: 'cancelled', reserveCleared: true }
  } catch (error) {
    const errorMsg = error.message || String(error)
    
    // Проверяем на ошибку аутентификации (HTML)
    if (errorMsg.includes('<!DOCTYPE') || errorMsg.includes('<html')) {
      throw new Error(`Ошибка аутентификации в МойСклад. Проверьте токен в .env`)
    }
    
    // Ошибки формата state (Error 2013)
    if (errorMsg.includes('неправильное значение href') || errorMsg.includes('error_2013')) {
      throw new Error(
        `Ошибка формата state: ${errorMsg}.\n` +
        `1. Проверьте ORDER_STATUS.CANCELLED в constants.js — должен быть РЕАЛЬНЫЙ UUID статуса "Отменён" из вашего МойСклад!\n` +
        `2. Убедитесь, что в заказе заполнено поле salesChannel (Канал продаж).\n` +
        `Текущий ORDER_STATUS.CANCELLED: ${ORDER_STATUS.CANCELLED}`
      )
    }
    
    // Другие ошибки API
    if (error.httpStatus >= 400 && error.httpStatus < 500) {
      throw new Error(`Ошибка МойСклад (${error.httpStatus}): ${errorMsg}`)
    }
    
    // Общая ошибка
    throw new Error(`Ошибка отмены заказа: ${errorMsg}`)
  }
}

module.exports = { cancelOrder }
