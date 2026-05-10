// ═══════════════════════════════════════════════════════════════════
// Invoice Audit Service — REQ-06.
//
// Given a newly-submitted carrier invoice, compute the variance vs the
// agreed shipment cost, compare to the carrier's tolerance, and decide:
//   - Within tolerance  → status='Approved', sent_to_ap_at=NOW()
//   - Outside tolerance → status='Rejected' (with a reason)
//
// Tolerance lookup order (first match wins):
//   1. carriers.invoice_tolerance_pct       OR carriers.invoice_tolerance_abs_usd
//   2. system defaults: 5% OR $100
//
// Tolerance thresholds are combined with OR: the invoice passes if the
// variance is within either bound. This matches typical shipper practice
// ("within 5% or within $100, whichever is more generous").
//
// The service is the single writer of the `invoices` table. Every write
// also emits REQ-02 change_history rows on the invoice entity.
// ═══════════════════════════════════════════════════════════════════

const db = require('./supabase');
const history = require('./changeHistory');

// System-wide defaults — used when the carrier row has no tolerance set.
const SYSTEM_DEFAULTS = Object.freeze({
  tolerancePct: 5.0,
  toleranceAbs: 100.0,
});

function num(v, fallback = null) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round2(n) {
  if (n === null || n === undefined) return null;
  return Math.round(Number(n) * 100) / 100;
}

function genInvoiceId() {
  const year = new Date().getFullYear();
  return `INV-${year}-${Math.floor(100000 + Math.random() * 900000)}`;
}

// Bug #163: NET-term lookup so submitInvoice can compute and persist
// `due_date` at insert time. The number is days added to invoice_date.
// Anything outside the dictionary falls back to NET30. Mirrors the
// frontend computeDueDate helper (frontend/src/services/invoiceService.js)
// so the value the UI was already optimistically rendering is the same
// value the DB now stores.
const PAYMENT_TERM_DAYS = Object.freeze({
  NET15: 15,
  NET30: 30,
  NET45: 45,
  NET60: 60,
});

function computeDueDateIso(invoiceDateIso, paymentTerms) {
  if (!invoiceDateIso) return null;
  const days = PAYMENT_TERM_DAYS[paymentTerms] ?? PAYMENT_TERM_DAYS.NET30;
  const base = new Date(invoiceDateIso);
  if (Number.isNaN(base.getTime())) return null;
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

// ── Shipment resolution (REQ-07) ────────────────────────────────
// Takes an array of shipment ids and returns:
//   {
//     found:           [{id, total_cost, carrier, mode, status, order_ids}],
//     missing:         [ids not present in DB],
//     combinedAgreedCost,        // sum of total_cost across `found`
//     carriers:        [unique carrier names],
//     primaryCarrier,            // most-common carrier (first one if tie)
//   }
// When only one id is requested, the output shape still holds.
async function resolveShipments(shipmentIds) {
  const ids = (Array.isArray(shipmentIds) ? shipmentIds : [])
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  if (!ids.length) {
    return { found: [], missing: [], combinedAgreedCost: null, carriers: [], primaryCarrier: null };
  }
  // Supabase REST: one query per id is simple and tolerant; for small N
  // (typical consolidated invoice covers 2–10 shipments) this is fine.
  const found = [];
  const missing = [];
  await Promise.all(ids.map(async (sid) => {
    try {
      const rows = await db.dbSelect('shipments', {
        filters: [['id', 'eq', sid]], limit: 1,
        // REQ-187: include bol_number so submitInvoice can validate the
        // BOL on a carrier-submitted invoice against the shipment of
        // record before running the cost decision.
        select: 'id,total_cost,carrier,mode,status,order_ids,bol_number',
      });
      const row = Array.isArray(rows) && rows.length ? rows[0] : null;
      if (row) found.push(row);
      else     missing.push(sid);
    } catch (_) { missing.push(sid); }
  }));

  const combinedAgreedCost = found.reduce(
    (sum, s) => sum + (num(s.total_cost, 0) || 0),
    0
  );
  const carriers = [...new Set(found.map((s) => s.carrier).filter(Boolean))];
  // Pick the most-common carrier (with a simple tally) as the primary.
  let primaryCarrier = null;
  if (carriers.length) {
    const tally = new Map();
    for (const s of found) {
      const c = s.carrier;
      if (!c) continue;
      tally.set(c, (tally.get(c) || 0) + 1);
    }
    primaryCarrier = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || carriers[0];
  }
  return {
    found, missing,
    combinedAgreedCost: found.length ? round2(combinedAgreedCost) : null,
    carriers,
    primaryCarrier,
  };
}

// ── Tolerance lookup ────────────────────────────────────────────
async function resolveCarrierTolerance({ carrier, carrierId }) {
  // Try by id first, then by name. carriers table has both 'id' and 'name';
  // we normalize the name compare to lowercase since carrier names vary in case.
  let row = null;
  if (carrierId) {
    const rows = await db.dbSelect('carriers', {
      filters: [['id', 'eq', carrierId]], limit: 1,
      select: 'id,name,invoice_tolerance_pct,invoice_tolerance_abs_usd',
    });
    if (Array.isArray(rows) && rows.length) row = rows[0];
  }
  if (!row && carrier) {
    const rows = await db.dbSelect('carriers', {
      filters: [['name', 'ilike', String(carrier)]], limit: 1,
      select: 'id,name,invoice_tolerance_pct,invoice_tolerance_abs_usd',
    });
    if (Array.isArray(rows) && rows.length) row = rows[0];
  }
  const pct = num(row?.invoice_tolerance_pct, null);
  const abs = num(row?.invoice_tolerance_abs_usd, null);
  return {
    source: (pct != null || abs != null) ? 'carrier' : 'system-default',
    tolerancePct: pct != null ? pct : SYSTEM_DEFAULTS.tolerancePct,
    toleranceAbs: abs != null ? abs : SYSTEM_DEFAULTS.toleranceAbs,
    carrierId: row?.id || carrierId || null,
    carrierName: row?.name || carrier || null,
  };
}

// ── Pure decision helper (unit-testable) ─────────────────────────
// Rules:
//   - If agreedCost is 0 or unknown: can't compute % → apply $ only.
//   - Pass if |variance| <= toleranceAbs  OR  |variancePct| <= tolerancePct.
//   - Fail otherwise. Reason includes the gap so operators see why.
function decide({ agreedCost, invoicedAmount, tolerancePct, toleranceAbs }) {
  const ac = num(agreedCost, null);
  const inv = num(invoicedAmount, 0);
  const pctLimit = num(tolerancePct, SYSTEM_DEFAULTS.tolerancePct);
  const absLimit = num(toleranceAbs, SYSTEM_DEFAULTS.toleranceAbs);

  if (ac == null) {
    // No agreed cost — can't compute % at all. Fall back to $ only. If
    // variance calc is impossible too, reject with a specific reason.
    return {
      status: 'Rejected',
      variance: null,
      variancePct: null,
      reason: 'No agreed shipment cost on file to audit against.',
    };
  }

  const variance = round2(inv - ac);
  const variancePct = ac > 0 ? round2((variance / ac) * 100) : null;
  const absOk = Math.abs(variance) <= absLimit;
  const pctOk = variancePct != null && Math.abs(variancePct) <= pctLimit;

  if (absOk || pctOk) {
    return {
      status: 'Approved',
      variance,
      variancePct,
      reason: absOk && pctOk
        ? `Within both ±${pctLimit}% and ±$${absLimit.toFixed(2)} tolerance.`
        : absOk
          ? `Within ±$${absLimit.toFixed(2)} absolute tolerance (|Δ|=$${Math.abs(variance).toFixed(2)}).`
          : `Within ±${pctLimit}% percentage tolerance (|Δ|=${Math.abs(variancePct).toFixed(3)}%).`,
    };
  }
  const pctPart = variancePct != null ? `${variancePct.toFixed(3)}% vs ±${pctLimit}%` : 'no % threshold';
  const absPart = `$${variance.toFixed(2)} vs ±$${absLimit.toFixed(2)}`;
  return {
    status: 'Rejected',
    variance,
    variancePct,
    reason: `Outside tolerance. Variance ${pctPart}; ${absPart}.`,
  };
}

// ── Submit a new invoice (happy path) ────────────────────────────
// Accepts either { shipmentId } (single, back-compat) or
// { shipmentIds: [...] } (consolidated). Resolves all referenced
// shipments, sums their agreed costs, looks up carrier tolerance,
// runs the decide() comparison, writes the invoice, and returns the
// decision payload with { shipmentsIdentified, missingShipments }.
async function submitInvoice({
  invoiceNumber, carrier, carrierId, shipmentId, shipmentIds,
  bolId, bolIds,                                    // REQ-187 (additive)
  invoicedAmount, invoiceDate, paymentTerms = 'NET30',
  notes, metadata, user,
}) {
  if (!invoiceNumber) { const e = new Error('invoiceNumber is required'); e.status = 400; throw e; }
  const amount = num(invoicedAmount, null);
  if (amount == null || amount < 0) { const e = new Error('invoicedAmount must be >= 0'); e.status = 400; throw e; }

  // 1. Normalize shipment inputs: accept scalar OR array. Dedupe.
  let ids = [];
  if (Array.isArray(shipmentIds) && shipmentIds.length) {
    ids = [...new Set(shipmentIds.map((x) => String(x || '').trim()).filter(Boolean))];
  } else if (shipmentId) {
    ids = [String(shipmentId).trim()].filter(Boolean);
  }

  // 1b. Normalize BOL inputs the same way. Carriers typically send a
  //     single bolId per invoice but consolidated invoices can carry
  //     multiple. Empty arrays are treated as "no BOL provided" — the
  //     audit only enforces a match when at least one BOL was sent.
  let bols = [];
  if (Array.isArray(bolIds) && bolIds.length) {
    bols = [...new Set(bolIds.map((x) => String(x || '').trim()).filter(Boolean))];
  } else if (bolId) {
    bols = [String(bolId).trim()].filter(Boolean);
  }

  // 2. Resolve all referenced shipments
  const resolved = await resolveShipments(ids);
  const isConsolidated = ids.length > 1;

  // Agreed cost = sum across *found* shipments. If any are missing we
  // force a Rejected decision with a specific reason, because the
  // audit isn't trustworthy when one or more shipments can't be matched.
  const agreedCost = resolved.combinedAgreedCost;
  const hasMissing = resolved.missing.length > 0;

  // 3. Tolerance lookup — prefer explicit carrier; otherwise pick the
  //    primary carrier across the referenced shipments.
  const tol = await resolveCarrierTolerance({
    carrier: carrier || resolved.primaryCarrier || null,
    carrierId,
  });

  // 3b. REQ-187: when the carrier supplies BOL ids, verify they match
  //     the BOLs on the shipments of record before running the cost
  //     decision. A mismatch means the carrier's invoice references a
  //     different load than the one we have — the audit isn't trustworthy
  //     until ops reconciles, so we reject up front with a specific reason.
  const bolsOnRecord = resolved.found
    .map((s) => s.bol_number)
    .filter(Boolean);
  const bolMismatched = bols.length > 0 && bolsOnRecord.length > 0
    && bols.some((b) => !bolsOnRecord.includes(b));

  // 4. Decide
  let decision;
  if (hasMissing) {
    decision = {
      status: 'Rejected',
      variance: agreedCost != null ? round2(amount - agreedCost) : null,
      variancePct: (agreedCost && agreedCost > 0) ? round2(((amount - agreedCost) / agreedCost) * 100) : null,
      reason: `${resolved.missing.length} referenced shipment${resolved.missing.length > 1 ? 's' : ''} not found: ${resolved.missing.join(', ')}.`,
    };
  } else if (bolMismatched) {
    decision = {
      status: 'Rejected',
      variance: agreedCost != null ? round2(amount - agreedCost) : null,
      variancePct: (agreedCost && agreedCost > 0) ? round2(((amount - agreedCost) / agreedCost) * 100) : null,
      reason: `BOL on submitted invoice (${bols.join(', ')}) does not match shipment of record (${bolsOnRecord.join(', ')}).`,
    };
  } else {
    decision = decide({
      agreedCost, invoicedAmount: amount,
      tolerancePct: tol.tolerancePct, toleranceAbs: tol.toleranceAbs,
    });
  }

  const nowIso = new Date().toISOString();
  const foundIds = resolved.found.map((s) => s.id);
  const row = {
    id: genInvoiceId(),
    invoice_number: invoiceNumber,
    carrier: carrier || tol.carrierName || resolved.primaryCarrier || null,
    carrier_id: tol.carrierId,
    // Back-compat: keep scalar shipment_id = first found (or first requested)
    shipment_id: foundIds[0] || ids[0] || null,
    // REQ-07: array of all referenced ids (found + missing, so the audit
    // trail shows exactly what was submitted)
    shipment_ids: ids.length ? ids : null,
    // REQ-187: BOL identifier(s) the carrier sent on this invoice. Stored
    // alongside shipment_ids so finance can audit that what the carrier
    // billed for matches the load we tendered.
    bol_ids: bols.length ? bols : null,
    invoice_date: invoiceDate || null,
    // Bug #163: persist due_date at insert time so the edit modal —
    // which reads invoices.due_date directly — never opens with an
    // empty field. Falls back to today + NET30 when the caller didn't
    // pass an invoiceDate (the table allows NULL but the UI doesn't).
    due_date: computeDueDateIso(invoiceDate || nowIso.slice(0, 10), paymentTerms),
    received_at: nowIso,
    agreed_cost: agreedCost,
    invoiced_amount: amount,
    variance: decision.variance,
    variance_pct: decision.variancePct,
    tolerance_pct: tol.tolerancePct,
    tolerance_abs_usd: tol.toleranceAbs,
    status: decision.status,
    decision_reason: decision.reason,
    decided_at: nowIso,
    decided_by: user?.email || 'system',
    sent_to_ap_at: decision.status === 'Approved' ? nowIso : null,
    sent_to_ap_by: decision.status === 'Approved' ? (user?.email || 'system') : null,
    payment_terms: paymentTerms,
    notes: notes || null,
    metadata: {
      ...(metadata || {}),
      tolerance_source: tol.source,
      consolidated: isConsolidated,
      shipments_identified: foundIds,
      missing_shipments: resolved.missing,
      carriers_on_shipments: resolved.carriers,
    },
    updated_at: nowIso,
  };

  const inserted = await db.dbUpsert('invoices', row, 'id');

  // 5. REQ-02: write a 'create' event for the invoice + a 'status' event
  //    for the decision so the history drawer shows the full story.
  // REQ-20: also mirror the invoice decision onto each linked shipment so
  //    the shipment's history drawer shows when an invoice was approved
  //    or rejected against it (alongside tender / status / edit events).
  try {
    const baseRows = [
      history.buildRow({
        entityType: 'invoice',
        entityId: inserted.id,
        action: 'create',
        user,
        metadata: {
          invoiceNumber, carrier: row.carrier,
          shipmentId: row.shipment_id,
          shipmentIds: foundIds,
          bolIds: bols,                    // REQ-187
          bolMismatched,                   // REQ-187
          missingShipments: resolved.missing,
          consolidated: isConsolidated,
          invoicedAmount: amount, agreedCost,
          variance: row.variance, variancePct: row.variance_pct,
        },
      }),
      history.buildRow({
        entityType: 'invoice',
        entityId: inserted.id,
        action: 'status',
        field: 'status',
        before: 'Pending',
        after: row.status,
        user,
        metadata: {
          reason: row.decision_reason,
          toleranceSource: tol.source,
          tolerancePct: tol.tolerancePct,
          toleranceAbs: tol.toleranceAbs,
          sentToAp: !!row.sent_to_ap_at,
          consolidated: isConsolidated,
          shipmentsIdentified: foundIds,
        },
      }),
    ];
    // REQ-20: per-shipment audit row.
    for (const sid of foundIds) {
      baseRows.push(history.buildRow({
        entityType: 'shipment',
        entityId: sid,
        action: 'invoice',
        field: 'status',
        before: 'Pending',
        after: row.status,
        user,
        metadata: {
          invoiceId: inserted.id,
          invoiceNumber,
          carrier: row.carrier,
          invoicedAmount: amount,
          agreedCost,
          variance: row.variance,
          variancePct: row.variance_pct,
          decisionReason: row.decision_reason,
          consolidated: isConsolidated,
          allShipmentsOnInvoice: foundIds,
          sentToAp: !!row.sent_to_ap_at,
        },
      }));
    }
    await history.recordChangeBatch(baseRows);
  } catch (auditErr) {
    console.error('[invoiceAudit] history write failed:', auditErr.message);
  }

  return {
    invoice: inserted,
    decision: {
      status: decision.status,
      reason: decision.reason,
      variance: decision.variance,
      variancePct: decision.variancePct,
      sentToAp: !!row.sent_to_ap_at,
      tolerancePct: tol.tolerancePct,
      toleranceAbs: tol.toleranceAbs,
      toleranceSource: tol.source,
      // REQ-07: surface consolidation details
      consolidated: isConsolidated,
      shipmentsIdentified: foundIds,
      missingShipments: resolved.missing,
      carriersOnShipments: resolved.carriers,
      combinedAgreedCost: agreedCost,
    },
  };
}

// ── Manual override paths (finance/admin can force a decision) ──
async function manualDecide({ invoiceId, decision, reason, user }) {
  if (!invoiceId) { const e = new Error('invoiceId is required'); e.status = 400; throw e; }
  if (!['Approved', 'Rejected', 'Disputed', 'On Hold', 'Cancelled', 'Paid'].includes(decision)) {
    const e = new Error(`Unknown decision '${decision}'`); e.status = 400; throw e;
  }
  // Read current
  const rows = await db.dbSelect('invoices', { filters: [['id', 'eq', invoiceId]], limit: 1 });
  const before = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!before) { const e = new Error(`Invoice not found: ${invoiceId}`); e.status = 404; throw e; }

  const nowIso = new Date().toISOString();
  const patch = {
    status: decision,
    decision_reason: reason || `Manually set to ${decision} by ${user?.email || 'admin'}.`,
    decided_at: nowIso,
    decided_by: user?.email || 'admin',
    updated_at: nowIso,
  };
  if (decision === 'Approved' && !before.sent_to_ap_at) {
    patch.sent_to_ap_at = nowIso;
    patch.sent_to_ap_by = user?.email || 'admin';
  }
  const updated = await db.dbUpdate('invoices', invoiceId, patch);

  try {
    // REQ-20: mirror manual invoice decisions into shipment history too.
    const shipmentIdsForHistory = Array.isArray(before.shipment_ids) && before.shipment_ids.length
      ? before.shipment_ids
      : (before.shipment_id ? [before.shipment_id] : []);
    const rows = [history.buildRow({
      entityType: 'invoice',
      entityId: invoiceId,
      action: 'status',
      field: 'status',
      before: before.status,
      after: decision,
      user,
      metadata: { reason: patch.decision_reason, manual: true },
    })];
    for (const sid of shipmentIdsForHistory) {
      rows.push(history.buildRow({
        entityType: 'shipment',
        entityId: sid,
        action: 'invoice',
        field: 'status',
        before: before.status,
        after: decision,
        user,
        metadata: {
          invoiceId, invoiceNumber: before.invoice_number,
          carrier: before.carrier,
          invoicedAmount: before.invoiced_amount,
          agreedCost: before.agreed_cost,
          decisionReason: patch.decision_reason,
          manual: true,
          sentToAp: !!patch.sent_to_ap_at,
        },
      }));
    }
    await history.recordChangeBatch(rows);
  } catch (_) { /* best-effort */ }
  return updated;
}

// ── Edit an existing invoice (Bug #157) ─────────────────────────
// Accepts a camelCase patch from the UI and maps to DB columns. This
// replaces the legacy raw PATCH /api/db/invoices/:id path that used to
// fail with "column 'agreed_rate' not in schema cache" because the UI
// was sending a column name that never existed (the DB column has
// always been agreed_cost — see migration 008).
//
// Allowed editable fields and their DB mappings:
//   invoiceNumber  → invoice_number
//   carrier        → carrier
//   carrierId      → carrier_id
//   shipmentId     → shipment_id
//   shipmentIds    → shipment_ids       (REQ-07 consolidated)
//   invoiceDate    → invoice_date
//   dueDate        → due_date
//   agreedCost     → agreed_cost        (ALSO accepts agreedRate / agreed
//                                        as legacy aliases — never persisted
//                                        as a separate column)
//   invoicedAmount → invoiced_amount
//   status         → status             (must be in the lifecycle whitelist)
//   paymentTerms   → payment_terms
//   notes          → notes
//
// REQ-02: every changed field is recorded in change_history under
// entity_type='invoice'. Untouched fields are left alone (patch semantics).
const EDIT_FIELD_MAP = Object.freeze({
  invoiceNumber:  'invoice_number',
  carrier:        'carrier',
  carrierId:      'carrier_id',
  shipmentId:     'shipment_id',
  shipmentIds:    'shipment_ids',
  bolIds:         'bol_ids',          // REQ-187
  invoiceDate:    'invoice_date',
  dueDate:        'due_date',
  agreedCost:     'agreed_cost',
  invoicedAmount: 'invoiced_amount',
  status:         'status',
  paymentTerms:   'payment_terms',
  notes:          'notes',
});

// Legacy snake_case keys the old generic-PATCH UI used to send. Mapped to
// the canonical DB column so a stale frontend (or 3rd-party caller) keeps
// working through one release. agreed_rate is the headline alias from #157.
const EDIT_LEGACY_ALIASES = Object.freeze({
  invoice_number:  'invoice_number',
  carrier_id:      'carrier_id',
  shipment_id:     'shipment_id',
  shipment_ids:    'shipment_ids',
  bol_ids:         'bol_ids',         // REQ-187
  invoice_date:    'invoice_date',
  due_date:        'due_date',
  agreed_cost:     'agreed_cost',
  agreed_rate:     'agreed_cost',   // ← Bug #157: legacy alias
  agreed:          'agreed_cost',
  invoiced_amount: 'invoiced_amount',
  payment_terms:   'payment_terms',
});

const EDIT_VALID_STATUSES = Object.freeze([
  'Pending', 'Approved', 'Rejected', 'Disputed', 'On Hold', 'Cancelled', 'Paid',
]);

function buildInvoicePatch(rawPatch) {
  const patch = {};
  if (!rawPatch || typeof rawPatch !== 'object') return patch;

  // Camel/domain keys win when both are present.
  for (const [k, col] of Object.entries(EDIT_LEGACY_ALIASES)) {
    if (k in rawPatch && rawPatch[k] !== undefined) patch[col] = rawPatch[k];
  }
  for (const [k, col] of Object.entries(EDIT_FIELD_MAP)) {
    if (k in rawPatch && rawPatch[k] !== undefined) patch[col] = rawPatch[k];
  }

  // Type coercion + light validation
  if ('agreed_cost' in patch)     patch.agreed_cost     = num(patch.agreed_cost, null);
  if ('invoiced_amount' in patch) patch.invoiced_amount = num(patch.invoiced_amount, null);
  if ('shipment_ids' in patch && patch.shipment_ids != null && !Array.isArray(patch.shipment_ids)) {
    patch.shipment_ids = String(patch.shipment_ids).split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  }
  if ('bol_ids' in patch && patch.bol_ids != null && !Array.isArray(patch.bol_ids)) {
    patch.bol_ids = String(patch.bol_ids).split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  }
  if ('status' in patch && !EDIT_VALID_STATUSES.includes(patch.status)) {
    const e = new Error(`Invalid status '${patch.status}'. Allowed: ${EDIT_VALID_STATUSES.join(', ')}`);
    e.status = 400;
    throw e;
  }
  if ('invoiced_amount' in patch && patch.invoiced_amount != null && patch.invoiced_amount < 0) {
    const e = new Error('invoicedAmount must be >= 0'); e.status = 400; throw e;
  }
  return patch;
}

async function editInvoice({ invoiceId, patch: rawPatch, user }) {
  if (!invoiceId) { const e = new Error('invoiceId is required'); e.status = 400; throw e; }
  const patch = buildInvoicePatch(rawPatch);
  if (!Object.keys(patch).length) {
    const e = new Error('No editable fields provided'); e.status = 400; throw e;
  }

  // Read current row so we can diff for REQ-02 history.
  const beforeRows = await db.dbSelect('invoices', { filters: [['id', 'eq', invoiceId]], limit: 1 });
  const before = Array.isArray(beforeRows) && beforeRows.length ? beforeRows[0] : null;
  if (!before) { const e = new Error(`Invoice not found: ${invoiceId}`); e.status = 404; throw e; }

  patch.updated_at = new Date().toISOString();
  const updated = await db.dbUpdate('invoices', invoiceId, patch);

  try {
    await history.recordFieldDiffs({
      entityType: 'invoice',
      entityId:   invoiceId,
      before,
      after:      updated,
      user,
      // Only diff the columns the editor actually exposes — internal
      // fields (variance, decided_at, etc.) are written by other paths.
      fields: {
        invoice_number:  'invoice_number',
        carrier:         'carrier',
        carrier_id:      'carrier_id',
        shipment_id:     'shipment_id',
        shipment_ids:    'shipment_ids',
        bol_ids:         'bol_ids',         // REQ-187
        invoice_date:    'invoice_date',
        due_date:        'due_date',
        agreed_cost:     'agreed_cost',
        invoiced_amount: 'invoiced_amount',
        status:          'status',
        payment_terms:   'payment_terms',
        notes:           'notes',
      },
      metadata: { via: 'invoice-edit' },
    });
  } catch (auditErr) {
    console.error('[invoiceAudit.editInvoice] history write failed:', auditErr.message);
  }
  return updated;
}

// ── Mark an Approved invoice as sent to AP (idempotent) ─────────
async function sendToAp({ invoiceId, user }) {
  if (!invoiceId) { const e = new Error('invoiceId is required'); e.status = 400; throw e; }
  const rows = await db.dbSelect('invoices', { filters: [['id', 'eq', invoiceId]], limit: 1 });
  const row = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!row) { const e = new Error(`Invoice not found: ${invoiceId}`); e.status = 404; throw e; }
  if (row.status !== 'Approved') {
    const e = new Error(`Only Approved invoices can be sent to AP; this one is '${row.status}'`);
    e.status = 409;
    throw e;
  }
  if (row.sent_to_ap_at) return row; // idempotent
  const nowIso = new Date().toISOString();
  const updated = await db.dbUpdate('invoices', invoiceId, {
    sent_to_ap_at: nowIso,
    sent_to_ap_by: user?.email || 'system',
    updated_at: nowIso,
  });
  try {
    await history.recordChange({
      entityType: 'invoice',
      entityId: invoiceId,
      action: 'status',
      field: 'sent_to_ap_at',
      before: null,
      after: nowIso,
      user,
      metadata: { action: 'send-to-ap' },
    });
  } catch (_) { /* best-effort */ }
  return updated;
}

module.exports = {
  SYSTEM_DEFAULTS,
  decide,
  resolveCarrierTolerance,
  resolveShipments,
  submitInvoice,
  manualDecide,
  sendToAp,
  editInvoice,
  // Exposed for unit testing of the field mapper / alias coverage.
  _internals: { buildInvoicePatch, EDIT_FIELD_MAP, EDIT_LEGACY_ALIASES },
};
