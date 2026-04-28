const { ATTRIBUTES } = require('./constants')

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

function getChannelAttrValue(orderFull) {
  const channelName = orderFull.salesChannel?.name || ''
  if (channelName.includes('Wildberries') || channelName.includes('WB')) return 'w'
  if (channelName.includes('Ozon')) return 'o'
  return 'o' // fallback
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
