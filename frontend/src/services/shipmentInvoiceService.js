// Carrier invoices on one shipment, for the shipment screen.
// No business rules here: the server decides each invoice's status.
import { InvoicesApi } from "../lib/api";
import { mapDbInvoice } from "./invoiceActionsService";
import { readableReason } from "./invoiceService";

/** Every invoice in the active domain, grouped by shipment id. */
export async function getInvoicesByShipment() {
  const data = await InvoicesApi.list();
  const rows = Array.isArray(data?.invoices) ? data.invoices : Array.isArray(data) ? data : [];
  const map = new Map();
  for (const inv of rows.map(mapDbInvoice)) {
    if (inv.status === "Cancelled") continue;
    for (const id of inv.shipIds.length ? inv.shipIds : [inv.shipId]) {
      if (!id) continue;
      if (!map.has(id)) map.set(id, []);
      map.get(id).push(inv);
    }
  }
  return map;
}

/**
 * Shipment status including billing. Only a delivered shipment moves on:
 *   any invoice approved      → Invoiced
 *   an invoice disputed       → Invoice Disputed
 *   an invoice received       → Invoicing (AP is still deciding)
 * Cancelled and in-flight shipments keep their own status.
 */
export function withBillingStatus(status, invoices) {
  if (status !== "Delivered" || !invoices || !invoices.length) return status;
  if (invoices.some((i) => i.status === "Approved" || i.status === "Paid")) return "Invoiced";
  if (invoices.some((i) => i.status === "Disputed" || i.status === "Rejected")) return "Invoice Disputed";
  return "Invoicing";
}

/**
 * Invoice status of a shipment, shown in its own column next to the
 * shipment status (the shipment status is never overwritten by billing).
 *   no carrier invoice        → Not invoiced
 *   any invoice approved/paid → Approved
 *   any disputed / rejected   → Disputed / Rejected
 *   any on hold               → On hold (AP must decide)
 *   otherwise                 → Received (being checked)
 */
const GREY = { background: "#F1F5F9", color: "#64748B", border: "1px solid #E2E8F0" };
export function invoiceStatusOf(invoices) {
  const list = (invoices || []).filter((i) => i.status !== "Duplicate");
  if (!list.length) return { label: "Not invoiced", cls: "badge", style: GREY };
  if (list.some((i) => i.status === "Approved" || i.status === "Paid")) return { label: list.some((i) => i.status === "Paid") ? "Paid" : "Approved", cls: "badge badge-green" };
  if (list.some((i) => i.status === "Disputed")) return { label: "Disputed", cls: "badge badge-red" };
  if (list.some((i) => i.status === "Rejected")) return { label: "Rejected", cls: "badge badge-red" };
  if (list.some((i) => i.status === "On Hold")) return { label: "On hold", cls: "badge badge-amber" };
  return { label: "Received", cls: "badge badge-blue" };
}

export async function getShipmentInvoices(shipmentId) {
  const data = await InvoicesApi.list({ shipment: shipmentId });
  const rows = Array.isArray(data?.invoices) ? data.invoices : Array.isArray(data) ? data : [];
  return rows.map(mapDbInvoice).filter((i) => i.status !== "Cancelled");
}

const money = (n) => `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** What AP sees for an invoice in one short line. */
export function invoiceStateLine(inv) {
  if (inv.status === "Approved" || inv.status === "Paid") return inv.sentToApAt ? "Approved · ready to post" : "Approved";
  if (inv.status === "On Hold") return `On hold · ${readableReason(inv.decisionReason) || "needs AP review"}`;
  if (inv.status === "Disputed" || inv.status === "Rejected") return `${inv.status} · ${readableReason(inv.decisionReason) || "with the carrier"}`;
  return inv.status || "Pending";
}

const firstSentence = (t) => {
  const s = readableReason(t);
  const cut = s.search(/[.;](\s|$)/);
  return cut > 0 ? s.slice(0, cut + 1) : s;
};

/**
 * The invoice step of the shipment timeline. It is only complete once AP
 * has approved the carrier's invoice; a held or disputed invoice shows
 * where it is stuck instead.
 * @returns {{ label:string, done:boolean, tone?:'warn'|'bad', time:string }}
 */
export function invoicedStep(invoices) {
  const latest = [...(invoices || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  if (!latest) return { label: "Invoiced", done: false, time: "Pending — no carrier invoice yet" };
  const more = invoices.length > 1 ? ` (+${invoices.length - 1} more)` : "";
  const head = `${latest.num} · ${money(latest.amount)}`;
  if (latest.status === "Approved" || latest.status === "Paid") {
    return { label: "Invoiced", done: true, time: `${head} · ${latest.sentToApAt ? "Approved · ready to post" : "Approved"}${more}` };
  }
  if (latest.status === "Disputed" || latest.status === "Rejected") {
    return { label: "Invoice disputed", done: false, tone: "bad", time: `${head} · ${firstSentence(latest.decisionReason) || latest.status}${more}` };
  }
  if (latest.status === "On Hold") {
    return { label: "Invoice received · on hold", done: false, tone: "warn", time: `${head} · ${firstSentence(latest.decisionReason) || "needs AP review"}${more}` };
  }
  return { label: "Invoice received · awaiting AP", done: false, tone: "warn", time: `${head}${more}` };
}
