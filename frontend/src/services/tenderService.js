import { TenderApi, OrdersApi } from "../lib/api";

function normalizeCarrierName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function findCarrierRecord(carriers, carrierName) {
  const target = normalizeCarrierName(carrierName);
  if (!target) return null;

  return (carriers || []).find((c) => {
    const candidate = normalizeCarrierName(c?.name || c?.carrier_name || c?.carrierName);
    if (!candidate) return false;
    return candidate === target || candidate.includes(target) || target.includes(candidate);
  }) || null;
}

function carrierEmail(carrierRecord) {
  const raw = carrierRecord?.email || carrierRecord?.contact_email || carrierRecord?.contactEmail || "";
  const value = String(raw || "").trim().toLowerCase();
  return value || "";
}

/**
 * Fetch line items for linked orders and build order/item detail fields
 * for the tender email payload.
 */
export async function gatherOrderDetails(linkedOrders = []) {
  const orderNumbers = linkedOrders.map((o) => o.id).filter(Boolean);
  const customerNames = [...new Set(linkedOrders.map((o) => o.customer).filter(Boolean))];

  let lineItems = [];
  try {
    const results = await Promise.all(
      orderNumbers.map((oid) =>
        OrdersApi.lines(oid)
          .then((res) => (Array.isArray(res) ? res : res?.lines || res?.data || []))
          .catch(() => [])
      )
    );
    lineItems = results.flat();
  } catch (_e) { /* line items are best-effort */ }

  return {
    orderNumbers,
    customerName: customerNames.join(", "),
    lineItems: lineItems.map((l) => ({
      orderId: l.order_id || "",
      itemId: l.item_id || "",
      description: l.description || "",
      qty: l.qty_ordered || 0,
      unitWeight: l.unit_weight || l.unit_value || 0,
    })),
  };
}

// ───────────────────────────────────────────────────────────────────
// Tender RESPONSE handling — the [CP_RESPONSE] payload appended to
// shipments.notes. Two acceptance flows write to the same record:
//
//   1. CARRIER PORTAL  — driver, phone, truck, PRO, pickup ETA
//      (TenderRespondModal.jsx + carrierPortalService.saveTenderResponse)
//   2. TMS-SIDE PLAN   — service level, BOL, dock door, loading
//      window, seal, delivery date
//      (ShipmentsPage TenderAcceptModal)
//
// Before this section, the TMS-side flow OVERWROTE the carrier's
// CP_RESPONSE payload with its own keys via a "find marker / replace
// JSON" helper, silently destroying the driver/truck data the carrier
// had submitted from their portal. We now MERGE payloads — carrier-
// owned fields and planner-owned fields coexist on the same record.
//
// Status semantics are unchanged: shipments.status stays in the DB
// enum {Planned, Tendered, ...}; effectiveShipmentStatus() in
// carrierPortalService promotes Tendered + CP_RESPONSE-accept to
// "Tender Accepted" for the UI.
// ───────────────────────────────────────────────────────────────────

const RESPONSE_MARKER = "[CP_RESPONSE]";

/** Carrier-supplied keys — captured by the carrier portal modal.
 *  Listed explicitly so a planner-side patch never clears them when
 *  the carrier already filled them in. */
const CARRIER_OWNED_KEYS = Object.freeze([
  "driver",
  "phone",
  "truck",
  "pickupEta",
  // proNumber and carrierPickupDate appear on BOTH sides — the merge
  // keeps the most recent non-empty value (planner can correct a typo,
  // but a planner submit with empty PRO won't wipe the carrier's PRO).
]);

/** Planner-supplied keys — captured by the TMS-side accept modal. */
const PLANNER_OWNED_KEYS = Object.freeze([
  "serviceLevel",
  "bolNumber",
  "dockDoor",
  "dockLoadStart",
  "dockLoadEnd",
  "sealNumber",
  "deliveryDate",
]);

export const TENDER_RESPONSE_KEYS = Object.freeze({
  CARRIER: CARRIER_OWNED_KEYS,
  PLANNER: PLANNER_OWNED_KEYS,
});

/**
 * Extract the trailing [CP_RESPONSE] {…json…} payload from a notes
 * string. Returns the parsed object or null if no marker / bad JSON.
 */
export function parseCarrierResponse(notes) {
  const text = String(notes || "");
  const idx = text.lastIndexOf(RESPONSE_MARKER);
  if (idx < 0) return null;
  const payload = text.slice(idx + RESPONSE_MARKER.length).trim();
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** Drop the trailing [CP_RESPONSE] block so the caller can re-append. */
export function stripResponseMarker(notes) {
  const text = String(notes || "");
  const idx = text.lastIndexOf(RESPONSE_MARKER);
  if (idx < 0) return text.trim();
  return text.slice(0, idx).trim();
}

/**
 * Merge an addition into the existing carrier response. Empty values
 * never overwrite — this is the rule that protects carrier-supplied
 * fields when a planner submits without re-typing them.
 */
export function mergeTenderResponse(existing, addition) {
  const base = existing && typeof existing === "object" ? existing : {};
  const next = { ...base };

  Object.keys(addition || {}).forEach((key) => {
    const v = addition[key];
    if (v === undefined || v === null) return;
    if (typeof v === "string" && v.trim() === "") return;
    next[key] = v;
  });

  // Defensive: never lose carrier-owned fields the base already had.
  CARRIER_OWNED_KEYS.forEach((key) => {
    if (base[key] && !next[key]) next[key] = base[key];
  });

  // Audit timestamps — record both sides separately when applicable.
  if (addition && addition.respondedAtIso) {
    next.plannerRespondedAtIso = addition.respondedAtIso;
  }
  if (base.respondedAtIso && !next.respondedAtIso) {
    next.respondedAtIso = base.respondedAtIso;
  }

  return next;
}

/**
 * Build the new notes string with a merged [CP_RESPONSE] block at the
 * tail. Safe replacement for the old `withCarrierResponseNotes` helper
 * that overwrote everything.
 */
export function withMergedTenderNotes(existingNotes, addition) {
  const existing = parseCarrierResponse(existingNotes);
  const merged = mergeTenderResponse(existing, addition);
  const cleaned = stripResponseMarker(existingNotes);
  const markerLine = `${RESPONSE_MARKER} ${JSON.stringify(merged)}`;
  return cleaned ? `${cleaned}\n${markerLine}` : markerLine;
}

/** Has the carrier already accepted via the carrier portal? */
export function hasCarrierAccepted(shipment) {
  const r = parseCarrierResponse(shipment && shipment.notes);
  return !!(r && r.action === "accept");
}

export async function sendTenderEmailIfAvailable({ carriers, carrierName, tenderPayload }) {
  const carrierRecord = findCarrierRecord(carriers, carrierName);
  const to = carrierEmail(carrierRecord);
  if (!to) return { sent: false, reason: "missing_email" };

  const contactName =
    carrierRecord?.contact || carrierRecord?.contact_name || carrierRecord?.contactName || "";
  const contactPhone = carrierRecord?.phone || carrierRecord?.contact_phone || "";

  const result = await TenderApi.sendEmail({
    ...tenderPayload,
    to,
    carrierName,
    contactEmail: to,
    ...(contactName ? { contactName } : {}),
    ...(contactPhone ? { contactPhone } : {}),
  });
  if (result && result.sent === true) return { sent: true, to };
  return {
    sent: false,
    reason: result?.skipped || "not_sent",
    message: result?.message || "Tender email was not sent by SMTP server",
    to,
  };
}
