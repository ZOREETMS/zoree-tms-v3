import { MESSAGE_TYPE_LABELS, MESSAGE_STATUS_COLORS } from "../types/messaging";

/**
 * Generate seed TMS messages from shipments data.
 */
export function generateMessages(shipments = []) {
  const now = Date.now();
  const msgs = [];
  const types = [
    "TENDER_OFFER", "TENDER_RESPONSE", "SHIPMENT_CREATE",
    "SHIPMENT_UPDATE", "SHIPMENT_STATUS", "WMS_SYNC",
    "DOCK_APPT", "EVENT_NOTIFICATION", "RATE_REQUEST",
    "RATE_RESPONSE", "BOL_TRANSMIT", "INVOICE",
  ];
  const statuses = ["Sent", "Delivered", "Acknowledged", "Failed", "Pending", "Received"];
  const dests = ["WMS", "CARRIER_PORTAL", "CUSTOMER_PORTAL", "ERP", "BROKER_API", "EDI_204", "EDI_214"];
  const priorities = ["NORMAL", "NORMAL", "NORMAL", "HIGH", "CRITICAL"];

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  for (let i = 0; i < 40; i++) {
    const type = pick(types);
    const direction = ["TENDER_RESPONSE", "RATE_RESPONSE", "SHIPMENT_STATUS"].includes(type) ? "Inbound" : "Outbound";
    const status = pick(statuses);
    const shp = shipments[i % Math.max(shipments.length, 1)];
    const ref = shp?.id || `SHP-${1000 + i}`;

    msgs.push({
      id: `MSG-${String(i + 1).padStart(4, "0")}`,
      direction,
      type,
      status,
      ts: new Date(now - i * 3600000 * (1 + Math.random())).toISOString(),
      ref,
      dest: pick(dests),
      priority: pick(priorities),
      notes: "",
      payload: buildPayload(type, ref, shp),
    });
  }
  return msgs;
}

function buildPayload(type, ref, shp) {
  const base = { messageId: `MSG-${Date.now()}`, timestamp: new Date().toISOString(), version: "1.0" };
  switch (type) {
    case "SHIPMENT_CREATE":
    case "SHIPMENT_UPDATE":
      return { ...base, type, shipmentId: ref, origin: shp?.origin || "CHI", dest: shp?.dest || "DAL", mode: shp?.mode || "TL", weight: shp?.weight || 42000 };
    case "TENDER_OFFER":
      return { ...base, type, shipmentId: ref, carrier: shp?.carrier || "Swift Transport", rate: shp?.total_cost || 2450, deadline: "24h" };
    case "TENDER_RESPONSE":
      return { ...base, type, shipmentId: ref, response: "ACCEPTED", carrier: shp?.carrier || "Swift Transport" };
    case "SHIPMENT_STATUS":
      return { ...base, type, shipmentId: ref, status: shp?.status || "In Transit", location: "Memphis, TN", eta: "2024-03-15T14:00:00Z" };
    case "WMS_SYNC":
      return { ...base, type, action: "INVENTORY_UPDATE", warehouse: "WH-001", items: 12 };
    case "DOCK_APPT":
      return { ...base, type, shipmentId: ref, dock: "DOCK-A3", appointmentTime: "2024-03-15T08:00:00Z" };
    default:
      return { ...base, type, reference: ref };
  }
}

/**
 * Filter messages by tab, direction, type, status, and search text.
 */
export function filterMessages(messages, { tab, direction, type, status, search }) {
  let filtered = [...messages];

  if (tab === "outbound") filtered = filtered.filter((m) => m.direction === "Outbound");
  if (tab === "inbound") filtered = filtered.filter((m) => m.direction === "Inbound");
  if (tab === "failed") filtered = filtered.filter((m) => m.status === "Failed");

  if (direction) filtered = filtered.filter((m) => m.direction === direction);
  if (type) filtered = filtered.filter((m) => m.type === type);
  if (status) filtered = filtered.filter((m) => m.status === status);

  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter((m) =>
      m.id.toLowerCase().includes(q) ||
      m.ref.toLowerCase().includes(q) ||
      m.type.toLowerCase().includes(q) ||
      m.dest.toLowerCase().includes(q) ||
      (m.notes || "").toLowerCase().includes(q)
    );
  }

  return filtered;
}

/**
 * Compute messaging KPIs from message list.
 */
export function computeMessagingKpis(messages) {
  return {
    total: messages.length,
    delivered: messages.filter((m) => m.status === "Delivered").length,
    outbound: messages.filter((m) => m.direction === "Outbound").length,
    inbound: messages.filter((m) => m.direction === "Inbound").length,
    failed: messages.filter((m) => m.status === "Failed").length,
    pending: messages.filter((m) => m.status === "Pending").length,
  };
}

/**
 * Build a compose message payload based on type and shipment.
 */
export function buildComposePayload(type, shipment) {
  return buildPayload(type, shipment?.id || "", shipment);
}

export function getTypeLabel(type) {
  return MESSAGE_TYPE_LABELS[type] || type;
}

export function getStatusColor(status) {
  return MESSAGE_STATUS_COLORS[status] || "#64748b";
}
