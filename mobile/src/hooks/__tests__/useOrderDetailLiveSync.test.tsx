/**
 * Unit tests for mobile/src/hooks/useOrderDetailLiveSync.
 *
 * Scope
 * -----
 * Covers the pure derivation function getOrderSyncSignature (the part
 * that decides "did the order change?") plus a simulated end-to-end
 * scenario for the bug we're fixing:
 *
 *   "Updating an order in web doesn't reflect in order in mobile app
 *    unless order is refreshed."
 *
 * The simulation reproduces what happens when:
 *
 *   t0  mobile detail screen mounts; reads orders[orderId] for the
 *       first time -> captures initial signature, no tick yet.
 *   t1  web user edits the order; server PATCHes orders, bumps
 *       updated_at; useRealtimeData fires refreshData() on the mobile
 *       side; DataContext.data.orders gets a new array with a fresh
 *       updated_at for that order.
 *   t2  the hook's signature comparator notices the change -> returns
 *       a new tick -> the screen's useEffect for `lines` and `history`
 *       refires and pulls fresh data from the server.
 *
 * Jest config (mobile/jest.config.js) is testEnvironment: 'node' and
 * does not pull in RN or jsdom, so we import the pure helper from
 * orderDetailSyncSignature.ts (the hook re-exports it for runtime
 * callers). The state machine below mirrors the hook body so the
 * end-to-end scenario can be asserted without a React renderer.
 */

import { getOrderSyncSignature } from '../orderDetailSyncSignature';

describe('getOrderSyncSignature', () => {
  // -- Inputs that should always produce the empty signature --------
  it('returns empty string when orderId is missing', () => {
    expect(getOrderSyncSignature([{ id: '1', updatedAt: 'x' }], '')).toBe('');
    expect(getOrderSyncSignature([{ id: '1', updatedAt: 'x' }], null)).toBe('');
    expect(getOrderSyncSignature([{ id: '1', updatedAt: 'x' }], undefined)).toBe('');
  });

  it('returns empty string for the special "new" order id', () => {
    // OrderForm uses orderId === 'new' to mean "creating"; sync is
    // not applicable until the row exists.
    expect(getOrderSyncSignature([{ id: 'new', updatedAt: 'x' }], 'new')).toBe('');
  });

  it('returns empty string when orders is not an array', () => {
    expect(getOrderSyncSignature(null, 'ord-1')).toBe('');
    expect(getOrderSyncSignature(undefined, 'ord-1')).toBe('');
    // @ts-expect-error - guarded against bad inputs at runtime
    expect(getOrderSyncSignature({ not: 'array' }, 'ord-1')).toBe('');
  });

  it('returns empty string when the order id is not present', () => {
    expect(getOrderSyncSignature([{ id: 'other', updatedAt: 'x' }], 'ord-1')).toBe('');
  });

  // -- Primary path: updatedAt drives the signature ----------------
  it('uses updatedAt (camelCase) as the signature when present', () => {
    const sig = getOrderSyncSignature(
      [{ id: 'ord-1', updatedAt: '2026-05-10T12:00:00Z' }],
      'ord-1',
    );
    expect(sig).toBe('u:2026-05-10T12:00:00Z');
  });

  it('uses updated_at (snake_case) when only that key is present', () => {
    const sig = getOrderSyncSignature(
      [{ id: 'ord-1', updated_at: '2026-05-10T12:00:00Z' }],
      'ord-1',
    );
    expect(sig).toBe('u:2026-05-10T12:00:00Z');
  });

  it('matches by id or order_id and accepts numeric ids', () => {
    expect(
      getOrderSyncSignature([{ order_id: 'ORD-7', updatedAt: 't1' }], 'ORD-7'),
    ).toBe('u:t1');
    expect(getOrderSyncSignature([{ id: 42, updatedAt: 't2' }], '42')).toBe('u:t2');
  });

  // -- Composite fallback when updatedAt is absent -----------------
  it('falls back to a deterministic JSON of meaningful fields', () => {
    const o = {
      id: 'ord-1',
      status: 'Planned',
      weight: 1500,
      pieces: 5,
      line_count: 3,
      shipMode: 'TL',
      serviceLevel: 'Standard',
      shipFromName: 'Dallas DC',
      shipToName: 'Phoenix DC',
      commodity: 'General',
      customer: 'ACME',
      readyDate: '2026-05-12',
      dueDate: '2026-05-15',
      shipmentId: 'SHP-1',
      notes: null,
    };
    const sig1 = getOrderSyncSignature([o], 'ord-1');
    expect(sig1.startsWith('{')).toBe(true);
    // Same input twice -> identical signature (stable key ordering).
    expect(getOrderSyncSignature([o], 'ord-1')).toBe(sig1);
  });

  it('fallback signature changes when status changes', () => {
    const before = { id: 'ord-1', status: 'Unplanned', weight: 100 };
    const after = { ...before, status: 'Planned' };
    expect(getOrderSyncSignature([before], 'ord-1')).not.toBe(
      getOrderSyncSignature([after], 'ord-1'),
    );
  });

  it('fallback signature changes when line_count/weight/pieces change (line-edit cascade)', () => {
    const before = { id: 'ord-1', line_count: 3, weight: 100, pieces: 5 };
    const after = { ...before, line_count: 4, weight: 140, pieces: 7 };
    expect(getOrderSyncSignature([before], 'ord-1')).not.toBe(
      getOrderSyncSignature([after], 'ord-1'),
    );
  });

  // -- Same inputs => same signature (no spurious refetches) -------
  it('returns the same signature when nothing changed (no thrash on every refresh)', () => {
    const o = { id: 'ord-1', updatedAt: '2026-05-10T12:00:00Z', status: 'Planned' };
    // Two different array references with structurally equal entries
    // - what DataContext.refreshData produces on every poll. The
    // signature must not differ between equivalent loads, otherwise
    // the screen would refetch its detail data on every realtime
    // event regardless of whether THIS order changed.
    expect(getOrderSyncSignature([o], 'ord-1')).toBe(
      getOrderSyncSignature([{ ...o }], 'ord-1'),
    );
  });
});

// -----------------------------------------------------------------
// End-to-end simulation
// -----------------------------------------------------------------
//
// The hook itself is a thin useEffect over the signature: when the
// signature changes (and isn't empty) it bumps a tick. Below we
// reproduce that state machine in plain JS so we can test the bug
// scenario without a React renderer (jest config = node only).
//
// The contract the screen's useEffect relies on:
//   - First mount: signature observed, NO tick bump (the parent
//     fetch already runs from the [orderId] dep).
//   - Subsequent change: tick increments by 1.
//   - No change: tick does not move (would cause refetch storms).
// -----------------------------------------------------------------

class SyncTracker {
  private lastSig = '';
  public tick = 0;
  // Mirrors useOrderDetailLiveSync's effect body. Returns true if a
  // tick was issued.
  observe(orders: any[], orderId: string): boolean {
    const sig = getOrderSyncSignature(orders, orderId);
    if (sig === this.lastSig) return false;
    const wasFirstObservation = this.lastSig === '';
    this.lastSig = sig;
    if (sig !== '' && !wasFirstObservation) {
      this.tick += 1;
      return true;
    }
    return false;
  }
}

describe('SyncTracker (mirrors useOrderDetailLiveSync state)', () => {
  const orderId = 'ORD-2026-100';

  it('does NOT bump tick on the first observation (parent fetch already runs)', () => {
    const t = new SyncTracker();
    const ordersT0 = [{ id: orderId, updatedAt: '2026-05-10T10:00:00Z', status: 'Unplanned' }];
    expect(t.observe(ordersT0, orderId)).toBe(false);
    expect(t.tick).toBe(0);
  });

  it('reproduces the bug scenario: web edit -> mobile observes -> tick fires', () => {
    const t = new SyncTracker();

    // t0: mobile detail screen mounts, captures initial signature.
    const ordersT0 = [{ id: orderId, updatedAt: '2026-05-10T10:00:00Z', status: 'Unplanned' }];
    t.observe(ordersT0, orderId);
    expect(t.tick).toBe(0);

    // t1: web user edits status -> server bumps updated_at -> mobile
    // useRealtimeData fires refreshData -> DataContext rehydrates.
    const ordersT1 = [{ id: orderId, updatedAt: '2026-05-10T10:00:30Z', status: 'Planned' }];
    expect(t.observe(ordersT1, orderId)).toBe(true);
    expect(t.tick).toBe(1);

    // t2: another refresh with the SAME data -> no new tick (no
    // unnecessary refetch storm on every Supabase event for an
    // unrelated row).
    expect(t.observe([{ ...ordersT1[0] }], orderId)).toBe(false);
    expect(t.tick).toBe(1);

    // t3: web user edits the order lines -> server PATCHes parent
    // order with new line_count/weight/pieces -> updated_at bumps
    // again. Tick advances so OrderDetailScreen refetches the lines
    // array and the per-line table re-renders without pull-to-refresh.
    const ordersT3 = [{
      id: orderId,
      updatedAt: '2026-05-10T10:01:15Z',
      status: 'Planned',
      weight: 1800,
      pieces: 6,
      line_count: 4,
    }];
    expect(t.observe(ordersT3, orderId)).toBe(true);
    expect(t.tick).toBe(2);
  });

  it('does not fire when an unrelated order changes', () => {
    const t = new SyncTracker();
    const ordersT0 = [
      { id: orderId, updatedAt: '2026-05-10T10:00:00Z' },
      { id: 'ORD-OTHER', updatedAt: '2026-05-10T10:00:00Z' },
    ];
    t.observe(ordersT0, orderId);

    // Only the *other* order changed. The watched order's signature
    // is unchanged, so no tick.
    const ordersT1 = [
      { id: orderId, updatedAt: '2026-05-10T10:00:00Z' },
      { id: 'ORD-OTHER', updatedAt: '2026-05-10T10:00:30Z' },
    ];
    expect(t.observe(ordersT1, orderId)).toBe(false);
    expect(t.tick).toBe(0);
  });

  it('handles legacy payloads without updated_at (composite fallback)', () => {
    const t = new SyncTracker();
    // No updated_at field - typical of older inline server.js routes.
    t.observe([{ id: orderId, status: 'Unplanned', weight: 100 }], orderId);
    expect(t.tick).toBe(0);

    // Status flips on web -> composite signature changes -> tick fires
    // even without updated_at present in the payload.
    expect(t.observe([{ id: orderId, status: 'Planned', weight: 100 }], orderId)).toBe(true);
    expect(t.tick).toBe(1);

    // Same composite again -> no tick.
    expect(t.observe([{ id: orderId, status: 'Planned', weight: 100 }], orderId)).toBe(false);
    expect(t.tick).toBe(1);
  });
});
