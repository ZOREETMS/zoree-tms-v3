/**
 * Mobile invoice service — orchestration layer for invoice CRUD on
 * the freight invoices screens.
 *
 * Pure service layer: calls InvoicesApi, returns plain data, no
 * React state, no UI side-effects.
 *
 * Web parity reference:
 *   frontend/src/services/invoiceService.js (pure helpers — already
 *     mirrored at mobile/src/shared/services/invoiceService.js)
 *   frontend/src/components/invoices/InvoiceModal.jsx → buildPayload
 *
 * The pure helpers (computeStats, generateInvoiceNum, computeDueDate)
 * live in the shared module so the bulk-plan and freight-audit code
 * paths can pull from one place. This file owns the *mutations*.
 */

import { InvoicesApi } from '../shared/api';
import {
  computeDueDate,
  generateInvoiceNum,
} from '../shared/services/invoiceService';

/* ── Form state ───────────────────────────────────────────────────── */

export const INVOICE_STATUSES = ['Pending', 'Approved', 'Disputed', 'Paid'] as const;
export const PAYMENT_TERMS = ['NET15', 'NET30', 'NET45', 'NET60'] as const;

export interface InvoiceFormState {
  num: string;
  carrier: string;
  shipId: string;
  extraShipIds: string;
  status: string;
  date: string;
  due: string;
  paymentTerms: string;
  amount: string;
  agreed: string;
  notes: string;
}

/** Build the blank form state used by the create modal. */
export function buildBlankInvoice(): InvoiceFormState {
  const today = new Date().toISOString().slice(0, 10);
  return {
    num: generateInvoiceNum(),
    carrier: '',
    shipId: '',
    extraShipIds: '',
    status: 'Pending',
    date: today,
    due: computeDueDate(today, 'NET30'),
    paymentTerms: 'NET30',
    amount: '',
    agreed: '',
    notes: '',
  };
}

/** Seed form state from an existing invoice row (edit flow). */
export function buildInvoiceFormFromRow(invoice: any): InvoiceFormState {
  if (!invoice) return buildBlankInvoice();
  return {
    num: invoice.num || invoice.invoice_num || '',
    carrier: invoice.carrier || '',
    shipId: invoice.shipId || invoice.ship_id || invoice.shipment_id || '',
    extraShipIds: invoice.extraShipIds || invoice.extra_ship_ids || '',
    status: invoice.status || 'Pending',
    date: invoice.date || invoice.invoice_date || '',
    due: invoice.due || invoice.due_date || '',
    paymentTerms: invoice.paymentTerms || invoice.payment_terms || 'NET30',
    amount: invoice.amount != null ? String(invoice.amount) : '',
    agreed: invoice.agreed != null ? String(invoice.agreed) : '',
    notes: invoice.notes || '',
  };
}

/**
 * Recompute the due date when invoice date or payment terms changes.
 * Useful for the form so the user sees the resulting due date as
 * they edit. Matches the web modal's `handleField` side effect.
 */
export function recomputeDueDate(form: InvoiceFormState): InvoiceFormState {
  if (!form.date) return form;
  return { ...form, due: computeDueDate(form.date, form.paymentTerms) };
}

/* ── Validation ───────────────────────────────────────────────────── */

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

export function validateInvoiceForm(form: InvoiceFormState): ValidationResult {
  if (!form.num?.trim()) return { ok: false, error: 'Invoice # is required.' };
  if (!form.carrier?.trim()) return { ok: false, error: 'Carrier is required.' };
  if (!form.date) return { ok: false, error: 'Invoice date is required.' };
  const amt = parseFloat(form.amount);
  if (Number.isNaN(amt) || amt < 0) return { ok: false, error: 'Amount must be a positive number.' };
  return { ok: true };
}

/* ── Payload builder ──────────────────────────────────────────────── */

/**
 * Map the form state to the DB row shape. Mirrors what the web
 * InvoiceModal builds. Numeric fields are coerced; optional fields
 * become null when blank so the row writes deterministically.
 *
 * @param form    Current form state
 * @param baseId  Existing row id (for an edit). Pass `null` to create.
 */
export function buildInvoicePayload(
  form: InvoiceFormState,
  baseId?: string | null,
): Record<string, any> {
  const payload: Record<string, any> = {
    num: form.num.trim(),
    carrier: form.carrier.trim(),
    shipId: form.shipId || null,
    extraShipIds: form.extraShipIds || null,
    status: form.status || 'Pending',
    date: form.date,
    due: form.due || null,
    paymentTerms: form.paymentTerms || 'NET30',
    amount: parseFloat(form.amount) || 0,
    agreed: form.agreed ? parseFloat(form.agreed) : null,
    notes: form.notes || null,
  };
  if (baseId) payload.id = baseId;
  return payload;
}

/* ── Mutations ────────────────────────────────────────────────────── */

/**
 * Resolve the row id to use for API calls. Invoice rows in this
 * codebase carry both an `id` (DB primary key) and a `num` (human
 * label) — the API uses whichever the row presents first.
 */
function resolveInvoiceId(invoice: any): string | undefined {
  return invoice?.id || invoice?.invoice_id || invoice?.num || undefined;
}

/**
 * Save (create or update) an invoice row. Routes through the API's
 * combined save endpoint which decides POST vs PATCH based on whether
 * an id is present in the payload.
 */
export async function saveInvoice(
  form: InvoiceFormState,
  baseId?: string | null,
): Promise<any> {
  const validation = validateInvoiceForm(form);
  if (!validation.ok) throw new Error(validation.error);
  const payload = buildInvoicePayload(form, baseId || null);
  return InvoicesApi.save(payload);
}

/** Permanently delete an invoice. */
export async function deleteInvoice(invoice: any): Promise<any> {
  const id = resolveInvoiceId(invoice);
  if (!id) throw new Error('deleteInvoice: invoice id is required');
  return InvoicesApi.remove(id);
}

/** Mark an invoice as Approved on the backend. */
export async function approveInvoice(invoice: any): Promise<any> {
  const id = resolveInvoiceId(invoice);
  if (!id) throw new Error('approveInvoice: invoice id is required');
  return InvoicesApi.approve(id);
}

/** Mark an invoice as Disputed on the backend. */
export async function disputeInvoice(invoice: any): Promise<any> {
  const id = resolveInvoiceId(invoice);
  if (!id) throw new Error('disputeInvoice: invoice id is required');
  return InvoicesApi.dispute(id);
}

/* Re-export the pure helpers callers commonly want next to the
 * mutations so files that need both can import from one module. */
export {
  computeDueDate,
  generateInvoiceNum,
  computeStats,
  computeVariance,
} from '../shared/services/invoiceService';
