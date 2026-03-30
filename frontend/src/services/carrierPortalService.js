import { DbApi } from "../lib/api";
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

export function isActivePortalCarrierShipment(shipment) {
  const shipmentCarrier = normalizeCarrier(resolveCarrierName(shipment));
  const activeCarrier = normalizeCarrier(ACTIVE_PORTAL_CARRIER);
  if (!shipmentCarrier || !activeCarrier) return false;
  return shipmentCarrier === activeCarrier
    || shipmentCarrier.includes(activeCarrier)
    || activeCarrier.includes(shipmentCarrier);
}

export async function saveTenderResponse(shipment, responseData) {
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
    patch.pro_number = normalized.proNumber || null;
    if (normalized.carrierPickupDate) patch.pickup_date = normalized.carrierPickupDate;
  }
  if (normalized.action === "reject") {
    patch.status = "Tender Rejected";
  }

  await DbApi.patch("shipments", shipment.id, patch);
  return normalized;
}
