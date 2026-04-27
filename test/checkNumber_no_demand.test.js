const { checkNumber } = require('../lib/payment');

jest.mock('../lib/moysklad', () => ({
  initApi: jest.fn(),
  getOrderUrl: jest.fn(),
  findOrderByShipmentNum: jest.fn(),
  getOrderFull: jest.fn(),
  getDemand: jest.fn(),
}));

const moysklad = require('../lib/moysklad');

describe('checkNumber - no demand', () => {
  beforeEach(() => {
    moysklad.findOrderByShipmentNum.mockResolvedValue({ id: 'order-1', name: 'Order 1' });
    moysklad.getOrderFull.mockResolvedValue({ id: 'order-1', name: 'Order 1', demands: [] });
  });

  test('returns no_demand and canCreate false', async () => {
    const res = await checkNumber('SHIP-NO-DEM');
    expect(res).toHaveProperty('status', 'no_demand');
    expect(res).toHaveProperty('canCreate', false);
  });
});
