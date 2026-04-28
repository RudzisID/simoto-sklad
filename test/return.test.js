const { createReturn } = require('../lib/return')
const { getApi } = require('../lib/api-utils')
const mockData = require('./mocks/return_data.json')

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
    getChannelAttrValue: jest.fn(() => 'w')
  }
})

// Mock constants
jest.mock('../lib/constants', () => ({
  ORDER_STATUS: {
    RETURN: 'status-return-id'
  },
  DEMAND_STATUS: {
    CANCELLED: 'demand-cancel-state-id'
  }
}))

// Mock order module (for getOrderFullForCreate)
jest.mock('../lib/order', () => ({
  getOrderFullForCreate: jest.fn()
}))

describe('return.js', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('createReturn', () => {
    it('should create return successfully', async () => {
      const orderId = mockData.orderId
      const orderFull = mockData.orderFull
      const demandId = mockData.demandId

      mockApi.GET.mockResolvedValue(mockData.demand)
      mockApi.PUT.mockResolvedValue({})
      mockApi.POST.mockResolvedValue(mockData.salesReturnResponse)

      const result = await createReturn(orderId, orderFull, demandId)

      expect(result).toEqual(mockData.salesReturnResponse)
      expect(mockApi.GET).toHaveBeenCalledWith(
        'entity/demand/' + demandId + '?expand=positions,returns'
      )
      expect(mockApi.PUT).toHaveBeenCalledTimes(2) // order + demand
      expect(mockApi.POST).toHaveBeenCalledWith('entity/salesreturn', expect.any(Object))
    })

    it('should throw error if demandId is not provided', async () => {
      const orderId = mockData.orderId
      const orderFull = mockData.orderFull
      const demandId = null

      await expect(createReturn(orderId, orderFull, demandId)).rejects.toThrow(
        'Отгрузка не найдена'
      )
    })

    it('should throw error if return already exists', async () => {
      const orderId = mockData.orderId
      const orderFull = mockData.orderFull
      const demandId = mockData.demandId

      mockApi.GET.mockResolvedValue(mockData.demandWithReturn)

      await expect(createReturn(orderId, orderFull, demandId)).rejects.toThrow(
        'Возврат уже создан'
      )
    })

    it('should update order status to return', async () => {
      const orderId = mockData.orderId
      const orderFull = mockData.orderFull
      const demandId = mockData.demandId

      mockApi.GET.mockResolvedValue(mockData.demand)
      mockApi.PUT.mockResolvedValue({})
      mockApi.POST.mockResolvedValue(mockData.salesReturnResponse)

      await createReturn(orderId, orderFull, demandId)

      expect(mockApi.PUT).toHaveBeenCalledWith(
        'entity/customerorder/' + orderId,
        expect.objectContaining({
          state: expect.any(Object)
        })
      )
    })

    it('should update demand status to cancelled', async () => {
      const orderId = mockData.orderId
      const orderFull = mockData.orderFull
      const demandId = mockData.demandId

      mockApi.GET.mockResolvedValue(mockData.demand)
      mockApi.PUT.mockResolvedValue({})
      mockApi.POST.mockResolvedValue(mockData.salesReturnResponse)

      await createReturn(orderId, orderFull, demandId)

      expect(mockApi.PUT).toHaveBeenCalledWith(
        'entity/demand/' + demandId,
        expect.objectContaining({
          state: expect.any(Object)
        })
      )
    })

    it('should map demand positions to return positions', async () => {
      const orderId = mockData.orderId
      const orderFull = mockData.orderFull
      const demandId = mockData.demandId

      mockApi.GET.mockResolvedValue(mockData.demand)
      mockApi.PUT.mockResolvedValue({})
      mockApi.POST.mockResolvedValue(mockData.salesReturnResponse)

      await createReturn(orderId, orderFull, demandId)

      const postCall = mockApi.POST.mock.calls.find((call) => call[0] === 'entity/salesreturn')
      expect(postCall[1].positions).toEqual(
        mockData.demand.positions.rows.map((pos) =>
          expect.objectContaining({
            quantity: pos.quantity,
            price: pos.price,
            vat: pos.vat,
            vatEnabled: pos.vatEnabled,
            assortment: { meta: pos.assortment.meta }
          })
        )
      )
    })

    it('should handle API errors', async () => {
      const orderId = mockData.orderId
      const orderFull = mockData.orderFull
      const demandId = mockData.demandId

      mockApi.GET.mockRejectedValue(new Error('API Error'))

      await expect(createReturn(orderId, orderFull, demandId)).rejects.toThrow('API Error')
    })

    // New test: self-sufficient mode with orderId only
    it('should work with orderId (self-sufficient mode)', async () => {
      // Arrange
      const orderId = mockData.orderId
      const orderFull = {
        ...mockData.orderFull,
        demands: [{ meta: { href: `https://api.moysklad.ru/api/remap/1.2/entity/demand/${mockData.demandId}` } }]
      }

      // Mock getOrderFullForCreate to return orderFull with demands
      const { getOrderFullForCreate } = require('../lib/order')
      getOrderFullForCreate.mockResolvedValue(orderFull)

      mockApi.GET.mockResolvedValue(mockData.demand)
      mockApi.PUT.mockResolvedValue({})
      mockApi.POST.mockResolvedValue(mockData.salesReturnResponse)

      // Act: call with only orderId (self-sufficient mode)
      const result = await createReturn(orderId)

      // Assert: should call getOrderFullForCreate internally
      expect(getOrderFullForCreate).toHaveBeenCalledWith(orderId)

      // Assert: should complete successfully
      expect(result).toEqual(mockData.salesReturnResponse)
    })

    // New test: verify metadata/states/ path is used (not metadata/attributes/)
    it('should use correct metadata/states/ path for order status update', async () => {
      // Arrange
      const orderId = mockData.orderId
      const orderFull = mockData.orderFull
      const demandId = mockData.demandId

      mockApi.GET.mockResolvedValue(mockData.demand)
      mockApi.PUT.mockResolvedValue({})
      mockApi.POST.mockResolvedValue(mockData.salesReturnResponse)

      // Act
      await createReturn(orderId, orderFull, demandId)

      // Assert: check that PUT was called with correct state href containing metadata/states/
      const putCalls = mockApi.PUT.mock.calls
      const orderStatusUpdateCall = putCalls.find(call => call[0].includes('customerorder'))
      
      expect(orderStatusUpdateCall).toBeDefined()
      expect(orderStatusUpdateCall[1].state.meta.href).toMatch(/metadata\/states\//)
      expect(orderStatusUpdateCall[1].state.meta.href).not.toMatch(/metadata\/attributes\//)
    })

    // New test: verify metadata/states/ path for demand status update
    it('should use correct metadata/states/ path for demand status update', async () => {
      // Arrange
      const orderId = mockData.orderId
      const orderFull = mockData.orderFull
      const demandId = mockData.demandId

      mockApi.GET.mockResolvedValue(mockData.demand)
      mockApi.PUT.mockResolvedValue({})
      mockApi.POST.mockResolvedValue(mockData.salesReturnResponse)

      // Act
      await createReturn(orderId, orderFull, demandId)

      // Assert: check that PUT was called with correct state href containing metadata/states/
      const putCalls = mockApi.PUT.mock.calls
      const demandStatusUpdateCall = putCalls.find(call => call[0].includes('demand'))
      
      expect(demandStatusUpdateCall).toBeDefined()
      expect(demandStatusUpdateCall[1].state.meta.href).toMatch(/metadata\/states\//)
      expect(demandStatusUpdateCall[1].state.meta.href).not.toMatch(/metadata\/attributes\//)
    })
  })
})
