const { cancelOrder } = require('../lib/cancel')
const { getApi } = require('../lib/api-utils')
const mockData = require('./mocks/cancel_data.json')

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
    getATTR_ORDER_CHANNEL: jest.fn(() => 'attr-order-channel-id'),
    getATTR_DEMAND_CHANNEL: jest.fn(() => 'attr-demand-channel-id'),
    getChannelAttrValue: jest.fn(() => 'o')
  }
})

// Mock constants
jest.mock('../lib/constants', () => ({
  ORDER_STATUS: {
    CANCELLED: 'status-cancel-id'
  },
  DEMAND_STATUS: {
    CANCELLED: 'demand-cancel-state-id'
  }
}))

// Mock order module (for getOrderFullForCreate)
jest.mock('../lib/order', () => ({
  getOrderFullForCreate: jest.fn()
}))

describe('cancel.js', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('cancelOrder', () => {
    it('should cancel order successfully without demand', async () => {
      // Arrange
      const orderId = mockData.orderId
      const orderFull = mockData.orderFull
      const demandId = null

      mockApi.GET.mockResolvedValue(mockData.positionsResponse)
      mockApi.POST.mockResolvedValue({})
      mockApi.PUT.mockResolvedValue({})

      // Act
      const result = await cancelOrder(orderId, orderFull, demandId)

      // Assert - check result structure
      expect(result).toEqual({
        orderId,
        demandId,
        status: 'cancelled',
        reserveCleared: true
      })

      // Assert - verify PUT was called with correct endpoint
      expect(mockApi.PUT).toHaveBeenCalledWith(
        'entity/customerorder/' + orderId,
        expect.objectContaining({
          state: expect.any(Object),
          salesChannel: expect.any(Object),
          attributes: expect.arrayContaining([
            expect.objectContaining({
              id: 'attr-order-channel-id',
              value: 'o'
            })
          ])
        })
      )
    })

    it('should throw error if demand exists (cancel not allowed)', async () => {
      const orderId = mockData.orderWithDemand.id
      const orderFull = mockData.orderFull
      const demandId = 'demand-123'

      await expect(cancelOrder(orderId, orderFull, demandId)).rejects.toThrow(
        'Нельзя отменить — отгрузка уже создана. Используйте возврат.'
      )
    })

    it('should clear reserves when cancelling', async () => {
      const orderId = mockData.orderId
      const orderFull = mockData.orderFull
      const demandId = null

      const positionsWithReserve = {
        rows: mockData.positionsResponse.rows.map((pos) => ({ ...pos, reserve: 2 }))
      }

      mockApi.GET.mockResolvedValue(positionsWithReserve)
      mockApi.POST.mockResolvedValue({})
      mockApi.PUT.mockResolvedValue({})

      await cancelOrder(orderId, orderFull, demandId)

      // Should update positions with reserve = 0 (simplified logic)
      expect(mockApi.POST).toHaveBeenCalledWith(
        'entity/customerorder/' + orderId + '/positions',
        expect.arrayContaining([
          expect.objectContaining({ reserve: 0 })
        ])
      )
    })

    it('should not update demand status if no demandId', async () => {
      const orderId = mockData.orderId
      const orderFull = mockData.orderFull
      const demandId = null

      mockApi.GET.mockResolvedValue(mockData.positionsResponse)
      mockApi.POST.mockResolvedValue({})
      mockApi.PUT.mockResolvedValue({})

      await cancelOrder(orderId, orderFull, demandId)

      // PUT should only be called once (for order), not for demand
      expect(mockApi.PUT).toHaveBeenCalledTimes(1)
    })

    it('should handle API errors', async () => {
      const orderId = mockData.orderId
      const orderFull = mockData.orderFull
      const demandId = null

      mockApi.GET.mockRejectedValue(new Error('API Error'))

      await expect(cancelOrder(orderId, orderFull, demandId)).rejects.toThrow('API Error')
    })

    it('should handle empty positions', async () => {
      const orderId = mockData.orderId
      const orderFull = mockData.orderFull
      const demandId = null

      mockApi.GET.mockResolvedValue({ rows: [] })
      mockApi.PUT.mockResolvedValue({})

      const result = await cancelOrder(orderId, orderFull, demandId)

      expect(result.status).toBe('cancelled')
      // Should not call POST for positions if empty
      expect(mockApi.POST).not.toHaveBeenCalledWith(
        'entity/customerorder/' + orderId + '/positions/delete',
        expect.any(Object)
      )
    })

    // New test: self-sufficient mode with orderId only
    it('should work with orderId (self-sufficient mode)', async () => {
      // Arrange
      const orderId = mockData.orderId
      const orderFull = mockData.orderFull

      // Mock getOrderFullForCreate to return orderFull
      const { getOrderFullForCreate } = require('../lib/order')
      getOrderFullForCreate.mockResolvedValue(orderFull)

      mockApi.GET.mockResolvedValue(mockData.positionsResponse)
      mockApi.POST.mockResolvedValue({})
      mockApi.PUT.mockResolvedValue({})

      // Act: call with only orderId (self-sufficient mode)
      const result = await cancelOrder(orderId)

      // Assert: should call getOrderFullForCreate internally
      expect(getOrderFullForCreate).toHaveBeenCalledWith(orderId)

      // Assert: should complete successfully
      expect(result).toEqual({
        orderId,
        demandId: undefined,
        status: 'cancelled',
        reserveCleared: true
      })
    })
  })
})
