// ═══════════════════════════════════════════════════════════════════
// revisionClassifier — what a document with an invoice number we already
// have is: a duplicate, a corrected revision, or something for a person.
// Pure: no DB. intakeService loads the rows and acts on the answer.
//
// Matched on carrier + invoice number (by the caller), then shipment and
// the dispute history of the current version:
//
//   current version is          new document                  → kind
//   ───────────────────────────  ────────────────────────────  ─────────────
//   any (or a superseded one)    same total and same charges    duplicate
//   Disputed / On Hold / Pending different shipment             needs_person
//   Disputed / On Hold / Pending total or charges changed       revision
//   Approved / Paid (posted)     total or charges changed       adjustment
//   Rejected                     total or charges changed       needs_person
//
// Only one version is "current": the newest row that is not Superseded or
// Cancelled. Superseded rows are kept for history and are never payable.
// ═══════════════════════════════════════════════════════════════════

const CENT = 0.005;
const OPEN = new Set(['Disputed', 'On Hold', 'Pending']);
const POSTED = new Set(['Approved', 'Paid']);
const RETIRED = new Set(['Superseded', 'Cancelled']);

const money = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100);
const shipKey = (s) => String(s || '').trim().toUpperCase();

/** Charges as { 'linehaul': 1180, 'accessorial:detention': 259.6, ... } — order-free. */
function chargeMap(lines) {
  const m = new Map();
  for (const l of lines || []) {
    const k = [l.cost_type || 'other', l.accessorial_type || ''].join(':').toLowerCase();
    m.set(k, (m.get(k) || 0) + (Number(l.invoice_cost ?? l.amount) || 0));
  }
  return m;
}

/** Plain-English list of what changed between two charge sets ('' when none). */
function chargeChanges(before, after) {
  const a = chargeMap(before);
  const b = chargeMap(after);
  const keys = [...new Set([...a.keys(), ...b.keys()])].sort();
  // "accessorial:detention" → "detention"; "base:" → "linehaul"; "fuel_surcharge:" → "fuel"
  const NAMES = { base: 'linehaul', fuel_surcharge: 'fuel' };
  const label = (k) => { const [type, extra] = k.split(':'); return (extra || NAMES[type] || type).replace(/_/g, ' '); };
  const out = [];
  for (const k of keys) {
    const x = a.has(k) ? Math.round(a.get(k) * 100) / 100 : null;
    const y = b.has(k) ? Math.round(b.get(k) * 100) / 100 : null;
    if (x == null) out.push(`added ${label(k)} $${y.toFixed(2)}`);
    else if (y == null) out.push(`removed ${label(k)} $${x.toFixed(2)}`);
    else if (Math.abs(x - y) > CENT) out.push(`${label(k)} $${x.toFixed(2)} → $${y.toFixed(2)}`);
  }
  return out.join('; ');
}

/** Same billed total and the same charges = the same invoice sent again. */
function sameDocument(row, incoming) {
  const t1 = money(row.invoiced_amount);
  const t2 = money(incoming.total);
  const totalSame = t1 != null && t2 != null && Math.abs(t1 - t2) <= CENT;
  // Lines unknown on either side: the total decides.
  if (!Array.isArray(row.lines) || !row.lines.length || !Array.isArray(incoming.lines) || !incoming.lines.length) return totalSame;
  return totalSame && chargeChanges(row.lines, incoming.lines) === '';
}

const newest = (rows) => [...rows].sort((a, b) => String(b.received_at || b.created_at || '').localeCompare(String(a.received_at || a.created_at || '')))[0] || null;

/**
 * @param {object[]} existing  same carrier + invoice number rows:
 *        { id, invoice_number, status, invoiced_amount, shipment_id, received_at, lines? }
 * @param {object}   incoming  { total, shipmentId, lines }
 * @returns {{ kind:'new'|'duplicate'|'revision'|'adjustment'|'needs_person', target:object|null, changes:string, reason:string }}
 */
function classify(existing, incoming) {
  const rows = (existing || []).filter(Boolean);
  if (!rows.length) return { kind: 'new', target: null, changes: '', reason: '' };

  // Any version — current or superseded — sent again unchanged is a duplicate.
  const same = rows.find((r) => r.status !== 'Cancelled' && sameDocument(r, incoming));
  if (same) {
    return { kind: 'duplicate', target: same, changes: '',
      reason: same.status === 'Superseded'
        ? `This is the superseded version of ${same.invoice_number} sent again. Nothing created.`
        : `Invoice ${same.invoice_number} from ${same.carrier} is already in (${same.status}) with the same amount and charges. Pay once — nothing created.` };
  }

  const current = newest(rows.filter((r) => !RETIRED.has(r.status)));
  if (!current) {
    // Only cancelled/superseded versions exist: nothing live to correct.
    return { kind: 'needs_person', target: newest(rows), changes: '',
      reason: `Invoice ${rows[0].invoice_number} was already closed (${newest(rows).status}). A person must decide whether this new copy should be paid.` };
  }

  const amtNote = (() => {
    const a = money(current.invoiced_amount); const b = money(incoming.total);
    return a != null && b != null && Math.abs(a - b) > CENT ? `total $${a.toFixed(2)} → $${b.toFixed(2)}` : '';
  })();
  const changes = [amtNote, Array.isArray(current.lines) ? chargeChanges(current.lines, incoming.lines) : ''].filter(Boolean).join('; ');

  if (POSTED.has(current.status)) {
    return { kind: 'adjustment', target: current, changes,
      reason: `Invoice ${current.invoice_number} is already ${current.status === 'Paid' ? 'paid' : 'approved for posting'}. This new copy changes it (${changes || 'different charges'}). Not replaced automatically — AP must handle it as a credit or adjustment.` };
  }
  if (current.status === 'Rejected') {
    return { kind: 'needs_person', target: current, changes,
      reason: `Invoice ${current.invoice_number} was rejected. A changed copy arrived (${changes || 'different charges'}); a person decides whether to reopen it.` };
  }
  if (OPEN.has(current.status)) {
    const a = shipKey(current.shipment_id); const b = shipKey(incoming.shipmentId);
    if (a && b && a !== b) {
      return { kind: 'needs_person', target: current, changes,
        reason: `Invoice ${current.invoice_number} is on file for shipment ${current.shipment_id}, but this copy names shipment ${incoming.shipmentId}. Same number, different load — a person must check it.` };
    }
    return { kind: 'revision', target: current, changes,
      reason: `Corrected revision of ${current.invoice_number} (was ${current.status}): ${changes || 'charges changed'}.` };
  }
  return { kind: 'needs_person', target: current, changes, reason: `Invoice ${current.invoice_number} is ${current.status}; a person must review this copy.` };
}

module.exports = { classify, chargeChanges, sameDocument, OPEN, POSTED };
