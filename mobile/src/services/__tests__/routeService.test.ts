/**
 * Unit tests for mobile/src/services/routeService.ts.
 * DbApi is mocked.
 */

import {
  addStop,
  autoAssignOrders,
  buildCbolPairs,
  buildRouteExecutionPlan,
  buildRoutePayload,
  calcRouteCost,
  calcTotalMiles,
  computeRouteStats,
  deleteRoute,
  emptyRoute,
  executeRoute,
  genRouteId,
  getCbolCost,
  moveStop,
  recalcLoadSeq,
  removeStop,
  saveRoute,
  updateStopField,
  validateRoute,
} from '../routeService';
import { DbApi } from '../../lib/api';

jest.mock('../../lib/api', () => ({
  DbApi: {
    upsert: jest.fn(),
    remove: jest.fn(),
  },
}));

describe('genRouteId / emptyRoute', () => {
  it('genRouteId returns RT-prefixed ids', () => {
    expect(genRouteId()).toMatch(/^RT-/);
  });

  it('emptyRoute has 1 pickup + 1 delivery and TL defaults', () => {
    const r = emptyRoute();
    expect(r.mode).toBe('TL');
    expect(r.max_weight).toBe(44000);
    expect(r.status).toBe('Active');
    expect(r.stops).toHaveLength(2);
    expect(r.stops[0].type).toBe('pickup');
    expect(r.stops[1].type).toBe('delivery');
  });
});

describe('recalcLoadSeq', () => {
  it('numbers deliveries reverse-LIFO and clears pickups', () => {
    const out = recalcLoadSeq([
      { sequence: 1, city: 'A', state: 'X', type: 'pickup', stop_seq: 1, load_seq: '' },
      { sequence: 2, city: 'B', state: 'X', type: 'delivery', stop_seq: 2, load_seq: '' },
      { sequence: 3, city: 'C', state: 'X', type: 'delivery', stop_seq: 3, load_seq: '' },
      { sequence: 4, city: 'D', state: 'X', type: 'delivery', stop_seq: 4, load_seq: '' },
    ] as any);
    expect(out[0].load_seq).toBe(''); // pickup
    expect(out[1].load_seq).toBe(3);  // first delivery → loaded last
    expect(out[2].load_seq).toBe(2);
    expect(out[3].load_seq).toBe(1);
  });
});

describe('addStop / removeStop / moveStop / updateStopField', () => {
  const base = emptyRoute();

  it('addStop appends and renumbers', () => {
    const out = addStop(base.stops, 'delivery');
    expect(out).toHaveLength(3);
    expect(out[2].type).toBe('delivery');
    expect(out[0].sequence).toBe(1);
    expect(out[2].sequence).toBe(3);
  });

  it('removeStop drops index and renumbers', () => {
    const three = addStop(base.stops);
    const out = removeStop(three, 1);
    expect(out).toHaveLength(2);
    expect(out[0].sequence).toBe(1);
    expect(out[1].sequence).toBe(2);
  });

  it('moveStop reorders + renumbers', () => {
    const three = addStop(base.stops);
    const out = moveStop(three, 0, 2);
    expect(out[2].type).toBe('pickup');
    expect(out[2].sequence).toBe(3);
  });

  it('moveStop is a no-op for invalid indices', () => {
    expect(moveStop(base.stops, -1, 0)).toBe(base.stops);
    expect(moveStop(base.stops, 0, 99)).toBe(base.stops);
  });

  it('updateStopField immutably patches a single stop', () => {
    const out = updateStopField(base.stops, 0, 'city', 'Chicago');
    expect(out[0].city).toBe('Chicago');
    expect(out[1].city).toBe(base.stops[1].city);
    // Original untouched
    expect(base.stops[0].city).toBe('');
  });
});

describe('calcTotalMiles', () => {
  it('returns 0 when stops have no coords', () => {
    expect(calcTotalMiles(emptyRoute().stops)).toBe(0);
  });

  it('sums haversine distance between consecutive coords', () => {
    // ~921 mi between Chicago (41.88, -87.63) and Dallas (32.78, -96.80)
    const stops: any[] = [
      { lat: 41.88, lng: -87.63 },
      { lat: 32.78, lng: -96.80 },
    ];
    const miles = calcTotalMiles(stops);
    // Haversine is great-circle; we accept ±50 mi vs road-distance.
    expect(miles).toBeGreaterThan(800);
    expect(miles).toBeLessThan(1000);
  });
});

describe('calcRouteCost', () => {
  it('uses cost_override when set', () => {
    expect(calcRouteCost({ ...emptyRoute(), cost_override: 1500 }, [])).toBe(1500);
  });

  it('falls back to 0 when no carrier match', () => {
    const r = { ...emptyRoute(), carrier: 'XPO', stops: [
      { lat: 41.88, lng: -87.63 } as any,
      { lat: 32.78, lng: -96.80 } as any,
    ] };
    expect(calcRouteCost(r as any, [])).toBe(0);
  });

  it('multiplies miles × rpm × (1 + fsc) when a matching active rate exists', () => {
    const r = { ...emptyRoute(), carrier: 'XPO', mode: 'TL', stops: [
      { lat: 41.88, lng: -87.63 } as any,
      { lat: 32.78, lng: -96.80 } as any,
    ] };
    const rates = [{ carrier: 'XPO', mode: 'TL', rate: '$2.50', fsc: '20%', status: 'Active' }];
    const cost = calcRouteCost(r as any, rates);
    // miles is roughly 920; cost = 920 * 2.5 * 1.2 ≈ 2760
    expect(cost).toBeGreaterThan(2400);
    expect(cost).toBeLessThan(3000);
  });
});

describe('validateRoute', () => {
  it('rejects missing name / fewer than 2 stops / blank cities / missing pickup-delivery split', () => {
    const r = emptyRoute();
    expect(validateRoute({ ...r, name: '' }).ok).toBe(false);
    expect(validateRoute({ ...r, name: 'X', stops: [r.stops[0]] }).ok).toBe(false);
    // Two stops, one blank city
    expect(validateRoute({ ...r, name: 'X' }).ok).toBe(false);
    // Two stops, both pickups → no delivery
    expect(
      validateRoute({
        ...r,
        name: 'X',
        stops: r.stops.map((s) => ({ ...s, type: 'pickup' as const, city: 'A' })),
      }).ok,
    ).toBe(false);
  });

  it('accepts a populated route', () => {
    const r = emptyRoute();
    r.name = 'Chicago–Dallas';
    r.stops = r.stops.map((s, i) => ({
      ...s,
      city: i === 0 ? 'Chicago' : 'Dallas',
      state: i === 0 ? 'IL' : 'TX',
    }));
    expect(validateRoute(r).ok).toBe(true);
  });
});

describe('buildRoutePayload', () => {
  it('composes location strings + coerces numerics', () => {
    const r = emptyRoute();
    r.name = 'X';
    r.stops = [
      { ...r.stops[0], city: 'Chicago', state: 'IL' },
      { ...r.stops[1], city: 'Dallas', state: 'TX' },
    ];
    r.transit_days = '3';
    r.miles_override = '900';
    const p = buildRoutePayload(r);
    expect(p.stops[0].location).toBe('Chicago, IL');
    expect(p.stops[1].location).toBe('Dallas, TX');
    expect(p.transit_days).toBe(3);
    expect(p.miles_override).toBe(900);
    expect(p.total_miles).toBe(900);
  });
});

describe('mutations', () => {
  beforeEach(() => jest.clearAllMocks());

  it('saveRoute validates then upserts to route_templates', async () => {
    const r = emptyRoute();
    await expect(saveRoute({ ...r, name: '' })).rejects.toThrow(/name/i);
    expect(DbApi.upsert).not.toHaveBeenCalled();

    r.name = 'Chicago–Dallas';
    r.stops = [
      { ...r.stops[0], city: 'Chicago' },
      { ...r.stops[1], city: 'Dallas' },
    ];
    (DbApi.upsert as jest.Mock).mockResolvedValue({ ok: true });
    await saveRoute(r);
    expect(DbApi.upsert).toHaveBeenCalledWith(
      'route_templates',
      expect.objectContaining({ name: 'Chicago–Dallas' }),
    );
  });

  it('deleteRoute requires id and removes', async () => {
    await expect(deleteRoute('')).rejects.toThrow(/id is required/);
    (DbApi.remove as jest.Mock).mockResolvedValue({ ok: true });
    await deleteRoute('RT-1');
    expect(DbApi.remove).toHaveBeenCalledWith('route_templates', 'RT-1');
  });
});

describe('buildCbolPairs', () => {
  it('builds a pickup → delivery pair for each valid combination', () => {
    const stops: any = [
      { sequence: 1, stop_seq: 1, type: 'pickup', city: 'A', leg_miles: 0 },
      { sequence: 2, stop_seq: 2, type: 'delivery', city: 'B', leg_miles: 200 },
      { sequence: 3, stop_seq: 3, type: 'delivery', city: 'C', leg_miles: 150 },
    ];
    const pairs = buildCbolPairs(stops);
    // 1 pickup × 2 deliveries = 2 pairs
    expect(pairs).toHaveLength(2);
    expect(pairs[0].key).toBe('1.2');
    expect(pairs[0].legMiles).toBe(200);
    expect(pairs[1].key).toBe('1.3');
    // Sum of leg_miles between p[0] and d[1] is 200 + 150
    expect(pairs[1].legMiles).toBe(350);
  });

  it('skips deliveries that come before a pickup', () => {
    const stops: any = [
      { sequence: 1, stop_seq: 1, type: 'delivery', city: 'A' },
      { sequence: 2, stop_seq: 2, type: 'pickup', city: 'B' },
    ];
    expect(buildCbolPairs(stops)).toEqual([]);
  });
});

describe('getCbolCost', () => {
  const pair: any = { key: '1.2', legMiles: 100 };

  it('uses caller-supplied override when present', () => {
    expect(getCbolCost(pair, 200, 1000, 250)).toBe(250);
    expect(getCbolCost(pair, 200, 1000, '300')).toBe(300);
  });

  it('falls back to leg-miles share when override blank or invalid', () => {
    expect(getCbolCost(pair, 200, 1000)).toBe(500);     // 100/200 of 1000
    expect(getCbolCost(pair, 200, 1000, '')).toBe(500);
    expect(getCbolCost(pair, 200, 1000, 'NaN')).toBe(500);
  });

  it('returns 0 when total miles or cost is 0', () => {
    expect(getCbolCost(pair, 0, 1000)).toBe(0);
    expect(getCbolCost(pair, 200, 0)).toBe(0);
  });
});

describe('autoAssignOrders', () => {
  it('matches orders whose origin/dest cities contain the pair cities', () => {
    const pairs: any = [
      { key: '1.2', pickup: { city: 'Chicago' }, delivery: { city: 'Dallas' } },
      { key: '1.3', pickup: { city: 'Chicago' }, delivery: { city: 'Atlanta' } },
    ];
    const orders: any = [
      { id: 'O1', origin: 'CHICAGO, IL', dest: 'DALLAS, TX' },
      { id: 'O2', origin: 'CHICAGO, IL', dest: 'ATLANTA, GA' },
      { id: 'O3', origin: 'NYC, NY', dest: 'DALLAS, TX' },
    ];
    const out = autoAssignOrders(pairs, orders);
    expect(out['1.2']).toEqual(['O1']);
    expect(out['1.3']).toEqual(['O2']);
  });

  it('returns empty object when no orders match', () => {
    const pairs: any = [{ key: 'x', pickup: { city: 'X' }, delivery: { city: 'Y' } }];
    expect(autoAssignOrders(pairs, [])).toEqual({});
  });
});

describe('buildRouteExecutionPlan', () => {
  function fixtureRoute(): any {
    return {
      ...emptyRoute(),
      id: 'RT-1',
      name: 'Chi → Dal+Atl',
      carrier: 'XPO',
      mode: 'TL',
      cost_override: 1000,
      total_miles: 1000,
      stops: [
        { sequence: 1, stop_seq: 1, type: 'pickup', city: 'Chicago', state: 'IL', location: 'Chicago, IL', load_seq: '', leg_miles: 0 },
        { sequence: 2, stop_seq: 2, type: 'delivery', city: 'Dallas', state: 'TX', location: 'Dallas, TX', load_seq: 2, leg_miles: 600 },
        { sequence: 3, stop_seq: 3, type: 'delivery', city: 'Atlanta', state: 'GA', location: 'Atlanta, GA', load_seq: 1, leg_miles: 400 },
      ],
    };
  }

  it('builds an MBOL + 2 CBOLs with pro-rated costs and order updates', () => {
    const orders = [
      { id: 'O1', origin: 'Chicago, IL', dest: 'Dallas, TX', weight: 1000, pieces: 5, ready: '2026-04-30', due: '2026-05-02' },
      { id: 'O2', origin: 'Chicago, IL', dest: 'Atlanta, GA', weight: 500, pieces: 2, ready: '2026-04-30', due: '2026-05-03' },
    ];
    const plan = buildRouteExecutionPlan(
      fixtureRoute(),
      orders,
      { '1.2': ['O1'], '1.3': ['O2'] },
    );

    expect(plan.masterShipment.bol_type).toBe('MBOL');
    expect(plan.masterShipment.weight).toBe(1500);
    expect(plan.masterShipment.pieces).toBe(7);
    expect(plan.masterShipment.order_ids.sort()).toEqual(['O1', 'O2']);
    expect(plan.masterShipment.miles).toBe(1000);
    expect(plan.masterShipment.pickup_date).toBe('2026-04-30');
    expect(plan.masterShipment.delivery_date).toBe('2026-05-03');

    expect(plan.childShipments).toHaveLength(2);
    const child12 = plan.childShipments.find((c) => c.id.endsWith('.1.2'))!;
    const child13 = plan.childShipments.find((c) => c.id.endsWith('.1.3'))!;
    // pro-rate: 600/(600+400)=60% of $1000 → $600 ; 400/1000 → $400
    expect(child12.total_cost).toBe(600);
    expect(child13.total_cost).toBe(400);
    expect(child12.bol_type).toBe('CBOL');
    expect(child12.master_shipment_id).toBe(plan.masterShipment.id);

    expect(plan.orderUpdates).toEqual(expect.arrayContaining([
      { id: 'O1', shipment_id: child12.id },
      { id: 'O2', shipment_id: child13.id },
    ]));
  });

  it('honours per-CBOL cost overrides', () => {
    const orders = [
      { id: 'O1', origin: 'Chicago, IL', dest: 'Dallas, TX', weight: 100, pieces: 1 },
    ];
    const plan = buildRouteExecutionPlan(
      fixtureRoute(),
      orders,
      { '1.2': ['O1'] },
      { '1.2': '750' },
    );
    expect(plan.childShipments[0].total_cost).toBe(750);
  });

  it('skips CBOLs with no assignments', () => {
    const orders = [{ id: 'O1', origin: 'Chicago, IL', dest: 'Dallas, TX' }];
    const plan = buildRouteExecutionPlan(fixtureRoute(), orders, { '1.2': ['O1'] });
    // Only the 1.2 child is created; 1.3 gets nothing
    expect(plan.childShipments).toHaveLength(1);
  });
});

describe('executeRoute', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects missing master id or empty children', async () => {
    await expect(executeRoute({} as any)).rejects.toThrow(/master shipment id/);
    await expect(executeRoute({ masterShipment: { id: 'M1' }, childShipments: [], orderUpdates: [] } as any))
      .rejects.toThrow(/at least one child/);
  });

  it('upserts master + each child + patches each order', async () => {
    (DbApi.upsert as jest.Mock).mockResolvedValue({ ok: true });
    (DbApi.remove as jest.Mock).mockResolvedValue({ ok: true });
    const patchMock = jest.fn().mockResolvedValue({ ok: true });
    (DbApi as any).patch = patchMock;
    const out = await executeRoute({
      masterShipment: { id: 'M1' } as any,
      childShipments: [
        { id: 'M1.1.2' } as any,
        { id: 'M1.1.3' } as any,
      ],
      orderUpdates: [
        { id: 'O1', shipment_id: 'M1.1.2' },
        { id: 'O2', shipment_id: 'M1.1.3' },
      ],
    });
    // 1 master + 2 children = 3 upserts
    expect(DbApi.upsert).toHaveBeenCalledTimes(3);
    // 2 order patches
    expect(patchMock).toHaveBeenCalledTimes(2);
    expect(out).toEqual({ ok: true, masterId: 'M1', childCount: 2 });
  });
});

describe('computeRouteStats', () => {
  it('counts total / active / inactive', () => {
    const out = computeRouteStats([
      { status: 'Active' },
      { status: 'Active' },
      { status: 'Inactive' },
      {},
    ]);
    expect(out.total).toBe(4);
    expect(out.active).toBe(3); // missing-status defaults Active
    expect(out.inactive).toBe(1);
  });
});
