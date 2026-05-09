// Regression tests for Bug #157 — Freight Invoice "agreed_rate column
// not in schema cache" 400.
//
// The fix lives in api/services/invoiceAudit.js as the new
// buildInvoicePatch helper (exposed via _internals). It maps client
// camelCase keys to DB columns and rewrites the legacy alias
// `agreed_rate` to `agreed_cost`. These tests pin the field map +
// alias coverage + light validation so a future refactor can't
// silently drop a column.
//
// Run with: node --test api/__tests__/invoiceAuditEdit.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// invoiceAudit.js requires('./supabase') and ('./changeHistory') at
// module-load. Those modules read env at require-time. We don't need
// either for the buildInvoicePatch tests, so we stub them on the
// require cache before pulling invoiceAudit in.
const supabaseStubPath = require.resolve('../services/supabase');
const historyStubPath  = require.resolve('../services/changeHistory');
require.cache[supabaseStubPath] = {
  id: supabaseStubPath, filename: supabaseStubPath, loaded: true,
  exports: {
    dbSelect: async () => [],
    dbUpdate: async (_t, _id, patch) => ({ ...patch }),
    dbUpsert: async (_t, row) => row,
    getClient: () => ({}),
  },
};
require.cache[historyStubPath] = {
  id: historyStubPath, filename: historyStubPath, loaded: true,
  exports: {
    recordChange:      async () => null,
    recordFieldDiffs:  async () => [],
    recordChangeBatch: async () => [],
    buildRow:          (input) => ({ ...input }),
  },
};

const { _internals, editInvoice } = require('../services/invoiceAudit');
const { buildInvoicePatch, EDIT_FIELD_MAP, EDIT_LEGACY_ALIASES } = _internals;

// ── buildInvoicePatch — happy path / alias coverage ─────────────────

test('buildInvoicePatch maps camelCase keys to DB columns', () => {
  const out = buildInvoicePatch({
    invoiceNumber:  'INV-2026-001',
    carrier:        'XPO',
    carrierId:      'CRR-7',
    shipmentId:     'SHP-2026-1234',
    shipmentIds:    ['SHP-2026-1234', 'SHP-2026-1235'],
    invoiceDate:    '2026-05-06',
    dueDate:        '2026-06-05',
    agreedCost:     1200,
    invoicedAmount: 1250,
    status:         'Pending',
    paymentTerms:   'NET30',
    notes:          'Test invoice',
  });
  assert.equal(out.invoice_number,  'INV-2026-001');
  assert.equal(out.carrier,         'XPO');
  assert.equal(out.carrier_id,      'CRR-7');
  assert.equal(out.shipment_id,     'SHP-2026-1234');
  assert.deepEqual(out.shipment_ids, ['SHP-2026-1234', 'SHP-2026-1235']);
  assert.equal(out.invoice_date,    '2026-05-06');
  assert.equal(out.due_date,        '2026-06-05');
  assert.equal(out.agreed_cost,     1200);
  assert.equal(out.invoiced_amount, 1250);
  assert.equal(out.status,          'Pending');
  assert.equal(out.payment_terms,   'NET30');
  assert.equal(out.notes,           'Test invoice');
  // No camelCase keys leaked into the DB patch.
  for (const k of Object.keys(EDIT_FIELD_MAP)) {
    assert.equal(out[k], undefined, `Leaked camelCase key: ${k}`);
  }
});

test('buildInvoicePatch — legacy `agreed_rate` alias rewrites to `agreed_cost` (Bug #157)', () => {
  const out = buildInvoicePatch({ agreed_rate: 999 });
  assert.equal(out.agreed_cost, 999);
  assert.equal(out.agreed_rate, undefined,
    'agreed_rate must NEVER reach the DB layer — column does not exist');
});

test('buildInvoicePatch — `agreed` alias also rewrites to `agreed_cost`', () => {
  const out = buildInvoicePatch({ agreed: 750 });
  assert.equal(out.agreed_cost, 750);
});

test('buildInvoicePatch — domain camelCase wins over legacy snake_case alias', () => {
  // If both come through (a misbehaving legacy caller + a freshly-
  // updated UI), the canonical camelCase value should win.
  const out = buildInvoicePatch({
    agreed_rate: 100,    // legacy
    agreedCost:  500,    // domain
  });
  assert.equal(out.agreed_cost, 500);
});

test('EDIT_LEGACY_ALIASES never resolves a non-existent column', () => {
  // Every alias must point at a real DB column (= one we list in
  // EDIT_FIELD_MAP) so the runtime mapper can never produce a key
  // that PostgREST will 400 on.
  const allowed = new Set(Object.values(EDIT_FIELD_MAP));
  for (const [alias, col] of Object.entries(EDIT_LEGACY_ALIASES)) {
    assert.ok(
      allowed.has(col),
      `Alias '${alias}' → '${col}' is not a known DB column`,
    );
  }
});

// ── Type coercion + light validation ────────────────────────────────

test('buildInvoicePatch coerces invoicedAmount string → number', () => {
  const out = buildInvoicePatch({ invoicedAmount: '1234.5' });
  assert.equal(typeof out.invoiced_amount, 'number');
  assert.equal(out.invoiced_amount, 1234.5);
});

test('buildInvoicePatch coerces agreedCost string → number', () => {
  const out = buildInvoicePatch({ agreedCost: '900' });
  assert.equal(typeof out.agreed_cost, 'number');
  assert.equal(out.agreed_cost, 900);
});

test('buildInvoicePatch — string shipmentIds splits on commas/whitespace', () => {
  const out = buildInvoicePatch({
    shipmentIds: 'SHP-A, SHP-B   SHP-C',
  });
  assert.deepEqual(out.shipment_ids, ['SHP-A', 'SHP-B', 'SHP-C']);
});

test('buildInvoicePatch — array shipmentIds passes through untouched', () => {
  const out = buildInvoicePatch({
    shipmentIds: ['SHP-A', 'SHP-B'],
  });
  assert.deepEqual(out.shipment_ids, ['SHP-A', 'SHP-B']);
});

test('buildInvoicePatch — invalid status throws 400', () => {
  assert.throws(
    () => buildInvoicePatch({ status: 'Banana' }),
    (err) => err.status === 400 && /Invalid status/.test(err.message),
  );
});

test('buildInvoicePatch — every CHECK status passes', () => {
  for (const status of [
    'Pending', 'Approved', 'Rejected', 'Disputed',
    'On Hold', 'Cancelled', 'Paid',
  ]) {
    const out = buildInvoicePatch({ status });
    assert.equal(out.status, status, `Status '${status}' should pass`);
  }
});

test('buildInvoicePatch — negative invoicedAmount throws 400', () => {
  assert.throws(
    () => buildInvoicePatch({ invoicedAmount: -1 }),
    (err) => err.status === 400 && />= 0/.test(err.message),
  );
});

test('buildInvoicePatch — empty patch object yields empty output', () => {
  // Empty input is a no-op; the route handler is what surfaces the
  // 400 ("No editable fields provided") via editInvoice.
  const out = buildInvoicePatch({});
  assert.deepEqual(out, {});
});

test('buildInvoicePatch — null/undefined input yields empty output', () => {
  assert.deepEqual(buildInvoicePatch(null), {});
  assert.deepEqual(buildInvoicePatch(undefined), {});
});

test('buildInvoicePatch — partial patch only writes provided keys', () => {
  // Status-only edit must NOT clobber other columns to undefined.
  const out = buildInvoicePatch({ status: 'Approved' });
  assert.deepEqual(Object.keys(out), ['status']);
  assert.equal(out.status, 'Approved');
});

// ── editInvoice — round-trip via the stubbed dbSelect/dbUpdate ──────

test('editInvoice writes the mapped patch + returns the updated row', async () => {
  // Mutate the SAME stub-exports object that invoiceAudit captured at
  // require-time (replacing the cache entry's `exports` property
  // wouldn't update invoiceAudit's already-bound `db` reference).
  const captured = {};
  const stub = require.cache[supabaseStubPath].exports;
  const origSelect = stub.dbSelect;
  const origUpdate = stub.dbUpdate;
  stub.dbSelect = async () => [{ id: 'INV-1', invoice_number: 'INV-1' }];
  stub.dbUpdate = async (table, id, patch) => {
    captured.table = table;
    captured.id    = id;
    captured.patch = patch;
    return { id, ...patch };
  };

  try {
    const out = await editInvoice({
      invoiceId: 'INV-1',
      patch: { agreed_rate: 500, dueDate: '2026-06-30' },
      user: { email: 'qa@zoree.test' },
    });
    assert.equal(captured.table, 'invoices');
    assert.equal(captured.id, 'INV-1');
    assert.equal(captured.patch.agreed_cost, 500,
      'Bug #157 — alias rewrite must reach dbUpdate as agreed_cost');
    assert.equal(captured.patch.due_date, '2026-06-30');
    assert.ok(captured.patch.updated_at, 'updated_at must be stamped');
    assert.equal(out.agreed_cost, 500);
  } finally {
    stub.dbSelect = origSelect;
    stub.dbUpdate = origUpdate;
  }
});

test('editInvoice — missing invoiceId throws 400', async () => {
  await assert.rejects(
    editInvoice({ invoiceId: '', patch: { status: 'Approved' } }),
    (err) => err.status === 400 && /invoiceId/.test(err.message),
  );
});

test('editInvoice — empty patch throws 400 (No editable fields)', async () => {
  await assert.rejects(
    editInvoice({ invoiceId: 'INV-1', patch: {} }),
    (err) => err.status === 400 && /No editable fields/.test(err.message),
  );
});
