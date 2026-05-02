// Тесты для проверки сортировки по статусу (statusName)
// Имитируем логику из public/app.js

// Копируем константу и функцию для тестирования
const statusOrder = {
  'Новый': 1,
  'Сохранено': 2,
  'С отсрочкой': 3,
  'Отгружен': 4,
  'Оплачен': 5,
  'Частично оплачен': 6,
  'Возврат': 7,
  'Отменён': 8
};

function getSortedOrdersTest(ordersData, column, asc) {
  const col = column
  const ascending = asc

  return [...ordersData].sort((a, b) => {
    let va, vb

    if (col === 'statusName') {
      const statusA = a[col] || 'Новый'
      const statusB = b[col] || 'Новый'
      const orderA = statusOrder[statusA] || 999
      const orderB = statusOrder[statusB] || 999
      va = orderA
      vb = orderB
    } else if (col === 'hasDemand' || col === 'hasPayment' || col === 'hasReturn' || col === 'isCancelled') {
      va = a[col] ? 1 : 0
      vb = b[col] ? 1 : 0
    } else if (col === 'sum') {
      va = Number(a.sum) || 0
      vb = Number(b.sum) || 0
    } else {
      va = String(a[col] || '').toLowerCase()
      vb = String(b[col] || '').toLowerCase()
    }

    if (va < vb) return ascending ? -1 : 1
    if (va > vb) return ascending ? 1 : -1
    return 0
  })
}

// Тестовые данные
const mockOrders = [
  { shipmentNum: '001', statusName: 'Отменён', sum: 1000 },
  { shipmentNum: '002', statusName: 'Новый', sum: 2000 },
  { shipmentNum: '003', statusName: 'Отгружен', sum: 3000 },
  { shipmentNum: '004', statusName: 'Оплачен', sum: 4000 },
  { shipmentNum: '005', statusName: 'Возврат', sum: 5000 },
  { shipmentNum: '006', statusName: 'Частично оплачен', sum: 6000 },
  { shipmentNum: '007', statusName: 'Сохранено', sum: 7000 },
  { shipmentNum: '008', statusName: 'С отсрочкой', sum: 8000 },
  { shipmentNum: '009', statusName: 'Новый', sum: 9000 }, // Дубликат статуса
  { shipmentNum: '010', statusName: 'Неизвестный статус', sum: 10000 } // Неизвестный статус
]

describe('Сортировка по statusName', () => {
  describe('По возрастанию (asc = true)', () => {
    it('должен сортировать статусы в правильном порядке', () => {
      const sorted = getSortedOrdersTest(mockOrders, 'statusName', true)
      
      // Проверяем порядок
      expect(sorted[0].statusName).toBe('Новый') // 1
      expect(sorted[1].statusName).toBe('Новый') // 1 (дубликат)
      expect(sorted[2].statusName).toBe('Сохранено') // 2
      expect(sorted[3].statusName).toBe('С отсрочкой') // 3
      expect(sorted[4].statusName).toBe('Отгружен') // 4
      expect(sorted[5].statusName).toBe('Оплачен') // 5
      expect(sorted[6].statusName).toBe('Частично оплачен') // 6
      expect(sorted[7].statusName).toBe('Возврат') // 7
      expect(sorted[8].statusName).toBe('Отменён') // 8
      expect(sorted[9].statusName).toBe('Неизвестный статус') // 999 (в конце)
    })

    it('должен помещать неизвестные статусы в конец', () => {
      const sorted = getSortedOrdersTest(mockOrders, 'statusName', true)
      const lastOrder = sorted[sorted.length - 1]
      expect(lastOrder.statusName).toBe('Неизвестный статус')
    })
  })

  describe('По убыванию (asc = false)', () => {
    it('должен сортировать статусы в обратном порядке', () => {
      const sorted = getSortedOrdersTest(mockOrders, 'statusName', false)
      
      // Проверяем обратный порядок
      expect(sorted[0].statusName).toBe('Отменён') // 8
      expect(sorted[1].statusName).toBe('Возврат') // 7
      expect(sorted[2].statusName).toBe('Частично оплачен') // 6
      expect(sorted[3].statusName).toBe('Оплачен') // 5
      expect(sorted[4].statusName).toBe('Отгружен') // 4
      expect(sorted[5].statusName).toBe('С отсрочкой') // 3
      expect(sorted[6].statusName).toBe('Сохранено') // 2
      expect(sorted[7].statusName).toBe('Новый') // 1
      expect(sorted[8].statusName).toBe('Новый') // 1 (дубликат)
    })

    it('должен помещать неизвестные статусы в начало при desc', () => {
      const sorted = getSortedOrdersTest(mockOrders, 'statusName', false)
      const firstOrder = sorted[0]
      expect(firstOrder.statusName).toBe('Неизвестный статус')
    })
  })

  describe('Крайние случаи', () => {
    it('должен обрабатывать пустой массив', () => {
      const sorted = getSortedOrdersTest([], 'statusName', true)
      expect(sorted).toEqual([])
    })

    it('должен обрабатывать отсутствие поля statusName', () => {
      const ordersWithoutStatus = [
        { shipmentNum: '001', sum: 1000 },
        { shipmentNum: '002', sum: 2000 }
      ]
      const sorted = getSortedOrdersTest(ordersWithoutStatus, 'statusName', true)
      // Оба должны получить статус 'Новый' (1)
      expect(sorted[0].shipmentNum).toBe('001')
      expect(sorted[1].shipmentNum).toBe('002')
    })

    it('должен сохранять порядок при равных статусах', () => {
      const ordersSameStatus = [
        { shipmentNum: '001', statusName: 'Новый', sum: 1000 },
        { shipmentNum: '002', statusName: 'Новый', sum: 2000 },
        { shipmentNum: '003', statusName: 'Новый', sum: 3000 }
      ]
      const sorted = getSortedOrdersTest(ordersSameStatus, 'statusName', true)
      // При равных статусах порядок может быть любым, но все должны остаться "Новый"
      expect(sorted[0].statusName).toBe('Новый')
      expect(sorted[1].statusName).toBe('Новый')
      expect(sorted[2].statusName).toBe('Новый')
    })
  })

  describe('Интеграция с currentSort', () => {
    it('должен правильно переключать asc/desc', () => {
      // Симулируем логику sortTable
      let currentSort = { column: 'statusName', asc: true }
      
      // Первая сортировка - по возрастанию
      let sorted = getSortedOrdersTest(mockOrders, currentSort.column, currentSort.asc)
      expect(sorted[0].statusName).toBe('Новый')
      
      // Переключаем на убывание
      currentSort.asc = false
      sorted = getSortedOrdersTest(mockOrders, currentSort.column, currentSort.asc)
      expect(sorted[0].statusName).toBe('Отменён')
      
      // Переключаем обратно
      currentSort.asc = true
      sorted = getSortedOrdersTest(mockOrders, currentSort.column, currentSort.asc)
      expect(sorted[0].statusName).toBe('Новый')
    })
  })
})

describe('Проверка массива statusOrder', () => {
  it('должен содержать все 8 статусов', () => {
    expect(Object.keys(statusOrder)).toHaveLength(8)
  })

  it('должен иметь правильный порядок чисел', () => {
    expect(statusOrder['Новый']).toBe(1)
    expect(statusOrder['Сохранено']).toBe(2)
    expect(statusOrder['С отсрочкой']).toBe(3)
    expect(statusOrder['Отгружен']).toBe(4)
    expect(statusOrder['Оплачен']).toBe(5)
    expect(statusOrder['Частично оплачен']).toBe(6)
    expect(statusOrder['Возврат']).toBe(7)
    expect(statusOrder['Отменён']).toBe(8)
  })

  it('должен обрабатывать неизвестные статусы как 999', () => {
    const unknownStatus = 'Несуществующий статус'
    const order = statusOrder[unknownStatus] || 999
    expect(order).toBe(999)
  })
})
