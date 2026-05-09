const { checkOrder } = require('../lib/check')
const mockData = require('./mocks/check_data.json')

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

// Mock order module
jest.mock('../lib/order', () => ({
  findOrderByShipmentNum: jest.fn(),
  getOrderFull: jest.fn(),
  getOrderFullForCreate: jest.fn(),
  getDemand: jest.fn(),
  findSalesReturnsByDemand: jest.fn(),
  findSalesReturnsByDemand_v2: jest.fn()
}))

// Mock constants
jest.mock('../lib/constants', () => ({
  ORDER_STATUS: { DELAYED: 'delayed', SHIPPED: 'shipped', CANCELLED: 'cancelled', RETURN: 'return' },
  DEMAND_STATUS: { CANCELLED: 'cancelled' },
  ATTRIBUTES: { ORDER_CHANNEL: 'attr-order', DEMAND_CHANNEL: 'attr-demand' }
}))

const { findSalesReturnsByDemand_v2 } = require('../lib/order')

const { findOrderByShipmentNum, getOrderFull, getOrderFullForCreate, getDemand } = require('../lib/order')

describe('check.js', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('returnSum calculation', () => {
    it('should calculate returnSum from demand.returns', async () => {
      // Arrange
      const shipmentNum = 'test-001'
      const order = { id: 'order-001', name: 'Test Order' }
      const orderFull = {
        id: 'order-001',
        demands: [{ meta: { href: '.../demand-001' } }],
        state: { meta: { href: '.../metadata/states/return' } }
      }
      const demand = {
        id: 'demand-001',
        sum: 10000,
        payedSum: 0,
        returns: {
          rows: [
            { id: 'return-001', name: 'Return 001', sum: 3000 },
            { id: 'return-002', name: 'Return 002', sum: 2000 }
          ]
        }
      }

      findOrderByShipmentNum.mockResolvedValue(order)
      getOrderFull.mockResolvedValue(orderFull)
      getDemand.mockResolvedValue(demand)

      // Act
      const result = await checkOrder(shipmentNum, jest.fn())

      // Assert: returnSum should be (3000 + 2000) / 100 = 50.00
      expect(result.returnSum).toBe(50.00)
      expect(result.hasReturn).toBe(true)
    })

    it('should calculate returnSum from orderFull.returns if demand.returns is empty', async () => {
      // Arrange
      const shipmentNum = 'test-002'
      const order = { id: 'order-002', name: 'Test Order 2' }
      const orderFull = {
        id: 'order-002',
        demands: [{ meta: { href: '.../demand-002' } }],
        state: { meta: { href: '.../metadata/states/return' } },
        returns: {
          rows: [
            { id: 'return-003', name: 'Return 003', sum: 5000 }
          ]
        }
      }
      const demand = {
        id: 'demand-002',
        sum: 10000,
        payedSum: 0,
        returns: { rows: [] }
      }

      findOrderByShipmentNum.mockResolvedValue(order)
      getOrderFull.mockResolvedValue(orderFull)
      getDemand.mockResolvedValue(demand)

      // Act
      const result = await checkOrder(shipmentNum, jest.fn())

      // Assert: returnSum should be 5000 / 100 = 50.00
      expect(result.returnSum).toBe(50.00)
    })

    it('should return 0 if no returns', async () => {
      // Arrange
      const shipmentNum = 'test-003'
      const order = { id: 'order-003', name: 'Test Order 3' }
      const orderFull = {
        id: 'order-003',
        demands: [{ meta: { href: '.../demand-003' } }],
        state: { name: 'Shipped' }
      }
      const demand = {
        id: 'demand-003',
        sum: 10000,
        payedSum: 0,
        returns: { rows: [] }
      }

      findOrderByShipmentNum.mockResolvedValue(order)
      getOrderFull.mockResolvedValue(orderFull)
      getDemand.mockResolvedValue(demand)

      // Act
      const result = await checkOrder(shipmentNum, jest.fn())

      // Assert
      expect(result.returnSum).toBe(0)
      expect(result.hasReturn).toBe(false)
    })
  })
})
