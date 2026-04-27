const { checkNumber } = require('../lib/payment');

jest.mock('../lib/moysklad', () => ({
  initApi: jest.fn(),
  getOrderUrl: jest.fn(),
  findOrderByShipmentNum: jest.fn(),
  getOrderFull: jest.fn(),
  getDemand: jest.fn(),
}));

const moysklad = require('../lib/moysklad');

describe('checkNumber - not found', () => {
  beforeEach(() => {
    moysklad.findOrderByShipmentNum.mockResolvedValue(null);
  });

  test('returns not_found and canCreate false', async () => {
    const res = await checkNumber('SHIP-NF-001');
    expect(res).toHaveProperty('status', 'not_found');
    expect(res).toHaveProperty('canCreate', false);
  });
});
