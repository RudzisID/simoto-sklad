const { checkNumber } = require('../lib/payment');

jest.mock('../lib/moysklad', () => ({
  initApi: jest.fn(),
  getOrderUrl: jest.fn(),
  findOrderByShipmentNum: jest.fn(),
  getOrderFull: jest.fn(),
  getDemand: jest.fn(),
}));

const moysklad = require('../lib/moysklad');

describe('checkNumber - real statuses', () => {
  beforeEach(() => {
    moysklad.findOrderByShipmentNum.mockResolvedValue({ id: 'order-1', name: 'Order 1' });
    moysklad.getDemand.mockResolvedValue({ sum: 1000, payedSum: 0 });
  });

  test('delayed status', async () => {
    moysklad.getOrderFull.mockResolvedValue({
      id: 'order-1',
      name: 'Order 1',
      state: { meta: { href: 'https://api/moysklad/states/91cb9364-d7c5-11ed-0a80-05b5003aa5c4' }, name: 'На отправке с отсрочкой' },
      demands: [{ meta: { href: '/demand/1' } }]
    });

    const res = await checkNumber('SHIP-DEL-REAL');
    expect(res.status).toBe('delayed');
  });

  test('shipped status', async () => {
    moysklad.getOrderFull.mockResolvedValue({
      id: 'order-1',
      name: 'Order 1',
      state: { meta: { href: 'https://api/moysklad/states/e98e02bb-b1c2-11ed-0a80-004e000a8440' }, name: 'Отгружен' },
      demands: [{ meta: { href: '/demand/1' } }]
    });
    const res = await checkNumber('SHIP-SHIP-REAL');
    expect(res.status).toBe('shipped');
  });

  test('already paid', async () => {
    moysklad.getOrderFull.mockResolvedValue({
      id: 'order-1',
      name: 'Order 1',
      demands: [{ meta: { href: '/demand/1' } }]
    });
    moysklad.getDemand.mockResolvedValue({ sum: 500, payedSum: 500 });
    const res = await checkNumber('SHIP-PAID-REAL');
    // статус может остаться как 'other', но canCreate должно стать false
    expect(res.canCreate).toBe(false);
  });
});
