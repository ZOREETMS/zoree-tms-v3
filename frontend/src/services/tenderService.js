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
