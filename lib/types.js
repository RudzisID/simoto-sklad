/**
 * @typedef {Object} Order
 * @property {string} id - ID заказа в МойСклад
 * @property {string} name - Название (номер заказа)
 * @property {number} sum - Сумма (в копейках)
 * @property {Object} state - Статус заказа
 * @property {Object} agent - Контрагент
 * @property {Object} organization - Организация
 * @property {Object} organizationAccount - Счёт организации
 * @property {Object} salesChannel - Канал продаж
 * @property {Object[]} demands - Отгрузки
 * @property {Object[]} payments - Платежи
 * @property {string} description - Описание (содержит номер отправления)
 */

/**
 * @typedef {Object} Demand
 * @property {string} id - ID отгрузки
 * @property {string} name - Название
 * @property {number} sum - Сумма (в копейках)
 * @property {number} payedSum - Оплаченная сумма
 * @property {Object} salesChannel - Канал продаж
 * @property {Object} positions - Позиции отгрузки
 * @property {Object} returns - Возвраты
 */

/**
 * @typedef {Object} Payment
 * @property {string} name - Название платежа
 * @property {number} sum - Сумма
 * @property {string} [description] - Описание
 */

/**
 * @typedef {Object} CheckResult
 * @property {string} shipmentNum - Номер отправления
 * @property {string} orderName - Название заказа
 * @property {number} sum - Сумма
 * @property {number} paid - Оплачено
 * @property {string} status - Статус (new, other, no_demand, not_found, cancelled, error)
 * @property {string} statusName - Название статуса
 * @property {boolean} canDemand - Можно создать отгрузку
 * @property {boolean} canPayment - Можно создать платёж
 * @property {boolean} canReturn - Можно создать возврат
 * @property {boolean} canCancel - Можно отменить
 * @property {boolean} hasDemand - Есть отгрузка
 * @property {boolean} hasPayment - Оплачен
 * @property {boolean} hasReturn - Есть возврат
 * @property {boolean} isCancelled - Отменён
 */
