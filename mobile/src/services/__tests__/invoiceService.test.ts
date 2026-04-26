/**
 * Unit tests for mobile/src/services/invoiceService.ts.
 *
 * Covers form helpers (blank, seed-from-row, recomputeDueDate),
 * validation, payload mapping, and mutations
 * (saveInvoice / deleteInvoice / approveInvoice / disputeInvoice).
 *
 * InvoicesApi is mocked. The shared/services/invoiceService.js helpers
 * (generateInvoiceNum, computeDueDate, etc.) are imported live since
 * they're plain pure functions.
 */

import {
  INVOICE_STATUSES,
  PAYMENT_TERMS,
  approveInvoice,
  buildBlankInvoice,
  buildInvoiceFormFromRow,
  buildInvoicePayload,
  deleteInvoice,
  disputeInvoice,
  recomputeDueDate,
  saveInvoice,
  validateInvoiceForm,
} from '../invoiceService';
import { InvoicesApi } from '../../shared/api';

jest.mock('../../shared/api', () => ({
  InvoicesApi: {
    save: jest.fn(),
    remove: jest.fn(),
    approve: jest.fn(),
    dispute: jest.fn(),
  },
}));

describe('enum exports', () => {
  it('exposes invoice status and payment-terms enums', () => {
    expect(INVOICE_STATUSES).toEqual(expect.arrayContaining(['Pending', 'Approved', 'Disputed']));
    expect(PAYMENT_TERMS).toEqual(expect.arrayContaining(['NET30']));
  });
});

describe('buildBlankInvoice', () => {
  it('returns a form with sane defaults', () => {
    const f = buildBlankInvoice();
    expect(f.num).toMatch(/^INV-\d{5}$/);
    expect(f.status).toBe('Pending');
    expect(f.paymentTerms).toBe('NET30');
    expect(f.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(f.due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Default due is +30 days
    const date = new Date(f.date);
    const due = new Date(f.due);
    expect((due.getTime() - date.getTime()) / 86400000).toBe(30);
  });
});

describe('buildInvoiceFormFromRow', () => {
  it('returns blank form when row is null', () => {
    const f = buildInvoiceFormFromRow(null);
    expect(f.num).toMatch(/^INV-/);
    expect(f.amount).toBe('');
  });

  it('preserves existing values and aliases (snake_case → camelCase)', () => {
    const f = buildInvoiceFormFromRow({
      num: 'INV-99999',
      carrier: 'XPO',
      ship_id: 'SHP-2025-1234',
      extra_ship_ids: 'SHP-2025-5678',
      status: 'Approved',
      invoice_date: '2026-04-01',
      due_date: '2026-05-01',
      payment_terms: 'NET45',
      amount: 1500.5,
      agreed: 1450,
      notes: 'short pay',
    });
    expect(f.num).toBe('INV-99999');
    expect(f.carrier).toBe('XPO');
    expect(f.shipId).toBe('SHP-2025-1234');
    expect(f.extraShipIds).toBe('SHP-2025-5678');
    expect(f.status).toBe('Approved');
    expect(f.date).toBe('2026-04-01');
    expect(f.due).toBe('2026-05-01');
    expect(f.paymentTerms).toBe('NET45');
    expect(f.amount).toBe('1500.5');
    expect(f.agreed).toBe('1450');
    expect(f.notes).toBe('short pay');
  });
});

describe('recomputeDueDate', () => {
  it('updates the due date based on payment terms', () => {
    const f = buildBlankInvoice();
    const r = recomputeDueDate({ ...f, date: '2026-04-01', paymentTerms: 'NET15' });
    expect(r.due).toBe('2026-04-16');
    const r45 = recomputeDueDate({ ...f, date: '2026-04-01', paymentTerms: 'NET45' });
    expect(r45.due).toBe('2026-05-16');
  });

  it('no-ops when date is missing', () => {
    const f = buildBlankInvoice();
    const r = recomputeDueDate({ ...f, date: '' });
    expect(r).toEqual({ ...f, date: '' });
  });
});

describe('validateInvoiceForm', () => {
  const base = buildBlankInvoice();

  it('rejects missing invoice number', () => {
    const r = validateInvoiceForm({ ...base, num: '   ' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Invoice/);
  });

  it('rejects missing carrier', () => {
    const r = validateInvoiceForm({ ...base, carrier: '', amount: '100' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Carrier/);
  });

  it('rejects negative amount', () => {
    const r = validateInvoiceForm({ ...base, carrier: 'XPO', amount: '-5' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Amount/);
  });

  it('accepts a populated form', () => {
    const r = validateInvoiceForm({ ...base, carrier: 'XPO', amount: '1500' });
    expect(r.ok).toBe(true);
  });
});

describe('buildInvoicePayload', () => {
  const base = buildBlankInvoice();

  it('coerces numeric fields, blanks → null for optionals', () => {
    const p = buildInvoicePayload({
      ...base,
      carrier: 'XPO',
      amount: '1500',
      agreed: '',
      notes: '',
      shipId: '',
    });
    expect(p.amount).toBe(1500);
    expect(p.agreed).toBeNull();
    expect(p.notes).toBeNull();
    expect(p.shipId).toBeNull();
    expect(p.id).toBeUndefined(); // create flow
  });

  it('attaches baseId when editing', () => {
    const p = buildInvoicePayload({ ...base, carrier: 'XPO', amount: '100' }, 'inv-123');
    expect(p.id).toBe('inv-123');
  });

  it('coerces agreed when present', () => {
    const p = buildInvoicePayload({ ...base, carrier: 'XPO', amount: '100', agreed: '90.5' });
    expect(p.agreed).toBe(90.5);
  });
});

describe('mutations', () => {
  beforeEach(() => jest.clearAllMocks());

  it('saveInvoice calls InvoicesApi.save with payload', async () => {
    (InvoicesApi.save as jest.Mock).mockResolvedValue({ ok: true });
    const base = buildBlankInvoice();
    await saveInvoice({ ...base, carrier: 'XPO', amount: '500' });
    expect(InvoicesApi.save).toHaveBeenCalledWith(
      expect.objectContaining({ carrier: 'XPO', amount: 500 }),
    );
  });

  it('saveInvoice rejects when validation fails', async () => {
    const base = buildBlankInvoice();
    await expect(
      saveInvoice({ ...base, carrier: '', amount: '100' }),
    ).rejects.toThrow(/Carrier/);
    expect(InvoicesApi.save).not.toHaveBeenCalled();
  });

  it('saveInvoice attaches baseId on edit', async () => {
    (InvoicesApi.save as jest.Mock).mockResolvedValue({ ok: true });
    const base = buildBlankInvoice();
    await saveInvoice({ ...base, carrier: 'XPO', amount: '100' }, 'inv-1');
    expect(InvoicesApi.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'inv-1' }));
  });

  it('deleteInvoice rejects when no id is present', async () => {
    await expect(deleteInvoice({})).rejects.toThrow(/id is required/);
    expect(InvoicesApi.remove).not.toHaveBeenCalled();
  });

  it('deleteInvoice resolves the id from id / invoice_id / num', async () => {
    (InvoicesApi.remove as jest.Mock).mockResolvedValue({ ok: true });
    await deleteInvoice({ id: 'inv-1' });
    expect(InvoicesApi.remove).toHaveBeenCalledWith('inv-1');

    (InvoicesApi.remove as jest.Mock).mockClear();
    await deleteInvoice({ num: 'INV-9' });
    expect(InvoicesApi.remove).toHaveBeenCalledWith('INV-9');
  });

  it('approveInvoice / disputeInvoice call the right API method', async () => {
    (InvoicesApi.approve as jest.Mock).mockResolvedValue({ ok: true });
    (InvoicesApi.dispute as jest.Mock).mockResolvedValue({ ok: true });
    await approveInvoice({ id: 'inv-1' });
    expect(InvoicesApi.approve).toHaveBeenCalledWith('inv-1');
    await disputeInvoice({ id: 'inv-2' });
    expect(InvoicesApi.dispute).toHaveBeenCalledWith('inv-2');
  });

  it('approveInvoice / disputeInvoice reject on missing id', async () => {
    await expect(approveInvoice({})).rejects.toThrow(/id is required/);
    await expect(disputeInvoice({})).rejects.toThrow(/id is required/);
  });
});
