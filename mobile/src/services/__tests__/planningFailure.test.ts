/**
 * Unit tests for the planning-failure stack:
 *   types/planningFailure.ts
 *   services/planningFailureCatalog.ts
 *   services/bulkPlanFailureCollector.ts
 *
 * Pure services / types — no React, no DbApi mocks needed.
 */

import { FAILURE_CODES, makeFailure } from '../../types/planningFailure';
import {
  classifyBackendError,
  describeFailure,
  failureCategory,
} from '../planningFailureCatalog';
import {
  createFailureCollector,
  dropReasonForLane,
  mapBackendErrorsToOrders,
} from '../bulkPlanFailureCollector';

describe('makeFailure', () => {
  it('returns a record with the recognised code', () => {
    const f = makeFailure('ORD-1', FAILURE_CODES.NO_CARRIER_QUOTE, 'no LTL');
    expect(f).toEqual({
      orderId: 'ORD-1',
      code: FAILURE_CODES.NO_CARRIER_QUOTE,
      details: 'no LTL',
    });
  });

  it('falls back to UNKNOWN when given a typo / unknown code', () => {
    const f = makeFailure('ORD-1', 'TYPO_CODE', '');
    expect(f.code).toBe(FAILURE_CODES.UNKNOWN);
  });

  it('coerces missing details to an empty string', () => {
    const f = makeFailure('ORD-1', FAILURE_CODES.PAST_DUE);
    expect(f.details).toBe('');
  });
});

describe('describeFailure / failureCategory', () => {
  it('renders a sentence for every known code', () => {
    for (const code of Object.values(FAILURE_CODES)) {
      const sentence = describeFailure({ orderId: 'X', code, details: '' });
      expect(typeof sentence).toBe('string');
      expect(sentence.length).toBeGreaterThan(10);
    }
  });

  it('appends details parenthetically when present', () => {
    const sentence = describeFailure({
      orderId: 'X',
      code: FAILURE_CODES.BACKEND_INSERT_FAILED,
      details: 'duplicate key on shipments_pkey',
    });
    expect(sentence).toMatch(/\(duplicate key on shipments_pkey\)$/);
  });

  it('falls back to UNKNOWN when given null / no code', () => {
    expect(describeFailure(null)).toMatch(/unrecognised reason/);
    expect(describeFailure({})).toMatch(/unrecognised reason/);
  });

  it('groups codes into broad categories', () => {
    expect(failureCategory(FAILURE_CODES.NO_CARRIER_QUOTE)).toBe('Carrier / Rate');
    expect(failureCategory(FAILURE_CODES.MODE_CONSTRAINT_UNMET)).toBe('Carrier / Rate');
    expect(failureCategory(FAILURE_CODES.SERVICE_LEVEL_UNMET)).toBe('Carrier / Rate');
    expect(failureCategory(FAILURE_CODES.DATES_INCOMPATIBLE)).toBe('Dates');
    expect(failureCategory(FAILURE_CODES.PAST_DUE)).toBe('Dates');
    expect(failureCategory(FAILURE_CODES.BACKEND_INSERT_FAILED)).toBe('Database');
    expect(failureCategory(FAILURE_CODES.ORDER_PATCH_FAILED)).toBe('Database');
    expect(failureCategory('GARBAGE')).toBe('Other');
  });
});

describe('classifyBackendError', () => {
  it('matches "batch order patch" → ORDER_PATCH_FAILED', () => {
    expect(classifyBackendError('Batch order patch failed for IDs 1,2')).toBe(
      FAILURE_CODES.ORDER_PATCH_FAILED,
    );
  });

  it('matches "db insert" / "insert failed" → BACKEND_INSERT_FAILED', () => {
    expect(classifyBackendError('DB insert rejected: missing column')).toBe(
      FAILURE_CODES.BACKEND_INSERT_FAILED,
    );
    expect(classifyBackendError('insert failed: constraint violation')).toBe(
      FAILURE_CODES.BACKEND_INSERT_FAILED,
    );
  });

  it('matches "dock columns missing" → BACKEND_INSERT_FAILED', () => {
    expect(classifyBackendError('shipments dock columns missing')).toBe(
      FAILURE_CODES.BACKEND_INSERT_FAILED,
    );
  });

  it('falls through to UNKNOWN on empty / unknown messages', () => {
    expect(classifyBackendError('')).toBe(FAILURE_CODES.UNKNOWN);
    expect(classifyBackendError('totally novel error')).toBe(FAILURE_CODES.UNKNOWN);
  });
});

describe('createFailureCollector', () => {
  it('starts empty and returns a copy on list()', () => {
    const c = createFailureCollector();
    expect(c.list()).toEqual([]);
    // Mutating the returned snapshot must not mutate internal state.
    const snap = c.list() as any[];
    snap.push({ junk: true });
    expect(c.list()).toEqual([]);
  });

  it('add() appends a Failure with normalized code', () => {
    const c = createFailureCollector();
    c.add('ORD-1', FAILURE_CODES.NO_CARRIER_QUOTE, 'no LTL');
    c.add('ORD-2', 'TYPO');
    expect(c.list()).toEqual([
      { orderId: 'ORD-1', code: FAILURE_CODES.NO_CARRIER_QUOTE, details: 'no LTL' },
      { orderId: 'ORD-2', code: FAILURE_CODES.UNKNOWN, details: '' },
    ]);
  });

  it('add() ignores empty orderId', () => {
    const c = createFailureCollector();
    c.add('', FAILURE_CODES.NO_CARRIER_QUOTE);
    expect(c.list()).toEqual([]);
  });

  it('addMany() handles strings and order objects, skips empties', () => {
    const c = createFailureCollector();
    c.addMany(['ORD-1', { id: 'ORD-2' }, '', { id: '' } as any], FAILURE_CODES.PAST_DUE, 'past due');
    const items = c.list();
    expect(items).toHaveLength(2);
    expect(items.map((f) => f.orderId)).toEqual(['ORD-1', 'ORD-2']);
    for (const f of items) expect(f.code).toBe(FAILURE_CODES.PAST_DUE);
  });
});

describe('dropReasonForLane', () => {
  it('prefers MODE_CONSTRAINT_UNMET when a mode constraint is set', () => {
    expect(dropReasonForLane('LTL', 'Standard')).toBe(FAILURE_CODES.MODE_CONSTRAINT_UNMET);
    expect(dropReasonForLane('TL')).toBe(FAILURE_CODES.MODE_CONSTRAINT_UNMET);
  });

  it('uses SERVICE_LEVEL_UNMET when only service level is set', () => {
    expect(dropReasonForLane('', 'Expedited')).toBe(FAILURE_CODES.SERVICE_LEVEL_UNMET);
    expect(dropReasonForLane(undefined, 'Standard')).toBe(FAILURE_CODES.SERVICE_LEVEL_UNMET);
  });

  it('falls through to NO_CARRIER_QUOTE when neither constraint is set', () => {
    expect(dropReasonForLane()).toBe(FAILURE_CODES.NO_CARRIER_QUOTE);
    expect(dropReasonForLane('')).toBe(FAILURE_CODES.NO_CARRIER_QUOTE);
  });
});

describe('mapBackendErrorsToOrders', () => {
  it('attributes a lane-keyed error to every order on that plan', () => {
    const failures = mapBackendErrorsToOrders({
      backendErrors: [{ lane: 'CHI->DAL', error: 'DB insert failed: dock columns missing' }],
      plans: [
        { laneKey: 'CHI->DAL', orderIds: ['ORD-1', 'ORD-2'] },
        { laneKey: 'NYC->LAX', orderIds: ['ORD-3'] },
      ],
      plannedOrderIds: new Set(),
    });
    expect(failures).toHaveLength(2);
    expect(failures.map((f) => f.orderId)).toEqual(['ORD-1', 'ORD-2']);
    for (const f of failures) {
      expect(f.code).toBe(FAILURE_CODES.BACKEND_INSERT_FAILED);
      expect(f.details).toMatch(/dock columns missing/);
    }
  });

  it('skips orders that survived on a different plan', () => {
    const failures = mapBackendErrorsToOrders({
      backendErrors: [{ lane: 'CHI->DAL', error: 'DB insert failed' }],
      plans: [{ laneKey: 'CHI->DAL', orderIds: ['ORD-1', 'ORD-2'] }],
      plannedOrderIds: new Set(['ORD-2']), // ORD-2 made it onto another shipment
    });
    expect(failures).toHaveLength(1);
    expect(failures[0].orderId).toBe('ORD-1');
  });

  it('returns nothing when the error has no matching plan', () => {
    const failures = mapBackendErrorsToOrders({
      backendErrors: [{ lane: 'UNKNOWN-LANE', error: 'whatever' }],
      plans: [{ laneKey: 'CHI->DAL', orderIds: ['ORD-1'] }],
    });
    expect(failures).toEqual([]);
  });

  it('handles empty or missing inputs without throwing', () => {
    expect(mapBackendErrorsToOrders()).toEqual([]);
    expect(mapBackendErrorsToOrders({ backendErrors: [] })).toEqual([]);
    expect(mapBackendErrorsToOrders({ backendErrors: [null as any] })).toEqual([]);
  });
});
