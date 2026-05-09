/**
 * Утилиты для сортировки заказов
 * Выделено из public/app.js для возможности тестирования
 */

// Жизненный цикл статусов заказов (в порядке следования)
const LIFECYCLE_STATUSES = [
  'Сохранено',
  'Отгрузка создана',
  'Отгружено',
  'Частично оплачен',
  'Оплачен',
  'Возврат',
  'Отменён'
]

/**
 * Получить список статусов в порядке жизненного цикла
 * @param {Array} ordersData - массив заказов
 * @returns {Array} - отсортированный список уникальных статусов
 */
function getLifecycleStatuses(ordersData) {
  const statusSet = new Set()
  ordersData.forEach(order => {
    if (order.statusName) statusSet.add(order.statusName)
  })
  
  // Разделяем на статусы из жизненного цикла и остальные
  const inLifecycle = []
  const notInLifecycle = []
  
  statusSet.forEach(status => {
    if (LIFECYCLE_STATUSES.includes(status)) {
      inLifecycle.push(status)
    } else {
      notInLifecycle.push(status)
    }
  })
  
  // Сортируем статусы из жизненного цикла по порядку в LIFECYCLE_STATUSES
  inLifecycle.sort((a, b) => LIFECYCLE_STATUSES.indexOf(a) - LIFECYCLE_STATUSES.indexOf(b))
  
  // Сортируем остальные статусы по алфавиту
  notInLifecycle.sort((a, b) => a.localeCompare(b, 'ru'))
  
  // Объединяем: сначала жизненный цикл, потом остальные
  return [...inLifecycle, ...notInLifecycle]
}

/**
 * Получить приоритет статуса для сортировки
 * @param {string} statusName - название статуса
 * @param {Array} lifecycleStatuses - список статусов в порядке жизненного цикла
 * @param {string} targetStatus - выбранный статус (который должен быть первым)
 * @returns {number} - приоритет (чем меньше, тем выше в списке)
 */
function getStatusPriority(statusName, lifecycleStatuses, targetStatus) {
  if (statusName === targetStatus) return 0  // Выбранный статус - первый
  const idx = lifecycleStatuses.indexOf(statusName)
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx + 1  // Остальные по порядку
}

/**
 * Преобразовать значение в булево число (0 или 1)
 * @param {*} val - значение любого типа
 * @returns {number} - 1 для true, 0 для false
 */
function getBoolValue(val) {
  if (val === true || val === 1 || val === 'true' || val === '1') return 1
  if (val === false || val === 0 || val === 'false' || val === '0') return 0
  return val ? 1 : 0 // fallback
}

/**
 * Сортировка заказов по указанной колонке
 * @param {Array} ordersData - массив заказов
 * @param {Object} sortConfig - конфигурация сортировки { column, asc, statusIndex }
 * @returns {Array} - новый отсортированный массив заказов
 */
function getSortedOrders(ordersData, sortConfig) {
  const col = sortConfig.column
  const asc = sortConfig.asc

  return [...ordersData].sort((a, b) => {
    let va, vb

    if (col === 'statusName') {
      // Циклическая сортировка по статусу (жизненный цикл)
      const lifecycleStatuses = getLifecycleStatuses(ordersData)
      const targetStatus = lifecycleStatuses[sortConfig.statusIndex] || ''

      // Группируем: выбранный статус наверху, остальные по порядку жизненного цикла
      va = getStatusPriority(a[col] || '', lifecycleStatuses, targetStatus)
      vb = getStatusPriority(b[col] || '', lifecycleStatuses, targetStatus)
    } else if (col === 'hasDemand' || col === 'hasPayment' || col === 'hasReturn' || col === 'isCancelled') {
      // Сортировка по булевым полям: false < true
      va = getBoolValue(a[col])
      vb = getBoolValue(b[col])
    } else if (col === 'sum') {
      va = Number(a.sum) || 0
      vb = Number(b.sum) || 0
    } else {
      va = String(a[col] || '').toLowerCase()
      vb = String(b[col] || '').toLowerCase()
    }

    if (va < vb) return asc ? -1 : 1
    if (va > vb) return asc ? 1 : -1
    return 0
  })
}

module.exports = {
  LIFECYCLE_STATUSES,
  getLifecycleStatuses,
  getStatusPriority,
  getBoolValue,
  getSortedOrders
}
