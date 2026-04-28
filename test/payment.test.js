const { createPayment } = require('../lib/payment')
const { getApi } = require('../lib/api-utils')
const mockData = require('./mocks/payment_data.json')

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
    })
  }
})

// Mock order module (for getOrderFullForCreate and getDemand)
jest.mock('../lib/order', () => ({
  getOrderFullForCreate: jest.fn(),
  getDemand: jest.fn()
}))

describe('payment.js', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('createPayment', () => {
    it('should create payment successfully', async () => {
      const orderFull = mockData.orderFull
      const demand = { ...mockData.demand }

      mockApi.POST.mockResolvedValue(mockData.paymentResponse)

      const result = await createPayment(orderFull, demand)

      expect(result).toEqual(mockData.paymentResponse)
      expect(mockApi.POST).toHaveBeenCalledWith(
        'entity/paymentin',
        expect.objectContaining({
          agent: { meta: orderFull.agent.meta },
          organization: { meta: orderFull.organization.meta },
          sum: demand.sum,
          vatSum: demand.vatSum
        })
      )
    })

    it('should throw error if payment already exists', async () => {
      const orderFull = mockData.orderFull
      const demand = { ...mockData.demandWithPayment }

      await expect(createPayment(orderFull, demand)).rejects.toThrow('Платёж уже существует')
    })

    it('should throw error if demand already paid (payedSum >= sum)', async () => {
      const orderFull = mockData.orderFull
      const demand = { ...mockData.demandAlreadyPaid }

      await expect(createPayment(orderFull, demand)).rejects.toThrow('Отгрузка уже оплачена')
    })

    it('should skip if payedSum equals sum', async () => {
      const orderFull = mockData.orderFull
      const demand = {
        ...mockData.demand,
        payedSum: 10000, // equals sum
        sum: 10000
      }

      await expect(createPayment(orderFull, demand)).rejects.toThrow('Отгрузка уже оплачена')
    })

    it('should handle API errors', async () => {
      const orderFull = mockData.orderFull
      const demand = { ...mockData.demand }

      mockApi.POST.mockRejectedValue(new Error('API Error'))

      await expect(createPayment(orderFull, demand)).rejects.toThrow('API Error')
    })

    it('should include salesChannel if present in order', async () => {
      const orderFull = {
        ...mockData.orderFull,
        salesChannel: mockData.demand.salesChannel
      }
      const demand = { ...mockData.demand }

      mockApi.POST.mockResolvedValue(mockData.paymentResponse)

      await createPayment(orderFull, demand)

      expect(mockApi.POST).toHaveBeenCalledWith(
        'entity/paymentin',
        expect.objectContaining({
          salesChannel: expect.any(Object)
        })
      )
    })

    it('should not include salesChannel if not present in order and demand', async () => {
      const orderFull = { ...mockData.orderFull }
      delete orderFull.salesChannel
      const demand = { ...mockData.demand }
      delete demand.salesChannel

      mockApi.POST.mockResolvedValue(mockData.paymentResponse)

      await createPayment(orderFull, demand)

      const callArgs = mockApi.POST.mock.calls[0][1]
      expect(callArgs.salesChannel).toBeUndefined()
    })

    it('should include description from order', async () => {
      const orderFull = mockData.orderFull
      const demand = { ...mockData.demand }

      mockApi.POST.mockResolvedValue(mockData.paymentResponse)

      await createPayment(orderFull, demand)

      expect(mockApi.POST).toHaveBeenCalledWith(
        'entity/paymentin',
        expect.objectContaining({
          description: orderFull.description
        })
      )
    })

    // New test: self-sufficient mode with orderId only
    it('should work with orderId (self-sufficient mode)', async () => {
      // Arrange
      const orderId = mockData.orderFull.id
      const orderFull = {
        ...mockData.orderFull,
        demands: [{ meta: { href: 'https://api.moysklad.ru/api/remap/1.2/entity/demand/demand-123' } }]
      }
      const demand = { ...mockData.demand }

      // Mock getOrderFullForCreate to return orderFull with demands
      const { getOrderFullForCreate, getDemand } = require('../lib/order')
      getOrderFullForCreate.mockResolvedValue(orderFull)
      getDemand.mockResolvedValue(demand)

      mockApi.POST.mockResolvedValue(mockData.paymentResponse)

      // Act: call with only orderId (self-sufficient mode)
      const result = await createPayment(orderId)

      // Assert: should call getOrderFullForCreate internally
      expect(getOrderFullForCreate).toHaveBeenCalledWith(orderId)

      // Assert: should call getDemand to fetch demand
      expect(getDemand).toHaveBeenCalled()

      // Assert: should complete successfully
      expect(result).toEqual(mockData.paymentResponse)
    })
  })
})
