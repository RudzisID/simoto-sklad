const { processBatch } = require('../lib/batch')
const mockData = require('./mocks/batch_data.json')

// Mock dependencies
jest.mock('../lib/check', () => ({
  checkOrder: jest.fn()
}))

jest.mock('../lib/order', () => ({
  getOrderFullForCreate: jest.fn(),
  getDemand: jest.fn(),
  changeOrderStatus: jest.fn()
}))

jest.mock('../lib/demand', () => ({
  createDemand: jest.fn()
}))

jest.mock('../lib/payment', () => ({
  createPayment: jest.fn()
}))

jest.mock('../lib/return', () => ({
  createReturn: jest.fn()
}))

jest.mock('../lib/cancel', () => ({
  cancelOrder: jest.fn()
}))

const { checkOrder } = require('../lib/check')
const { getOrderFullForCreate, getDemand, changeOrderStatus } = require('../lib/order')
const { createDemand } = require('../lib/demand')
const { createPayment } = require('../lib/payment')
const { createReturn } = require('../lib/return')
const { cancelOrder } = require('../lib/cancel')

describe('batch.js', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('processBatch', () => {
    describe('check action', () => {
      it('should check orders in parallel batches', async () => {
        const numbers = mockData.numbers
        const action = 'check'
        const log = jest.fn()

        checkOrder.mockImplementation((num, log) => {
          return mockData.checkResults.find((r) => r.shipmentNum === num)
        })

        const result = await processBatch(numbers, action, log)

        expect(result.orders).toHaveLength(3)
        expect(checkOrder).toHaveBeenCalledTimes(3)
      })

      it('should call onProgress callback for each order', async () => {
        const numbers = ['001']
        const action = 'check'
        const log = jest.fn()
        const onProgress = jest.fn()

        checkOrder.mockResolvedValue(mockData.checkResults[0])

        await processBatch(numbers, action, log, onProgress)

        expect(onProgress).toHaveBeenCalledWith(expect.any(Object), 0, 1)
      })

      it('should handle abort during check', async () => {
        // BATCH_CONCURRENCY = 3, нужно больше элементов чтобы прерывание сработало между чанками
        const numbers = ['001', '002', '003', '004', '005', '006']
        const action = 'check'
        const log = jest.fn()
        let chunkCallCount = 0
        const onAbort = jest.fn(() => {
          chunkCallCount++
          return chunkCallCount > 1 // прервать после первого чанка
        })

        checkOrder.mockResolvedValue(mockData.checkResults[0])

        const result = await processBatch(numbers, action, log, null, { onAbort })

        expect(result.aborted).toBe(true)
        expect(result.processed).toBe(3) // только первый чанк (3 элемента)
      })
    })

    describe('demand action', () => {
      it('should create demands for eligible orders', async () => {
        const numbers = ['001']
        const action = 'demand'
        const log = jest.fn()

        checkOrder.mockResolvedValue(mockData.checkResults[0])
        getOrderFullForCreate.mockResolvedValue({ id: 'order-001' })
        createDemand.mockResolvedValue({ name: 'Отгрузка 001' })

        const result = await processBatch(numbers, action, log)

        expect(result.created).toBe(1)
        expect(createDemand).toHaveBeenCalled()
      })

      it('should skip orders that cannot demand', async () => {
        const numbers = ['002']
        const action = 'demand'
        const log = jest.fn()

        checkOrder.mockResolvedValue(mockData.checkResults[1]) // canDemand: false

        const result = await processBatch(numbers, action, log)

        expect(result.skipped).toBe(1)
        expect(createDemand).not.toHaveBeenCalled()
      })
    })

    describe('payment action', () => {
      it('should create payments for eligible orders', async () => {
        const numbers = ['002']
        const action = 'payment'
        const log = jest.fn()

        checkOrder.mockResolvedValue(mockData.checkResults[1]) // canPayment: true
        getOrderFullForCreate.mockResolvedValue({
          id: 'order-002',
          demands: [{ meta: { href: '.../demand-123' } }]
        })
        getDemand.mockResolvedValue({})
        createPayment.mockResolvedValue({ name: 'Платёж 001' })

        const result = await processBatch(numbers, action, log)

        expect(result.created).toBe(1)
        expect(createPayment).toHaveBeenCalled()
      })
    })

    describe('return action', () => {
      it('should create returns for eligible orders', async () => {
        const numbers = ['003']
        const action = 'return'
        const log = jest.fn()

        checkOrder.mockResolvedValue(mockData.checkResults[2]) // canReturn: true
        getOrderFullForCreate.mockResolvedValue({
          id: 'order-003',
          demands: [{ meta: { href: '.../demand-123' } }]
        })
        createReturn.mockResolvedValue({ name: 'Возврат 001' })

        const result = await processBatch(numbers, action, log)

        expect(result.created).toBe(1)
        expect(createReturn).toHaveBeenCalled()
      })
    })

    describe('cancel action', () => {
      it('should cancel eligible orders', async () => {
        const numbers = ['001']
        const action = 'cancel'
        const log = jest.fn()

        checkOrder.mockResolvedValue(mockData.checkResults[0]) // canCancel: true
        getOrderFullForCreate.mockResolvedValue({ id: 'order-001', demands: [] })
        cancelOrder.mockResolvedValue({ status: 'cancelled' })

        const result = await processBatch(numbers, action, log)

        expect(result.created).toBe(1)
        expect(cancelOrder).toHaveBeenCalled()
      })
    })

    it('should handle errors during action execution', async () => {
      const numbers = ['001']
      const action = 'demand'
      const log = jest.fn()

      checkOrder.mockResolvedValue(mockData.checkResults[0])
      getOrderFullForCreate.mockRejectedValue(new Error('API Error'))

      const result = await processBatch(numbers, action, log)

      expect(result.errors).toBe(1)
      expect(result.orders[0].status).toBe('error')
    })

    it('should call onProgress callback after each action', async () => {
      const numbers = ['001']
      const action = 'demand'
      const log = jest.fn()
      const onProgress = jest.fn()

      checkOrder.mockResolvedValue(mockData.checkResults[0])
      getOrderFullForCreate.mockResolvedValue({ id: 'order-001' })
      createDemand.mockResolvedValue({ name: 'Отгрузка 001' })

      await processBatch(numbers, action, log, onProgress)

      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ status: 'created' }), 0, 1)
    })
  })
})
