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
  return {
    id: "BOL-" + Date.now(),
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

export function downloadDocument(docId, title, contentHtml) {
  const html = buildBOLPrintHtml(title, contentHtml);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = docId + ".html";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
