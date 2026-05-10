// ═══════════════════════════════════════════════════════════════════
// Create Invoice From Shipment Service — REQ-184/185/187.
//
// When a planner clicks 🧾 Invoice on a shipment, the server creates
// the invoice in one shot — no "fill in this form" intermediate step
// (REQ-184). The invoice inherits costs from the shipment and starts
// in status 'On Hold' (REQ-185). The shipment_id and BOL ids are
// populated from the shipment so finance can match against carrier
// invoices later (REQ-187).
//
// IDEMPOTENCY: if the shipment already has an open (non-Cancelled)
// invoice, the existing one is returned with `reused: true`. This makes
// the "Invoice" button safe to double-click and safe to call from a
// router that may retry on transient errors.
//
// This module composes the existing single-writer pieces:
//   - `db` (api/services/supabase.js)               : invoices table writes
//   - `invoiceCostLines.replaceForInvoice`          : cost-line breakdown
//   - `history.recordChangeBatch`                   : REQ-02 audit trail
// It does NOT call `invoiceAudit.submitInvoice` because that path runs
// the carrier-tolerance decision; the direct-from-shipment flow has no
// carrier variance to evaluate (the costs ARE the shipment costs) and
// must always start On Hold for finance review.
// ═══════════════════════════════════════════════════════════════════

const db = require('./supabase');
const history = require('./changeHistory');
const costLines = require('./invoiceCostLines');

const ON_HOLD = 'On Hold';
// Lifecycle states that mean "an invoice already exists for this
// shipment, don't create another one". Cancelled invoices are excluded
// so a planner can recreate after explicitly cancelling.
const OPEN_STATUSES = ['Pending', 'On Hold', 'Approved', 'Disputed', 'Paid'];

function num(v, fallback = 0) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function genInvoiceId() {
  const year = new Date().getFullYear();
  return `INV-${year}-${Math.floor(100000 + Math.random() * 900000)}`;
}

function genInvoiceNumber() {
  // Matches the frontend `generateInvoiceNum` (5-digit) so an invoice
  // created server-side from a shipment looks like one created from
  // the manual modal.
  const seq = Math.floor(10000 + Math.random() * 90000);
  return `INV-${seq}`;
}

// Days to add to invoice_date to compute due_date — mirrors
// invoiceAudit.computeDueDateIso so the two creation paths produce
// identical due-dates.
const PAYMENT_TERM_DAYS = Object.freeze({ NET15: 15, NET30: 30, NET45: 45, NET60: 60 });
function computeDueDate(invoiceDateIso, paymentTerms) {
  if (!invoiceDateIso) return null;
  const days = PAYMENT_TERM_DAYS[paymentTerms] ?? 30;
  const base = new Date(invoiceDateIso);
  if (Number.isNaN(base.getTime())) return null;
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

// ── Resolve the shipment plus any CBOL children (when MBOL) ─────
async function resolveShipmentBundle(shipmentId) {
  const rows = await db.dbSelect('shipments', {
    filters: [['id', 'eq', shipmentId]],
    limit: 1,
  });
  const head = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!head) return { head: null, children: [] };
  if (head.bol_type !== 'MBOL') return { head, children: [] };

  const children = await db.dbSelect('shipments', {
    filters: [['master_shipment_id', 'eq', shipmentId]],
    order: { col: 'id', asc: true },
  });
  return { head, children: Array.isArray(children) ? children : [] };
}

// Existing-invoice lookup. Uses the GIN index on shipment_ids so we
// catch consolidated invoices that include this shipment too.
async function findOpenInvoiceForShipment(shipmentId) {
  // Cheap path: scalar shipment_id match.
  const byScalar = await db.dbSelect('invoices', {
    filters: [['shipment_id', 'eq', shipmentId]],
    order: { col: 'received_at', asc: false },
    limit: 50,
  });
  for (const inv of byScalar) {
    if (OPEN_STATUSES.includes(inv.status)) return inv;
  }
  // Consolidated path: scan recent invoices and check shipment_ids[].
  // Caps at 200 rows to keep this constant-time-ish; consolidated
  // invoices for a given shipment are rare AND recent.
  const recent = await db.dbSelect('invoices', {
    order: { col: 'received_at', asc: false },
    limit: 200,
    select: 'id,invoice_number,status,shipment_id,shipment_ids',
  });
  for (const inv of recent) {
    if (!OPEN_STATUSES.includes(inv.status)) continue;
    const list = Array.isArray(inv.shipment_ids) ? inv.shipment_ids : [];
    if (list.includes(shipmentId)) return inv;
  }
  return null;
}

// ── Public: create an invoice from a shipment ────────────────────
async function createInvoiceFromShipment({ shipmentId, user }) {
  if (!shipmentId) {
    const e = new Error('shipmentId is required'); e.status = 400; throw e;
  }

  // 1. Idempotency — return existing open invoice if any.
  const existing = await findOpenInvoiceForShipment(shipmentId);
  if (existing) {
    const lines = await costLines.listForInvoice(existing.id);
    return { invoice: existing, costLines: lines, reused: true };
  }

  // 2. Resolve shipment (and CBOL children for an MBOL parent).
  const { head, children } = await resolveShipmentBundle(shipmentId);
  if (!head) {
    const e = new Error(`Shipment not found: ${shipmentId}`); e.status = 404; throw e;
  }

  // 3. Build cost lines from the shipment's cost columns. For an MBOL
  //    parent we sum the children's costs into one set of lines because
  //    the parent shipment row carries the rolled-up totals already; we
  //    don't double-count by adding child lines on top.
  const lines = costLines.costLinesFromShipment(head);

  // 4. Compute totals for the invoice scalar columns. agreed_cost and
  //    invoiced_amount both equal the shipment's total_cost on this
  //    path because the costs ARE the shipment costs (no carrier
  //    variance to record). Approved-cost edits later flow into the
  //    cost lines, not into these scalars.
  const total = num(head.total_cost, 0)
    || (num(head.rate, 0) + num(head.fuel_surcharge, 0) + num(head.accessorials, 0) - num(head.discount, 0));
  const agreedCost = round2(total);

  // 5. Collect BOL ids: the head shipment's BOL, plus children's if any.
  const bolIds = [];
  if (head.bol_number) bolIds.push(head.bol_number);
  for (const c of children) {
    if (c?.bol_number && !bolIds.includes(c.bol_number)) bolIds.push(c.bol_number);
  }

  // 6. Collect linked shipment ids — for a CBOL-bearing MBOL we record
  //    every CBOL too so the per-shipment history rows fire below.
  const shipmentIds = [head.id, ...children.map((c) => c.id).filter(Boolean)];

  const nowIso = new Date().toISOString();
  const invoiceDate = nowIso.slice(0, 10);
  const paymentTerms = 'NET30';
  const row = {
    id:               genInvoiceId(),
    invoice_number:   genInvoiceNumber(),
    carrier:          head.carrier || null,
    carrier_id:       head.carrier_id || null,
    shipment_id:      head.id,
    shipment_ids:     shipmentIds,
    bol_ids:          bolIds.length ? bolIds : null,
    invoice_date:     invoiceDate,
    due_date:         computeDueDate(invoiceDate, paymentTerms),
    received_at:      nowIso,
    agreed_cost:      agreedCost,
    invoiced_amount:  agreedCost,        // direct-from-shipment: invoice == agreed
    variance:         0,
    variance_pct:     0,
    tolerance_pct:    null,
    tolerance_abs_usd: null,
    status:           ON_HOLD,           // REQ-185
    decision_reason:  'Created from shipment — pending finance review.',
    decided_at:       null,
    decided_by:       null,
    sent_to_ap_at:    null,
    sent_to_ap_by:    null,
    payment_terms:    paymentTerms,
    notes:            null,
    metadata: {
      created_from:        'shipment',
      source_shipment_id:  head.id,
      child_shipment_ids:  children.map((c) => c.id).filter(Boolean),
      bol_type:            head.bol_type || null,
      shipment_total_cost: agreedCost,
    },
    tenant_id:        head.tenant_id || null,
    updated_at:       nowIso,
  };

  // 7. Insert invoice, then cost lines. If the cost-line write fails we
  //    delete the invoice so we don't leave a half-built record (no
  //    real transactions here — Supabase REST — so this is the next
  //    best thing).
  const inserted = await db.dbUpsert('invoices', row, 'id');
  let insertedLines = [];
  try {
    insertedLines = await costLines.replaceForInvoice({
      invoiceId: inserted.id, lines, tenantId: row.tenant_id,
    });
  } catch (lineErr) {
    try { await db.dbDelete('invoices', inserted.id); } catch (_) { /* swallow */ }
    const e = new Error(`Cost lines insert failed: ${lineErr.message}`);
    e.status = 500;
    throw e;
  }

  // 8. REQ-02 history. Mirrors the shape `submitInvoice` writes so the
  //    History drawer displays the create + status events plus a
  //    per-shipment 'invoice' row on each linked shipment.
  try {
    const rows = [
      history.buildRow({
        entityType: 'invoice',
        entityId:   inserted.id,
        action:     'create',
        user,
        metadata: {
          createdFrom:    'shipment',
          shipmentId:     head.id,
          shipmentIds,
          bolIds,
          invoicedAmount: agreedCost,
          agreedCost,
          carrier:        row.carrier,
          costLineCount:  insertedLines.length,
        },
      }),
      history.buildRow({
        entityType: 'invoice',
        entityId:   inserted.id,
        action:     'status',
        field:      'status',
        before:     'Pending',
        after:      ON_HOLD,
        user,
        metadata: {
          reason: row.decision_reason,
          createdFrom: 'shipment',
        },
      }),
    ];
    for (const sid of shipmentIds) {
      rows.push(history.buildRow({
        entityType: 'shipment',
        entityId:   sid,
        action:     'invoice',
        field:      'status',
        before:     null,
        after:      ON_HOLD,
        user,
        metadata: {
          invoiceId:      inserted.id,
          invoiceNumber:  row.invoice_number,
          carrier:        row.carrier,
          invoicedAmount: agreedCost,
          agreedCost,
          createdFrom:    'shipment',
          allShipmentsOnInvoice: shipmentIds,
        },
      }));
    }
    await history.recordChangeBatch(rows);
  } catch (auditErr) {
    console.error('[invoiceFromShipment] history write failed:', auditErr.message);
  }

  return { invoice: inserted, costLines: insertedLines, reused: false };
}

module.exports = {
  createInvoiceFromShipment,
  // Exposed for unit tests
  _internals: { findOpenInvoiceForShipment, resolveShipmentBundle, OPEN_STATUSES, ON_HOLD },
};
