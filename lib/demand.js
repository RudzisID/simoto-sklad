const { getApi, getSalesChannelObj, getATTR_DEMAND_CHANNEL, getChannelAttrValue } = require('./api-utils');

async function createDemand(orderFull) {
    const API = getApi();

    if (orderFull.demands && orderFull.demands.length > 0) {
        throw new Error('Отгрузка уже существует');
    }

    const positions = await API.GET('entity/customerorder/' + orderFull.id + '/positions');
    const attrValue = getChannelAttrValue(orderFull);

    const demand = await API.POST('entity/demand', {
        customerOrder: { meta: orderFull.meta },
        agent: { meta: orderFull.agent.meta },
        organization: { meta: orderFull.organization.meta },
        store: { meta: orderFull.store.meta },
        salesChannel: getSalesChannelObj(orderFull),
        attributes: [
            {
                meta: { href: `https://api.moysklad.ru/api/remap/1.2/entity/demand/metadata/attributes/${getATTR_DEMAND_CHANNEL()}`, type: 'attributemetadata' },
                id: getATTR_DEMAND_CHANNEL(),
                value: attrValue
            }
        ],
        positions: positions.rows.map(pos => ({
            quantity: pos.quantity,
            price: pos.price,
            discount: pos.discount,
            vat: pos.vat,
            vatEnabled: pos.vatEnabled,
            assortment: { meta: pos.assortment.meta }
        }))
    });

    return demand;
}

module.exports = { createDemand };