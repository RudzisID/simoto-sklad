// Константы для МойСклад API
// Все UUID статусов и атрибутов в одном месте

// Статусы заказов
const ORDER_STATUS = {
    // Статус "На отправке с отсрочкой"
    DELAYED: '91cb9364-d7c5-11ed-0a80-05b5003aa5c4',
    // Статус "Отгружен"
    SHIPPED: 'e98e02bb-b1c2-11ed-0a80-004e000a8440',
    // Статус "Возврат"
    RETURN: '444c3246-91e8-11f0-0a80-11be007306ce',
    // Статус "Отменён"
    CANCELLED: 'fb56e2b4-2e58-11e6-8a84-bae50000006f'
};

// Статусы отгрузок
const DEMAND_STATUS = {
    // Статус отменённой отгрузки
    CANCELLED: 'b1de4f91-a3ca-11ee-0a80-1547000a8e4c'
};

// ID атрибутов (для полей канала продаж)
const ATTRIBUTES = {
    // Канал продаж в заказе
    ORDER_CHANNEL: 'ec686189-d214-11ed-0a80-0d7d00353a4e',
    // Канал продаж в отгрузке
    DEMAND_CHANNEL: 'eff314b1-d222-11ed-0a80-01240038ac64'
};

module.exports = {
    ORDER_STATUS,
    DEMAND_STATUS,
    ATTRIBUTES
};