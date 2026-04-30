// Helpers that derive shipment-level fields from the orders linked to a
// shipment (orders where order.shipment_id === shipment.id).
//
// A shipment may consolidate multiple orders, so fields like commodity
// must be aggregated across all linked orders. Keeping this math here
// (per CLAUDE_RULES §1 / §6 / §13) keeps the derivation consistent
// across every UI surface that needs it (shipments list, detail modal,
// future reports) and avoids copy-pasting the same Set-join idiom into
// each component.

export function deriveCommodityFromOrders(linkedOrders) {
  if (!Array.isArray(linkedOrders) || linkedOrders.length === 0) return "";
  const unique = new Set(
    linkedOrders.map((o) => o && o.commodity).filter(Boolean)
  );
  return [...unique].join(", ");
}
