// Normalize free-text location strings (origin/dest) so trivial whitespace
// or casing differences from different input paths (manual edit vs OMS push
// vs middleware) don't produce phantom change_history rows where old/new
// render identical. Returns null for empty input so the column nulls cleanly.
function normalizeLocation(s) {
  if (s === null || s === undefined) return null;
  const cleaned = String(s).replace(/\s+/g, " ").trim().toUpperCase();
  return cleaned || null;
}

function apiOrderToDbPatch(body) {
  const b = body || {};
  const patch = {};

  if ("customer" in b) patch.customer = b.customer || null;
  if ("origin" in b) patch.origin = normalizeLocation(b.origin);
  if ("destination" in b || "dest" in b) patch.dest = normalizeLocation(b.destination || b.dest);
  if ("weight" in b) patch.weight = Number(b.weight) || 0;
  if ("pieces" in b) patch.pieces = parseInt(b.pieces, 10) || 0;
  if ("shipMode" in b || "ship_mode" in b) patch.ship_mode = b.shipMode || b.ship_mode || null;
  // REQ-10: service level acts as a planning constraint similar to ship_mode.
  if ("serviceLevel" in b || "service_level" in b) patch.service_level = b.serviceLevel || b.service_level || null;
  if ("commodity" in b) patch.commodity = b.commodity || null;
  if ("incoterms" in b) patch.incoterms = b.incoterms || null;
  if ("refNum" in b || "ref_num" in b) patch.ref_num = b.refNum || b.ref_num || null;
  if ("poNum" in b || "po_num" in b || "po_number" in b) patch.po_number = b.poNum || b.po_number || b.po_num || null;
  if ("readyDate" in b || "ready" in b) patch.ready = b.readyDate || b.ready || null;
  if ("dueDate" in b || "due" in b) patch.due = b.dueDate || b.due || null;
  if ("status" in b) patch.status = b.status || null;
  if ("shipmentId" in b || "shipment_id" in b) patch.shipment_id = b.shipmentId || b.shipment_id || null;
  if ("originZip" in b || "origin_zip" in b) patch.origin_zip = b.originZip || b.origin_zip || null;
  if ("destZip" in b || "dest_zip" in b) patch.dest_zip = b.destZip || b.dest_zip || null;
  // Ship-from / ship-to location NAMES (the free-text "Dallas DC" label that
  // sits above the city/state/zip). Without this, names submitted from
  // NewOrderModal / OrderDetailModal were silently dropped, so the Edit tab
  // always re-rendered blank. Accept both camelCase (from OrdersApi →
  // mapDbOrderToApiOrder) and snake_case (from paths that spread a DB patch
  // directly).
  if ("shipFromName" in b || "ship_from_name" in b) patch.ship_from_name = b.shipFromName || b.ship_from_name || null;
  if ("shipToName" in b || "ship_to_name" in b) patch.ship_to_name = b.shipToName || b.ship_to_name || null;
  if ("hazmat" in b) patch.hazmat = !!b.hazmat;
  if ("preferredCarrier" in b || "preferred_carrier" in b) patch.preferred_carrier = b.preferredCarrier || b.preferred_carrier || null;
  if ("excludedCarrier" in b || "excluded_carrier" in b) patch.excluded_carrier = b.excludedCarrier || b.excluded_carrier || null;
  if ("noConsolidate" in b || "no_consolidate" in b) patch.no_consolidate = !!(b.noConsolidate || b.no_consolidate);
  if ("dedicatedEquip" in b || "dedicated_equip" in b) patch.dedicated_equip = !!(b.dedicatedEquip || b.dedicated_equip);
  if ("noContractRate" in b || "no_contract_rate" in b) patch.no_contract_rate = !!(b.noContractRate || b.no_contract_rate);
  if ("notes" in b) patch.notes = b.notes || null;

  return patch;
}

async function cleanupOrphanShipmentAfterUnassign({ previousShipmentId, dbSelect, dbDelete }) {
  if (!previousShipmentId) return { deleted: false };

  const remaining = await dbSelect(
    "orders",
    `select=id&shipment_id=eq.${encodeURIComponent(previousShipmentId)}&limit=2`,
    null
  );

  if (Array.isArray(remaining) && remaining.length > 0) return { deleted: false };

  const shipRows = await dbSelect(
    "shipments",
    `select=id,master_shipment_id&id=eq.${encodeURIComponent(previousShipmentId)}&limit=1`,
    null
  );
  const ship = Array.isArray(shipRows) && shipRows.length ? shipRows[0] : null;
  await dbDelete("shipments", previousShipmentId, null).catch(() => {});

  if (!ship?.master_shipment_id) return { deleted: true };

  const siblings = await dbSelect(
    "shipments",
    `select=id&master_shipment_id=eq.${encodeURIComponent(ship.master_shipment_id)}&limit=2`,
    null
  );
  if (!Array.isArray(siblings) || siblings.length === 0) {
    await dbDelete("shipments", ship.master_shipment_id, null).catch(() => {});
  }
  return { deleted: true };
}

module.exports = { apiOrderToDbPatch, cleanupOrphanShipmentAfterUnassign };

