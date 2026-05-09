/**
 * Regression tests for the carrier-picker variant of single-order
 * planning. The bug: OrderDetailScreen's "Plan" button only ever
 * showed one carrier in the confirm Alert (the cheapest), so users
 * couldn't pick from the rest of the rated carriers on the lane.
 *
 * The service-layer fix:
 *   - `rateAllCarriersForOrder` calls `BulkPlanApi.rate` directly
 *      and surfaces the FULL `quotes[]`, not just `bestQuote`.
 *   - `buildPlanFromQuote` materialises an executable plan from a
 *      specific user-chosen quote (so the picked carrier wins, not
 *      the cheapest).
 */

import {
  rateAllCarriersForOrder,
  buildPlanFromQuote,
  isFailure,
  type SingleOrderCarrierQuote,
} from '../planSingleOrderService';

// Mirror the mock pattern used by bulkPlanWeightCap.test.ts so
// future maintainers see one consistent style across this folder.
jest.mock('../../lib/api', () => {
  return { BulkPlanApi: { rate: jest.fn(), execute: jest.fn() } };
});

const { BulkPlanApi } = jest.requireMock('../../lib/api');

function makeOrder(overrides: Partial<any> = {}): any {
  return {
    id: 'ORD-1',
    origin: 'Houston, TX 77003',
    destination: 'Dallas, TX 75201',
    origin_zip: '77003',
    dest_zip: '75201',
    freight_class: '70',
    weight: 5000,
    pieces: 10,
    readyDate: '2099-01-02',
    dueDate: '2099-01-10',
    ...overrides,
  };
}

function makeQuote(carrier: string, totalCharge: number, transitDays = 2, extra: any = {}) {
  return {
    carrier,
    mode: 'LTL',
    serviceLevel: 'Standard',
    totalCharge,
    transitDays,
    czarBase: totalCharge * 0.7,
    czarBaseGross: totalCharge * 0.8,
    fscCharge: totalCharge * 0.15,
    accessorialCharge: totalCharge * 0.05,
    pcmilerMiles: 240,
    rateId: `rate-${carrier}`,
    ...extra,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('rateAllCarriersForOrder', () => {
  it('returns ALL viable quotes from the API, not just the winner', async () => {
    BulkPlanApi.rate.mockResolvedValueOnce({
      results: [
        {
          // laneKey from buildSingleOrderLane uses normalised origin/dest;
          // the service falls back to results[0] when no exact match,
          // so the test only needs SOME laneResult shape.
          laneKey: 'lane',
          quotes: [
            makeQuote('FastShip', 1200, 1, { recommended: true }),
            makeQuote('CheapShip', 800, 4, { preferred: true }),
            makeQuote('MidShip', 950, 2),
          ],
          bestQuote: { carrier: 'FastShip' },
        },
      ],
      meta: { equipment: { tlMaxWeight: 45000 } },
    });

    const result = await rateAllCarriersForOrder(makeOrder(), 'cost');
    expect(isFailure(result)).toBe(false);
    if (isFailure(result)) return;
    expect(result.quotes.map((q) => q.carrier)).toEqual([
      'FastShip',
      'CheapShip',
      'MidShip',
    ]);
    // preferred / recommended flags propagate so the picker badges work
    const cheap = result.quotes.find((q) => q.carrier === 'CheapShip')!;
    expect(cheap.preferred).toBe(true);
    const fast = result.quotes.find((q) => q.carrier === 'FastShip')!;
    expect(fast.recommended).toBe(true);
  });

  it('drops quotes with transitDays <= 0 (matches API bestQuote gate)', async () => {
    BulkPlanApi.rate.mockResolvedValueOnce({
      results: [
        {
          laneKey: 'lane',
          quotes: [
            makeQuote('GoodCarrier', 1000, 3),
            makeQuote('NoTransitCarrier', 900, 0), // would trip calcDates
            makeQuote('NegTransitCarrier', 850, -1),
          ],
        },
      ],
    });

    const result = await rateAllCarriersForOrder(makeOrder());
    expect(isFailure(result)).toBe(false);
    if (isFailure(result)) return;
    expect(result.quotes.map((q) => q.carrier)).toEqual(['GoodCarrier']);
  });

  it('returns NO_CARRIER_QUOTE when the API responds with no viable quotes', async () => {
    BulkPlanApi.rate.mockResolvedValueOnce({
      results: [{ laneKey: 'lane', quotes: [], bestQuote: null }],
    });

    const result = await rateAllCarriersForOrder(makeOrder());
    expect(isFailure(result)).toBe(true);
    if (!isFailure(result)) return;
    expect(result.code).toBe('NO_CARRIER_QUOTE');
  });

  it('rejects past-due orders before calling the rating API', async () => {
    const result = await rateAllCarriersForOrder(
      makeOrder({ dueDate: '2000-01-01' }),
    );
    expect(BulkPlanApi.rate).not.toHaveBeenCalled();
    expect(isFailure(result)).toBe(true);
    if (!isFailure(result)) return;
    expect(result.code).toBe('PAST_DUE_DATE');
  });

  it('returns NO_CARRIER_QUOTE when the API call throws', async () => {
    BulkPlanApi.rate.mockRejectedValueOnce(new Error('network down'));
    const result = await rateAllCarriersForOrder(makeOrder());
    expect(isFailure(result)).toBe(true);
    if (!isFailure(result)) return;
    expect(result.code).toBe('NO_CARRIER_QUOTE');
    expect(result.message).toMatch(/network down/i);
  });

  it('rejects orders missing an id without calling the API', async () => {
    const result = await rateAllCarriersForOrder({});
    expect(BulkPlanApi.rate).not.toHaveBeenCalled();
    expect(isFailure(result)).toBe(true);
    if (!isFailure(result)) return;
    expect(result.code).toBe('INVALID_ORDER');
  });
});

describe('buildPlanFromQuote', () => {
  function pickerQuote(carrier: string, totalCharge: number): SingleOrderCarrierQuote {
    return {
      carrier,
      mode: 'LTL',
      serviceLevel: 'Standard',
      totalCost: totalCharge,
      transitDays: 2,
      pickupDate: '2099-01-05',
      deliveryDate: '2099-01-07',
      preferred: false,
      recommended: false,
      rawQuote: makeQuote(carrier, totalCharge, 2),
    };
  }

  it('materialises a plan whose carrier matches the picked quote — NOT the cheapest', () => {
    // Important: the user picked the more expensive option. We need
    // the resulting plan to carry their choice, not silently swap to
    // the lowest cost (which was the bug we're fixing).
    const order = makeOrder();
    const picked = pickerQuote('UserChoice', 1500);
    const plan = buildPlanFromQuote(order, picked);
    expect(plan).toBeTruthy();
    expect(plan.carrier).toBe('UserChoice');
    expect(plan.totalCost).toBe(1500);
    expect(plan.orderIds).toEqual(['ORD-1']);
  });

  it('returns null when handed a quote with no rawQuote', () => {
    const plan = buildPlanFromQuote(makeOrder(), {
      carrier: 'X', mode: 'LTL', serviceLevel: 'Standard',
      totalCost: 0, transitDays: null, pickupDate: null, deliveryDate: null,
      preferred: false, recommended: false, rawQuote: null,
    });
    expect(plan).toBeNull();
  });

  it('returns null when the order is missing', () => {
    const plan = buildPlanFromQuote(null, pickerQuote('X', 100));
    expect(plan).toBeNull();
  });
});
