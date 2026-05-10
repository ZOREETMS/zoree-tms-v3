// ════════════════════════════════════════════════════════════════════
// orderDetailService — pure presentation helpers for OrderDetailScreen.
//
// Why this exists
// ───────────────
// CLAUDE_RULES §1 (modular layers) and §6 (no large inline logic) push
// any non-trivial field-resolution out of the screen. The detail screen
// receives an `order` row whose keys may be camelCase (from the API's
// dbToOrder mapper — services/orders.js) or snake_case (raw rows from
// the inline server.js routes). Order-line rows come back snake_case
// (see GET /api/orders/:id/lines) but tests + bulkPlan still emit a
// camelCase shape on some paths.
//
// This module:
//   • normalizes both casings into one OrderDetailViewModel
//   • normalizes per-line fields into one OrderLineViewModel
//   • formats values for display (lbs / dashes / commas)
//
// No API calls, no React, no styles — drop-in unit-testable.
//
// QA #182: previously OrderDetailScreen rendered only Customer / Origin
// / Destination / Ready / Due / Weight / Pieces / Commodity / Shipment
// ID. The web modal also shows Ship From, Ship To, Ship Mode, Service
// Level, and Incoterms; the per-line table shows Qty + Unit Wt + Total
// Wt. This module surfaces all of those so mobile reaches field-parity
// with the web `OrderDetailModal` (frontend/src/components/orders/).
// ════════════════════════════════════════════════════════════════════

export interface OrderDetailViewModel {
  /** ORD-2026-… display id, falling back to internal id. */
  orderId: string;
  customer: string;
  status: string;
  origin: string;
  destination: string;
  /** Optional location-name fields surfaced separately from origin/dest. */
  shipFromName: string | null;
  shipToName: string | null;
  /** TL / LTL / null. Stored as `ship_mode` in DB; aliased `shipMode`. */
  shipMode: string | null;
  /** Standard / Expedited / Economy / White Glove / Time-Critical. */
  serviceLevel: string | null;
  /** Free-text Incoterms (FOB, DAP, DDP, …). */
  incoterms: string | null;
  commodity: string;
  weightLbs: number | null;
  pieces: number | null;
  readyDate: string;
  dueDate: string;
  shipmentId: string | null;
  preferredCarrier: string | null;
  notes: string | null;
}

export interface OrderLineViewModel {
  key: string;
  lineNum: number | null;
  /** "ITM-1004" or "" if blank. */
  itemId: string;
  /** Falls back to itemId or "Line N" upstream. */
  description: string;
  qty: number | null;
  unitWeightLbs: number | null;
  totalWeightLbs: number | null;
}

/* ── Field readers ────────────────────────────────────────────────── */

function readString(...candidates: any[]): string {
  for (const c of candidates) {
    if (c == null) continue;
    const s = String(c).trim();
    if (s.length > 0) return s;
  }
  return '';
}

function readStringOrNull(...candidates: any[]): string | null {
  const s = readString(...candidates);
  return s ? s : null;
}

function readNumberOrNull(...candidates: any[]): number | null {
  for (const c of candidates) {
    if (c == null || c === '') continue;
    // Strip thousands separators before parsing — matches what the
    // web's order-line editor does on input.
    const cleaned = typeof c === 'string' ? c.replace(/,/g, '') : c;
    const n = Number(cleaned);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function readDate(...candidates: any[]): string {
  for (const c of candidates) {
    if (!c) continue;
    const d = new Date(c);
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString();
  }
  return '--';
}

/* ── Order view model ─────────────────────────────────────────────── */

/**
 * Build the screen's view model from the raw order row. Accepts both
 * casings so the screen never has to know which API path produced the
 * row.
 */
export function buildOrderDetailViewModel(order: any): OrderDetailViewModel {
  const o = order || {};
  return {
    orderId: readString(o.order_id, o.orderId, o.id),
    customer: readString(o.customer, o.customer_name, o.customerName) || '--',
    status: readString(o.status) || 'Unplanned',
    origin: readString(o.origin, o.origin_city, o.originCity) || '--',
    destination: readString(o.destination, o.destination_city, o.destinationCity, o.dest) || '--',
    shipFromName: readStringOrNull(o.ship_from_name, o.shipFromName),
    shipToName: readStringOrNull(o.ship_to_name, o.shipToName),
    shipMode: readStringOrNull(o.ship_mode, o.shipMode, o.mode),
    serviceLevel: readStringOrNull(o.service_level, o.serviceLevel),
    incoterms: readStringOrNull(o.incoterms, o.inco_terms, o.incoTerms),
    commodity: readString(o.commodity) || '--',
    weightLbs: readNumberOrNull(o.weight, o.total_weight, o.totalWeight),
    pieces: readNumberOrNull(o.pieces, o.total_pieces, o.totalPieces),
    readyDate: readDate(o.readyDate, o.ready_date, o.ready),
    dueDate: readDate(o.dueDate, o.due_date, o.due),
    shipmentId: readStringOrNull(o.shipmentId, o.shipment_id),
    preferredCarrier: readStringOrNull(o.preferredCarrier, o.preferred_carrier),
    notes: readStringOrNull(o.notes),
  };
}

/* ── Line view model ──────────────────────────────────────────────── */

/**
 * Normalize one order_lines row. The DB column names are line_num,
 * item_id, description, qty_ordered, unit_weight, total_weight; the
 * bulk-plan/import path also passes camelCase aliases (qtyOrdered,
 * unitWt, totalWt) so we accept both.
 */
export function buildOrderLineViewModel(line: any, idx: number): OrderLineViewModel {
  const l = line || {};
  const qty = readNumberOrNull(l.qty_ordered, l.qtyOrdered, l.qty, l.quantity);
  const unit = readNumberOrNull(l.unit_weight, l.unitWeight, l.unitWt, l.unit_value);
  // Prefer a stored total_weight; fall back to qty × unit if both are
  // present so the screen never shows a blank total when the data is
  // recoverable arithmetically. Mirrors OrderLinesEditor.jsx behaviour.
  const storedTotal = readNumberOrNull(l.total_weight, l.totalWeight, l.totalWt, l.total_value);
  const computedTotal = qty != null && unit != null ? qty * unit : null;
  const totalWeightLbs = storedTotal != null ? storedTotal : computedTotal;

  const itemId = readString(l.item_id, l.itemId);
  const description = readString(l.description, l.item_name, l.itemName) || itemId || `Line ${idx + 1}`;
  const lineNumRaw = readNumberOrNull(l.line_num, l.lineNum);

  return {
    key: String(l.id ?? `${itemId || 'LINE'}-${idx}`),
    lineNum: lineNumRaw != null ? lineNumRaw : idx + 1,
    itemId,
    description,
    qty,
    unitWeightLbs: unit,
    totalWeightLbs,
  };
}

export function buildOrderLineViewModels(lines: any[] | null | undefined): OrderLineViewModel[] {
  if (!Array.isArray(lines)) return [];
  return lines.map((l, idx) => buildOrderLineViewModel(l, idx));
}

/* ── Formatters used by the screen ────────────────────────────────── */

export function formatLbs(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '--';
  return `${Number(value).toLocaleString()} lbs`;
}

export function formatInt(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '--';
  return Number(value).toLocaleString();
}

export function dashIfBlank(value: string | null | undefined): string {
  if (value == null) return '--';
  const s = String(value).trim();
  return s.length ? s : '--';
}
