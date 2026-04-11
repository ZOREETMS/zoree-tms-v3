import { DbApi } from "../api";
import { resolveCarrierName } from "../utils/carrierPortal";

const RESPONSE_MARKER = "[CP_RESPONSE]";
const ENV_PORTAL_CARRIER =
  import.meta.env.VITE_CARRIER_PORTAL_CARRIER ||
  window.ZOREE_CARRIER_PORTAL_CARRIER ||
  "JB Hunt";

export const ACTIVE_PORTAL_CARRIER = String(ENV_PORTAL_CARRIER).trim() || "JB Hunt";

function normalizeCarrier(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function parseResponseFromNotes(notes) {
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

function stripResponseMarker(notes) {
  const text = String(notes || "");
  const idx = text.lastIndexOf(RESPONSE_MARKER);
  if (idx < 0) return text.trim();
  return text.slice(0, idx).trim();
}

function buildNotesWithResponse(existingNotes, response) {
  const cleaned = stripResponseMarker(existingNotes);
  const markerLine = `${RESPONSE_MARKER} ${JSON.stringify(response)}`;
  return cleaned ? `${cleaned}\n${markerLine}` : markerLine;
}

function toIsoDateTimeParts(date = new Date()) {
  return {
    respondedAt: date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      + " " + date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
    respondedAtIso: date.toISOString(),
  };
}

export function buildPersistedTenderResponses(shipments) {
  const map = {};
  (shipments || []).forEach((s) => {
    const response = parseResponseFromNotes(s.notes);
    if (response) map[s.id] = response;
  });
  return map;
}

/**
 * UI status: if DB still says Tendered but carrier portal saved [CP_RESPONSE] accept in notes, treat as Confirmed.
 */
export function effectiveShipmentStatus(s) {
  if (!s) return "";
  const raw = String(s.status || "").trim();
  if (raw === "Tendered") {
    const r = parseResponseFromNotes(s.notes);
    if (r?.action === "accept") return "Confirmed";
  }
  return raw || "—";
}

export function isActivePortalCarrierShipment(shipment) {
  const shipmentCarrier = normalizeCarrier(resolveCarrierName(shipment));
  const activeCarrier = normalizeCarrier(ACTIVE_PORTAL_CARRIER);
  if (!shipmentCarrier || !activeCarrier) return false;
  return shipmentCarrier === activeCarrier
    || shipmentCarrier.includes(activeCarrier)
    || activeCarrier.includes(shipmentCarrier);
}

function parseMissingColumn(errorMessage) {
  const msg = String(errorMessage || "");
  const patterns = [
    /column\s+"?([a-zA-Z0-9_]+)"?\s+does\s+not\s+exist/i,
    /Could not find the ['"]([a-zA-Z0-9_]+)['"] column/i,
    /unknown column ['"]?([a-zA-Z0-9_]+)['"]?/i,
  ];
  for (const p of patterns) {
    const m = msg.match(p);
    if (m) return m[1];
  }
  return "";
}

/** Retry PATCH after dropping columns Supabase rejects (schema drift). */
async function patchTableWithFallback(table, id, payload) {
  const patch = { ...payload };
  const maxAttempts = Math.max(1, Object.keys(patch).length + 3);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await DbApi.patch(table, id, patch);
    } catch (err) {
      const missing = parseMissingColumn(err.message);
      if (!missing || !Object.prototype.hasOwnProperty.call(patch, missing)) throw err;
      delete patch[missing];
      if (!Object.keys(patch).length) throw err;
    }
  }
  return DbApi.patch(table, id, patch);
}

async function patchOrderConfirmed(orderId, pickupVal) {
  const p = { status: "Confirmed" };
  if (pickupVal) {
    p.pickup = pickupVal;
    p.ready = pickupVal;
  }
  return patchTableWithFallback("orders", orderId, p);
}

/**
 * @param {{ orders?: Array<{ id?: string }> }} [extra] Linked orders for status sync (matches Shipments “Accept” flow).
 */
export async function saveTenderResponse(shipment, responseData, extra = {}) {
  const now = toIsoDateTimeParts();
  const carrierName = resolveCarrierName(shipment);
  const normalized = {
    ...responseData,
    respondedAt: responseData.respondedAt || now.respondedAt,
    respondedAtIso: responseData.respondedAtIso || now.respondedAtIso,
    carrierName,
  };

  const notes = buildNotesWithResponse(shipment.notes, normalized);
  const patch = { notes };

  if (normalized.action === "accept") {
    patch.status = "Confirmed";
    patch.pro_number = normalized.proNumber || null;
    if (normalized.carrierPickupDate) {
      patch.pickup_date = normalized.carrierPickupDate;
      patch.pickup = normalized.carrierPickupDate;
    }
  }
  if (normalized.action === "reject") {
    patch.status = "Tender Rejected";
  }

  await patchTableWithFallback("shipments", shipment.id, patch);

  if (normalized.action === "accept" && Array.isArray(extra.orders) && extra.orders.length) {
    const pickupVal =
      normalized.carrierPickupDate || shipment.pickup_date || shipment.pickup || "";
    const list = extra.orders.filter((o) => o && o.id);
    await Promise.allSettled(
      list.map((o) => patchOrderConfirmed(o.id, pickupVal))
    );
  }

  return normalized;
}
