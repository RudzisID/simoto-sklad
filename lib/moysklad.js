const { ORDER_STATUS, DEMAND_STATUS, ATTRIBUTES } = require('./constants');

const order = require('./order');
const check = require('./check');
const batch = require('./batch');
const payment = require('./payment');
const demand = require('./demand');
const returnMod = require('./return');
const cancel = require('./cancel');

module.exports = {
    ORDER_STATUS,
    DEMAND_STATUS,
    ATTRIBUTES,
    ...order,
    ...check,
    ...batch,
    ...payment,
    ...demand,
    ...returnMod,
    ...cancel
};