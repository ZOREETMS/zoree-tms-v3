import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { DbApi, TenderApi } from "../lib/api";

const STATUS_BADGES = {
  Planned: "badge badge-teal",
  Tendered: "badge badge-purple",
  "In Transit": "badge badge-blue",
  Delivered: "badge badge-green",
  Exception: "badge badge-red",
  Cancelled: "badge badge-red",
};

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
function ShipmentDetailModal({ ds, onClose, onTender, onWithdraw, STATUS_BADGES }) {
  const linked = ds._linkedOrders || [];
  const consolidated = linked.length > 1;
  const pct = ds.status === "Delivered" ? 100 : ds.status === "In Transit" ? 62 : ds.status === "Tendered" ? 20 : ds.status === "Exception" ? 55 : 5;
  const barCol = ds.status === "Exception" ? "var(--red)" : ds.status === "Delivered" ? "var(--green)" : "var(--accent)";
  const isTendered = ds.status !== "Planned";
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
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 680 }}>
        <div className="modal-header">
          <div>
            <div style={{ fontSize: 10, opacity: 0.6, letterSpacing: 1 }}>SHIPMENT DETAILS</div>
            <h3>{ds.id}</h3>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ maxHeight: "75vh", overflowY: "auto" }}>

          {/* Status bar */}
          <div style={{ padding: "14px 20px", background: "#f8faff", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className={STATUS_BADGES[ds.status] || "badge"}>{ds.status}</span>
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
            <InfoBox icon="📅" label="Pickup Date" value={ds.pickup_date || "—"} />
            <InfoBox icon="🏁" label="Delivery Date" value={ds.delivery_date || "—"} />
            <InfoBox icon="🚚" label="Transit Days" value={transitDays} />
            <InfoBox icon="🚪" label="Dock Door" value={ds.dock_door || "—"} />
            <InfoBox icon="🕐" label="Dock Window" value={ds.dock_time || "—"} />
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
                  <span className="mono" style={{ color: "var(--accent)", fontSize: 12, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2 }}>{o.id}</span>
                  <span style={{ fontSize: 12, color: "var(--text2)" }}>{o.customer || ""}</span>
                  <span style={{ fontSize: 12, color: "var(--text3)" }}>· {o.commodity || ""}</span>
                  <span style={{ fontSize: 11, color: "var(--text3)" }}>· {(o.origin || "").split(",")[0]} → {(o.dest || "").split(",")[0]}</span>
                  <span style={{ marginLeft: "auto", fontSize: 12, fontFamily: "monospace", color: "var(--text2)" }}>{(o.weight || 0).toLocaleString()} lbs</span>
                  {ds.status === "Planned" && (
                    <button style={{ padding: "3px 10px", background: "rgba(245,158,11,.1)", border: "1px solid rgba(245,158,11,.3)", borderRadius: 7, fontSize: 11, fontWeight: 600, color: "#b45309", cursor: "pointer", fontFamily: "inherit" }}>🔓 Unassign</button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Line Items */}
          <ShipmentLineItems orderIds={linked.map((o) => o.id)} />

          {/* Shipment Timeline */}
          <div style={{ padding: "16px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1 }}>Shipment Timeline</span>
              <button style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>+ Add Event</button>
            </div>
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
          {ds.status === "Planned" && (
            <button className="btn btn-primary btn-sm" onClick={() => onTender(ds)}>📤 Tender to Carrier</button>
          )}
          {ds.status === "Tendered" && (
            <button style={{ background: "#ea580c", color: "#fff", border: "none", padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }} onClick={() => onWithdraw(ds)}>📤 Withdraw Tender</button>
          )}
          {["Planned", "Tendered", "In Transit"].includes(ds.status) && (
            <button className="btn btn-secondary btn-sm">🔄 Change Carrier</button>
          )}
          <button className="btn btn-secondary btn-sm">🚪 Dock schedule</button>
          <button className="btn btn-secondary btn-sm">📄 Documents</button>
          <button className="btn btn-secondary btn-sm">📧 Contact Carrier</button>
          <button className="btn btn-secondary btn-sm">📨 Send to WMS</button>
        </div>
      </div>
    </div>
  );
}

/* ── Async Line Items for Shipment Detail ── */
function ShipmentLineItems({ orderIds }) {
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!orderIds.length) { setLoading(false); return; }
    Promise.all(orderIds.map((oid) =>
      DbApi.list("order_lines", `order_id=eq.${encodeURIComponent(oid)}&order=line_num.asc&limit=50`)
        .then((res) => (Array.isArray(res) ? res : res?.data || []))
        .catch(() => [])
    )).then((results) => {
      setLines(results.flat());
      setLoading(false);
    });
  }, [orderIds.join(",")]);
  if (loading) return <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)" }}><div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>📦 Line Items</div><div style={{ color: "var(--text3)", fontSize: 12, fontStyle: "italic" }}>Loading…</div></div>;
  if (!lines.length) return null;
  return (
    <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>📦 Line Items</div>
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
              <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace" }}>{l.unit_weight || 0} lbs</td>
              <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace", fontWeight: 600 }}>{l.total_weight || 0} lbs</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ShipmentsPage() {
  const { shipments, orders, carriers, setData, refreshData } = useOutletContext();
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [modeFilter, setModeFilter] = useState("All");
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState({ text: "", type: "" });
  const [detailShipment, setDetailShipment] = useState(null);

  // Auto-open shipment detail from URL ?id=SHP-xxxx (run once on mount)
  const [autoOpened, setAutoOpened] = useState(false);
  useEffect(() => {
    if (autoOpened) return;
    const idParam = new URLSearchParams(window.location.search).get("id");
    if (idParam && shipments.length > 0) {
      const ship = shipments.find((s) => s.id === idParam);
      if (ship) {
        const linkedOrders = orders.filter((o) => String(o.shipment_id || "") === String(ship.id || ""));
        setDetailShipment({ ...ship, _linkedOrders: linkedOrders, _carrier: ship.carrier || "" });
      }
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

  const carrierByName = useMemo(() => {
    const map = new Map();
    carriers.forEach((c) => {
      if (c?.name) map.set(String(c.name).toLowerCase(), c);
    });
    return map;
  }, [carriers]);

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
        _linkedOrders: linkedOrders,
        _orderCount: linkedOrders.length,
        _commodity: commodities.join(", ") || s.commodity || "",
      };
    });
    if (statusFilter !== "All") list = list.filter((s) => s.status === statusFilter);
    if (modeFilter !== "All") list = list.filter((s) => (s.mode || "").toUpperCase() === modeFilter);
    if (q.trim()) {
      const t = q.toLowerCase().trim();
      list = list.filter((s) =>
        [s.id, s._carrier, s.origin, s.dest, s.mode, s.status]
          .some((v) => String(v || "").toLowerCase().includes(t))
      );
    }
    return [...list].sort((a, b) => {
      const av = String(a[sortCol] || "").toLowerCase();
      const bv = String(b[sortCol] || "").toLowerCase();
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [shipments, orders, q, statusFilter, modeFilter, sortCol, sortAsc]);

  function toggleSort(col) {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(true); }
  }

  async function onTender(row) {
    const carrierName = row._carrier || "";
    const carrier = carrierByName.get(carrierName.toLowerCase());
    const to = carrier?.email || "";
    if (!to) {
      toast(`Cannot tender ${row.id}: carrier email missing`, "warning");
      return;
    }
    setBusyId(row.id);
    try {
      await DbApi.patch("shipments", row.id, { status: "Tendered", carrier: carrierName });
      await TenderApi.sendEmail({
        to, shipmentId: row.id, carrierName,
        origin: row.origin || "", dest: row.dest || "",
        pickup: row.pickup_date || "", delivery: row.delivery_date || "",
        mode: row.mode || "", cost: row.total_cost || "",
        weight: row.weight || "", pieces: row.pieces || "",
        commodity: row.commodity || row._commodity || "",
        dockDoor: row.dock_door || "Door 1",
        dockTime: row.dock_time || "06:00–08:00",
      });
      toast(`Tendered ${row.id} → ${to}`, "success");
      await refreshData();
    } catch (err) {
      toast(`Tender failed: ${err.message}`, "error");
    } finally {
      setBusyId("");
    }
  }

  async function acceptTender(row) {
    setBusyId(row.id);
    try {
      await DbApi.patch("shipments", row.id, { status: "Confirmed" });
      toast(`Tender accepted for ${row.id}`, "success");
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
    if (row.status === "Tendered") {
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
    shipments.forEach((s) => { c[s.status] = (c[s.status] || 0) + 1; });
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

      {/* Filters */}
      <div className="filter-bar">
        <input
          placeholder="🔍 Search shipments... or SHP-1..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="search"
        />
        <select className="fsel" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          {["All", "Planned", "Tendered", "Confirmed", "In Transit", "Delivered", "Cancelled"].map((s) => (
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
            <tr key={s.id}>
              <td>
                <a href="#" onClick={(e) => { e.preventDefault(); setDetailShipment(s); }}
                   className="mono" style={{ color: "var(--accent)", fontWeight: 600 }}>
                  {s.id}
                </a>
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
                <span className={STATUS_BADGES[s.status] || "badge badge-blue"}>
                  {s.status || "—"}
                </span>
              </td>
              <td style={{ whiteSpace: "nowrap" }}>
                <div style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                {s.status === "Planned" && (
                  <button
                    style={{ background: "#2563eb", color: "#fff", borderColor: "#2563eb", padding: "4px 10px", fontSize: 12, borderRadius: 6, fontWeight: 700, cursor: "pointer", border: "none" }}
                    disabled={busyId === s.id}
                    onClick={() => onTender(s)}
                  >
                    📤 Tender
                  </button>
                )}
                {s.status === "Tendered" && (<>
                  <button
                    style={{ background: "#16a34a", color: "#fff", border: "none", padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                    disabled={busyId === s.id}
                    onClick={() => acceptTender(s)}
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
                {s.status === "Confirmed" && (
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

      {/* Shipment Detail Modal */}
      {detailShipment && <ShipmentDetailModal ds={detailShipment} onClose={() => setDetailShipment(null)} onTender={onTender} onWithdraw={(s) => { withdrawTender(s); setDetailShipment(null); }} STATUS_BADGES={STATUS_BADGES} />}
      </div>{/* end page-content */}
    </div>
  );
}
