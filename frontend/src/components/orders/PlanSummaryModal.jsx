import React from "react";
import { fmt$ } from "../../utils/orderUtils.jsx";

/**
 * Collect all shipment IDs from a summary object for filtering.
 */
function collectShipmentIds(summary) {
  const ids = [];
  if (summary.isCombined) {
    if (summary.multiStop?.masterShipment?.id) ids.push(summary.multiStop.masterShipment.id);
    (summary.multiStop?.childShipments || []).forEach(c => ids.push(c.id));
    (summary.bulkShipments || []).forEach(s => ids.push(s.id));
  } else if (summary.isMultiStop) {
    if (summary.masterShipment?.id) ids.push(summary.masterShipment.id);
    (summary.childShipments || []).forEach(c => ids.push(c.id));
  } else {
    (summary.shipments || []).forEach(s => ids.push(s.id));
  }
  return ids;
}

function ShipmentCountKPI({ count, shipmentIds, onClose }) {
  const handleClick = () => {
    if (shipmentIds.length > 0) {
      onClose();
      window.location.href = `/shipments?ids=${shipmentIds.join(",")}`;
    }
  };
  return (
    <div
      style={{ textAlign: "center", padding: "14px 10px", border: "2px solid rgba(5,150,105,.2)", borderRadius: 12, cursor: shipmentIds.length > 0 ? "pointer" : "default" }}
      onClick={handleClick}
      title={shipmentIds.length > 0 ? "Click to view these shipments" : ""}
    >
      <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 26, color: "var(--green)", textDecoration: shipmentIds.length > 0 ? "underline" : "none", textUnderlineOffset: 4 }}>{count}</div>
      <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", fontWeight: 600 }}>Shipments</div>
    </div>
  );
}

function formatElapsed(ms) {
  if (!ms) return null;
  if (ms < 1000) return `${ms}ms`;
  const secs = (ms / 1000).toFixed(1);
  return `${secs}s`;
}

function PlanSummaryModal({ summary, onClose }) {
  if (!summary) return null;
  const allShipmentIds = collectShipmentIds(summary);
  const elapsed = formatElapsed(summary.elapsedMs);

  // Combined summary (multi-stop + bulk direct shipments)
  if (summary.isCombined) {
    const { multiStop, bulkShipments, bulkPlans, bulkSiblings, ordersUpdated, totalCost } = summary;
    const totalShipments = (multiStop ? 1 + (multiStop.childShipments?.length || 0) : 0) + (bulkShipments?.length || 0);
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-card" style={{ width: 660, maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden" }} onClick={(e) => e.stopPropagation()}>
          <div style={{ background: "linear-gradient(135deg,#059669,#10b981)", borderRadius: "16px 16px 0 0", padding: "18px 24px", color: "#fff" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, opacity: 0.8, marginBottom: 4 }}>Planning Complete{elapsed ? ` \u00b7 ${elapsed}` : ""}</div>
            <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 18 }}>{totalShipments} Shipment{totalShipments !== 1 ? "s" : ""} Created</div>
          </div>
          <div className="modal-body" style={{ flex: 1, overflowY: "auto" }}>
            {/* KPI cards */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 20 }}>
              <ShipmentCountKPI count={totalShipments} shipmentIds={allShipmentIds} onClose={onClose} />
              <div style={{ textAlign: "center", padding: "14px 10px", border: "2px solid var(--border)", borderRadius: 12 }}>
                <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 26 }}>{ordersUpdated}</div>
                <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", fontWeight: 600 }}>Orders Planned</div>
              </div>
              <div style={{ textAlign: "center", padding: "14px 10px", border: "2px solid rgba(5,150,105,.2)", borderRadius: 12 }}>
                <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 26, color: "var(--green)" }}>{fmt$(totalCost)}</div>
                <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", fontWeight: 600 }}>Total Est. Cost</div>
              </div>
            </div>

            {/* Multi-stop section */}
            {multiStop && (<>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Multi-Stop Route</div>
              <div style={{ border: "2px solid rgba(99,102,241,.25)", borderRadius: 12, padding: "14px 16px", marginBottom: 12, background: "rgba(99,102,241,.03)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span className="badge badge-blue" style={{ fontSize: 10 }}>MBOL</span>
                  <a href={`/shipments?id=${multiStop.masterShipment?.id}`} onClick={(e) => { e.preventDefault(); onClose(); window.location.href = `/shipments?id=${multiStop.masterShipment?.id}`; }} style={{ fontWeight: 700, fontSize: 13, color: "var(--accent)", textDecoration: "none", cursor: "pointer" }}>{multiStop.masterShipment?.id}</a>
                  <span style={{ marginLeft: "auto", fontWeight: 700, color: "var(--green)" }}>{fmt$(multiStop.totalCost)}</span>
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>📍 {multiStop.masterShipment?.routePath}</div>
                <div style={{ fontSize: 11, color: "var(--text3)" }}>{multiStop.carrier} · {multiStop.mode} · {(multiStop.masterShipment?.miles || 0).toLocaleString()} mi</div>
              </div>
              {(multiStop.childShipments || []).map((cbol) => (
                <div key={cbol.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px", marginBottom: 8, marginLeft: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span className="badge badge-teal" style={{ fontSize: 9 }}>CBOL</span>
                    <a href={`/shipments?id=${cbol.id}`} onClick={(e) => { e.preventDefault(); onClose(); window.location.href = `/shipments?id=${cbol.id}`; }} style={{ fontWeight: 600, fontSize: 12, color: "var(--accent)", textDecoration: "none" }}>{cbol.id}</a>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>📍 {(cbol.origin || "").split(",")[0]} → {(cbol.dest || "").split(",")[0]}</span>
                    <span style={{ marginLeft: "auto", fontWeight: 700, color: "var(--green)", fontSize: 12 }}>{fmt$(cbol.cost)}</span>
                  </div>
                  {(cbol.orders || []).map((o) => (
                    <div key={o.id} style={{ display: "flex", gap: 8, fontSize: 11, color: "var(--text2)", padding: "1px 0 1px 24px" }}>
                      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, color: "var(--accent)" }}>{o.id}</span>
                      <span>{o.customer}</span>
                      <span style={{ marginLeft: "auto", fontWeight: 600 }}>{Number(o.weight || 0).toLocaleString()} lbs</span>
                    </div>
                  ))}
                </div>
              ))}
            </>)}

            {/* Direct shipments section */}
            {bulkShipments.length > 0 && (<>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, marginTop: multiStop ? 12 : 0 }}>Direct Shipments</div>
              {bulkShipments.map((shp, idx) => {
                const plan = bulkPlans?.[idx];
                const shipOrders = (bulkSiblings || []).filter((o) => (plan?.orderIds || []).includes(o.id));
                return (
                  <div key={shp.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px", marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: 14 }}>🚛</span>
                      <a href={`/shipments?id=${shp.id}`} onClick={(e) => { e.preventDefault(); onClose(); window.location.href = `/shipments?id=${shp.id}`; }} style={{ fontWeight: 700, fontSize: 13, color: "var(--accent)", textDecoration: "none" }}>{shp.id}</a>
                      <span className="badge badge-green" style={{ fontSize: 10 }}>Planned</span>
                      <span style={{ marginLeft: "auto", fontWeight: 700, color: "var(--green)" }}>{fmt$(shp.total_cost || 0)}</span>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>📍 {(shp.origin || "").split(",")[0]} → {(shp.dest || "").split(",")[0]}</div>
                    <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>{shp.carrier} · {shp.mode} · {(shp.weight || 0).toLocaleString()} lbs</div>
                    {shipOrders.map((o) => (
                      <div key={o.id} style={{ display: "flex", gap: 8, fontSize: 11, color: "var(--text2)", padding: "1px 0" }}>
                        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, color: "var(--accent)" }}>{o.id}</span>
                        <span>{o.customer}</span>
                        <span style={{ marginLeft: "auto", fontWeight: 600 }}>{Number(o.weight || 0).toLocaleString()} lbs</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </>)}
          </div>
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={onClose}>Close</button>
            <button className="btn btn-primary" onClick={() => { onClose(); window.location.href = "/shipments"; }}>📦 View All Shipments</button>
          </div>
        </div>
      </div>
    );
  }

  // Multi-stop summary
  if (summary.isMultiStop) {
    const { masterShipment, childShipments, ordersUpdated, totalCost, carrier, mode, siblings } = summary;
    const totalShipments = 1 + childShipments.length;
    return (
      <div className="modal-overlay" onClick={() => onClose()}>
        <div className="modal-card" style={{ width: 640, maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden" }} onClick={(e) => e.stopPropagation()}>
          <div style={{ background: "linear-gradient(135deg,#1e40af,#6366f1)", borderRadius: "16px 16px 0 0", padding: "18px 24px", color: "#fff" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, opacity: 0.8, marginBottom: 4 }}>Planning Complete{elapsed ? ` \u00b7 ${elapsed}` : ""}</div>
            <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 18 }}>Multi-Stop Shipment Created</div>
          </div>
          <div className="modal-body" style={{ flex: 1, overflowY: "auto" }}>
            {/* KPI cards */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 20 }}>
              <ShipmentCountKPI count={totalShipments} shipmentIds={allShipmentIds} onClose={onClose} />
              <div style={{ textAlign: "center", padding: "14px 10px", border: "2px solid var(--border)", borderRadius: 12 }}>
                <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 26 }}>{ordersUpdated}</div>
                <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", fontWeight: 600 }}>Orders Planned</div>
              </div>
              <div style={{ textAlign: "center", padding: "14px 10px", border: "2px solid rgba(5,150,105,.2)", borderRadius: 12 }}>
                <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 26, color: "var(--green)" }}>{fmt$(totalCost)}</div>
                <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", fontWeight: 600 }}>Total Est. Cost</div>
              </div>
            </div>

            {/* MBOL Card */}
            <div style={{ border: "2px solid rgba(99,102,241,.25)", borderRadius: 12, padding: "16px 18px", marginBottom: 16, background: "rgba(99,102,241,.03)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span className="badge badge-blue" style={{ fontSize: 10 }}>MBOL</span>
                <a href={`/shipments?id=${masterShipment.id}`} onClick={(e) => { e.preventDefault(); onClose(); window.location.href = `/shipments?id=${masterShipment.id}`; }} style={{ fontWeight: 700, fontSize: 14, color: "var(--accent)", textDecoration: "none", cursor: "pointer" }}>{masterShipment.id}</a>
                <span className="badge badge-green" style={{ fontSize: 10 }}>Planned</span>
                <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 700, color: "var(--green)" }}>{fmt$(totalCost)}</span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>📍 {masterShipment.routePath}</div>
              <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--text3)" }}>
                <span>{carrier} · {mode}</span>
                <span>{(masterShipment.miles || 0).toLocaleString()} mi</span>
                <span>{(masterShipment.weight || 0).toLocaleString()} lbs</span>
              </div>
            </div>

            {/* CBOL Cards */}
            {childShipments.map((cbol, idx) => (
              <div key={cbol.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "14px 18px", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span className="badge badge-teal" style={{ fontSize: 10 }}>CBOL</span>
                  <a href={`/shipments?id=${cbol.id}`} onClick={(e) => { e.preventDefault(); onClose(); window.location.href = `/shipments?id=${cbol.id}`; }} style={{ fontWeight: 600, fontSize: 13, color: "var(--accent)", textDecoration: "none", cursor: "pointer" }}>{cbol.id}</a>
                  <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: "var(--green)" }}>{fmt$(cbol.cost)}</span>
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>📍 {(cbol.origin || "").split(",")[0]} → {(cbol.dest || "").split(",")[0]}</div>
                <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 6 }}>{(cbol.miles || 0).toLocaleString()} mi</div>
                {/* Assigned orders */}
                {cbol.orders.map((o) => (
                  <div key={o.id} style={{ display: "flex", gap: 10, fontSize: 11, color: "var(--text2)", padding: "2px 0" }}>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, color: "var(--accent)" }}>{o.id}</span>
                    <span>{o.customer}</span>
                    <span>{o.commodity || "General"}</span>
                    <span style={{ marginLeft: "auto", fontWeight: 600 }}>{Number(o.weight || 0).toLocaleString()} lbs</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={() => onClose()}>Close</button>
            <button className="btn btn-primary" onClick={() => { onClose(); window.location.href = "/shipments"; }}>📦 View All Shipments</button>
          </div>
        </div>
      </div>
    );
  }

  // Shipment summary (single or multiple)
  const { shipments, ordersUpdated, totalCost, carrier, mode, lane, siblings, dates } = summary;
  const shipmentCount = shipments.length;
  return (
    <div className="modal-overlay" onClick={() => onClose()}>
      <div className="modal-card" style={{ width: 580, maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ background: "linear-gradient(135deg,#059669,#10b981)", borderRadius: "16px 16px 0 0", padding: "18px 24px", color: "#fff" }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, opacity: 0.8, marginBottom: 4 }}>Planning Complete</div>
          <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 18 }}>{shipmentCount} Shipment{shipmentCount !== 1 ? "s" : ""} Created Successfully</div>
        </div>
        <div className="modal-body" style={{ flex: 1, overflowY: "auto" }}>
          {/* KPI cards */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 20 }}>
            <ShipmentCountKPI count={shipmentCount} shipmentIds={allShipmentIds} onClose={onClose} />
            <div style={{ textAlign: "center", padding: "14px 10px", border: "2px solid var(--border)", borderRadius: 12 }}>
              <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 26 }}>{ordersUpdated}</div>
              <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", fontWeight: 600 }}>Orders Planned</div>
            </div>
            <div style={{ textAlign: "center", padding: "14px 10px", border: "2px solid rgba(5,150,105,.2)", borderRadius: 12 }}>
              <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 26, color: "var(--green)" }}>{fmt$(totalCost)}</div>
              <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", fontWeight: 600 }}>Total Est. Cost</div>
            </div>
          </div>

          {/* Shipment details — render ALL shipments */}
          {shipments.map((shp) => {
            const shipOrderIds = shp.order_ids || [];
            const shipOrders = (siblings || []).filter((s) => shipOrderIds.includes(s.id));
            const displayOrders = shipOrders.length > 0 ? shipOrders : siblings;
            return (
              <div key={shp.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "16px 18px", marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 18 }}>🚛</span>
                  <div>
                    <a href={`/shipments?id=${shp.id}`} onClick={(e) => { e.preventDefault(); onClose(); window.location.href = `/shipments?id=${shp.id}`; }} style={{ fontWeight: 700, fontSize: 14, color: "var(--accent)", textDecoration: "none", cursor: "pointer" }}>{shp.id}</a>
                    <div style={{ fontSize: 11, color: "var(--text3)" }}>{shp.carrier || carrier} · {shp.mode || mode}</div>
                    <span className="badge badge-green" style={{ fontSize: 10, marginTop: 2 }}>✓ Planned</span>
                  </div>
                  <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 700, color: "var(--green)" }}>{fmt$(shp.total_cost || 0)}</span>
                </div>

                {/* Lane */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderTop: "1px solid var(--border)", marginTop: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>📍 {(shp.origin || lane?.origin || "").split(",")[0]} → {(shp.dest || lane?.destination || "").split(",")[0]}</span>
                </div>

                {/* Orders */}
                <div style={{ fontSize: 11, color: "var(--text3)", fontWeight: 600, marginBottom: 4 }}>{shipOrderIds.length || displayOrders.length} Order{(shipOrderIds.length || displayOrders.length) !== 1 ? "s" : ""} Consolidated</div>
                {displayOrders.map((s) => (
                  <div key={s.id} style={{ display: "flex", gap: 10, fontSize: 11, color: "var(--text2)", padding: "2px 0" }}>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, color: "var(--accent)" }}>{s.id}</span>
                    <span>{s.customer}</span>
                    <span>{s.commodity || "General"}</span>
                    <span style={{ marginLeft: "auto", fontWeight: 600 }}>{Number(s.weight || 0).toLocaleString()} lbs</span>
                  </div>
                ))}

                {/* Dates */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 12 }}>
                  <div style={{ background: "var(--bg3)", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
                    <div style={{ fontSize: 9, color: "var(--text3)", textTransform: "uppercase" }}>Weight</div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{(shp.weight || shp.total_weight || 0).toLocaleString()} lbs</div>
                  </div>
                  <div style={{ background: "var(--bg3)", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
                    <div style={{ fontSize: 9, color: "var(--text3)", textTransform: "uppercase" }}>Pickup</div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{shp.pickup_date || dates?.pickup || "—"}</div>
                  </div>
                  <div style={{ background: "var(--bg3)", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
                    <div style={{ fontSize: 9, color: "var(--text3)", textTransform: "uppercase" }}>Delivery</div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{shp.delivery_date || dates?.delivery || "—"}</div>
                  </div>
                </div>
                <a href={`/shipments?id=${shp.id}`} onClick={(e) => { e.preventDefault(); onClose(); window.location.href = `/shipments?id=${shp.id}`; }} style={{ display: "block", textAlign: "right", marginTop: 8, fontSize: 11, color: "var(--accent)", cursor: "pointer", textDecoration: "none" }}>Click to view full details →</a>
              </div>
            );
          })}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={() => onClose()}>Close</button>
          <button className="btn btn-primary" onClick={() => { onClose(); window.location.href = "/shipments"; }}>📦 View All Shipments</button>
        </div>
      </div>
    </div>
  );
}

export default PlanSummaryModal;
