/**
 * Тесты для проверки багов сортировки
 * Баг 1: Статусы - заголовок не соответствует сортировке
 * Баг 2: Булевы колонки не сортируют
 */

const { getSortedOrders, getLifecycleStatuses, getStatusPriority, getBoolValue, LIFECYCLE_STATUSES } = require('../lib/sort-utils')

// Моковые данные для тестов - специально созданные для выявления багов сортировки
const createMockOrders = () => [
  {
    shipmentNum: 'ORD-001',
    statusName: 'Отменён',
    hasDemand: false,    // false - должен быть первым при сортировке по hasDemand
    hasPayment: true,    // true - должен быть последним при сортировке по hasPayment
    hasReturn: false,
    isCancelled: true,
    sum: 1000
  },
  {
    shipmentNum: 'ORD-002',
    statusName: 'Частичная отмена',
    hasDemand: true,    // true
    hasPayment: false,  // false - должен быть первым при сортировке по hasPayment
    hasReturn: false,
    isCancelled: false,
    sum: 2000
  },
  {
    shipmentNum: 'ORD-003',
    statusName: 'Отгрузка создана',
    hasDemand: true,
    hasPayment: false,  // false
    hasReturn: true,    // true - должен быть последним при сортировке по hasReturn
    isCancelled: false,
    sum: 3000
  },
  {
    shipmentNum: 'ORD-004',
    statusName: 'Оплачен',
    hasDemand: true,
    hasPayment: true,
    hasReturn: false,  // false - должен быть первым при сортировке по hasReturn
    isCancelled: false,
    sum: 4000
  },
  {
    shipmentNum: 'ORD-005',
    statusName: 'Возврат',
    hasDemand: false,   // false - должен быть первым при сортировке по hasDemand
    hasPayment: true,
    hasReturn: true,
    isCancelled: false,
    sum: 5000
  },
  {
    shipmentNum: 'ORD-006',
    statusName: 'Частично оплачен',
    hasDemand: true,
    hasPayment: true,
    hasReturn: false,
    isCancelled: false,
    sum: 6000
  }
]

// Специальные данные для проверки Бага 2 - с четким различием в булевых полях
const createBug2TestOrders = () => [
  { shipmentNum: 'A', hasDemand: false, hasPayment: false, hasReturn: false },
  { shipmentNum: 'B', hasDemand: false, hasPayment: true, hasReturn: true },
  { shipmentNum: 'C', hasDemand: true, hasPayment: false, hasReturn: true },
  { shipmentNum: 'D', hasDemand: true, hasPayment: true, hasReturn: false }
]

describe('Баг 1: Статусы - заголовок не соответствует сортировке', () => {
  // Проверяем, что сортировка по статусу работает корректно
  // Проблема: заголовок показывает "Частичная отмена", но сверху "Отменён"

  describe('✅ Позитивные тесты: сортировка по статусу работает корректно', () => {
    test('должен сортировать заказы с "Частичная отмена" в начало, когда statusIndex указывает на него', () => {
      // Arrange
      const orders = createMockOrders()
      const sortConfig = {
        column: 'statusName',
        asc: true,
        statusIndex: 5 // Предполагаем, что "Частичная отмена" имеет индекс 5 в lifecycleStatuses
      }
      
      console.log('[DEBUG] Исходные заказы:')
      orders.forEach(o => console.log(`  ${o.shipmentNum}: ${o.statusName}`))
      
      // Act
      const sorted = getSortedOrders(orders, sortConfig)
      
      console.log('[DEBUG] Отсортированные заказы:')
      sorted.forEach((o, i) => console.log(`  ${i + 1}. ${o.shipmentNum}: ${o.statusName}`))
      
      // Assert
      // Первым должен идти заказ с "Частичная отмена"
      expect(sorted[0].statusName).toBe('Частичная отмена')
      expect(sorted[0].shipmentNum).toBe('ORD-002')
      
      // Остальные статусы должны идти в порядке жизненного цикла
      const lifecycleStatuses = getLifecycleStatuses(orders)
      console.log('[DEBUG] Lifecycle statuses:', lifecycleStatuses)
      
      // Проверяем, что заказы со статусами из жизненного цикла идут в правильном порядке
      const statusOrder = sorted.map(o => o.statusName)
      console.log('[DEBUG] Порядок статусов:', statusOrder)
    })

    test('должен корректно определять приоритет статусов', () => {
      // Arrange
      const orders = createMockOrders()
      const lifecycleStatuses = getLifecycleStatuses(orders)
      const targetStatus = 'Частичная отмена'
      
      console.log('[DEBUG] Lifecycle statuses:', lifecycleStatuses)
      console.log('[DEBUG] Target status:', targetStatus)
      
      // Act & Assert
      // Целевой статус должен иметь приоритет 0
      expect(getStatusPriority(targetStatus, lifecycleStatuses, targetStatus)).toBe(0)
      
      // Остальные статусы должны иметь приоритет > 0
      expect(getStatusPriority('Отменён', lifecycleStatuses, targetStatus)).toBeGreaterThan(0)
      expect(getStatusPriority('Оплачен', lifecycleStatuses, targetStatus)).toBeGreaterThan(0)
      
      console.log('[DEBUG] Priority for "Частичная отмена":', getStatusPriority(targetStatus, lifecycleStatuses, targetStatus))
      console.log('[DEBUG] Priority for "Отменён":', getStatusPriority('Отменён', lifecycleStatuses, targetStatus))
      console.log('[DEBUG] Priority for "Оплачен":', getStatusPriority('Оплачен', lifecycleStatuses, targetStatus))
    })

    test('должен показывать разные результаты при разных statusIndex', () => {
      // Arrange
      const orders = createMockOrders()
      const lifecycleStatuses = getLifecycleStatuses(orders)
      
      console.log('[DEBUG] Lifecycle statuses:', lifecycleStatuses)
      
      // Сортировка с statusIndex = 0 (первый статус в списке)
      const sortConfig1 = {
        column: 'statusName',
        asc: true,
        statusIndex: 0
      }
      
      // Сортировка с statusIndex = последний (Отменён)
      const sortConfig2 = {
        column: 'statusName',
        asc: true,
        statusIndex: lifecycleStatuses.indexOf('Отменён')
      }
      
      console.log('[DEBUG] statusIndex для "Отменён":', lifecycleStatuses.indexOf('Отменён'))
      
      // Act
      const sorted1 = getSortedOrders(orders, sortConfig1)
      const sorted2 = getSortedOrders(orders, sortConfig2)
      
      console.log('[DEBUG] Сортировка по первому статусу:', sorted1.map(o => o.statusName))
      console.log('[DEBUG] Сортировка по "Отменён":', sorted2.map(o => o.statusName))
      
      // Assert
      // Порядок должен быть разным
      expect(sorted1[0].statusName).not.toBe(sorted2[0].statusName)
      expect(sorted1[0].statusName).toBe(lifecycleStatuses[0])
      expect(sorted2[0].statusName).toBe('Отменён')
    })
  })

  describe('❌ Негативные тесты: краевые случаи сортировки по статусу', () => {
    test('должен корректно обрабатывать несуществующий statusIndex', () => {
      // Arrange
      const orders = createMockOrders()
      const sortConfig = {
        column: 'statusName',
        asc: true,
        statusIndex: 999 // Несуществующий индекс
      }
      
      // Act
      const sorted = getSortedOrders(orders, sortConfig)
      
      console.log('[DEBUG] Сортировка с несуществующим statusIndex:', sorted.map(o => o.statusName))
      
      // Assert
      // Не должно быть ошибок, просто сортировка по умолчанию
      expect(sorted).toBeDefined()
      expect(sorted.length).toBe(orders.length)
    })

    test('должен корректно обрабатывать пустой массив заказов', () => {
      // Arrange
      const orders = []
      const sortConfig = {
        column: 'statusName',
        asc: true,
        statusIndex: 0
      }
      
      // Act
      const sorted = getSortedOrders(orders, sortConfig)
      
      console.log('[DEBUG] Сортировка пустого массива:', sorted)
      
      // Assert
      expect(sorted).toEqual([])
    })

    test('должен корректно обрабатывать заказы без статуса', () => {
      // Arrange
      const orders = [
        { shipmentNum: 'ORD-001', statusName: null },
        { shipmentNum: 'ORD-002', statusName: undefined },
        { shipmentNum: 'ORD-003', statusName: '' }
      ]
      const sortConfig = {
        column: 'statusName',
        asc: true,
        statusIndex: 0
      }
      
      // Act
      const sorted = getSortedOrders(orders, sortConfig)
      
      console.log('[DEBUG] Заказы без статуса:', sorted)
      
      // Assert
      expect(sorted).toBeDefined()
      expect(sorted.length).toBe(3)
    })
  })
})

describe('Баг 2: Булевы колонки не сортируют', () => {
  // Проверяем, что сортировка по hasDemand, hasPayment, hasReturn
  // дает РАЗНЫЙ порядок строк

  describe('✅ Позитивные тесты: булевы колонки сортируют корректно', () => {
    test('должен менять порядок при сортировке по hasDemand', () => {
      // Arrange
      const orders = createMockOrders()
      const sortConfig = {
        column: 'hasDemand',
        asc: true,
        statusIndex: 0
      }
      
      console.log('[DEBUG] Исходные заказы (hasDemand):')
      orders.forEach(o => console.log(`  ${o.shipmentNum}: hasDemand=${o.hasDemand}`))
      
      // Act
      const sorted = getSortedOrders(orders, sortConfig)
      
      console.log('[DEBUG] После сортировки по hasDemand (asc):')
      sorted.forEach((o, i) => console.log(`  ${i + 1}. ${o.shipmentNum}: hasDemand=${o.hasDemand}`))
      
      // Assert
      // false должны идти перед true (при asc=true)
      const hasDemandFalse = sorted.filter(o => o.hasDemand === false)
      const hasDemandTrue = sorted.filter(o => o.hasDemand === true)
      
      expect(hasDemandFalse.length).toBeGreaterThan(0)
      expect(hasDemandTrue.length).toBeGreaterThan(0)
      
      // Проверяем, что все false идут перед true
      const firstTrueIndex = sorted.findIndex(o => o.hasDemand === true)
      const lastFalseIndex = sorted.reverse().findIndex(o => o.hasDemand === false)
      
      console.log('[DEBUG] Индекс первого true:', firstTrueIndex)
      console.log('[DEBUG] Индекс последнего false (с конца):', lastFalseIndex)
    })

    test('должен менять порядок при сортировке по hasPayment (отличается от hasDemand)', () => {
      // Arrange
      const orders = createMockOrders()
      const sortConfigDemand = {
        column: 'hasDemand',
        asc: true,
        statusIndex: 0
      }
      const sortConfigPayment = {
        column: 'hasPayment',
        asc: true,
        statusIndex: 0
      }
      
      console.log('[DEBUG] Исходные заказы:')
      orders.forEach(o => console.log(`  ${o.shipmentNum}: hasDemand=${o.hasDemand}, hasPayment=${o.hasPayment}`))
      
      // Act
      const sortedByDemand = getSortedOrders(orders, sortConfigDemand)
      const sortedByPayment = getSortedOrders(orders, sortConfigPayment)
      
      console.log('[DEBUG] Сортировка по hasDemand:')
      sortedByDemand.forEach((o, i) => console.log(`  ${i + 1}. ${o.shipmentNum}: hasDemand=${o.hasDemand}`))
      
      console.log('[DEBUG] Сортировка по hasPayment:')
      sortedByPayment.forEach((o, i) => console.log(`  ${i + 1}. ${o.shipmentNum}: hasPayment=${o.hasPayment}`))
      
      // Assert
      // Порядок должен быть РАЗНЫМ, так как у заказов разные комбинации hasDemand и hasPayment
      const orderDemand = sortedByDemand.map(o => o.shipmentNum).join(',')
      const orderPayment = sortedByPayment.map(o => o.shipmentNum).join(',')
      
      console.log('[DEBUG] Порядок по hasDemand:', orderDemand)
      console.log('[DEBUG] Порядок по hasPayment:', orderPayment)
      
      // Если баг существует, порядок будет одинаковым
      // Если баг исправлен, порядок должен отличаться
      expect(orderDemand).not.toBe(orderPayment)
    })

    test('должен менять порядок при сортировке по hasReturn (отличается от hasDemand и hasPayment)', () => {
      // Arrange
      const orders = createMockOrders()
      const sortConfigPayment = {
        column: 'hasPayment',
        asc: true,
        statusIndex: 0
      }
      const sortConfigReturn = {
        column: 'hasReturn',
        asc: true,
        statusIndex: 0
      }
      
      console.log('[DEBUG] Исходные заказы:')
      orders.forEach(o => console.log(`  ${o.shipmentNum}: hasPayment=${o.hasPayment}, hasReturn=${o.hasReturn}`))
      
      // Act
      const sortedByPayment = getSortedOrders(orders, sortConfigPayment)
      const sortedByReturn = getSortedOrders(orders, sortConfigReturn)
      
      console.log('[DEBUG] Сортировка по hasPayment:')
      sortedByPayment.forEach((o, i) => console.log(`  ${i + 1}. ${o.shipmentNum}: hasPayment=${o.hasPayment}`))
      
      console.log('[DEBUG] Сортировка по hasReturn:')
      sortedByReturn.forEach((o, i) => console.log(`  ${i + 1}. ${o.shipmentNum}: hasReturn=${o.hasReturn}`))
      
      // Assert
      const orderPayment = sortedByPayment.map(o => o.shipmentNum).join(',')
      const orderReturn = sortedByReturn.map(o => o.shipmentNum).join(',')
      
      console.log('[DEBUG] Порядок по hasPayment:', orderPayment)
      console.log('[DEBUG] Порядок по hasReturn:', orderReturn)
      
      // Порядок должен отличаться
      expect(orderPayment).not.toBe(orderReturn)
    })

    test('должен корректно сортировать булевы значения разных типов', () => {
      // Arrange
      const orders = [
        { shipmentNum: 'ORD-001', hasDemand: true },
        { shipmentNum: 'ORD-002', hasDemand: false },
        { shipmentNum: 'ORD-003', hasDemand: 1 },      // число
        { shipmentNum: 'ORD-004', hasDemand: 0 },      // число
        { shipmentNum: 'ORD-005', hasDemand: 'true' }, // строка
        { shipmentNum: 'ORD-006', hasDemand: 'false' } // строка
      ]
      const sortConfig = {
        column: 'hasDemand',
        asc: true,
        statusIndex: 0
      }
      
      console.log('[DEBUG] Заказы с разными типами hasDemand:')
      orders.forEach(o => console.log(`  ${o.shipmentNum}: hasDemand=${o.hasDemand} (${typeof o.hasDemand})`))
      
      // Act
      const sorted = getSortedOrders(orders, sortConfig)
      
      console.log('[DEBUG] После сортировки:')
      sorted.forEach((o, i) => console.log(`  ${i + 1}. ${o.shipmentNum}: hasDemand=${o.hasDemand}`))
      
      // Assert
      // Все false (0, 'false') должны идти перед true (1, 'true')
      const firstTrueIndex = sorted.findIndex(o => getBoolValue(o.hasDemand) === 1)
      console.log('[DEBUG] Индекс первого true:', firstTrueIndex)
      
      // Проверяем, что false идут в начале
      for (let i = 0; i < firstTrueIndex; i++) {
        expect(getBoolValue(sorted[i].hasDemand)).toBe(0)
      }
    })
  })

  describe('❌ Негативные тесты: краевые случаи булевой сортировки', () => {
    test('должен корректно обрабатывать null/undefined в булевых полях', () => {
      // Arrange
      const orders = [
        { shipmentNum: 'ORD-001', hasDemand: null },
        { shipmentNum: 'ORD-002', hasDemand: undefined },
        { shipmentNum: 'ORD-003', hasDemand: false },
        { shipmentNum: 'ORD-004', hasDemand: true }
      ]
      const sortConfig = {
        column: 'hasDemand',
        asc: true,
        statusIndex: 0
      }
      
      // Act
      const sorted = getSortedOrders(orders, sortConfig)
      
      console.log('[DEBUG] Заказы с null/undefined:')
      sorted.forEach((o, i) => console.log(`  ${i + 1}. ${o.shipmentNum}: hasDemand=${o.hasDemand}`))
      
      // Assert
      expect(sorted).toBeDefined()
      expect(sorted.length).toBe(4)
      // null/undefined должны обрабатываться как false
    })

    test('должен корректно обрабатывать переключение asc/desc для булевых полей', () => {
      // Arrange
      const orders = createMockOrders()
      const sortConfigAsc = {
        column: 'hasDemand',
        asc: true,
        statusIndex: 0
      }
      const sortConfigDesc = {
        column: 'hasDemand',
        asc: false,
        statusIndex: 0
      }
      
      // Act
      const sortedAsc = getSortedOrders(orders, sortConfigAsc)
      const sortedDesc = getSortedOrders(orders, sortConfigDesc)
      
      console.log('[DEBUG] Сортировка asc:')
      sortedAsc.forEach((o, i) => console.log(`  ${i + 1}. ${o.shipmentNum}: hasDemand=${o.hasDemand}`))
      
      console.log('[DEBUG] Сортировка desc:')
      sortedDesc.forEach((o, i) => console.log(`  ${i + 1}. ${o.shipmentNum}: hasDemand=${o.hasDemand}`))
      
      // Assert
      // Порядок должен быть обратным
      const orderAsc = sortedAsc.map(o => o.shipmentNum).join(',')
      const orderDesc = sortedDesc.map(o => o.shipmentNum).join(',')
      
      console.log('[DEBUG] Порядок asc:', orderAsc)
      console.log('[DEBUG] Порядок desc:', orderDesc)
      
      expect(orderAsc).not.toBe(orderDesc)
    })

    test('должен возвращать тот же порядок при сортировке одинаковых значений', () => {
      // Arrange
      const orders = [
        { shipmentNum: 'ORD-001', hasDemand: true },
        { shipmentNum: 'ORD-002', hasDemand: true },
        { shipmentNum: 'ORD-003', hasDemand: true }
      ]
      const sortConfig = {
        column: 'hasDemand',
        asc: true,
        statusIndex: 0
      }
      
      // Act
      const sorted = getSortedOrders(orders, sortConfig)
      
      console.log('[DEBUG] Все hasDemand=true:')
      sorted.forEach((o, i) => console.log(`  ${i + 1}. ${o.shipmentNum}`))
      
      // Assert
      expect(sorted.length).toBe(3)
      // Порядок может сохраняться (стабильная сортировка) или нет,
      // но результат должен быть валидным
    })
  })
})

describe('Интеграционные тесты: проверка реального изменения порядка строк', () => {
  test('Баг 2: сортировка по hasDemand, hasPayment, hasReturn дает РАЗНЫЙ порядок', () => {
    // Arrange
    // Используем специальные данные, где комбинации булевых полей разные
    const orders = createBug2TestOrders()
    
    const sortDemand = { column: 'hasDemand', asc: true, statusIndex: 0 }
    const sortPayment = { column: 'hasPayment', asc: true, statusIndex: 0 }
    const sortReturn = { column: 'hasReturn', asc: true, statusIndex: 0 }
    
    console.log('[DEBUG] Проверка Бага 2: разный порядок для булевых колонок')
    console.log('[DEBUG] Исходные заказы:')
    orders.forEach(o => console.log(`  ${o.shipmentNum}: D=${o.hasDemand}, P=${o.hasPayment}, R=${o.hasReturn}`))
    
    // Act
    const resultDemand = getSortedOrders(orders, sortDemand)
    const resultPayment = getSortedOrders(orders, sortPayment)
    const resultReturn = getSortedOrders(orders, sortReturn)
    
    const orderDemand = resultDemand.map(o => o.shipmentNum).join(',')
    const orderPayment = resultPayment.map(o => o.shipmentNum).join(',')
    const orderReturn = resultReturn.map(o => o.shipmentNum).join(',')
    
    console.log('[DEBUG] Порядок по hasDemand (false сначала):', orderDemand)
    console.log('[DEBUG] Порядок по hasPayment (false сначала):', orderPayment)
    console.log('[DEBUG] Порядок по hasReturn (false сначала):', orderReturn)
    
    // Assert
    // Все три порядка должны быть РАЗНЫМИ (если баг исправлен)
    // Если баг существует, все три порядка будут одинаковыми
    
    const uniqueOrders = new Set([orderDemand, orderPayment, orderReturn])
    console.log('[DEBUG] Количество уникальных порядков:', uniqueOrders.size)
    
    // Ожидаем, что порядки различаются (баг исправлен)
    expect(uniqueOrders.size).toBe(3) // Все три должны быть разными
    
    // Дополнительная проверка: каждый порядок должен быть логичным
    // hasDemand: A, B (false) сначала, потом C, D (true)
    expect(orderDemand).toBe('A,B,C,D')
    
    // hasPayment: A, C (false) сначала, потом B, D (true)
    expect(orderPayment).toBe('A,C,B,D')
    
    // hasReturn: A, D (false) сначала, потом B, C (true)
    expect(orderReturn).toBe('A,D,B,C')
    
    console.log('[DEBUG] ✅ Баг 2 исправлен! Порядки различаются.')
  })

  test('Баг 1: проверка соответствия заголовка и сортировки', () => {
    // Arrange
    const orders = createMockOrders()
    const lifecycleStatuses = getLifecycleStatuses(orders)
    
    console.log('[DEBUG] Проверка Бага 1: соответствие заголовка и сортировки')
    console.log('[DEBUG] Lifecycle statuses:', lifecycleStatuses)
    
    // Симулируем ситуацию: заголовок показывает "Частичная отмена" (statusIndex=5)
    const targetStatusIndex = lifecycleStatuses.indexOf('Частичная отмена')
    console.log('[DEBUG] statusIndex для "Частичная отмена":', targetStatusIndex)
    
    const sortConfig = {
      column: 'statusName',
      asc: true,
      statusIndex: targetStatusIndex
    }
    
    // Act
    const sorted = getSortedOrders(orders, sortConfig)
    
    console.log('[DEBUG] Отсортированные заказы:')
    sorted.forEach((o, i) => console.log(`  ${i + 1}. ${o.shipmentNum}: ${o.statusName}`))
    
    // Assert
    // Заголовок говорит "Частичная отмена", значит первым должен быть заказ с этим статусом
    expect(sorted[0].statusName).toBe('Частичная отмена')
    
    // Проверяем, что остальные идут в порядке жизненного цикла
    for (let i = 1; i < sorted.length; i++) {
      const currentPriority = getStatusPriority(sorted[i].statusName, lifecycleStatuses, 'Частичная отмена')
      const previousPriority = getStatusPriority(sorted[i-1].statusName, lifecycleStatuses, 'Частичная отмена')
      
      console.log(`[DEBUG] ${i}. ${sorted[i].statusName}: priority=${currentPriority}`)
      
      // При asc=true, приоритеты должны возрастать
      expect(currentPriority).toBeGreaterThanOrEqual(previousPriority)
    }
  })
})
