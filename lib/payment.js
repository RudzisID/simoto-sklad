const { getApi, getSalesChannelObj } = require('./api-utils');

async function createPayment(orderFull, demand) {
    // Проверяем существование платежа
    if (demand.payments?.rows?.length > 0) {
        throw new Error('Платёж уже существует');
    }
    
    // Проверяем оплаченность
    if (demand.payedSum >= demand.sum) {
        throw new Error('Отгрузка уже оплачена');
    }

    const API = getApi();
    const payment = await API.POST('entity/paymentin', {
        agent: { meta: orderFull.agent.meta },
        organization: { meta: orderFull.organization.meta },
        sum: demand.sum,
        vatSum: demand.vatSum,
        salesChannel: getSalesChannelObj(orderFull) || (demand.salesChannel ? { meta: demand.salesChannel.meta } : undefined),
        operations: [{
            meta: {
                href: 'https://api.moysklad.ru/api/remap/1.2/entity/customerorder/' + orderFull.id,
                type: 'customerorder',
                mediaType: 'application/json'
            },
            linkedSum: demand.sum
        }],
        description: orderFull.description,
        organizationAccount: { meta: orderFull.organizationAccount.meta }
    });
    return payment;
}

module.exports = { createPayment };