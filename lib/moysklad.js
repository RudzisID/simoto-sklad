/**
 * @file Barrel-файл для модулей МойСклад.
 * @module moysklad
 * @description Переэкспортирует все функции из модулей lib/ для удобного импорта.
 *              Импортирует константы статусов и все бизнес-модули (order, check,
 *              batch, payment, demand, return, cancel) единым объектом.
 * @see module:lib/constants
 * @see module:lib/order
 * @see module:lib/check
 * @see module:lib/batch
 * @see module:lib/payment
 * @see module:lib/demand
 * @see module:lib/return
 * @see module:lib/cancel
 */

const { ORDER_STATUS, DEMAND_STATUS } = require('./constants')

const order = require('./order')
const check = require('./check')
const batch = require('./batch')
const payment = require('./payment')
const demand = require('./demand')
const returnMod = require('./return')
const cancel = require('./cancel')

module.exports = {
  ORDER_STATUS,
  DEMAND_STATUS,
  ...order,
  ...check,
  ...batch,
  ...payment,
  ...demand,
  ...returnMod,
  ...cancel
}
