const { getApi, getSalesChannelObj, getATTR_ORDER_CHANNEL, getATTR_DEMAND_CHANNEL, getChannelAttrValue } = require('./api-utils');
const { STATUS_CANCEL_ID, DEMAND_CANCEL_STATE_ID } = require('./constants');

async function cancelOrder(orderId, orderFull, demandId) {
    const API = getApi();
    const attrValue = getChannelAttrValue(orderFull);

    if (demandId) {
        throw new Error('Нельзя отменить — отгрузка уже создана. Используйте возврат.');
    }

    const positions = await API.GET('entity/customerorder/' + orderId + '/positions');
    if (positions.rows && positions.rows.length > 0) {
        await API.POST('entity/customerorder/' + orderId + '/positions/delete', {
            items: positions.rows.map(pos => ({ meta: pos.meta }))
        });
        const positionsToUpdate = positions.rows.map(pos => ({
            quantity: pos.quantity,
            price: pos.price,
            discount: pos.discount,
            vat: pos.vat,
            vatEnabled: pos.vatEnabled,
            assortment: { meta: pos.assortment.meta },
            reserve: 0
        }));
        await API.POST('entity/customerorder/' + orderId + '/positions', positionsToUpdate);
    }

    await API.PUT('entity/customerorder/' + orderId, {
        state: {
            meta: {
                href: `https://api.moysklad.ru/api/remap/1.2/entity/customerorder/metadata/states/${STATUS_CANCEL_ID}`,
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

    if (demandId) {
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
    }

    return { orderId, demandId, status: 'cancelled', reserveCleared: true };
}

module.exports = { cancelOrder };