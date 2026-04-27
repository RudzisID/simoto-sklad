const { getApi, getSalesChannelObj, getATTR_ORDER_CHANNEL, getATTR_DEMAND_CHANNEL, getChannelAttrValue } = require('./api-utils');
const { STATUS_RETURN_ID, DEMAND_CANCEL_STATE_ID } = require('./constants');

async function createReturn(orderId, orderFull, demandId) {
    const API = getApi();

    if (!demandId) {
        throw new Error('Отгрузка не найдена');
    }

    const demand = await API.GET('entity/demand/' + demandId + '?expand=positions,returns');

    if (demand.returns?.rows?.length > 0) {
        throw new Error('Возврат уже создан');
    }

    const attrValue = getChannelAttrValue(orderFull);

    await API.PUT('entity/customerorder/' + orderId, {
        state: {
            meta: {
                href: `https://api.moysklad.ru/api/remap/1.2/entity/customerorder/metadata/states/${STATUS_RETURN_ID}`,
                type: 'state'
            }
        },
        salesChannel: getSalesChannelObj(orderFull),
        attributes: [
            {
                meta: { href: `https://api.moysklad.ru/api/remap/1.2/entity/customerorder/metadata/attributes/${getATTR_ORDER_CHANNEL()}`, type: 'attributemetadata' },
                id: getATTR_ORDER_CHANNEL(),
                value: attrValue
            }
        ]
    });

    await API.PUT('entity/demand/' + demandId, {
        state: {
            meta: {
                href: `https://api.moysklad.ru/api/remap/1.2/entity/demand/metadata/states/${DEMAND_CANCEL_STATE_ID}`,
                type: 'state'
            }
        },
        salesChannel: getSalesChannelObj(orderFull),
        attributes: [
            {
                meta: { href: `https://api.moysklad.ru/api/remap/1.2/entity/demand/metadata/attributes/${getATTR_DEMAND_CHANNEL()}`, type: 'attributemetadata' },
                id: getATTR_DEMAND_CHANNEL(),
                value: attrValue
            }
        ]
    });

    const salesReturn = await API.POST('entity/salesreturn', {
        demand: { meta: demand.meta },
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
        positions: demand.positions.rows.map(pos => ({
            quantity: pos.quantity,
            price: pos.price,
            vat: pos.vat,
            vatEnabled: pos.vatEnabled,
            assortment: { meta: pos.assortment.meta }
        }))
    });

    return salesReturn;
}

module.exports = { createReturn };