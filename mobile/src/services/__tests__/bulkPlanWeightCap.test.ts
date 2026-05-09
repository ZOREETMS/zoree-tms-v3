/**
 * Regression tests for Bug #164 — Mobile Bulk Plan combined 5 separate
 * 45,000 lb orders into a single 225,000 lb shipment because the
 * consolidation algorithm only checked cost, not weight feasibility.
 *
 * The fix lives in mobile/src/shared/services/bulkPlanService.js:
 *   1. rateLane() captures meta.equipment.tlMaxWeight from the server
 *      response into a module-level cache.
 *   2. planLaneWithSplit() skips any subset whose totalWeight exceeds
 *      that cached ceiling, so 5×45,000 → no consolidation → 5 plans.
 *
 * The corresponding server change publishes the ceiling in
 * /api/bulk-plan/rate response.meta.equipment.tlMaxWeight (api/server.js).
 */
import {
  planLaneWithSplit,
  _resetEquipmentLimitsCacheForTest,
  getCachedTlMaxWeight,
} from '../../shared/services/bulkPlanService';

// Mock the API layer the service depends on. Each test rewires
// BulkPlanApi.rate to control the server's response shape.
jest.mock('../../lib/api', () => {
  return {
    BulkPlanApi: { rate: jest.fn() },
  };
});

// `BulkPlanApi` is the mocked one we want to manipulate. It's
// re-imported here so jest hands back the spy.
const { BulkPlanApi } = jest.requireMock('../../lib/api');

const TL_MAX = 45000; // matches equipment_types.DV53.max_weight

function makeOrder(id: string, weight: number, pieces = 10): any {
  return {
    id,
    origin: 'Houston, TX 77003',
    destination: 'Dallas, TX 75201',
    origin_zip: '77003',
    dest_zip: '75201',
    freight_class: '70',
    weight,
    pieces,
    readyDate: '2026-05-08',
    dueDate: '2026-05-15',
  };
}

function buildLane(orders: any[]): any {
  return {
    laneKey: '77003-75201',
    origin: 'Houston, TX 77003',
    destination: 'Dallas, TX 75201',
    originZip: '77003',
    destZip: '75201',
    freightClass: '70',
    totalWeight: orders.reduce((s, o) => s + Number(o.weight || 0), 0),
    totalPieces: orders.reduce((s, o) => s + Number(o.pieces || 0), 0),
    orderIds: orders.map((o) => o.id),
  };
}

/**
 * Default rate handler: every lane returns a proportional quote so the
 * cost-only path of planLaneWithSplit would normally PREFER one big
 * shipment ($X-per-pound flat) over many small ones. Without the
 * weight gate this is exactly what produced the 225,000 lb monster.
 *
 * Returns `meta.equipment.tlMaxWeight` so rateLane caches it on the
 * very first call.
 */
function defaultRateImpl(lanes: any[]) {
  return Promise.resolve({
    results: lanes.map((l) => ({
      laneKey: l.laneKey,
      bestQuote: {
        carrier: 'TEST CARRIER',
        totalCharge: Math.round(l.totalWeight * 0.05) + 100, // strictly cheaper per-lb when bigger
        transitDays: 2,
      },
    })),
    meta: { equipment: { tlMaxWeight: TL_MAX } },
  });
}

beforeEach(() => {
  _resetEquipmentLimitsCacheForTest();
  (BulkPlanApi.rate as jest.Mock).mockReset();
  (BulkPlanApi.rate as jest.Mock).mockImplementation(defaultRateImpl);
});

describe('TL ceiling cache — Bug #164', () => {
  it('starts cleared after _resetEquipmentLimitsCacheForTest', () => {
    expect(getCachedTlMaxWeight()).toBeNull();
  });

  it('captures meta.equipment.tlMaxWeight on the first rate call', async () => {
    const orders = [makeOrder('O-1', 10000)];
    const lane = buildLane(orders);
    await planLaneWithSplit(lane, orders, orders);
    expect(getCachedTlMaxWeight()).toBe(TL_MAX);
  });

  it('ignores invalid/missing tlMaxWeight in meta', async () => {
    (BulkPlanApi.rate as jest.Mock).mockImplementation((lanes: any[]) =>
      Promise.resolve({
        results: lanes.map((l: any) => ({
          laneKey: l.laneKey,
          bestQuote: { carrier: 'X', totalCharge: 100, transitDays: 2 },
        })),
        meta: { equipment: { tlMaxWeight: -1 } }, // invalid
      }),
    );
    const orders = [makeOrder('O-1', 10000)];
    await planLaneWithSplit(buildLane(orders), orders, orders);
    expect(getCachedTlMaxWeight()).toBeNull();
  });
});

describe('planLaneWithSplit weight gate — Bug #164', () => {
  it('REPRO: 5×45,000 lb orders → 5 individual plans, no 225K consolidation', async () => {
    const orders = [
      makeOrder('O-1', 45000),
      makeOrder('O-2', 45000),
      makeOrder('O-3', 45000),
      makeOrder('O-4', 45000),
      makeOrder('O-5', 45000),
    ];
    const lane = buildLane(orders); // totalWeight = 225,000

    const result = await planLaneWithSplit(lane, orders, orders);

    expect(result.plans).toHaveLength(5);
    expect(result.consolidated).toBe(0);
    expect(result.individual).toBe(5);
    // Every produced plan must be a single-order shipment at the cap.
    for (const plan of result.plans) {
      expect(plan.totalWeight).toBeLessThanOrEqual(TL_MAX);
      expect(plan.orderIds).toHaveLength(1);
    }
  });

  it('still consolidates a 2-order subset that fits under the TL cap', async () => {
    // Two 10,000 lb orders → 20,000 lb consolidated → fits.
    const orders = [makeOrder('O-A', 10000), makeOrder('O-B', 10000)];
    const lane = buildLane(orders);

    const result = await planLaneWithSplit(lane, orders, orders);

    expect(result.consolidated).toBe(2);
    expect(result.plans[0].totalWeight).toBe(20000);
  });

  it('skips an overweight subset but still allows a smaller-fit subset within the same lane', async () => {
    // 3 orders × 25,000 lbs each. Triple = 75K (over cap), pairs = 50K
    // (still over), singletons = 25K (fit). Expect no consolidation —
    // every pair already exceeds the cap.
    const orders = [
      makeOrder('O-X', 25000),
      makeOrder('O-Y', 25000),
      makeOrder('O-Z', 25000),
    ];
    const lane = buildLane(orders);

    const result = await planLaneWithSplit(lane, orders, orders);

    expect(result.consolidated).toBe(0);
    expect(result.plans).toHaveLength(3);
    for (const plan of result.plans) {
      expect(plan.totalWeight).toBe(25000);
    }
  });

  it('the gate does nothing (and consolidation works) when the cache is unset', async () => {
    // When the server response omits meta.equipment.tlMaxWeight (older
    // server / new client), the cache stays null and the gate becomes
    // a no-op. Consolidation reverts to cost-only, mirroring the
    // pre-#164 behaviour — acceptable because every realistic deploy
    // has updated server + client together. The risk is only that an
    // overweight subset could still consolidate; in practice the
    // cache populates on the FIRST individualQuotes rateLane call so
    // this window is sub-millisecond.
    (BulkPlanApi.rate as jest.Mock).mockImplementation((lanes: any[]) =>
      Promise.resolve({
        results: lanes.map((l: any) => ({
          laneKey: l.laneKey,
          bestQuote: { carrier: 'X', totalCharge: 50, transitDays: 2 },
        })),
        meta: {},
      }),
    );

    const orders = [makeOrder('O-1', 100), makeOrder('O-2', 100)];
    const lane = buildLane(orders);
    const result = await planLaneWithSplit(lane, orders, orders);
    expect(getCachedTlMaxWeight()).toBeNull();
    // We don't pin "consolidated" exactly because that depends on the
    // cost ratio; we DO pin that the produced plans are valid and
    // never exceed the lane's combined weight (no fabricated rows).
    for (const plan of result.plans) {
      expect(plan.totalWeight).toBeLessThanOrEqual(200);
    }
    expect(result.plans.length).toBeGreaterThanOrEqual(1);
  });
});
