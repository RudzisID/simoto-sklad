const { createDemand } = require('../lib/demand')
const { getApi } = require('../lib/api-utils')
const mockData = require('./mocks/demand_data.json')

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
    getATTR_DEMAND_CHANNEL: jest.fn(() => 'attr-demand-channel-id'),
    getChannelAttrValue: jest.fn(() => 'o')
  }
})

// Mock order module (for getOrderFullForCreate)
jest.mock('../lib/order', () => ({
  getOrderFullForCreate: jest.fn()
}))

describe('demand.js', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('createDemand', () => {
    it('should create demand successfully', async () => {
      const orderFull = mockData.orderFull

      mockApi.GET.mockResolvedValue(mockData.positionsResponse)
      mockApi.POST.mockResolvedValue(mockData.demandResponse)

      const result = await createDemand(orderFull)

      expect(result).toEqual(mockData.demandResponse)
      expect(mockApi.GET).toHaveBeenCalledWith(
        'entity/customerorder/' + orderFull.id + '/positions'
      )
      expect(mockApi.POST).toHaveBeenCalledWith(
        'entity/demand',
        expect.objectContaining({
          customerOrder: { meta: orderFull.meta },
          agent: { meta: orderFull.agent.meta },
          organization: { meta: orderFull.organization.meta },
          store: { meta: orderFull.store.meta }
        })
      )
    })

    it('should throw error if demand already exists', async () => {
      const orderFull = mockData.orderWithDemand

      await expect(createDemand(orderFull)).rejects.toThrow('Отгрузка уже существует')
    })

    it('should handle API errors on GET positions', async () => {
      const orderFull = mockData.orderFull

      mockApi.GET.mockRejectedValue(new Error('API Error'))

      await expect(createDemand(orderFull)).rejects.toThrow('API Error')
    })

    it('should handle API errors on POST demand', async () => {
      const orderFull = mockData.orderFull

      mockApi.GET.mockResolvedValue(mockData.positionsResponse)
      mockApi.POST.mockRejectedValue(new Error('API Error'))

      await expect(createDemand(orderFull)).rejects.toThrow('API Error')
    })

    it('should map positions correctly', async () => {
      const orderFull = mockData.orderFull
      const positions = mockData.positionsResponse

      mockApi.GET.mockResolvedValue(positions)
      mockApi.POST.mockResolvedValue(mockData.demandResponse)

      await createDemand(orderFull)

      const callArgs = mockApi.POST.mock.calls[0][1]
      expect(callArgs.positions).toEqual(
        positions.rows.map((pos) =>
          expect.objectContaining({
            quantity: pos.quantity,
            price: pos.price,
            discount: pos.discount,
            vat: pos.vat,
            vatEnabled: pos.vatEnabled,
            assortment: { meta: pos.assortment.meta }
          })
        )
      )
    })

    it('should include salesChannel if present', async () => {
      const orderFull = mockData.orderFull

      mockApi.GET.mockResolvedValue(mockData.positionsResponse)
      mockApi.POST.mockResolvedValue(mockData.demandResponse)

      await createDemand(orderFull)

      expect(mockApi.POST).toHaveBeenCalledWith(
        'entity/demand',
        expect.objectContaining({
          salesChannel: expect.any(Object)
        })
      )
    })

    it('should include attributes with channel value', async () => {
      const orderFull = mockData.orderFull

      mockApi.GET.mockResolvedValue(mockData.positionsResponse)
      mockApi.POST.mockResolvedValue(mockData.demandResponse)

      await createDemand(orderFull)

      const callArgs = mockApi.POST.mock.calls[0][1]
      expect(callArgs.attributes).toBeDefined()
      expect(callArgs.attributes.length).toBeGreaterThan(0)
    })

    // New test: self-sufficient mode with orderId only
    it('should work with orderId (self-sufficient mode)', async () => {
      // Arrange
      const orderId = mockData.orderFull.id
      const orderFull = mockData.orderFull

      // Mock getOrderFullForCreate to return orderFull
      const { getOrderFullForCreate } = require('../lib/order')
      getOrderFullForCreate.mockResolvedValue(orderFull)

      mockApi.GET.mockResolvedValue(mockData.positionsResponse)
      mockApi.POST.mockResolvedValue(mockData.demandResponse)

      // Act: call with only orderId (self-sufficient mode)
      const result = await createDemand(orderId)

      // Assert: should call getOrderFullForCreate internally
      expect(getOrderFullForCreate).toHaveBeenCalledWith(orderId)

      // Assert: should complete successfully
      expect(result).toEqual(mockData.demandResponse)
    })
  })
})
