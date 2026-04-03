import { useEffect, useMemo, useState } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip } from "react-leaflet";
import { DbApi, TenderApi, OrdersApi, OmsApi } from "../lib/api";
import { sendTenderEmailIfAvailable } from "../services/tenderService";
import { effectiveShipmentStatus } from "../services/carrierPortalService";
import { getHereApiKey, hereRasterTileUrl, resolveHereApiKey } from "../config/hereMaps";
import "leaflet/dist/leaflet.css";
import TenderResultModal from "../components/shipments/TenderResultModal";

const STATUS_BADGES = {
  Planned: "badge badge-teal",
  Tendered: "badge badge-purple",
  "Tender Rejected": "badge badge-red",
  "In Transit": "badge badge-blue",
  Delivered: "badge badge-green",
  Exception: "badge badge-red",
  Cancelled: "badge badge-red",
};

const STATE_CENTROIDS = {
  AL: [32.8, -86.8], AZ: [34.2, -111.7], AR: [34.9, -92.4], CA: [37.1, -119.7],
  CO: [39.0, -105.5], CT: [41.6, -72.7], FL: [27.8, -81.7], GA: [32.7, -83.3],
  IA: [42.1, -93.5], ID: [44.2, -114.4], IL: [40.0, -89.2], IN: [39.9, -86.3],
  KS: [38.5, -98.3], KY: [37.6, -85.3], LA: [31.1, -91.9], MA: [42.2, -71.8],
  MD: [39.0, -76.7], MI: [44.3, -85.4], MN: [46.4, -94.6], MO: [38.5, -92.6],
  MS: [32.7, -89.7], NC: [35.5, -79.4], NE: [41.5, -99.8], NJ: [40.1, -74.7],
  NM: [34.5, -106.0], NV: [39.3, -116.6], NY: [43.0, -75.0], OH: [40.3, -82.8],
  OK: [35.6, -97.5], OR: [43.9, -120.6], PA: [40.9, -77.6], SC: [33.8, -80.9],
  TN: [35.7, -86.4], TX: [31.4, -99.3], UT: [39.3, -111.7], VA: [37.5, -78.6],
  WA: [47.4, -120.5], WI: [44.6, -89.6],
};

function hashInt(value) {
  let h = 0;
  const str = String(value || "");
  for (let i = 0; i < str.length; i += 1) h = ((h << 5) - h) + str.charCodeAt(i);
  return Math.abs(h);
}

function stateFromLocation(location) {
  const m = String(location || "").toUpperCase().match(/,\s*([A-Z]{2})\b/);
  return m ? m[1] : "";
}

function coordForLocation(location) {
  const st = stateFromLocation(location);
  const base = STATE_CENTROIDS[st];
  if (base) {
    const jitter = ((hashInt(location) % 20) - 10) * 0.04;
    return [Number((base[0] + jitter).toFixed(4)), Number((base[1] - jitter).toFixed(4))];
  }
  return null;
}

function statusColor(status) {
  if (status === "In Transit") return "#3b82f6";
  if (status === "Exception") return "#ef4444";
  if (status === "Delivered") return "#22c55e";
  return "#f59e0b";
}

/* ── InfoBox helper ── */
function InfoBox({ icon, label, value }) {
  return (
    <div style={{ padding: "10px 14px", background: "var(--bg2)", borderRadius: 10, border: "1px solid var(--border)" }}>
      <div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 }}>{icon} {label}</div>
      <div style={{ fontSize: 14, fontWeight: 700 }}>{value || "—"}</div>
    </div>
  );
}

/* ── Shipment Detail Modal ── */
function ShipmentDetailModal({ ds, onClose, onTender, onWithdraw, onUnassign, onNavigate, STATUS_BADGES }) {
  const linked = ds._linkedOrders || [];
  const displayStatus = effectiveShipmentStatus(ds);
  const [lines, setLines] = useState([]);
  const [linesLoading, setLinesLoading] = useState(true);
  const [events, setEvents] = useState([]);
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [newEvent, setNewEvent] = useState({ type: "", note: "", date: new Date().toISOString().slice(0, 10) });

  // Load line items for all linked orders
  useEffect(() => {
    const ids = linked.map((o) => o.id).filter(Boolean);
    if (!ids.length) { setLinesLoading(false); return; }
    Promise.all(ids.map((oid) =>
      OrdersApi.lines(oid)
        .then((res) => (Array.isArray(res) ? res : res?.lines || res?.data || []))
        .catch(() => [])
    )).then((results) => {
      setLines(results.flat());
      setLinesLoading(false);
    }).catch(() => setLinesLoading(false));
  }, [ds.id]);
  const consolidated = linked.length > 1;
  const pct = displayStatus === "Delivered" ? 100 : displayStatus === "In Transit" ? 62 : displayStatus === "Confirmed" ? 32 : displayStatus === "Tendered" ? 20 : displayStatus === "Exception" ? 55 : 5;
  const barCol = displayStatus === "Exception" ? "var(--red)" : displayStatus === "Delivered" ? "var(--green)" : "var(--accent)";
  const isTendered = displayStatus !== "Planned" && displayStatus !== "Tender Rejected";
  const isPickedUp = ["In Transit", "Delivered", "Exception"].includes(ds.status);
  const isInTransit = ["In Transit", "Delivered"].includes(ds.status);
  const isDelivered = ds.status === "Delivered";
  const transitDays = (() => {
    const pu = ds.pickup_date, du = ds.delivery_date;
    if (!pu || !du) return "—";
    const d1 = new Date(pu), d2 = new Date(du);
    if (isNaN(d1) || isNaN(d2)) return "—";
    return Math.max(1, Math.round((d2 - d1) / 86400000)) + " days";
  })();
  const timelineEvents = [
    { icon: "📋", label: "Order Created & Rate Confirmed", done: true },
    { icon: "📤", label: "Tendered to Carrier", done: isTendered, time: isTendered ? (ds.pickup_date || "—") : "Pending" },
    { icon: "🚛", label: "Picked Up", done: isPickedUp, time: isPickedUp ? (ds.pickup_date || "—") : "Pending" },
    { icon: "📍", label: "In Transit", done: isInTransit, time: isInTransit ? "En route" : "Pending" },
    { icon: "✅", label: "Delivered", done: isDelivered, time: isDelivered ? (ds.delivery_date || "—") : "Pending" },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 680, maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div className="modal-header">
          <div>
            <div style={{ fontSize: 10, opacity: 0.6, letterSpacing: 1 }}>SHIPMENT DETAILS</div>
            <h3>{ds.id}</h3>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ flex: 1, overflowY: "auto" }}>

          {/* Status bar */}
          <div style={{ padding: "14px 20px", background: "#f8faff", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className={STATUS_BADGES[displayStatus] || "badge"}>{displayStatus}</span>
              <span style={{ fontSize: 13, color: "var(--text2)" }}>{ds._carrier || "—"} · <span className={`badge ${ds.mode === "LTL" ? "badge-blue" : "badge-green"}`} style={{ fontSize: 11 }}>{ds.mode || "—"}</span></span>
              {consolidated && <span style={{ fontSize: 11, background: "rgba(99,102,241,.1)", color: "#6366f1", border: "1px solid rgba(99,102,241,.2)", padding: "2px 9px", borderRadius: 10, fontWeight: 600 }}>🔗 Consolidated · {linked.length} orders</span>}
            </div>
            <span style={{ fontSize: 15, fontWeight: 800, color: "var(--green)" }}>${(ds.total_cost || 0).toLocaleString()}</span>
          </div>

          {/* Progress / Origin → Destination */}
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.8 }}>ORIGIN</div>
                <div style={{ fontWeight: 700, fontSize: 14, marginTop: 3 }}>{ds.origin || "—"}</div>
                <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>Pickup: {ds.pickup_date || "—"}</div>
              </div>
              <div style={{ textAlign: "center", paddingTop: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text2)" }}>750 mi</div>
                <span style={{ fontSize: 12, color: "var(--text3)" }}>{pct}% complete</span>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.8 }}>DESTINATION</div>
                <div style={{ fontWeight: 700, fontSize: 14, marginTop: 3 }}>{ds.dest || "—"}</div>
                <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>Delivery: {ds.delivery_date || "—"}</div>
              </div>
            </div>
            <div style={{ height: 10, background: "var(--bg3)", borderRadius: 8 }}>
              <div style={{ width: `${pct}%`, height: 10, background: barCol, borderRadius: 8 }} />
            </div>
          </div>

          {/* Details grid - 3 columns */}
          <div style={{ padding: "16px 20px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, borderBottom: "1px solid var(--border)" }}>
            <InfoBox icon="🚛" label="Carrier" value={ds._carrier || "—"} />
            <InfoBox icon="📦" label="Mode" value={ds.mode || "—"} />
            <InfoBox icon="⚖️" label="Weight" value={`${(ds.weight || 0).toLocaleString()} lbs`} />
            <InfoBox icon="🔢" label="Pieces" value={String(ds.pieces || 0)} />
            <InfoBox icon="🏷️" label="Commodity" value={ds._commodity || ds.commodity || "—"} />
            <InfoBox icon="💰" label="Est. Cost" value={`$${(ds.total_cost || 0).toLocaleString()}`} />
            <InfoBox icon="📅" label="Pickup Date" value={ds.pickup_date || ds.pickup || "—"} />
            <InfoBox icon="🏁" label="Delivery Date" value={ds.delivery_date || ds.delivery || "—"} />
            <InfoBox icon="🚚" label="Transit Days" value={transitDays} />
            <InfoBox icon="🔖" label="PRO Number" value={ds.pro_number || "—"} />
            <InfoBox icon="📋" label="BOL / Carrier Ref" value={ds.bol_number || "—"} />
            <InfoBox icon="⭐" label="Service Level" value={ds.service_level || "—"} />
            <InfoBox icon="🚪" label="Dock Door" value={ds.dock_door || ds.dock_assigned || "—"} />
            <InfoBox icon="🕐" label="Dock Time" value={ds.dock_time || "—"} />
            <InfoBox icon="▶️" label="Loading Start" value={ds.loading_start || "—"} />
            <InfoBox icon="⏹️" label="Loading End" value={ds.loading_end || "—"} />
          </div>

          {/* Consolidated Orders */}
          {linked.length > 0 && (
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
                {linked.length > 1 ? `Consolidated Orders (${linked.length})` : "Associated Order"}
              </div>
              {linked.map((o) => (
                <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 12px", background: "#f8faff", borderRadius: 8, marginBottom: 6, border: "1px solid var(--border)" }}>
                  <a href={`/orders?id=${o.id}`} onClick={(e) => { e.preventDefault(); window.location.href = `/orders?id=${o.id}`; }} className="mono" style={{ color: "var(--accent)", fontSize: 12, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2 }}>{o.id}</a>
                  <span style={{ fontSize: 12, color: "var(--text2)" }}>{o.customer || ""}</span>
                  <span style={{ fontSize: 12, color: "var(--text3)" }}>· {o.commodity || ""}</span>
                  <span style={{ fontSize: 11, color: "var(--text3)" }}>· {(o.origin || "").split(",")[0]} → {(o.dest || "").split(",")[0]}</span>
                  <span style={{ marginLeft: "auto", fontSize: 12, fontFamily: "monospace", color: "var(--text2)" }}>{(o.weight || 0).toLocaleString()} lbs</span>
                  {ds.status === "Planned" && (
                    <button onClick={() => onUnassign(o.id, ds.id)} style={{ padding: "3px 10px", background: "rgba(245,158,11,.1)", border: "1px solid rgba(245,158,11,.3)", borderRadius: 7, fontSize: 11, fontWeight: 600, color: "#b45309", cursor: "pointer", fontFamily: "inherit" }}>🔓 Unassign</button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Line Items */}
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>📦 Line Items</div>
            {linesLoading ? (
              <div style={{ color: "var(--text3)", fontSize: 12, fontStyle: "italic" }}>Loading…</div>
            ) : lines.length === 0 ? (
              <div style={{ color: "var(--text3)", fontSize: 12, fontStyle: "italic" }}>No line items</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "var(--bg3)" }}>
                    {["Order", "#", "Item ID", "Description", "Qty", "Unit Wt", "Total Wt"].map((h) => (
                      <th key={h} style={{ padding: "5px 8px", textAlign: ["Qty", "Unit Wt", "Total Wt"].includes(h) ? "right" : "left", fontSize: 10, color: "var(--text3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: "1px solid var(--border)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "5px 8px", fontFamily: "monospace", fontSize: 10, color: "var(--text3)" }}>{l.order_id || ""}</td>
                      <td style={{ padding: "5px 8px", fontSize: 11, color: "var(--text3)" }}>{i + 1}</td>
                      <td style={{ padding: "5px 8px", fontFamily: "monospace", fontSize: 11, color: "var(--accent)" }}>{l.item_id || "—"}</td>
                      <td style={{ padding: "5px 8px", fontSize: 12 }}>{l.description || "—"}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: 600 }}>{l.qty_ordered || 0}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace" }}>{l.unit_weight || l.unit_value || 0} lbs</td>
                      <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace", fontWeight: 600 }}>{l.total_weight || l.total_value || 0} lbs</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Shipment Timeline */}
          <div style={{ padding: "16px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1 }}>Shipment Timeline</span>
              <button onClick={() => setShowAddEvent(!showAddEvent)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>+ Add Event</button>
            </div>

            {/* Add Event Form */}
            {showAddEvent && (
              <div style={{ padding: "12px", background: "var(--bg2)", borderRadius: 10, border: "1px solid var(--border)", marginBottom: 12 }}>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <select value={newEvent.type} onChange={(e) => setNewEvent({ ...newEvent, type: e.target.value })} style={{ flex: 1, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12, fontFamily: "inherit" }}>
                    <option value="">— Select Event Type —</option>
                    <option value="Picked Up">Picked Up</option>
                    <option value="In Transit">In Transit</option>
                    <option value="Departed">Departed Terminal</option>
                    <option value="Arrived">Arrived at Destination</option>
                    <option value="Delivered">Delivered</option>
                    <option value="Exception">Exception</option>
                    <option value="Delay">Delay Notification</option>
                    <option value="Note">General Note</option>
                  </select>
                  <input type="date" value={newEvent.date} onChange={(e) => setNewEvent({ ...newEvent, date: e.target.value })} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12, fontFamily: "inherit" }} />
                </div>
                <input placeholder="Add a note (optional)" value={newEvent.note} onChange={(e) => setNewEvent({ ...newEvent, note: e.target.value })} style={{ width: "100%", padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12, fontFamily: "inherit", marginBottom: 8, boxSizing: "border-box" }} />
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => {
                    if (!newEvent.type) return;
                    setEvents([...events, { type: newEvent.type, note: newEvent.note, date: newEvent.date, time: new Date().toLocaleTimeString() }]);
                    setNewEvent({ type: "", note: "", date: new Date().toISOString().slice(0, 10) });
                    setShowAddEvent(false);
                  }} style={{ padding: "5px 14px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Save Event</button>
                  <button onClick={() => setShowAddEvent(false)} style={{ padding: "5px 14px", background: "var(--bg3)", color: "var(--text2)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
                </div>
              </div>
            )}

            {/* Custom Events */}
            {events.map((ev, i) => (
              <div key={`custom-${i}`} style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 4 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#10b981", border: "2px solid #10b981", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>
                    <span style={{ color: "#fff", fontSize: 12 }}>📝</span>
                  </div>
                  <div style={{ width: 2, height: 20, background: "#10b981" }} />
                </div>
                <div style={{ paddingTop: 4 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>{ev.type}</div>
                  <div style={{ fontSize: 11, color: "var(--text3)" }}>{ev.date} {ev.time}{ev.note ? ` — ${ev.note}` : ""}</div>
                </div>
              </div>
            ))}

            {/* Default Timeline */}
            {timelineEvents.map((ev, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 4 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: ev.done ? "var(--accent)" : "var(--bg3)", border: ev.done ? "2px solid var(--accent)" : "2px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>
                    {ev.done ? <span style={{ color: "#fff", fontSize: 12 }}>{ev.icon}</span> : <span style={{ opacity: 0.4, fontSize: 12 }}>{ev.icon}</span>}
                  </div>
                  {i < 4 && <div style={{ width: 2, height: 20, background: ev.done ? "var(--accent)" : "var(--border)" }} />}
                </div>
                <div style={{ paddingTop: 4 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: ev.done ? "var(--text)" : "var(--text3)" }}>{ev.label}</div>
                  <div style={{ fontSize: 11, color: "var(--text3)" }}>{ev.time || (ev.done ? "Confirmed" : "Pending")}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Action Footer */}
                <div style={{ padding: "14px 20px", background: "#f8faff", borderTop: "1px solid var(--border)", display: "flex", gap: 8, flexWrap: "wrap", borderRadius: "0 0 16px 16px" }}>
          {["Planned", "Tender Rejected"].includes(displayStatus) && (
            <button className="btn btn-primary btn-sm" onClick={() => onTender(ds)}>📤 Tender to Carrier</button>
          )}
          {displayStatus === "Tendered" && (
            <button style={{ background: "#ea580c", color: "#fff", border: "none", padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }} onClick={() => onWithdraw(ds)}>📤 Withdraw Tender</button>
          )}
          {["Planned", "Tendered", "Tender Rejected", "In Transit"].includes(displayStatus) && (
            <button className="btn btn-secondary btn-sm" onClick={() => { onClose(); onNavigate("/carriers"); }}>🔄 Change Carrier</button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={() => { onClose(); onNavigate("/dock-scheduling"); }}>🚪 Dock schedule</button>
          <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); onNavigate(`/documents?shipmentId=${encodeURIComponent(ds.id)}`); onClose(); }}>📄 Documents</button>
          <button className="btn btn-secondary btn-sm" onClick={() => { onClose(); onNavigate(`/messaging`); }}>📧 Contact Carrier</button>
          <button className="btn btn-secondary btn-sm" onClick={() => { onClose(); onNavigate("/messaging"); }}>📨 Send to WMS</button>
        </div>
      </div>
    </div>
  );
}

export default function ShipmentsPage() {
  const { shipments, orders, carriers, setData, refreshData } = useOutletContext();
  const navigate = useNavigate();
  const [shipView, setShipView] = useState("list");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [modeFilter, setModeFilter] = useState("All");
  const [idsFilter, setIdsFilter] = useState(null); // Set from ?ids= URL param for bulk plan filtering
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState({ text: "", type: "" });
  const [detailShipment, setDetailShipment] = useState(null);

  // Auto-open shipment detail from URL ?id=SHP-xxxx (run once on mount)
  const [autoOpened, setAutoOpened] = useState(false);
  useEffect(() => {
    if (autoOpened) return;
    const params = new URLSearchParams(window.location.search);
    const idParam = params.get("id");
    const idsParam = params.get("ids");
    if (idParam && shipments.length > 0) {
      const ship = shipments.find((s) => s.id === idParam);
      if (ship) {
        const linkedOrders = orders.filter((o) => String(o.shipment_id || "") === String(ship.id || ""));
        setDetailShipment({ ...ship, _linkedOrders: linkedOrders, _carrier: ship.carrier || "" });
      }
      setAutoOpened(true);
      window.history.replaceState({}, "", "/shipments");
    }
    if (idsParam && shipments.length > 0) {
      setIdsFilter(new Set(idsParam.split(",")));
      setAutoOpened(true);
      window.history.replaceState({}, "", "/shipments");
    }
  }, [shipments]);
  const [sortCol, setSortCol] = useState("id");
  const [sortAsc, setSortAsc] = useState(false);

  function toast(text, type = "info") {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: "", type: "" }), 4000);
  }

  async function unassignOrder(orderId, shipmentId) {
    try {
      await DbApi.patch("orders", orderId, { status: "Unplanned", shipment_id: null });
      // Recalculate shipment weight from remaining orders
      const remaining = orders.filter((o) => o.shipment_id === shipmentId && o.id !== orderId);
      if (remaining.length === 0) {
        // No orders left — delete the shipment
        await DbApi.patch("shipments", shipmentId, { status: "Cancelled", notes: "All orders unassigned" });
        toast(`Order ${orderId} unassigned. Shipment ${shipmentId} cancelled (no orders left).`, "info");
      } else {
        const newWeight = remaining.reduce((s, o) => s + (Number(o.weight) || 0), 0);
        const newPieces = remaining.reduce((s, o) => s + (Number(o.pieces) || 0), 0);
        await DbApi.patch("shipments", shipmentId, { weight: newWeight, pieces: newPieces });
        toast(`Order ${orderId} unassigned from shipment ${shipmentId}`, "success");
      }
      await refreshData();
      setDetailShipment(null);
    } catch (e) {
      toast(`Unassign failed: ${e.message}`, "error");
    }
  }

  function resolveCarrierName(s) {
    if (s?.carrier) return s.carrier;
    const linked = orders.filter(
      (o) => String(o.shipment_id || "") === String(s.id || "")
    );
    for (const o of linked) {
      if (o.preferred_carrier) return o.preferred_carrier;
    }
    return "";
  }

  const rows = useMemo(() => {
    let list = shipments.map((s) => {
      const linkedOrders = orders.filter(
        (o) => String(o.shipment_id || "") === String(s.id || "")
      );
      const commodities = [...new Set(linkedOrders.map((o) => o.commodity).filter(Boolean))];
      return {
        ...s,
        _carrier: resolveCarrierName(s),
        _displayStatus: effectiveShipmentStatus(s),
        _linkedOrders: linkedOrders,
        _orderCount: linkedOrders.length,
        _commodity: commodities.join(", ") || s.commodity || "",
      };
    });
    if (idsFilter) list = list.filter((s) => idsFilter.has(s.id));
    if (statusFilter !== "All") list = list.filter((s) => s._displayStatus === statusFilter);
    if (modeFilter !== "All") list = list.filter((s) => (s.mode || "").toUpperCase() === modeFilter);
    if (q.trim()) {
      const terms = q.split(",").map((s) => s.toLowerCase().trim()).filter(Boolean);
      list = list.filter((s) => {
        const fields = [s.id, s._carrier, s.origin, s.dest, s.mode, s.status, s._displayStatus]
          .map((v) => String(v || "").toLowerCase());
        return terms.some((t) => fields.some((f) => f.includes(t)));
      });
    }
    return [...list].sort((a, b) => {
      const av = String((sortCol === "status" ? a._displayStatus : a[sortCol]) || "").toLowerCase();
      const bv = String((sortCol === "status" ? b._displayStatus : b[sortCol]) || "").toLowerCase();
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [shipments, orders, q, statusFilter, modeFilter, idsFilter, sortCol, sortAsc]);

  const laneRoutes = useMemo(() => {
    const lanes = new Map();
    rows.forEach((s) => {
      const origin = String(s.origin || "");
      const dest = String(s.dest || "");
      const os = stateFromLocation(origin) || "NA";
      const ds = stateFromLocation(dest) || "NA";
      const key = `${os}->${ds}`;
      if (!lanes.has(key)) {
        lanes.set(key, {
          key,
          from: os,
          to: ds,
          origin,
          dest,
          count: 0,
          statuses: {},
          originCoord: coordForLocation(origin),
          destCoord: coordForLocation(dest),
        });
      }
      const lane = lanes.get(key);
      lane.count += 1;
      lane.statuses[s._displayStatus] = (lane.statuses[s._displayStatus] || 0) + 1;
    });

    return [...lanes.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 18)
      .map((lane) => {
        const topStatus = Object.entries(lane.statuses).sort((a, b) => b[1] - a[1])[0]?.[0] || "Planned";
        return {
          ...lane,
          topStatus,
          color: statusColor(topStatus),
          hasCoords: Array.isArray(lane.originCoord) && Array.isArray(lane.destCoord),
        };
      });
  }, [rows]);

  function toggleSort(col) {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(true); }
  }

  const [tenderResult, setTenderResult] = useState(null); // { shipment, result }

  async function onTender(row) {
    const carrierName = row._carrier || row.carrier || "";
    // Close detail modal and show tender result modal
    setDetailShipment(null);
    setTenderResult({ shipment: row, result: null }); // show "sending" phase
    setBusyId(row.id);
    try {
      await DbApi.patch("shipments", row.id, { status: "Tendered", carrier: carrierName });
      const origin = row.origin || "";
      const dest = row.dest || "";
      const refNum =
        "TND-" + String(row.id || "").replace(/^SHP-/i, "") + "-" + String(Math.floor(Math.random() * 9000 + 1000));
      const tenderPayload = {
        shipmentId: row.id,
        refNum,
        subject: `Load Tender: ${row.id} — ${origin} → ${dest}`,
        origin,
        dest,
        pickup: row.pickup_date || "",
        delivery: row.delivery_date || "",
        mode: row.mode || "",
        cost: row.total_cost ?? row.cost ?? "",
        weight: row.weight ?? "",
        pieces: row.pieces || "",
        commodity: row.commodity || row._commodity || "",
        specialInstructions: row.special_instructions || row.specialInstructions || row.notes || "",
        dockDoor: row.dock_door || "Door 1",
        dockTime: row.dock_time || "06:00–08:00",
      };
      let emailSent = false;
      let emailTo = "";
      try {
        const result = await sendTenderEmailIfAvailable({
          carriers,
          carrierName,
          tenderPayload,
        });
        emailSent = !!result.sent;
        emailTo = result.to || "";
      } catch (emailErr) {
        console.warn("Tender email failed:", emailErr);
      }
      await refreshData();
      setTenderResult({ shipment: row, result: { refNum, emailSent, to: emailTo } });
    } catch (err) {
      setTenderResult({ shipment: row, result: { error: true, errorMessage: err.message } });
    } finally {
      setBusyId("");
    }
  }

  /* ── Accept Tender Modal ── */
  const [acceptModal, setAcceptModal] = useState(null); // { shipment, pro, pickup, service, bol, dock, dockTime, notes }

  function openAcceptTender(row) {
    const today = new Date().toISOString().slice(0, 10);
    setAcceptModal({
      shipment: row,
      pro: row.pro_number || "",
      pickup: row.pickup || today,
      delivery: row.delivery || "",
      service: row.service_level || "",
      bol: row.bol_number || "",
      dock: row.dock_assigned || "",
      dockLoadStart: row.dock_load_start || "",
      dockLoadEnd: row.dock_load_end || "",
      notes: "",
    });
  }

  async function confirmAcceptTender() {
    if (!acceptModal) return;
    const { shipment: row, pro, pickup, delivery, service, bol, dock, dockLoadStart, dockLoadEnd, notes } = acceptModal;
    if (!pickup) { toast("Pickup date is required", "warning"); return; }
    setBusyId(row.id);
    try {
      // 1. Update shipment in DB
      await DbApi.patch("shipments", row.id, {
        status: "Confirmed",
        pro_number: pro || null,
        pickup: pickup,
        delivery: delivery || null,
        service_level: service || null,
        bol_number: bol || null,
        dock_assigned: dock || null,
        dock_load_start: dockLoadStart || null,
        dock_load_end: dockLoadEnd || null,
        notes: notes || null,
      });
      // 2. Update linked orders
      const linkedOrders = orders.filter((o) => String(o.shipment_id || "") === String(row.id));
      await Promise.all(linkedOrders.map((o) =>
        DbApi.patch("orders", o.id, { status: "Confirmed", pickup: pickup })
      ));
      // 3. Push to OMS
      try {
        const omsResult = await OmsApi.push({
          shipmentId: row.id,
          carrier: row.carrier || "",
          mode: row.mode || "",
          serviceLevel: service || "",
          pickupDate: pickup,
          deliveryDate: delivery || "",
          proNumber: pro || "",
          bolNumber: bol || "",
          dockNumber: dock || "",
          dockLoadStart: dockLoadStart || "",
          dockLoadEnd: dockLoadEnd || "",
          origin: row.origin || "",
          destination: row.dest || "",
          weight: row.weight || 0,
          pieces: row.pieces || 0,
          commodity: row.commodity || "",
          cost: row.cost || 0,
          orderIds: linkedOrders.map((o) => o.id),
          notes: notes || "",
        });
        if (omsResult.sent) {
          toast(`✅ Tender confirmed & sent to OMS — ${row.id}`, "success");
        } else {
          toast(`✅ Tender confirmed — ${row.id} · PRO: ${pro || "pending"} · Pickup: ${pickup} · OMS: ${omsResult.message || "not configured"}`, "success");
        }
      } catch (omsErr) {
        console.warn("[OMS Push] Failed:", omsErr.message);
        toast(`✅ Tender confirmed — ${row.id} · PRO: ${pro || "pending"} · Pickup: ${pickup} · OMS push failed (non-blocking)`, "success");
      }
      setAcceptModal(null);
      await refreshData();
    } catch (err) {
      toast(`Failed: ${err.message}`, "error");
    } finally {
      setBusyId("");
    }
  }

  async function rejectTender(row) {
    if (!window.confirm(`Reject tender for ${row.id}? Shipment will return to Planned.`)) return;
    setBusyId(row.id);
    try {
      await DbApi.patch("shipments", row.id, { status: "Planned" });
      toast(`Tender rejected for ${row.id}`, "success");
      await refreshData();
    } catch (err) {
      toast(`Failed: ${err.message}`, "error");
    } finally {
      setBusyId("");
    }
  }

  async function withdrawTender(row) {
    if (!window.confirm(`Withdraw tender for ${row.id}?`)) return;
    setBusyId(row.id);
    try {
      await DbApi.patch("shipments", row.id, { status: "Planned" });
      toast(`Tender withdrawn for ${row.id}`, "success");
      await refreshData();
    } catch (err) {
      toast(`Failed: ${err.message}`, "error");
    } finally {
      setBusyId("");
    }
  }

  async function deleteShipment(row) {
    if (effectiveShipmentStatus(row) === "Tendered") {
      toast("Withdraw tender first before deleting", "warning");
      return;
    }
    if (!window.confirm(`Delete shipment ${row.id}? Linked orders will be unplanned.`)) return;
    setBusyId(row.id);
    try {
      // Unplan linked orders
      for (const o of row._linkedOrders || []) {
        await DbApi.patch("orders", o.id, { status: "Unplanned", shipment_id: null });
      }
      await DbApi.patch("shipments", row.id, { status: "Cancelled" });
      toast(`Shipment ${row.id} deleted, ${(row._linkedOrders || []).length} orders unplanned`, "success");
      await refreshData();
    } catch (err) {
      toast(`Failed: ${err.message}`, "error");
    } finally {
      setBusyId("");
    }
  }

  const statusCounts = useMemo(() => {
    const c = { All: shipments.length };
    shipments.forEach((s) => {
      const st = effectiveShipmentStatus(s);
      c[st] = (c[st] || 0) + 1;
    });
    return c;
  }, [shipments]);

  const SortIcon = ({ col }) => (
    <span style={{ opacity: sortCol === col ? 1 : 0.3, marginLeft: 4 }}>
      {sortCol === col ? (sortAsc ? "▲" : "▼") : "⇅"}
    </span>
  );

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Shipments</div>
          <div className="page-sub">Plan, track, and manage all freight movements</div>
        </div>
        <div className="header-actions">
          <button className="btn btn-secondary btn-sm">📥 Export CSV</button>
          <button className="btn btn-primary btn-sm">+ New Shipment</button>
        </div>
      </div>
      <div className="page-content">

      {/* View Toggle */}
      <div style={{ display: "flex", gap: 2, marginBottom: 16, background: "#f0f4ff", borderRadius: 10, padding: 3, border: "1px solid rgba(59,130,246,.15)", width: "fit-content" }}>
        <button
          style={{ padding: "5px 14px", borderRadius: 8, border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all .15s", fontFamily: "inherit", background: shipView === "list" ? "var(--accent)" : "transparent", color: shipView === "list" ? "#fff" : "var(--text3)" }}
          onClick={() => setShipView("list")}
        >List</button>
        <button
          style={{ padding: "5px 14px", borderRadius: 8, border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all .15s", fontFamily: "inherit", background: shipView === "map" ? "var(--accent)" : "transparent", color: shipView === "map" ? "#fff" : "var(--text3)" }}
          onClick={() => setShipView("map")}
        >Map View</button>
      </div>

      {shipView === "list" ? (<>
      {/* Filters */}
      <div className="filter-bar">
        <input
          placeholder="🔍 Search shipments... or SHP-1..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="search"
        />
        <select className="fsel" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          {["All", "Planned", "Tendered", "Tender Rejected", "Confirmed", "In Transit", "Delivered", "Cancelled"].map((s) => (
            <option key={s} value={s}>{s === "All" ? "ALL STATUSES" : s} {statusCounts[s] ? `(${statusCounts[s]})` : ""}</option>
          ))}
        </select>
        <select className="fsel" value={modeFilter} onChange={(e) => setModeFilter(e.target.value)}>
          <option value="All">All Modes</option>
          <option value="LTL">LTL</option>
          <option value="TL">TL</option>
        </select>
      </div>

      {/* Toast */}
      {message.text && (
        <div className={`toast toast-${message.type}`} style={{ marginBottom: 12 }}>
          {message.text}
        </div>
      )}

      {/* Table */}
      <div className="card" style={{ padding: 0 }}><div className="table-wrap">
      <table className="grid" style={{ border: "none", boxShadow: "none" }}>
        <thead>
          <tr>
            <th onClick={() => toggleSort("id")}>Shipment ID <SortIcon col="id" /></th>
            <th onClick={() => toggleSort("origin")}>Origin <SortIcon col="origin" /></th>
            <th onClick={() => toggleSort("dest")}>Destination <SortIcon col="dest" /></th>
            <th>Mode</th>
            <th onClick={() => toggleSort("carrier")}>Carrier <SortIcon col="carrier" /></th>
            <th>Est. Cost</th>
            <th>Pickup</th>
            <th>Delivery</th>
            <th onClick={() => toggleSort("status")}>Status <SortIcon col="status" /></th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={10} className="empty-state">No shipments found</td></tr>
          ) : rows.map((s) => (
            <tr key={s.id} style={s.bol_type === "CBOL" ? { background: "#FAFBFE" } : undefined}>
              <td>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {s.bol_type === "MBOL" && <span className="badge badge-blue" style={{ fontSize: 9, padding: "0 6px", height: 18, lineHeight: "18px" }}>MBOL</span>}
                  {s.bol_type === "CBOL" && <span className="badge badge-teal" style={{ fontSize: 9, padding: "0 6px", height: 18, lineHeight: "18px" }}>CBOL</span>}
                  <a href="#" onClick={(e) => { e.preventDefault(); setDetailShipment(s); }}
                     className="mono" style={{ color: "var(--accent)", fontWeight: 600 }}>
                    {s.id}
                  </a>
                </div>
                {s.bol_type === "CBOL" && s.master_shipment_id && (
                  <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 1 }}>
                    Master: {s.master_shipment_id}
                  </div>
                )}
              </td>
              <td className="text-sm">{s.origin || "—"}</td>
              <td className="text-sm">{s.dest || "—"}</td>
              <td>
                <span className={`badge ${s.mode === "LTL" ? "badge-blue" : "badge-green"}`}>
                  {s.mode || "—"}
                </span>
              </td>
              <td>
                {s.czarlite_rate && <span className="badge badge-purple" style={{ marginRight: 4, fontSize: 9 }}>CzarLite</span>}
                {s._carrier || "—"}
              </td>
              <td className="mono fw-700">${(s.total_cost || 0).toLocaleString()}</td>
              <td className="mono text-sm">{s.pickup_date || "—"}</td>
              <td className="mono text-sm">{s.delivery_date || "—"}</td>
              <td>
                <span className={STATUS_BADGES[s._displayStatus] || "badge badge-blue"}>
                  {s._displayStatus || "—"}
                </span>
              </td>
              <td style={{ whiteSpace: "nowrap" }}>
                <div style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                {["Planned", "Tender Rejected"].includes(s._displayStatus) && (
                  <button
                    style={{ background: "#2563eb", color: "#fff", borderColor: "#2563eb", padding: "4px 10px", fontSize: 12, borderRadius: 6, fontWeight: 700, cursor: "pointer", border: "none" }}
                    disabled={busyId === s.id}
                    onClick={() => onTender(s)}
                  >
                    📤 Tender
                  </button>
                )}
                {s._displayStatus === "Tendered" && (<>
                  <button
                    style={{ background: "#16a34a", color: "#fff", border: "none", padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                    disabled={busyId === s.id}
                    onClick={() => openAcceptTender(s)}
                  >
                    ✅ Accept
                  </button>
                  <button
                    style={{ background: "#dc2626", color: "#fff", border: "none", padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                    disabled={busyId === s.id}
                    onClick={() => rejectTender(s)}
                  >
                    ❌ Reject
                  </button>
                  <button
                    style={{ background: "rgba(245,158,11,.08)", color: "#b45309", border: "1px solid rgba(245,158,11,.35)", padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                    disabled={busyId === s.id}
                    onClick={() => withdrawTender(s)}
                  >
                    ↩ Withdraw
                  </button>
                </>)}
                {s._displayStatus === "Confirmed" && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--green)" }}>✅ Confirmed</span>
                )}
                <button
                  style={{ background: "rgba(220,38,38,.08)", color: "#dc2626", border: "1px solid rgba(220,38,38,.25)", padding: "4px 7px", borderRadius: 6, fontSize: 12, cursor: "pointer", lineHeight: 1 }}
                  disabled={busyId === s.id}
                  onClick={() => deleteShipment(s)}
                >
                  🗑️
                </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div></div>{/* end table-wrap, card */}
      <div className="text-sm text-muted mt-2">{rows.length} of {shipments.length} shipments</div>
      </>) : (
        /* ═══ MAP VIEW ═══ */
        <div>
          {/* Legend */}
          <div style={{ display: "flex", gap: 16, marginBottom: 12, fontSize: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 10, height: 10, borderRadius: "50%", background: "#3b82f6" }} />In Transit</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 10, height: 10, borderRadius: "50%", background: "#ef4444" }} />Exception</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 10, height: 10, borderRadius: "50%", background: "#22c55e" }} />Delivered</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 10, height: 10, borderRadius: "50%", background: "#f59e0b" }} />Planned / Tendered</div>
          </div>
          {/* Map Container */}
          <div className="card" style={{ padding: 16, minHeight: 500, position: "relative", overflow: "hidden" }}>
            <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 10 }}>
              US map with top lanes by volume (grouped by origin/destination state)
              {getHereApiKey()
                ? " · HERE basemap (Raster Tile API v3)"
                : " · HERE basemap — add VITE_HERE_API_KEY to frontend/.env (same key as developer.here.com)"}
            </div>
            <div style={{ border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", height: 460 }}>
              <MapContainer
                center={[39.5, -98.35]}
                zoom={4}
                minZoom={3}
                maxZoom={6}
                maxBounds={[[22, -130], [52, -64]]}
                style={{ height: "100%", width: "100%" }}
              >
                <TileLayer
                  attribution='&copy; <a href="https://developer.here.com">HERE</a>'
                  url={hereRasterTileUrl(resolveHereApiKey())}
                />
                {laneRoutes.filter((lane) => lane.hasCoords).map((lane) => {
                  const width = Math.min(8, 2 + lane.count * 0.55);
                  return (
                    <Polyline
                      key={lane.key}
                      positions={[lane.originCoord, lane.destCoord]}
                      pathOptions={{ color: lane.color, weight: width, opacity: 0.62 }}
                    >
                      <Tooltip sticky>{`${lane.from} → ${lane.to} (${lane.count})`}</Tooltip>
                    </Polyline>
                  );
                })}
                {laneRoutes.filter((lane) => lane.hasCoords).flatMap((lane) => ([
                  <CircleMarker
                    key={`${lane.key}-o`}
                    center={lane.originCoord}
                    radius={4}
                    pathOptions={{ color: "#ffffff", weight: 1, fillColor: lane.color, fillOpacity: 1 }}
                  />,
                  <CircleMarker
                    key={`${lane.key}-d`}
                    center={lane.destCoord}
                    radius={4}
                    pathOptions={{ color: "#ffffff", weight: 1, fillColor: lane.color, fillOpacity: 1 }}
                  />,
                ]))}
              </MapContainer>
            </div>
            {/* Shipment summary cards below map */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10, marginTop: 16 }}>
              {rows.slice(0, 12).map((s) => {
                const col = s._displayStatus === "In Transit" ? "var(--accent)" : s._displayStatus === "Exception" ? "var(--red)" : s._displayStatus === "Delivered" ? "var(--green)" : "var(--yellow)";
                return (
                  <div key={s.id} style={{ padding: "10px 14px", border: "1.5px solid var(--border)", borderRadius: 10, cursor: "pointer", borderLeft: `3px solid ${col}` }}
                    onClick={() => setDetailShipment(s)}>
                    <div className="mono" style={{ fontWeight: 700, color: "var(--accent)", fontSize: 12 }}>{s.id}</div>
                    <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>{s.origin} → {s.dest}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11 }}>
                      <span className={STATUS_BADGES[s._displayStatus] || "badge badge-blue"} style={{ fontSize: 10 }}>{s._displayStatus}</span>
                      <span className="mono" style={{ fontWeight: 700 }}>${(s.total_cost || 0).toLocaleString()}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Shipment Detail Modal */}
      {detailShipment && <ShipmentDetailModal ds={detailShipment} onClose={() => setDetailShipment(null)} onTender={onTender} onWithdraw={(s) => { withdrawTender(s); setDetailShipment(null); }} onUnassign={unassignOrder} onNavigate={navigate} STATUS_BADGES={STATUS_BADGES} />}

      {/* Tender Result Modal */}
      <TenderResultModal
        isOpen={!!tenderResult}
        shipment={tenderResult?.shipment}
        result={tenderResult?.result}
        onClose={() => setTenderResult(null)}
        onViewShipment={(id) => {
          const ship = shipments.find((s) => s.id === id);
          if (ship) {
            const linked = orders.filter((o) => String(o.shipment_id || "") === String(id));
            setDetailShipment({ ...ship, _linkedOrders: linked, _carrier: ship.carrier || "" });
          }
        }}
      />

      {/* Accept Tender Modal */}
      {acceptModal && (
        <div className="modal-overlay" onClick={() => setAcceptModal(null)}>
          <div style={{ background: "var(--bg)", borderRadius: 16, width: 520, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,.4)", border: "1px solid var(--border)" }} onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div style={{ background: "linear-gradient(135deg,#0f4c35,#16a34a)", padding: "20px 24px", borderRadius: "16px 16px 0 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>✅ Accept Tender</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,.8)", marginTop: 3 }}>{acceptModal.shipment.id} · {acceptModal.shipment.carrier}</div>
              </div>
              <button onClick={() => setAcceptModal(null)} style={{ background: "rgba(255,255,255,.15)", border: "none", color: "#fff", width: 30, height: 30, borderRadius: "50%", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
            </div>

            {/* Shipment summary */}
            <div style={{ padding: "16px 24px", background: "var(--bg2)", borderBottom: "1px solid var(--border)", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <div><div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", fontWeight: 700 }}>Origin</div><div style={{ fontSize: 12, fontWeight: 600, marginTop: 2 }}>{acceptModal.shipment.origin}</div></div>
              <div><div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", fontWeight: 700 }}>Destination</div><div style={{ fontSize: 12, fontWeight: 600, marginTop: 2 }}>{acceptModal.shipment.dest}</div></div>
              <div><div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", fontWeight: 700 }}>Weight</div><div style={{ fontSize: 12, fontWeight: 600, marginTop: 2 }}>{(acceptModal.shipment.weight || 0).toLocaleString()} lbs</div></div>
            </div>

            {/* Form */}
            <div style={{ padding: "20px 24px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 14 }}>Tender Response Details</div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text2)", textTransform: "uppercase", letterSpacing: 0.5, display: "block", marginBottom: 5 }}>PRO Number <span style={{ color: "var(--accent)", fontSize: 10 }}>(from carrier)</span></label>
                  <input value={acceptModal.pro} onChange={(e) => setAcceptModal({ ...acceptModal, pro: e.target.value })} placeholder="e.g. PRO-123456" style={{ width: "100%", padding: "9px 12px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, background: "var(--bg2)", color: "var(--text)", fontFamily: "monospace", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text2)", textTransform: "uppercase", letterSpacing: 0.5, display: "block", marginBottom: 5 }}>Pickup Date *</label>
                  <input type="date" value={acceptModal.pickup} onChange={(e) => setAcceptModal({ ...acceptModal, pickup: e.target.value })} style={{ width: "100%", padding: "9px 12px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, background: "var(--bg2)", color: "var(--text)", boxSizing: "border-box" }} />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text2)", textTransform: "uppercase", letterSpacing: 0.5, display: "block", marginBottom: 5 }}>Service Level</label>
                  <select value={acceptModal.service} onChange={(e) => setAcceptModal({ ...acceptModal, service: e.target.value })} style={{ width: "100%", padding: "9px 12px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, background: "var(--bg2)", color: "var(--text)", boxSizing: "border-box" }}>
                    <option value="">— Select —</option>
                    <option value="Standard">Standard</option>
                    <option value="Expedited">Expedited</option>
                    <option value="Economy">Economy</option>
                    <option value="White Glove">White Glove</option>
                    <option value="Time-Critical">Time-Critical</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text2)", textTransform: "uppercase", letterSpacing: 0.5, display: "block", marginBottom: 5 }}>Carrier Ref / BOL</label>
                  <input value={acceptModal.bol} onChange={(e) => setAcceptModal({ ...acceptModal, bol: e.target.value })} placeholder="e.g. BOL-2026-001" style={{ width: "100%", padding: "9px 12px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, background: "var(--bg2)", color: "var(--text)", fontFamily: "monospace", boxSizing: "border-box" }} />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text2)", textTransform: "uppercase", letterSpacing: 0.5, display: "block", marginBottom: 5 }}>Delivery Date</label>
                  <input type="date" value={acceptModal.delivery} onChange={(e) => setAcceptModal({ ...acceptModal, delivery: e.target.value })} style={{ width: "100%", padding: "9px 12px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, background: "var(--bg2)", color: "var(--text)", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text2)", textTransform: "uppercase", letterSpacing: 0.5, display: "block", marginBottom: 5 }}>Dock Assigned</label>
                  <input value={acceptModal.dock} onChange={(e) => setAcceptModal({ ...acceptModal, dock: e.target.value })} placeholder="e.g. Dock 4A" style={{ width: "100%", padding: "9px 12px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, background: "var(--bg2)", color: "var(--text)", boxSizing: "border-box" }} />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text2)", textTransform: "uppercase", letterSpacing: 0.5, display: "block", marginBottom: 5 }}>Dock Loading Start</label>
                  <input type="time" value={acceptModal.dockLoadStart} onChange={(e) => setAcceptModal({ ...acceptModal, dockLoadStart: e.target.value })} style={{ width: "100%", padding: "9px 12px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, background: "var(--bg2)", color: "var(--text)", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text2)", textTransform: "uppercase", letterSpacing: 0.5, display: "block", marginBottom: 5 }}>Dock Loading End</label>
                  <input type="time" value={acceptModal.dockLoadEnd} onChange={(e) => setAcceptModal({ ...acceptModal, dockLoadEnd: e.target.value })} style={{ width: "100%", padding: "9px 12px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, background: "var(--bg2)", color: "var(--text)", boxSizing: "border-box" }} />
                </div>
              </div>

              <div style={{ marginBottom: 6 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text2)", textTransform: "uppercase", letterSpacing: 0.5, display: "block", marginBottom: 5 }}>Notes (optional)</label>
                <input value={acceptModal.notes} onChange={(e) => setAcceptModal({ ...acceptModal, notes: e.target.value })} placeholder="Any additional carrier notes" style={{ width: "100%", padding: "9px 12px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, background: "var(--bg2)", color: "var(--text)", boxSizing: "border-box" }} />
              </div>

              <div style={{ background: "rgba(59,130,246,.06)", border: "1px solid rgba(59,130,246,.2)", borderRadius: 8, padding: "10px 14px", marginTop: 14, fontSize: 11, color: "var(--text2)" }}>
                💡 These details will be sent back to OMS via Middleware Pull TMS Planning so the shipping team has all confirmation info.
              </div>
            </div>

            {/* Footer */}
            <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border)", display: "flex", gap: 10, justifyContent: "flex-end", background: "var(--bg2)", borderRadius: "0 0 16px 16px" }}>
              <button onClick={() => setAcceptModal(null)} style={{ padding: "10px 20px", background: "var(--bg)", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontWeight: 600, color: "var(--text2)", cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
              <button onClick={confirmAcceptTender} disabled={busyId === acceptModal.shipment.id} style={{ padding: "10px 24px", background: "#16a34a", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, color: "#fff", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6 }}>✅ Confirm Acceptance</button>
            </div>
          </div>
        </div>
      )}

      </div>{/* end page-content */}
    </div>
  );
}
