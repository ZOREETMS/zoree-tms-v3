/**
 * Unit tests for mobile/src/services/orderActionRules.ts.
 *
 * Pure status-gating logic — no network, no React. Each QA bug that
 * drove a rule has its own describe block so a future regression
 * (e.g. someone widens canTenderOrder) trips the right test.
 *
 * Status set under test: Unplanned, Planned, Tendered, Tender Accepted,
 * In Transit, Delivered, Cancelled. These match the ORDER_STATUSES
 * list in shared/constants/orderConstants.js plus 'In Transit' which
 * comes from the shipment-events cascade.
 */

import {
  canPlanOrder,
  canTenderOrder,
  canCancelOrder,
  canDeleteOrder,
  evaluateOrderActions,
  getOrderStatus,
  getOrderShipmentId,
} from '../orderActionRules';

describe('getOrderStatus', () => {
  it('returns the order status when present', () => {
    expect(getOrderStatus({ status: 'Planned' })).toBe('Planned');
  });

  it('defaults to Unplanned for missing or empty status', () => {
    // Defensive default — DataContext sometimes hands us a row before
    // a refresh has populated the column.
    expect(getOrderStatus({})).toBe('Unplanned');
    expect(getOrderStatus(null as any)).toBe('Unplanned');
    expect(getOrderStatus({ status: '' })).toBe('Unplanned');
  });
});

describe('getOrderShipmentId', () => {
  it('reads camelCase shipmentId', () => {
    expect(getOrderShipmentId({ shipmentId: 'SHP-1' })).toBe('SHP-1');
  });
  it('falls back to snake_case shipment_id', () => {
    expect(getOrderShipmentId({ shipment_id: 'SHP-2' })).toBe('SHP-2');
  });
  it('returns null when neither present', () => {
    expect(getOrderShipmentId({})).toBeNull();
  });
});

describe('canPlanOrder (QA bug #122)', () => {
  it('allows planning an Unplanned order', () => {
    expect(canPlanOrder({ status: 'Unplanned' })).toBe(true);
  });

  it('blocks planning a Cancelled order — the bug', () => {
    // Direct regression for bug #122. Before the fix, Plan was only
    // gated on status === 'Planned' so a cancelled order showed Plan
    // as actionable, which would silently re-plan a cancelled row.
    expect(canPlanOrder({ status: 'Cancelled' })).toBe(false);
  });

  it('blocks planning an already-Planned order (replan path lives on web)', () => {
    expect(canPlanOrder({ status: 'Planned' })).toBe(false);
  });

  it('blocks planning past terminal states', () => {
    expect(canPlanOrder({ status: 'Tendered' })).toBe(false);
    expect(canPlanOrder({ status: 'Tender Accepted' })).toBe(false);
    expect(canPlanOrder({ status: 'In Transit' })).toBe(false);
    expect(canPlanOrder({ status: 'Delivered' })).toBe(false);
  });
});

describe('canTenderOrder (QA bug #120)', () => {
  it('allows tendering a Planned order with a linked shipment', () => {
    expect(canTenderOrder({ status: 'Planned', shipmentId: 'SHP-1' })).toBe(true);
  });

  it('also accepts snake_case shipment_id', () => {
    expect(canTenderOrder({ status: 'Planned', shipment_id: 'SHP-2' })).toBe(true);
  });

  it('blocks tendering a Planned order with no shipment_id', () => {
    // Defensive: a status of "Planned" without a shipment row is the
    // exact orphan state mobile bugs #58/#61 produced. Tender on that
    // row would fan out to /api/tender with no shipment to point at.
    expect(canTenderOrder({ status: 'Planned' })).toBe(false);
  });

  it('blocks tendering an Unplanned order — the bug', () => {
    // Regression for #120: prior code allowed Tender on any non-
    // Tendered status. Tendering an unplanned order produced a status
    // change with no shipment row and broke downstream reports.
    expect(canTenderOrder({ status: 'Unplanned', shipmentId: 'SHP-1' })).toBe(false);
  });

  it('blocks tendering after the tender step has happened', () => {
    expect(canTenderOrder({ status: 'Tendered', shipmentId: 'SHP-1' })).toBe(false);
    expect(canTenderOrder({ status: 'Tender Accepted', shipmentId: 'SHP-1' })).toBe(false);
  });
});

describe('canCancelOrder', () => {
  it('allows cancelling a non-terminal order', () => {
    expect(canCancelOrder({ status: 'Unplanned' })).toBe(true);
    expect(canCancelOrder({ status: 'Planned' })).toBe(true);
    expect(canCancelOrder({ status: 'Tendered' })).toBe(true);
    expect(canCancelOrder({ status: 'Tender Accepted' })).toBe(true);
    expect(canCancelOrder({ status: 'In Transit' })).toBe(true);
  });

  it('blocks cancelling a terminal order', () => {
    expect(canCancelOrder({ status: 'Delivered' })).toBe(false);
    expect(canCancelOrder({ status: 'Cancelled' })).toBe(false);
  });
});

describe('canDeleteOrder (QA bug #121)', () => {
  it('allows deleting an Unplanned or Planned order', () => {
    // Mirrors the web's destructive-action contract: deletion only
    // before carriers / drivers are dispatched.
    expect(canDeleteOrder({ status: 'Unplanned' })).toBe(true);
    expect(canDeleteOrder({ status: 'Planned' })).toBe(true);
  });

  it('allows deleting a Cancelled order', () => {
    // Cancelled orders are routinely tidied up — the row is no longer
    // active, so deletion is a clean-up action rather than a
    // destructive one.
    expect(canDeleteOrder({ status: 'Cancelled' })).toBe(true);
  });

  it('blocks deleting once carrier action has happened', () => {
    // Tender Accepted means a carrier has agreed to the load, so the
    // row is auditable and shouldn't be erased — same gate the web
    // applies, same gate the API enforces server-side.
    expect(canDeleteOrder({ status: 'Tender Accepted' })).toBe(false);
    expect(canDeleteOrder({ status: 'In Transit' })).toBe(false);
    expect(canDeleteOrder({ status: 'Delivered' })).toBe(false);
  });

  it('still allows delete after Tendered (carrier hasn\'t accepted yet)', () => {
    // Tendered = email sent / awaiting carrier — the row is recoverable
    // by withdrawing the tender server-side, so the API permits delete.
    // The mobile gate matches.
    expect(canDeleteOrder({ status: 'Tendered' })).toBe(true);
  });
});

describe('evaluateOrderActions', () => {
  it('returns every flag in one pass', () => {
    const flags = evaluateOrderActions({ status: 'Planned', shipmentId: 'SHP-1' });
    expect(flags).toEqual({
      canPlan: false,    // already planned
      canTender: true,   // planned + shipment present
      canCancel: true,   // not terminal
      canDelete: true,   // not yet dispatched
    });
  });

  it('handles a Cancelled order correctly across all four flags', () => {
    expect(evaluateOrderActions({ status: 'Cancelled' })).toEqual({
      canPlan: false,    // bug #122
      canTender: false,
      canCancel: false,  // already terminal
      canDelete: true,   // bug #121 — clean-up still allowed
    });
  });
});
