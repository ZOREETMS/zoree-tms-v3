import { DbApi } from "../lib/api";

// ── Field mapping: camelCase (frontend) ↔ snake_case (DB) ─────────
function docToDb(doc) {
  return {
    id: doc.id,
    type: doc.type,
    status: doc.status || "Pending",
    ship: doc.ship,
    carrier: doc.carrier,
    generated: doc.generated,
    origin: doc.origin || null,
    dest: doc.dest || null,
    weight: doc.weight || null,
    pieces: doc.pieces || null,
    mode: doc.mode || null,
    bol_type: doc.bolType || null,
    pickup_date: doc.pickupDate || null,
    delivery_date: doc.deliveryDate || null,
    order_ids: doc.orderIds || [],
    orders: doc.orders || [],
    line_items: doc.lineItems || [],
    incoterms: doc.incoterms || null,
  };
}

function dbToDoc(row) {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    ship: row.ship,
    carrier: row.carrier,
    generated: row.generated,
    origin: row.origin,
    dest: row.dest,
    weight: row.weight,
    pieces: row.pieces,
    mode: row.mode,
    bolType: row.bol_type,
    pickupDate: row.pickup_date,
    deliveryDate: row.delivery_date,
    orderIds: row.order_ids || [],
    orders: row.orders || [],
    lineItems: row.line_items || [],
    incoterms: row.incoterms || null,
  };
}

// ── API persistence functions ─────────────────────────────────────
export async function fetchDocuments() {
  try {
    const rows = await DbApi.documents();
    if (Array.isArray(rows)) return rows.map(dbToDoc);
    return [];
  } catch {
    return [];
  }
}

export async function saveDocument(doc) {
  const payload = docToDb(doc);
  return DbApi.upsert("documents", payload).catch(() => doc);
}

export async function removeDocument(docId) {
  return DbApi.remove("documents", docId).catch(() => {});
}

// ── Seed data (fallback when DB is empty) ─────────────────────────
export const SEED_DOCUMENTS = [
  { id: "BOL-2024-1840", type: "BOL", ship: "SHP-2024-1840", carrier: "Swift Transport", generated: "2026-02-28", status: "Signed" },
  { id: "POD-2024-1840", type: "POD", ship: "SHP-2024-1840", carrier: "Swift Transport", generated: "2026-03-03", status: "Received" },
  { id: "BOL-2024-1841", type: "BOL", ship: "SHP-2024-1841", carrier: "Old Dominion", generated: "2026-03-01", status: "Signed" },
  { id: "BOL-2024-1844", type: "BOL", ship: "SHP-2024-1844", carrier: "Werner Enterprises", generated: "2026-03-02", status: "Pending" },
  { id: "POD-2024-1841", type: "POD", ship: "SHP-2024-1841", carrier: "Old Dominion", generated: "2026-03-04", status: "Received" },
  { id: "BOL-2024-1845", type: "BOL", ship: "SHP-2024-1845", carrier: "Schneider National", generated: "2026-03-03", status: "Signed" },
  { id: "BOL-2024-1848", type: "BOL", ship: "SHP-2024-1848", carrier: "XPO Logistics", generated: "2026-03-04", status: "Signed" },
  { id: "HZM-2024-1851", type: "Hazmat", ship: "SHP-2024-1851", carrier: "JB Hunt", generated: "2026-03-05", status: "Filed" },
  { id: "INV-COM-1840", type: "Invoice", ship: "SHP-2024-1840", carrier: "Swift Transport", generated: "2026-03-03", status: "Sent" },
  { id: "BOL-2024-1849", type: "BOL", ship: "SHP-2024-1849", carrier: "Swift Transport", generated: "2026-03-05", status: "Pending" },
  { id: "BOL-2024-1843", type: "BOL", ship: "SHP-2024-1843", carrier: "FedEx Freight", generated: "2026-03-01", status: "Signed" },
  { id: "POD-2024-1843", type: "POD", ship: "SHP-2024-1843", carrier: "FedEx Freight", generated: "2026-03-04", status: "Received" },
];

export function generateBOLForShipment(shipment, orders, lineItems) {
  const bolType = shipment.bol_type || "BOL";
  const prefix = bolType === "MBOL" ? "MBOL" : bolType === "CBOL" ? "CBOL" : "BOL";
  return {
    id: `${prefix}-${shipment.id}`,
    type: "BOL",
    ship: shipment.id,
    carrier: shipment.carrier || "",
    generated: new Date().toISOString().split("T")[0],
    status: "Pending",
    // Shipment details for BOL viewer
    origin: shipment.origin || "",
    dest: shipment.dest || "",
    weight: shipment.weight || 0,
    pieces: shipment.pieces || 0,
    mode: shipment.mode || "",
    pickupDate: shipment.pickup_date || "",
    deliveryDate: shipment.delivery_date || "",
    bolType: shipment.bol_type || "BOL",
    orderIds: shipment.order_ids || [],
    orders: orders || [],
    lineItems: lineItems || [],
    incoterms: (orders || []).map((o) => o.incoterms).find(Boolean) || null,
  };
}

export function computeDocStats(documents) {
  const total = documents.length;
  const bolsGenerated = documents.filter((d) => d.type === "BOL").length;
  const podsPending = documents.filter((d) => d.type === "POD" && d.status === "Pending").length;
  const podsReceived = documents.filter((d) => d.type === "POD" && d.status === "Received").length;
  return { total, bolsGenerated, podsPending, podsReceived };
}

export function buildBOLPrintHtml(title, contentHtml) {
  return (
    "<!DOCTYPE html><html><head>" +
    '<meta charset="UTF-8">' +
    "<title>" + title + "</title>" +
    "<style>" +
    "* { box-sizing: border-box; margin: 0; padding: 0; }" +
    'body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #000; background: #fff; padding: 20px; }' +
    "table { border-collapse: collapse; width: 100%; }" +
    "th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }" +
    "th { background: #f0f0f0; font-size: 10px; text-transform: uppercase; }" +
    '.mono { font-family: "Courier New", monospace; }' +
    "@page { size: A4; margin: 15mm; }" +
    "@media print { body { padding: 0; } }" +
    "</style>" +
    "</head><body>" +
    contentHtml +
    "</body></html>"
  );
}

export async function downloadDocument(docId, title, contentElement) {
  const html2pdf = (await import("html2pdf.js")).default;
  const opt = {
    margin: [10, 10, 10, 10],
    filename: docId + ".pdf",
    image: { type: "jpeg", quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
  };
  html2pdf().set(opt).from(contentElement).save();
}

export function printDocument(title, contentHtml) {
  const win = window.open("", "_blank", "width=800,height=900");
  win.document.write(
    "<html><head><title>" + title + "</title>" +
    '<style>body{font-family:"Courier New",monospace;margin:20px}@media print{body{margin:0}}table{border-collapse:collapse;width:100%}.mono{font-family:monospace}</style>' +
    "</head><body>" + contentHtml + "</body></html>"
  );
  win.document.close();
  setTimeout(() => win.print(), 400);
}
