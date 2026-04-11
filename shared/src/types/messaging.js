export const MESSAGE_TYPES = {
  TENDER_OFFER: "Tender Offer",
  TENDER_RESPONSE: "Tender Response",
  SHIPMENT_CREATE: "Shipment Create",
  SHIPMENT_UPDATE: "Shipment Update",
  SHIPMENT_STATUS: "Shipment Status",
  WMS_SYNC: "WMS Sync",
  DOCK_APPT: "Dock Appointment",
  EVENT_NOTIFICATION: "Event Notification",
  RATE_REQUEST: "Rate Request",
  RATE_RESPONSE: "Rate Response",
  BOL_TRANSMIT: "BOL Transmit",
  INVOICE: "Invoice",
};

export const MESSAGE_TYPE_LABELS = {
  TENDER_OFFER: "📤 Tender Offer",
  TENDER_RESPONSE: "📥 Tender Response",
  SHIPMENT_CREATE: "📦 Shipment Create",
  SHIPMENT_UPDATE: "🔄 Shipment Update",
  SHIPMENT_STATUS: "📡 Shipment Status",
  WMS_SYNC: "🔁 WMS Sync",
  DOCK_APPT: "🚪 Dock Appointment",
  EVENT_NOTIFICATION: "🔔 Event Notification",
  RATE_REQUEST: "💲 Rate Request",
  RATE_RESPONSE: "💰 Rate Response",
  BOL_TRANSMIT: "📄 BOL Transmit",
  INVOICE: "🧾 Invoice",
};

export const MESSAGE_STATUS_COLORS = {
  Sent: "#3b82f6",
  Delivered: "#16a34a",
  Acknowledged: "#8b5cf6",
  Failed: "#dc2626",
  Pending: "#f59e0b",
  Received: "#059669",
};

export const DIRECTIONS = ["Outbound", "Inbound"];

export const STATUSES = ["Sent", "Delivered", "Acknowledged", "Failed", "Pending", "Received"];

export const DESTINATION_SYSTEMS = [
  { value: "WMS", label: "WMS (Warehouse Mgmt System)" },
  { value: "CARRIER_PORTAL", label: "Carrier Portal" },
  { value: "CUSTOMER_PORTAL", label: "Customer Portal" },
  { value: "ERP", label: "ERP System" },
  { value: "BROKER_API", label: "Broker API" },
  { value: "EDI_315", label: "EDI 315 Gateway" },
  { value: "EDI_214", label: "EDI 214 Gateway" },
  { value: "EDI_204", label: "EDI 204 Gateway" },
];

export const PRIORITIES = ["NORMAL", "HIGH", "CRITICAL"];

export const COMPOSE_TYPES = [
  { value: "SHIPMENT_CREATE", label: "📦 Shipment Create → WMS" },
  { value: "SHIPMENT_UPDATE", label: "🔄 Shipment Update → WMS" },
  { value: "SHIPMENT_STATUS", label: "📡 Shipment Status → Customer" },
  { value: "TENDER_OFFER", label: "📤 Tender Offer → Carrier" },
  { value: "WMS_SYNC", label: "🔁 WMS Sync Request" },
  { value: "DOCK_APPT", label: "🚪 Dock Appointment → WMS" },
  { value: "EVENT_NOTIFICATION", label: "🔔 Event Notification" },
  { value: "BOL_TRANSMIT", label: "📄 BOL Transmit → Carrier" },
  { value: "RATE_REQUEST", label: "💲 Rate Request → Broker" },
];
