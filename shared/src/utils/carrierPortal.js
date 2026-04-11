export function resolveCarrierName(shipment) {
  if (!shipment) return "Carrier TBD";
  const raw = shipment.carrier_name || shipment.carrierName || shipment.carrier;
  const name = String(raw || "").trim();
  return name || "Carrier TBD";
}

export function plannedPickupDate(shipment) {
  if (!shipment) return "—";
  return shipment.pickupDate || shipment.pickup_date || shipment.pickup || "—";
}

export function plannedDeliveryDate(shipment) {
  if (!shipment) return "—";
  return shipment.deliveryDate || shipment.delivery_date || shipment.delivery || "—";
}

export function safeDateUrgency(dateValue) {
  const ts = Date.parse(dateValue);
  if (Number.isNaN(ts)) return { color: "var(--text3)", label: "DATE TBD" };

  const days = Math.ceil((ts - Date.now()) / 86400000);
  if (days <= 0) return { color: "var(--red)", label: "TODAY" };
  if (days === 1) return { color: "var(--red)", label: "TOMORROW" };
  if (days <= 3) return { color: "var(--yellow)", label: `in ${days} days` };
  return { color: "var(--green)", label: `in ${days} days` };
}
