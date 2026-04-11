import { useState, useMemo } from "react";
import { RouteApi } from "../../lib/api";

function genShipId() {
  const y = new Date().getFullYear();
  const r = String(Math.floor(1000 + Math.random() * 9000));
  return `SHP-${y}-${r}`;
}

function getLegMiles(pickup, delivery) {
  // Use leg_miles entered on the delivery stop, or fallback to 0
  return parseFloat(delivery.leg_miles) || 0;
}

export default function ExecuteRouteModal({ route, orders, onClose, onSuccess }) {
  const [assigning, setAssigning] = useState({});
  const [costOverrides, setCostOverrides] = useState({});
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState("");

  const stops = Array.isArray(route?.stops) ? route.stops : [];
  const pickups = stops.filter((s) => s.type === "pickup");
  const deliveries = stops.filter((s) => s.type === "delivery");
  const totalRouteCost = parseFloat(route.cost_override) || 0;

  // Build CBOL pairs: each pickup → each delivery
  const cbolPairs = useMemo(() => {
    const pairs = [];
    pickups.forEach((p) => {
      deliveries.forEach((d) => {
        if ((d.stop_seq || d.sequence) > (p.stop_seq || p.sequence)) {
          // Sum leg miles from pickup to this delivery
          const pIdx = stops.indexOf(p);
          const dIdx = stops.indexOf(d);
          let legMiles = 0;
          for (let i = pIdx + 1; i <= dIdx; i++) {
            legMiles += parseFloat(stops[i].leg_miles) || 0;
          }
          pairs.push({
            key: `${p.stop_seq || p.sequence}.${d.stop_seq || d.sequence}`,
            pickup: p,
            delivery: d,
            stopFrom: p.stop_seq || p.sequence,
            stopTo: d.stop_seq || d.sequence,
            legMiles,
          });
        }
      });
    });
    return pairs;
  }, [pickups, deliveries, stops]);

  // Total leg miles across all CBOLs (for pro-rata)
  const totalLegMiles = useMemo(() => {
    return cbolPairs.reduce((s, p) => s + p.legMiles, 0);
  }, [cbolPairs]);

  // Calculate pro-rata cost for a CBOL
  function getCbolCost(pair) {
    // Manual override takes priority
    if (costOverrides[pair.key] !== undefined && costOverrides[pair.key] !== "") {
      return parseFloat(costOverrides[pair.key]) || 0;
    }
    // Pro-rate by miles
    if (totalLegMiles === 0 || totalRouteCost === 0) return 0;
    return Math.round((pair.legMiles / totalLegMiles) * totalRouteCost * 100) / 100;
  }

  // Unplanned orders available for assignment
  const availableOrders = useMemo(() => {
    return (orders || []).filter((o) => o.status === "Unplanned");
  }, [orders]);

  function toggleOrder(cbolKey, orderId) {
    setAssigning((prev) => {
      const next = {};
      for (const [k, ids] of Object.entries(prev)) {
        next[k] = ids.filter((id) => id !== orderId);
      }
      const current = prev[cbolKey] || [];
      if (current.includes(orderId)) {
        return next;
      }
      next[cbolKey] = [...(next[cbolKey] || []), orderId];
      return next;
    });
  }

  function getAssignment(orderId) {
    for (const [k, ids] of Object.entries(assigning)) {
      if (ids.includes(orderId)) return k;
    }
    return null;
  }

  async function execute() {
    const totalAssigned = Object.values(assigning).flat().length;
    if (totalAssigned === 0) {
      setError("Assign at least one order to a shipment");
      return;
    }
    setError("");
    setExecuting(true);

    try {
      const masterId = genShipId();
      const allOrderIds = Object.values(assigning).flat();
      const firstPickup = pickups[0] || stops[0];
      const lastDelivery = deliveries[deliveries.length - 1] || stops[stops.length - 1];

      const masterShipment = {
        id: masterId,
        carrier: route.carrier || "",
        mode: route.mode || "TL",
        origin: firstPickup.location || `${firstPickup.city}, ${firstPickup.state}`,
        dest: lastDelivery.location || `${lastDelivery.city}, ${lastDelivery.state}`,
        weight: allOrderIds.reduce((s, oid) => {
          const o = availableOrders.find((x) => x.id === oid);
          return s + (parseFloat(o?.weight) || 0);
        }, 0),
        pieces: allOrderIds.reduce((s, oid) => {
          const o = availableOrders.find((x) => x.id === oid);
          return s + (parseInt(o?.pieces) || 0);
        }, 0),
        status: "Planned",
        total_cost: totalRouteCost,
        order_ids: allOrderIds,
        miles: route.total_miles || 0,
        bol_type: "MBOL",
        master_shipment_id: null,
        route_template_id: route.id,
      };

      const childShipments = [];
      const orderUpdates = [];

      for (const pair of cbolPairs) {
        const orderIds = assigning[pair.key] || [];
        if (orderIds.length === 0) continue;

        const childId = `${masterId}.${pair.stopFrom}.${pair.stopTo}`;
        const pickup = pair.pickup;
        const delivery = pair.delivery;
        const cbolCost = getCbolCost(pair);

        childShipments.push({
          id: childId,
          carrier: route.carrier || "",
          mode: route.mode || "TL",
          origin: pickup.location || `${pickup.city}, ${pickup.state}`,
          dest: delivery.location || `${delivery.city}, ${delivery.state}`,
          weight: orderIds.reduce((s, oid) => {
            const o = availableOrders.find((x) => x.id === oid);
            return s + (parseFloat(o?.weight) || 0);
          }, 0),
          pieces: orderIds.reduce((s, oid) => {
            const o = availableOrders.find((x) => x.id === oid);
            return s + (parseInt(o?.pieces) || 0);
          }, 0),
          status: "Planned",
          total_cost: cbolCost,
          order_ids: orderIds,
          miles: pair.legMiles,
          bol_type: "CBOL",
          master_shipment_id: masterId,
          stop_from: pair.stopFrom,
          stop_to: pair.stopTo,
          route_template_id: route.id,
        });

        orderIds.forEach((oid) => {
          orderUpdates.push({ id: oid, shipment_id: childId });
        });
      }

      await RouteApi.executeRoute(masterShipment, childShipments, orderUpdates);
      onSuccess(masterId, childShipments.length);
    } catch (err) {
      setError("Execute failed: " + err.message);
    } finally {
      setExecuting(false);
    }
  }

  const fmt$ = (n) => "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 780 }}>
        <div className="modal-header">
          <div>
            <div style={{ fontSize: 10, opacity: 0.6, letterSpacing: 1 }}>EXECUTE MULTI-STOP ROUTE</div>
            <h3>{route.name || route.id}</h3>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body" style={{ maxHeight: "75vh", overflowY: "auto" }}>
          {error && (
            <div style={{
              padding: "10px 14px", borderRadius: 10, marginBottom: 14,
              fontSize: 13, fontWeight: 600,
              background: "#FEF2F2", color: "#B91C1C", border: "1px solid #FECACA",
            }}>
              {error}
            </div>
          )}

          {/* Route Summary */}
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 20,
            padding: 16, background: "#F8FAFC", borderRadius: 12, border: "1px solid var(--border)",
          }}>
            <div>
              <div style={{ fontSize: 10, color: "var(--text3)", fontWeight: 600, textTransform: "uppercase" }}>Carrier</div>
              <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>{route.carrier || "—"}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "var(--text3)", fontWeight: 600, textTransform: "uppercase" }}>Mode</div>
              <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>{route.mode}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "var(--text3)", fontWeight: 600, textTransform: "uppercase" }}>Total Miles</div>
              <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>{(route.total_miles || totalLegMiles).toLocaleString()} mi</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "var(--text3)", fontWeight: 600, textTransform: "uppercase" }}>MBOL Cost</div>
              <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2, color: "var(--green)" }}>{fmt$(totalRouteCost)}</div>
            </div>
          </div>

          {/* BOL Structure */}
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>
            Shipment Structure
          </div>
          <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 14, textTransform: "none" }}>
            MBOL (master) + {cbolPairs.length} CBOLs — cost split pro-rata by leg miles
          </div>

          {/* CBOL Cards */}
          {cbolPairs.map((pair) => {
            const assignedIds = assigning[pair.key] || [];
            const pickupLabel = pair.pickup.city && pair.pickup.state
              ? `${pair.pickup.city}, ${pair.pickup.state}`
              : pair.pickup.location || `Stop ${pair.stopFrom}`;
            const delivLabel = pair.delivery.city && pair.delivery.state
              ? `${pair.delivery.city}, ${pair.delivery.state}`
              : pair.delivery.location || `Stop ${pair.stopTo}`;
            const cbolCost = getCbolCost(pair);
            const pctOfTotal = totalRouteCost > 0 ? Math.round((cbolCost / totalRouteCost) * 100) : 0;

            return (
              <div key={pair.key} style={{
                border: "1px solid var(--border)", borderRadius: 12, marginBottom: 14, overflow: "hidden",
              }}>
                {/* CBOL Header */}
                <div style={{
                  padding: "12px 16px", background: "#EFF6FF",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="badge badge-blue" style={{ fontSize: 10 }}>CBOL</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                      .{pair.stopFrom}.{pair.stopTo}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--text2)" }}>
                      {pickupLabel} → {delivLabel}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                    <span style={{ color: "var(--text3)" }}>{pair.legMiles.toLocaleString()} mi</span>
                    <span style={{ color: "var(--text3)" }}>({pctOfTotal}%)</span>
                  </div>
                </div>

                {/* Cost + Order Assignment */}
                <div style={{ padding: "12px 16px" }}>
                  {/* Pro-rata cost with override */}
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, padding: "8px 12px", background: "#F8FAFC", borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: "var(--text3)", fontWeight: 600, textTransform: "uppercase" }}>Cost:</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "var(--green)", fontFamily: "'JetBrains Mono', monospace" }}>
                      {fmt$(cbolCost)}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text3)", flex: 1 }}>
                      {costOverrides[pair.key] !== undefined && costOverrides[pair.key] !== "" ? "(manual)" : `(pro-rata: ${pair.legMiles} / ${totalLegMiles} mi)`}
                    </div>
                    <input
                      type="number"
                      value={costOverrides[pair.key] ?? ""}
                      onChange={(e) => setCostOverrides((prev) => ({ ...prev, [pair.key]: e.target.value }))}
                      placeholder="Override"
                      step="0.01"
                      style={{ width: 100, height: 28, fontSize: 12, textAlign: "center", padding: "0 6px", borderRadius: 6, border: "1px solid var(--border)" }}
                    />
                  </div>

                  {/* Order Assignment */}
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text3)", marginBottom: 8, textTransform: "uppercase" }}>
                    Assign Orders ({assignedIds.length})
                  </div>
                  {availableOrders.length === 0 ? (
                    <div style={{ fontSize: 12, color: "var(--text3)", fontStyle: "italic" }}>No unplanned orders</div>
                  ) : (
                    <div style={{ maxHeight: 140, overflowY: "auto" }}>
                      {availableOrders.map((order) => {
                        const currentAssignment = getAssignment(order.id);
                        const isAssigned = currentAssignment === pair.key;
                        const assignedElsewhere = currentAssignment && currentAssignment !== pair.key;

                        return (
                          <label
                            key={order.id}
                            style={{
                              display: "flex", alignItems: "center", gap: 10,
                              padding: "5px 8px", borderRadius: 6, cursor: "pointer",
                              background: isAssigned ? "#EFF6FF" : "transparent",
                              opacity: assignedElsewhere ? 0.35 : 1,
                              fontSize: 12,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isAssigned}
                              onChange={() => toggleOrder(pair.key, order.id)}
                              style={{ accentColor: "var(--accent)" }}
                            />
                            <span style={{ fontWeight: 600, color: "var(--accent)", fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
                              {order.id}
                            </span>
                            <span style={{ color: "var(--text2)" }}>{order.customer}</span>
                            <span style={{ color: "var(--text3)", fontSize: 11 }}>{(parseFloat(order.weight) || 0).toLocaleString()} lbs</span>
                            <span style={{ color: "var(--text3)", marginLeft: "auto", fontSize: 11 }}>
                              {order.origin} → {order.dest}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="modal-footer">
          <div style={{ flex: 1, fontSize: 12, color: "var(--text3)", textTransform: "none" }}>
            {Object.values(assigning).flat().length} orders · {cbolPairs.filter((p) => (assigning[p.key] || []).length > 0).length} CBOLs · Total: {fmt$(cbolPairs.reduce((s, p) => s + getCbolCost(p), 0))}
          </div>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={execute} disabled={executing}>
            {executing ? "Creating..." : "Execute Route"}
          </button>
        </div>
      </div>
    </div>
  );
}
