const { createPartialPayment } = require('../lib/payment')
const { getApi } = require('../lib/api-utils')
const mockData = require('./mocks/partial_payment_data.json')

// Mock moysklad
jest.mock('moysklad', () => {
  const mockApi = {
    GET: jest.fn(),
    POST: jest.fn(),
    PUT: jest.fn()
  }
  const ms = jest.fn(() => mockApi)
  ms.mockApi = mockApi
  return ms
})

const moysklad = require('moysklad')
const mockApi = moysklad.mockApi

// Mock api-utils
jest.mock('../lib/api-utils', () => {
  const original = jest.requireActual('../lib/api-utils')
  return {
    ...original,
    getApi: jest.fn(() => mockApi),
    getSalesChannelObj: jest.fn((orderFull) => {
      if (!orderFull.salesChannel) return undefined
      return { meta: orderFull.salesChannel.meta }
    }),
    getATTR_ORDER_CHANNEL: jest.fn(() => 'attr-order-123'),
    getChannelAttrValue: jest.fn(() => 'w')
  }
})

// Mock order module
jest.mock('../lib/order', () => ({
  getOrderFullForCreate: jest.fn(),
  getDemand: jest.fn()
}))

describe('createPartialPayment', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('when demand has partial return', () => {
    it('should create payment with sum = demand.sum - return.sum', async () => {
      // Arrange
      const orderFull = { ...mockData.orderFull }
      const demand = { ...mockData.demandWithPartialReturn }
      
      // Mock GET to return demand with returns
      mockApi.GET.mockResolvedValue(demand)
      
      // Mock POST to return payment
      mockApi.POST.mockResolvedValue(mockData.partialPaymentResponse)

      // Act
      const result = await createPartialPayment(orderFull, demand.id)

      // Assert: payment sum should be 10000 - 3000 = 7000
      expect(mockApi.POST).toHaveBeenCalledWith(
        'entity/paymentin',
        expect.objectContaining({
          sum: 7000, // 10000 - 3000
          vatSum: expect.any(Number) // Should be proportional: 2000 * (7000/10000) = 1400
        })
      )
      expect(result.paymentSum).toBe(70.00) // 7000 kopeks = 70.00 rubles
    })

    it('should calculate proportional VAT correctly', async () => {
      const orderFull = { ...mockData.orderFull }
      const demand = { ...mockData.demandWithPartialReturn }
      
      mockApi.GET.mockResolvedValue(demand)
      mockApi.POST.mockResolvedValue(mockData.partialPaymentResponse)

      await createPartialPayment(orderFull, demand.id)

      const callArgs = mockApi.POST.mock.calls[0][1]
      // VAT should be: 2000 * (7000/10000) = 1400
      expect(callArgs.vatSum).toBe(1400)
    })
  })

  describe('when demand has full return', () => {
    it('should throw error if return sum >= demand sum', async () => {
      const orderFull = { ...mockData.orderFull }
      const demand = { ...mockData.demandWithFullReturn }
      
      mockApi.GET.mockResolvedValue(demand)

      await expect(createPartialPayment(orderFull, demand.id))
        .rejects.toThrow('Полный возврат — нечего оплачивать')
    })
  })

  describe('when demand has multiple returns', () => {
    it('should sum all returns and subtract from demand sum', async () => {
      const orderFull = { ...mockData.orderFull }
      const demand = { ...mockData.demandWithMultipleReturns }
      
      mockApi.GET.mockResolvedValue(demand)
      mockApi.POST.mockResolvedValue(mockData.partialPaymentResponse)

      const result = await createPartialPayment(orderFull, demand.id)

      // Total returns: 5000 + 3000 = 8000
      // Payment sum: 15000 - 8000 = 7000
      expect(mockApi.POST).toHaveBeenCalledWith(
        'entity/paymentin',
        expect.objectContaining({
          sum: 7000
        })
      )
    })
  })

  describe('when no returns', () => {
    it('should create payment with full demand sum (like regular payment)', async () => {
      const orderFull = { ...mockData.orderFull }
      const demand = { 
        ...mockData.demandWithPartialReturn,
        returns: { rows: [] } // No returns
      }
      
      mockApi.GET.mockResolvedValue(demand)
      mockApi.POST.mockResolvedValue(mockData.partialPaymentResponse)

      const result = await createPartialPayment(orderFull, demand.id)

      expect(mockApi.POST).toHaveBeenCalledWith(
        'entity/paymentin',
        expect.objectContaining({
          sum: 10000 // Full demand sum
        })
      )
    })
  })

  describe('when payment already exists', () => {
    it('should throw error if demand has payments', async () => {
      const orderFull = { ...mockData.orderFull }
      const demandWithPayment = {
        ...mockData.demandWithPartialReturn,
        payments: { rows: [{ meta: { href: '...' } }] }
      }
      
      // Mock GET to return demand with payments
      mockApi.GET.mockResolvedValue(demandWithPayment)
      
      await expect(createPartialPayment(orderFull, demandWithPayment.id))
        .rejects.toThrow('Платёж уже существует')
    })
  })

  describe('self-sufficient mode', () => {
    it('should work with orderId only', async () => {
      const orderId = 'order-456'
      const orderFull = { 
        ...mockData.orderFull,
        demands: [{ meta: { href: 'https://api.moysklad.ru/api/remap/1.2/entity/demand/demand-456' } }]
      }
      const demandWithNoPayments = {
        ...mockData.demandWithPartialReturn,
        payments: { rows: [] } // Explicitly no payments
      }
      
      const { getOrderFullForCreate } = require('../lib/order')
      getOrderFullForCreate.mockResolvedValue(orderFull)
      
      // Mock GET to return demand without payments
      mockApi.GET.mockImplementation((url) => {
        if (url.includes('demand')) {
          return Promise.resolve(demandWithNoPayments)
        }
        return Promise.resolve({})
      })
      
      mockApi.POST.mockResolvedValue(mockData.partialPaymentResponse)

      const result = await createPartialPayment(orderId)

      expect(getOrderFullForCreate).toHaveBeenCalledWith(orderId)
      expect(result).toEqual(expect.objectContaining({ paymentSum: expect.any(Number) }))
    })
  })
})
