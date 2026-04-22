// Shipment cost-breakdown helpers.
//
// Shipments carry four cost columns: total_cost, rate (base/linehaul),
// fuel_surcharge, and accessorials. Legacy or OMS-ingested shipments may
// only persist total_cost, leaving the components at 0. Rather than hide
// the breakdown when that happens, deriveShipmentCostBreakdown() fills in
// the base from (total − fuel − accessorials) so the detail panel always
// has a full set of rows to render.
//
// Keeping the math here (per CLAUDE_RULES §1 / §6) lets the view stay a
// dumb renderer and lets tests exercise the math directly if needed.

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function deriveShipmentCostBreakdown(shipment) {
  const total = toNum(shipment?.total_cost);
  const fuel = toNum(shipment?.fuel_surcharge);
  const accessorials = toNum(shipment?.accessorials);
  let base = toNum(shipment?.rate);

  if (base === 0 && total > 0) {
    const derived = total - fuel - accessorials;
    base = derived > 0 ? derived : total;
  }

  return {
    base,
    fuel,
    accessorials,
    total: total || base + fuel + accessorials,
    // Surface whether the base came from the stored column or was derived,
    // so the UI can optionally annotate "derived" for transparency.
    baseIsDerived: toNum(shipment?.rate) === 0 && total > 0,
  };
}

export function formatUSD(value) {
  const n = toNum(value);
  return `$${n.toLocaleString()}`;
}
