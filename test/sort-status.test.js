// Тесты для проверки циклической сортировки по статусу (жизненный цикл)
// Имитируем логику из public/app.js

// Порядок статусов по жизненному циклу
const LIFECYCLE_STATUSES = [
  'Новый',
  'Предложение отправлено',
  'Подтверждён',
  'Оплачен',
  'Частично оплачен',
  'На отправке с отсрочкой платежа',
  'На отправку - оплачен',
  'Собран',
  'Ожидает отгрузки',
  'Сохранено',
  'Отправлен',
  'Доставляется',
  'Доставлен',
  'Отгружен',
  'С отсрочкой',
  'Возврат ожидает',
  'Возврат',
  'Возвращается',
  'Частичная отмена',
  'Отменён',
  'ОЖДАЕТ ОЗОН (КОМПЕНСИРОВАН)'
]

// Получить статусы из жизненного цикла, которые есть в данных
function getLifecycleStatusesTest(ordersData) {
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

// Сортировка с циклическим переключением
function getSortedOrdersTest(ordersData, statusIndex) {
  const lifecycleStatuses = getLifecycleStatusesTest(ordersData)
  const targetStatus = lifecycleStatuses[statusIndex] || ''

  return [...ordersData].sort((a, b) => {
    const getStatusPriority = (statusName) => {
      if (statusName === targetStatus) return 0
      const idx = lifecycleStatuses.indexOf(statusName)
      return idx === -1 ? Number.MAX_SAFE_INTEGER : idx + 1
    }

    const priorityA = getStatusPriority(a.statusName || '')
    const priorityB = getStatusPriority(b.statusName || '')

    if (priorityA < priorityB) return -1
    if (priorityA > priorityB) return 1
    return 0
  })
}

// Тестовые данные (только некоторые статусы для простоты)
const mockOrders = [
  { shipmentNum: '001', statusName: 'Отменён', sum: 1000 },
  { shipmentNum: '002', statusName: 'Новый', sum: 2000 },
  { shipmentNum: '003', statusName: 'Отгружен', sum: 3000 },
  { shipmentNum: '004', statusName: 'Оплачен', sum: 4000 },
  { shipmentNum: '005', statusName: 'Возврат', sum: 5000 },
  { shipmentNum: '006', statusName: 'Частично оплачен', sum: 6000 },
  { shipmentNum: '007', statusName: 'Сохранено', sum: 7000 },
  { shipmentNum: '008', statusName: 'С отсрочкой', sum: 8000 },
  { shipmentNum: '009', statusName: 'Новый', sum: 9000 },
  { shipmentNum: '010', statusName: 'Неизвестный статус', sum: 10000 }
]

describe('Циклическая сортировка по statusName (жизненный цикл)', () => {
  // Порядок статусов в lifecycleStatuses для mockOrders:
  // 0: Новый (индекс 0 в LIFECYCLE_STATUSES)
  // 1: Оплачен (3)
  // 2: Частично оплачен (4)
  // 3: Сохранено (9)
  // 4: Отгружен (13)
  // 5: С отсрочкой (14)
  // 6: Возврат (16)
  // 7: Отменён (19)
  // 8: Неизвестный статус (не в жизненном цикле, в конце)

  describe('Переключение статусов (statusIndex)', () => {
    it('statusIndex=0: наверху "Новый"', () => {
      const sorted = getSortedOrdersTest(mockOrders, 0)
      expect(sorted[0].statusName).toBe('Новый')
      expect(sorted[1].statusName).toBe('Новый')
    })

    it('statusIndex=1: наверху "Оплачен"', () => {
      const sorted = getSortedOrdersTest(mockOrders, 1)
      expect(sorted[0].statusName).toBe('Оплачен')
    })

    it('statusIndex=2: наверху "Частично оплачен"', () => {
      const sorted = getSortedOrdersTest(mockOrders, 2)
      expect(sorted[0].statusName).toBe('Частично оплачен')
    })

    it('statusIndex=3: наверху "Сохранено"', () => {
      const sorted = getSortedOrdersTest(mockOrders, 3)
      expect(sorted[0].statusName).toBe('Сохранено')
    })

    it('statusIndex=4: наверху "Отгружен"', () => {
      const sorted = getSortedOrdersTest(mockOrders, 4)
      expect(sorted[0].statusName).toBe('Отгружен')
    })

    it('statusIndex=7: наверху "Отменён"', () => {
      const sorted = getSortedOrdersTest(mockOrders, 7)
      expect(sorted[0].statusName).toBe('Отменён')
    })

    it('statusIndex=8: наверху "Неизвестный статус"', () => {
      const sorted = getSortedOrdersTest(mockOrders, 8)
      expect(sorted[0].statusName).toBe('Неизвестный статус')
    })
  })

  describe('Циклический переход', () => {
    it('после последнего статуса снова первый', () => {
      const lifecycleStatuses = getLifecycleStatusesTest(mockOrders)
      const lastIndex = lifecycleStatuses.length - 1  // 8
      // После последнего (Неизвестный статус) переходим к первому (Новый)
      const nextIndex = (lastIndex + 1) % lifecycleStatuses.length  // 0
      expect(nextIndex).toBe(0)
      
      const sorted = getSortedOrdersTest(mockOrders, nextIndex)
      expect(sorted[0].statusName).toBe('Новый')
    })
  })

  describe('Неизвестные статусы', () => {
    it('Неизвестный статус всегда в конце (когда не выбран)', () => {
      const sorted = getSortedOrdersTest(mockOrders, 0)  // Выбран Новый
      const lastOrder = sorted[sorted.length - 1]
      expect(lastOrder.statusName).toBe('Неизвестный статус')
    })
  })

  describe('Крайние случаи', () => {
    it('Пустой массив', () => {
      const sorted = getSortedOrdersTest([], 0)
      expect(sorted).toEqual([])
    })

    it('Отсутствие statusName', () => {
      const orders = [
        { shipmentNum: '001', sum: 1000 },
        { shipmentNum: '002', sum: 2000 }
      ]
      const sorted = getSortedOrdersTest(orders, 0)
      // Пустые статусы получат MAX_SAFE_INTEGER, будут в конце
      expect(sorted[0].shipmentNum).toBe('001')
      expect(sorted[1].shipmentNum).toBe('002')
    })

    it('Один статус в данных', () => {
      const orders = [
        { shipmentNum: '001', statusName: 'Новый' },
        { shipmentNum: '002', statusName: 'Новый' }
      ]
      const sorted = getSortedOrdersTest(orders, 0)
      expect(sorted[0].statusName).toBe('Новый')
      expect(sorted[1].statusName).toBe('Новый')
    })
  })

  describe('Интеграция с currentSort (симуляция)', () => {
    it('Должен циклически переключать статусы', () => {
      let statusIndex = 0
      const lifecycleStatuses = getLifecycleStatusesTest(mockOrders)

      // Первый клик - Новый
      let sorted = getSortedOrdersTest(mockOrders, statusIndex)
      expect(sorted[0].statusName).toBe('Новый')

      // Второй клик - Оплачен
      statusIndex = (statusIndex + 1) % lifecycleStatuses.length
      sorted = getSortedOrdersTest(mockOrders, statusIndex)
      expect(sorted[0].statusName).toBe('Оплачен')

      // Третий клик - Частично оплачен
      statusIndex = (statusIndex + 1) % lifecycleStatuses.length
      sorted = getSortedOrdersTest(mockOrders, statusIndex)
      expect(sorted[0].statusName).toBe('Частично оплачен')

      // Четвертый клик - Сохранено
      statusIndex = (statusIndex + 1) % lifecycleStatuses.length
      sorted = getSortedOrdersTest(mockOrders, statusIndex)
      expect(sorted[0].statusName).toBe('Сохранено')
    })
  })
})
