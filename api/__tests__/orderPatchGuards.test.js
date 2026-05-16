// Tests for the post-tender date-freeze guard.
//
// Background — bug ORD-127493: the carrier-portal Accept flow used to
// stomp `orders.ready_date` with the shipment's pickup_date, causing
// the TMS Ready Date to drift from the OMS Ready Date (which reads
// the untouched `oms_orders.ready_date`). The root cause was fixed at
// each of the four carrier-portal call sites; this guard is the
// defense-in-depth backstop for any future writer that PATCHes
// `/api/orders/:id` with date fields after a tender has been accepted.
//
// Strategy: test the pure helpers in api/services/orderPatchGuards.js
// directly — no Express, no Supabase. The HTTP layer in server.js is
// a one-liner over these helpers and is therefore implicitly covered
// once these pass.
//
// Run with: node --test api/__tests__/orderPatchGuards.test.js

const test   = require('node:test');
const assert = require('node:assert/strict');

const {
  stripFrozenDateFields,
  applyPostTenderDateGuard,
  ERROR_CODE_DATES_FROZEN,
} = require('../services/orderPatchGuards');
const { isOrderPostTenderAccept } = require('../constants/orderStatus');

// ── isOrderPostTenderAccept predicate ──────────────────────────────

test('isOrderPostTenderAccept — pre-tender statuses return false', () => {
  for (const s of ['Unplanned', 'Planned', 'Consolidated', 'Tendered']) {
    assert.equal(isOrderPostTenderAccept(s), false, `expected ${s} to be pre-tender`);
  }
});

test('isOrderPostTenderAccept — post-tender statuses return true', () => {
  for (const s of ['Tender Accepted', 'Confirmed', 'Shipped', 'In Transit', 'Delivered', 'Cancelled']) {
    assert.equal(isOrderPostTenderAccept(s), true, `expected ${s} to be post-tender`);
  }
});

test('isOrderPostTenderAccept — null/undefined/unknown return false', () => {
  assert.equal(isOrderPostTenderAccept(null), false);
  assert.equal(isOrderPostTenderAccept(undefined), false);
  assert.equal(isOrderPostTenderAccept(''), false);
  assert.equal(isOrderPostTenderAccept('SomeNewStatus'), false);
});

// ── stripFrozenDateFields ──────────────────────────────────────────

test('stripFrozenDateFields — pre-tender order keeps date fields', () => {
  const patch = { ready: '2026-05-18', due: '2026-05-29', notes: 'rush' };
  const stripped = stripFrozenDateFields(patch, { id: 'O-1', status: 'Unplanned' });
  assert.deepEqual(stripped, []);
  assert.deepEqual(patch, { ready: '2026-05-18', due: '2026-05-29', notes: 'rush' });
});

test('stripFrozenDateFields — post-tender order drops ready + due', () => {
  const patch = { ready: '2026-05-27', due: '2026-05-29', notes: 'rush' };
  const stripped = stripFrozenDateFields(patch, { id: 'O-1', status: 'Tender Accepted' });
  assert.deepEqual(stripped.sort(), ['due', 'ready']);
  assert.deepEqual(patch, { notes: 'rush' });
});

test('stripFrozenDateFields — snake_case date keys also stripped', () => {
  const patch = { ready_date: '2026-05-27', due_date: '2026-05-29' };
  const stripped = stripFrozenDateFields(patch, { id: 'O-1', status: 'Delivered' });
  assert.deepEqual(stripped.sort(), ['due_date', 'ready_date']);
  assert.deepEqual(patch, {});
});

test('stripFrozenDateFields — handles missing beforeRow / patch defensively', () => {
  assert.deepEqual(stripFrozenDateFields(null, { status: 'Tender Accepted' }), []);
  assert.deepEqual(stripFrozenDateFields({ ready: '2026-05-27' }, null), []);
  assert.deepEqual(stripFrozenDateFields({ ready: '2026-05-27' }, {}), []);
});

// ── applyPostTenderDateGuard ───────────────────────────────────────

test('applyPostTenderDateGuard — pre-tender pass-through', () => {
  const patch = { ready: '2026-05-18', notes: 'rush' };
  const result = applyPostTenderDateGuard(patch, { id: 'O-1', status: 'Unplanned' });
  assert.equal(result.reject, false);
  assert.equal(result.statusCode, null);
  assert.equal(result.body, null);
  assert.deepEqual(result.strippedFields, []);
  assert.deepEqual(patch, { ready: '2026-05-18', notes: 'rush' });
});

test('applyPostTenderDateGuard — post-tender mixed patch strips dates silently', () => {
  const patch = { ready: '2026-05-27', notes: 'rush' };
  const result = applyPostTenderDateGuard(patch, { id: 'O-1', status: 'Tender Accepted' });
  assert.equal(result.reject, false);
  assert.deepEqual(result.strippedFields, ['ready']);
  // notes still applies, ready is dropped
  assert.deepEqual(patch, { notes: 'rush' });
});

test('applyPostTenderDateGuard — post-tender date-only patch rejects with 409', () => {
  const patch = { ready: '2026-05-27', due: '2026-05-29' };
  const result = applyPostTenderDateGuard(patch, { id: 'ORD-127493', status: 'Tender Accepted' });
  assert.equal(result.reject, true);
  assert.equal(result.statusCode, 409);
  assert.equal(result.body.code, ERROR_CODE_DATES_FROZEN);
  assert.match(result.body.error, /ORD-127493/);
  assert.match(result.body.error, /Tender Accepted/);
  assert.deepEqual(result.body.fields.sort(), ['due', 'ready']);
});

test('applyPostTenderDateGuard — Delivered + date-only patch also rejects', () => {
  const patch = { due: '2026-06-01' };
  const result = applyPostTenderDateGuard(patch, { id: 'O-2', status: 'Delivered' });
  assert.equal(result.reject, true);
  assert.equal(result.statusCode, 409);
  assert.deepEqual(result.body.fields, ['due']);
});

test('applyPostTenderDateGuard — unknown status acts as pre-tender (fails-open)', () => {
  // A patch coming through with a status the API does not yet know about
  // (e.g. a label introduced by a future migration before this module
  // is updated) must not block writes. The frontend constants file is
  // authoritative for valid labels; this guard is concerned only with
  // *known* post-tender ones.
  const patch = { ready: '2026-05-27' };
  const result = applyPostTenderDateGuard(patch, { id: 'O-3', status: 'BrandNewStatus' });
  assert.equal(result.reject, false);
  assert.deepEqual(result.strippedFields, []);
  assert.deepEqual(patch, { ready: '2026-05-27' });
});
