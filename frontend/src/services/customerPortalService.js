import { CUSTOMERS_WITH_ACCESS } from "../types/customerPortal";

/**
 * Customer Portal service layer.
 * All API calls for customer portal go through here.
 * Currently uses local computation; swap for real endpoints when ready.
 */

/** Compute portal statistics from shipments */
export function computePortalStats(shipments) {
  const all = shipments || [];
  const shipped = all.filter((s) => s.status !== "Planned").length;
  const inTransit = all.filter((s) => s.status === "In Transit").length;
  const delivered = all.filter((s) => s.status === "Delivered").length;
  const exceptions = all.filter((s) => s.status === "Exception").length;

  return {
    activeCustomers: CUSTOMERS_WITH_ACCESS.length,
    shipmentsShared: shipped,
    inTransit,
    delivered,
    exceptions,
  };
}

/** Build customer access list with shipment counts */
export function buildCustomerAccessList(shipments, orders) {
  return CUSTOMERS_WITH_ACCESS.map((name) => {
    const count = (shipments || []).filter((s) =>
      (orders || []).some(
        (o) => o.customer === name && o.shipmentId === s.id
      )
    ).length;

    return {
      name,
      initial: name.charAt(0),
      shipmentCount: count,
      portalStatus: "Active",
    };
  });
}

/** Build shipment visibility rows for table */
export function buildVisibilityRows(shipments, orders) {
  return (shipments || []).slice(0, 12).map((s) => {
    const order = (orders || []).find((o) => o.shipmentId === s.id);
    const customer = order ? order.customer : "N/A";
    const etaDays =
      s.status === "Delivered"
        ? 0
        : s.status === "In Transit"
        ? 2
        : s.status === "Tendered"
        ? 4
        : 6;
    const etaDate = new Date(Date.now() + etaDays * 86400000).toLocaleDateString(
      "en-US",
      { month: "short", day: "numeric" }
    );

    return {
      id: s.id,
      customer,
      originShort: (s.origin || "").split(",")[0],
      destShort: (s.dest || "").split(",")[0],
      status: s.status,
      eta: s.status === "Delivered" ? "Delivered" : etaDate,
      lastUpdate: s.pickup || "",
    };
  });
}

/** Stub: send portal invite (replace with real API call) */
export async function sendCustomerInvite(invite) {
  // TODO: POST /api/customer-portal/invite
  return { success: true, message: `Invite sent to ${invite.email}` };
}

/** Stub: share tracking link (replace with real API call) */
export async function shareTrackingLink(shipmentId, customerName) {
  // TODO: POST /api/customer-portal/share
  return { success: true, message: `Tracking link shared with ${customerName}` };
}

/** Stub: copy portal link (replace with real API call) */
export async function copyPortalLink() {
  // TODO: GET /api/customer-portal/link
  return { success: true, message: "Portal link copied to clipboard" };
}
