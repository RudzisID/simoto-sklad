const { ATTRIBUTES } = require('./constants')

// ═══════════════════════════════════════════════════════════════════════════════
// @cleanup 2026-05-20 — канал продаж w/o больше не пишется (отключено 2026-05-14)
//
// ПОЛНАЯ ИНСТРУКЦИЯ ПО ОКОНЧАТЕЛЬНОМУ УДАЛЕНИЮ:
// 1. api-utils.js: удалить getChannelAttrValue, getATTR_ORDER_CHANNEL, getATTR_DEMAND_CHANNEL + их экспорт
// 2. constants.js: удалить ATTRIBUTES + его экспорт
// 3. moysklad.js: удалить ATTRIBUTES из импорта/экспорта
// 4. order.js: удалить закомментированные блоки + неиспользуемые импорты
// 5. demand.js: удалить закомментированные блоки + неиспользуемые импорты
// 6. return.js: удалить закомментированные блоки + неиспользуемые импорты
// 7. payment.js: удалить закомментированные блоки + неиспользуемые импорты
// 8. cancel.js: удалить закомментированные блоки + неиспользуемые импорты
// 9. docs-generator.js: удалить 'getChannelAttrValue' из списка
// 10. AGENTS.md: удалить раздел Cleanup
// ═══════════════════════════════════════════════════════════════════════════════

let apiInstance = null

function initApi(token) {
  const ms = require('moysklad')
  apiInstance = ms({ token })
  return apiInstance
}

function getApi() {
  if (!apiInstance) {
    throw new Error('API не инициализирован')
  }
  return apiInstance
}

const getATTR_ORDER_CHANNEL = () => ATTRIBUTES.ORDER_CHANNEL
const getATTR_DEMAND_CHANNEL = () => ATTRIBUTES.DEMAND_CHANNEL

// @cleanup 2026-05-20 — функция отключена, всегда возвращает undefined
function getChannelAttrValue(orderFull) {
  // ────────────────────────────────────────────────────────────
  // Закомментировано 2026-05-14 — канал продаж w/o больше не пишем.
  // Раскомментировать для восстановления:
  // ────────────────────────────────────────────────────────────
  // const channelName = orderFull.salesChannel?.name || ''
  // if (channelName.includes('Wildberries') || channelName.includes('WB')) return 'w'
  // if (channelName.includes('Ozon')) return 'o'
  // return 'o' // fallback
  return undefined
}

function getSalesChannelObj(orderFull) {
  if (!orderFull.salesChannel) return undefined
  return { meta: orderFull.salesChannel.meta }
}

module.exports = {
  initApi,
  getApi,
  getATTR_ORDER_CHANNEL,
  getATTR_DEMAND_CHANNEL,
  getChannelAttrValue,
  getSalesChannelObj
}
