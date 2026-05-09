/**
 * Regression tests for Bug #161 — Mobile invoice edit modal opens with
 * blank Invoice #, Amount, and Due Date.
 *
 * Root cause: DbApi.invoices() returns raw DB rows (`invoice_number`,
 * `invoiced_amount`, `due_date`, `payment_terms`, `agreed_cost`,
 * `shipment_ids`) but buildInvoiceFormFromRow used to read only the
 * camelCase shape (`num`, `amount`, `due`). These tests pin the
 * snake_case → form-state hydration so a future refactor of either
 * mapper can't silently re-introduce the empty-form behaviour.
 */
import {
  buildInvoiceFormFromRow,
} from '../invoiceService';

// invoiceService imports InvoicesApi via '../shared/api'. We don't call
// any saveInvoice/etc. paths here, but jest still loads transitive
// modules — mock the API surface so it doesn't try to bind a real
// fetch / storage at import time.
jest.mock('../../shared/api', () => ({
  InvoicesApi: {
    list:       jest.fn(),
    submit:     jest.fn(),
    update:     jest.fn(),
    save:       jest.fn(),
    approve:    jest.fn(),
    reject:     jest.fn(),
    sendToAp:   jest.fn(),
    remove:     jest.fn(),
  },
}));

describe('buildInvoiceFormFromRow — Bug #161 DB → form hydration', () => {
  it('reads canonical snake_case columns from a raw DB row', () => {
    const row = {
      id: 'INV-2026-001',
      invoice_number: 'INV-2026-001',
      carrier: 'XPO',
      shipment_id: 'SHP-2026-1234',
      invoice_date: '2026-05-06',
      due_date: '2026-06-05',
      payment_terms: 'NET30',
      agreed_cost: 1200,
      invoiced_amount: 1250,
      status: 'Pending',
      notes: 'first row',
    };
    const f = buildInvoiceFormFromRow(row);
    expect(f.num).toBe('INV-2026-001');
    expect(f.shipId).toBe('SHP-2026-1234');
    expect(f.date).toBe('2026-05-06');
    expect(f.due).toBe('2026-06-05');
    expect(f.paymentTerms).toBe('NET30');
    expect(f.amount).toBe('1250');
    expect(f.agreed).toBe('1200');
    expect(f.status).toBe('Pending');
    expect(f.notes).toBe('first row');
  });

  it('still reads pre-mapped camelCase rows for back-compat', () => {
    const f = buildInvoiceFormFromRow({
      num: 'INV-2026-002',
      shipId: 'SHP-X',
      date: '2026-05-07',
      due: '2026-06-06',
      paymentTerms: 'NET45',
      amount: 999,
      agreed: 800,
      status: 'Approved',
    });
    expect(f.num).toBe('INV-2026-002');
    expect(f.shipId).toBe('SHP-X');
    expect(f.date).toBe('2026-05-07');
    expect(f.due).toBe('2026-06-06');
    expect(f.paymentTerms).toBe('NET45');
    expect(f.amount).toBe('999');
    expect(f.agreed).toBe('800');
    expect(f.status).toBe('Approved');
  });

  it('hydrates shipId + extraShipIds from shipment_ids[]', () => {
    const f = buildInvoiceFormFromRow({
      invoice_number: 'INV-CONS-1',
      shipment_ids: ['SHP-A', 'SHP-B', 'SHP-C'],
      invoiced_amount: 100,
    });
    expect(f.shipId).toBe('SHP-A');
    expect(f.extraShipIds).toBe('SHP-B, SHP-C');
  });

  it('falls back to legacy `agreed_rate` alias when only that key is present', () => {
    // Some old rows in the wild still use the agreed_rate alias that
    // bug #157 was about. The reader must still hydrate them.
    const f = buildInvoiceFormFromRow({
      invoice_number: 'INV-OLD',
      agreed_rate: 444,
    });
    expect(f.agreed).toBe('444');
  });

  it('returns blank invoice when given null', () => {
    const f = buildInvoiceFormFromRow(null);
    expect(f.num).not.toBe('');
    expect(typeof f.num).toBe('string');
    // due is auto-computed from today + NET30 by buildBlankInvoice.
    expect(f.paymentTerms).toBe('NET30');
  });

  it('coerces numeric amount/agreed to strings (form inputs)', () => {
    // Form fields are TextInputs — numbers must reach the form as strings.
    const f = buildInvoiceFormFromRow({
      invoice_number: 'INV-Z',
      invoiced_amount: 0,
      agreed_cost: 0,
    });
    expect(typeof f.amount).toBe('string');
    expect(typeof f.agreed).toBe('string');
    expect(f.amount).toBe('0');
    expect(f.agreed).toBe('0');
  });

  it('does NOT lose payment_terms when given snake_case', () => {
    const f = buildInvoiceFormFromRow({
      invoice_number: 'INV-T',
      payment_terms: 'NET60',
    });
    expect(f.paymentTerms).toBe('NET60');
  });
});
