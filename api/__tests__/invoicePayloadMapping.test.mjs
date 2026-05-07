// Regression tests for QA #131 — Mobile finance "DB upset" error.
//
// The mobile app was POSTing camelCase form keys (`num`, `shipId`,
// `paymentTerms`, `amount`, …) straight to /api/db/invoices, but the
// columns are snake_case (invoice_number, shipment_id, payment_terms,
// invoiced_amount). PostgREST returned 400 because none of those
// camelCase keys exist as columns.
//
// Fix: route NEW invoices through /api/invoices (camelCase contract,
// audited) and translate EDIT PATCHes to snake_case before they hit
// /api/db/invoices/:id.
//
// Run with: node --test api/__tests__/invoicePayloadMapping.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiPath = path.resolve(__dirname, '../../mobile/src/shared/api.js');
const mod = await import(pathToFileURL(apiPath).href);
const { mapInvoiceFormToCreatePayload, mapInvoiceFormToEditPatch } = mod;

const baseForm = {
  num: 'INV-2026-001',
  carrier: 'XPO',
  shipId: 'SHP-2026-1234',
  extraShipIds: '',
  status: 'Pending',
  date: '2026-05-06',
  due: '2026-06-05',
  paymentTerms: 'NET30',
  amount: '1250.00',
  agreed: '1200.00',
  notes: 'Test invoice',
};

test('CREATE payload uses the camelCase contract /api/invoices expects', () => {
  const out = mapInvoiceFormToCreatePayload(baseForm);
  assert.equal(out.invoiceNumber,  'INV-2026-001');
  assert.equal(out.carrier,        'XPO');
  assert.equal(out.shipmentId,     'SHP-2026-1234');
  assert.equal(out.invoicedAmount, 1250);
  assert.equal(out.invoiceDate,    '2026-05-06');
  assert.equal(out.paymentTerms,   'NET30');
  assert.equal(out.notes,          'Test invoice');
  // No snake_case keys leaked.
  assert.equal(out.invoice_number,  undefined);
  assert.equal(out.shipment_id,     undefined);
  assert.equal(out.invoiced_amount, undefined);
  assert.equal(out.invoice_date,    undefined);
  assert.equal(out.payment_terms,   undefined);
  assert.equal(out.due_date,        undefined);
});

test('CREATE payload coerces amount to a number', () => {
  const out = mapInvoiceFormToCreatePayload({ ...baseForm, amount: '99.5' });
  assert.equal(typeof out.invoicedAmount, 'number');
  assert.equal(out.invoicedAmount, 99.5);
});

test('CREATE payload — empty amount becomes 0', () => {
  const out = mapInvoiceFormToCreatePayload({ ...baseForm, amount: '' });
  assert.equal(out.invoicedAmount, 0);
});

test('CREATE payload — extraShipIds rolls into shipmentIds[] only when >1 ID', () => {
  // Single shipment → shipmentIds is undefined (only scalar shipmentId).
  const single = mapInvoiceFormToCreatePayload(baseForm);
  assert.equal(single.shipmentIds, undefined);

  // Multi-ship consolidated invoice → shipmentIds carries everything.
  const multi = mapInvoiceFormToCreatePayload({
    ...baseForm,
    extraShipIds: 'SHP-2026-1235, SHP-2026-1236',
  });
  assert.deepEqual(multi.shipmentIds, [
    'SHP-2026-1234',
    'SHP-2026-1235',
    'SHP-2026-1236',
  ]);
});

test('CREATE payload — defaults paymentTerms to NET30 when missing', () => {
  const out = mapInvoiceFormToCreatePayload({ ...baseForm, paymentTerms: '' });
  assert.equal(out.paymentTerms, 'NET30');
});

test('EDIT patch translates camelCase form keys → snake_case columns', () => {
  const out = mapInvoiceFormToEditPatch(baseForm);
  assert.equal(out.invoice_number,  'INV-2026-001');
  assert.equal(out.carrier,         'XPO');
  assert.equal(out.shipment_id,     'SHP-2026-1234');
  assert.equal(out.status,          'Pending');
  assert.equal(out.invoice_date,    '2026-05-06');
  assert.equal(out.due_date,        '2026-06-05');
  assert.equal(out.payment_terms,   'NET30');
  assert.equal(out.invoiced_amount, 1250);
  assert.equal(out.agreed_cost,     1200);
  assert.equal(out.notes,           'Test invoice');
  // No camelCase keys leaked into the PostgREST payload.
  assert.equal(out.num,           undefined);
  assert.equal(out.shipId,        undefined);
  assert.equal(out.paymentTerms,  undefined);
  assert.equal(out.amount,        undefined);
  assert.equal(out.agreed,        undefined);
  assert.equal(out.date,          undefined);
  assert.equal(out.due,           undefined);
});

test('EDIT patch — only includes keys actually present on the form', () => {
  // Partial edits (e.g. status-only change) shouldn't blow null over
  // every other column. The mapper only writes a key when the form
  // explicitly carries it.
  const partial = mapInvoiceFormToEditPatch({ status: 'Approved' });
  assert.deepEqual(Object.keys(partial), ['status']);
  assert.equal(partial.status, 'Approved');
});

test('EDIT patch — empty agreed becomes null (clear), not 0', () => {
  // Clearing agreed_cost is a real edit case; we mustn't conflate "not
  // touched" with "cleared to 0".
  const out = mapInvoiceFormToEditPatch({ ...baseForm, agreed: '' });
  assert.equal(out.agreed_cost, null);
});

test('EDIT patch — empty shipId becomes null (unlink shipment)', () => {
  const out = mapInvoiceFormToEditPatch({ ...baseForm, shipId: '' });
  assert.equal(out.shipment_id, null);
});

test('EDIT patch — coerces amount string → number', () => {
  const out = mapInvoiceFormToEditPatch({ ...baseForm, amount: '7' });
  assert.equal(typeof out.invoiced_amount, 'number');
  assert.equal(out.invoiced_amount, 7);
});
