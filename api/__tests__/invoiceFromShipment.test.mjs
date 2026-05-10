// Unit tests for REQ-184/185/186/187 — direct-from-shipment invoice creation.
//
// Exercises:
//   - costLinesFromShipment: shipment row → cost-line array translation
//   - sumApproved / sumInvoiced totals
//   - findOpenInvoiceForShipment idempotency check (with stubbed db)
//   - createInvoiceFromShipment integration (with stubbed db + history)
//
// Run with: node --test api/__tests__/invoiceFromShipment.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Stub the supabase + changeHistory modules BEFORE requiring the
// services-under-test, the same way invoiceAuditEdit.test.mjs does it.
// invoiceFromShipment captures `db` and `history` at require-time, so
// later mutations on the cache exports object will still flow through.
const supabaseStubPath = require.resolve('../services/supabase');
const historyStubPath  = require.resolve('../services/changeHistory');

const dbCalls = { selects: [], inserts: [], deletes: [], upserts: [], updates: [] };
const fakeClient = {
  from(table) {
    return {
      delete() {
        return {
          eq: async () => { dbCalls.deletes.push({ table }); return { error: null }; },
        };
      },
      insert(rows) {
        return {
          select: async () => { dbCalls.inserts.push({ table, rows }); return { data: rows.map((r, i) => ({ ...r, id: r.id || `gen-${i}` })), error: null }; },
        };
      },
      update(patch) {
        return {
          eq() {
            return {
              eq() {
                return {
                  select: async () => { dbCalls.updates.push({ table, patch }); return { data: [{ id: 'line-1', invoice_id: 'INV-X', cost_type: 'base', invoice_cost: 0, approved_cost: 95, ...patch }], error: null }; },
                };
              },
              select: async () => { dbCalls.updates.push({ table, patch }); return { data: [{ id: 'line-1', invoice_id: 'INV-X', cost_type: 'base', invoice_cost: 0, approved_cost: 95, ...patch }], error: null }; },
            };
          },
        };
      },
    };
  },
};

require.cache[supabaseStubPath] = {
  id: supabaseStubPath, filename: supabaseStubPath, loaded: true,
  exports: {
    dbSelect: async (table, query) => { dbCalls.selects.push({ table, query }); return []; },
    dbUpsert: async (table, row) => { dbCalls.upserts.push({ table, row }); return row; },
    dbUpdate: async (_t, _id, patch) => ({ ...patch }),
    dbDelete: async () => ({ deleted: true }),
    getClient: () => fakeClient,
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

const costLines = require('../services/invoiceCostLines');
const fromShip  = require('../services/invoiceFromShipment');

// ── Pure: costLinesFromShipment ─────────────────────────────────

test('costLinesFromShipment — emits base + fuel + accessorials when set', () => {
  const lines = costLines.costLinesFromShipment({
    id: 'SHP-2026-273786',
    rate: 1000,
    fuel_surcharge: 150,
    accessorials: 75,
    discount: 0,
  });
  assert.equal(lines.length, 3);
  const types = lines.map((l) => l.cost_type);
  assert.deepEqual(types, ['base', 'fuel_surcharge', 'accessorial']);
  // approved_cost defaults to invoice_cost (REQ-186)
  for (const l of lines) {
    assert.equal(l.approved_cost, l.invoice_cost,
      `approved_cost should default to invoice_cost on ${l.cost_type}`);
  }
});

test('costLinesFromShipment — always emits base line even when rate=0', () => {
  const lines = costLines.costLinesFromShipment({
    id: 'SHP-X', rate: 0, fuel_surcharge: 0, accessorials: 0,
  });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].cost_type, 'base');
  assert.equal(lines[0].invoice_cost, 0);
});

test('costLinesFromShipment — discount comes through as a negative line', () => {
  const lines = costLines.costLinesFromShipment({
    id: 'SHP-X', rate: 500, fuel_surcharge: 0, accessorials: 0, discount: 50,
  });
  const disc = lines.find((l) => l.cost_type === 'discount');
  assert.ok(disc, 'discount line should exist when shipment.discount > 0');
  assert.ok(disc.invoice_cost < 0, 'discount stored as negative invoice_cost');
  assert.equal(disc.approved_cost, disc.invoice_cost);
});

test('costLinesFromShipment — null/undefined input yields empty array', () => {
  assert.deepEqual(costLines.costLinesFromShipment(null), []);
  assert.deepEqual(costLines.costLinesFromShipment(undefined), []);
});

test('sumApproved / sumInvoiced — totals across the line set', () => {
  const lines = [
    { invoice_cost: 100, approved_cost: 90 },
    { invoice_cost: 50,  approved_cost: 50 },
    { invoice_cost: -10, approved_cost: -10 },
  ];
  assert.equal(costLines.sumInvoiced(lines), 140);
  assert.equal(costLines.sumApproved(lines), 130);
});

// ── createInvoiceFromShipment — happy path ──────────────────────

test('createInvoiceFromShipment — builds invoice with status On Hold and cost lines', async () => {
  // Reset call log
  dbCalls.selects.length = 0;
  dbCalls.inserts.length = 0;
  dbCalls.upserts.length = 0;

  const stub = require.cache[supabaseStubPath].exports;
  const origSelect = stub.dbSelect;
  stub.dbSelect = async (table, query) => {
    dbCalls.selects.push({ table, query });
    if (table === 'shipments' && query?.filters?.[0]?.[2] === 'SHP-2026-273786') {
      return [{
        id: 'SHP-2026-273786',
        carrier: 'XPO LOGISTICS',
        carrier_id: 'CRR-1',
        rate: 1000,
        fuel_surcharge: 150,
        accessorials: 75,
        total_cost: 1225,
        bol_number: 'BOL-AB-9001',
        bol_type: 'CBOL',
        tenant_id: 't1',
      }];
    }
    if (table === 'invoices') {
      // No existing invoice — return empty
      return [];
    }
    return [];
  };

  try {
    const out = await fromShip.createInvoiceFromShipment({
      shipmentId: 'SHP-2026-273786',
      user:       { email: 'planner@zoree.test' },
    });
    assert.equal(out.reused, false);
    assert.equal(out.invoice.status, 'On Hold', 'REQ-185: status starts On Hold');
    assert.equal(out.invoice.shipment_id, 'SHP-2026-273786');
    assert.deepEqual(out.invoice.bol_ids, ['BOL-AB-9001'], 'REQ-187: bol_ids inherited from shipment');
    assert.equal(out.invoice.agreed_cost, 1225);
    assert.equal(out.invoice.invoiced_amount, 1225,
      'direct-from-shipment: invoiced_amount equals shipment total_cost');
    // Three cost lines in the inserts (base + fuel + accessorials, no discount)
    const lineInsert = dbCalls.inserts.find((c) => c.table === 'invoice_cost_lines');
    assert.ok(lineInsert, 'cost lines should be inserted');
    assert.equal(lineInsert.rows.length, 3);
    assert.deepEqual(
      lineInsert.rows.map((r) => r.cost_type),
      ['base', 'fuel_surcharge', 'accessorial'],
    );
  } finally {
    stub.dbSelect = origSelect;
  }
});

test('createInvoiceFromShipment — idempotent when an open invoice already exists', async () => {
  dbCalls.selects.length = 0;
  dbCalls.inserts.length = 0;
  dbCalls.upserts.length = 0;

  const existingInvoice = {
    id: 'INV-2026-999',
    invoice_number: 'INV-99999',
    status: 'On Hold',
    shipment_id: 'SHP-DUP',
    shipment_ids: ['SHP-DUP'],
  };
  const stub = require.cache[supabaseStubPath].exports;
  const origSelect = stub.dbSelect;
  stub.dbSelect = async (table) => {
    if (table === 'invoices') return [existingInvoice];
    if (table === 'invoice_cost_lines') return [{ id: 'L1', cost_type: 'base', invoice_cost: 100, approved_cost: 100 }];
    return [];
  };

  try {
    const out = await fromShip.createInvoiceFromShipment({
      shipmentId: 'SHP-DUP', user: null,
    });
    assert.equal(out.reused, true,
      'must reuse the existing open invoice instead of creating a duplicate (REQ-184 idempotency)');
    assert.equal(out.invoice.id, 'INV-2026-999');
    // The new-row upsert path should NOT have run.
    assert.equal(dbCalls.upserts.length, 0, 'no new invoice should be inserted');
  } finally {
    stub.dbSelect = origSelect;
  }
});

test('createInvoiceFromShipment — 404 when the shipment is not found', async () => {
  const stub = require.cache[supabaseStubPath].exports;
  const origSelect = stub.dbSelect;
  stub.dbSelect = async () => [];
  try {
    await assert.rejects(
      fromShip.createInvoiceFromShipment({ shipmentId: 'SHP-MISSING', user: null }),
      (err) => err.status === 404 && /Shipment not found/.test(err.message),
    );
  } finally {
    stub.dbSelect = origSelect;
  }
});

test('createInvoiceFromShipment — 400 when shipmentId is missing', async () => {
  await assert.rejects(
    fromShip.createInvoiceFromShipment({ shipmentId: '', user: null }),
    (err) => err.status === 400 && /shipmentId/.test(err.message),
  );
});
