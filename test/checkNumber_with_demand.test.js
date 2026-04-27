const { checkNumber } = require('../lib/payment');

jest.mock('../lib/moysklad', () => ({
  initApi: jest.fn(),
  getOrderUrl: jest.fn(),
  findOrderByShipmentNum: jest.fn(),
  getOrderFull: jest.fn(),
  getDemand: jest.fn(),
}));

const moysklad = require('../lib/moysklad');

describe('checkNumber - with demand', () => {
  beforeEach(() => {
    moysklad.findOrderByShipmentNum.mockResolvedValue({ id: 'order-1', name: 'Order 1' });
    moysklad.getOrderFull.mockResolvedValue({
      id: 'order-1',
      name: 'Order 1',
      demands: [{ meta: { href: '/demand/1' } }],
      state: { meta: { href: '/states/other' }, name: 'Другой' },
      meta: { href: '/order/1' }
    });
    moysklad.getDemand.mockResolvedValue({ sum: 1000, payedSum: 0 });
  });

  test('returns with canCreate true and correct sums', async () => {
    const res = await checkNumber('SHIP-DEM-001');
    expect(res).toHaveProperty('canCreate', true);
    // сумма отгрузки = 1000 / 100 = 10
    expect(res).toHaveProperty('sum', 10);
    expect(res).toHaveProperty('paid', 0);
  });
});
