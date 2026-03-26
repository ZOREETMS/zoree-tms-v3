import { useEffect, useMemo, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { DbApi, TenderApi } from "../lib/api";

const STATUS_BADGES = {
  Planned: "badge badge-teal",
  Tendered: "badge badge-purple",
  "In Transit": "badge badge-blue",
  Delivered: "badge badge-green",
  Exception: "badge badge-red",
  Cancelled: "badge badge-red",
};

export default function ShipmentsPage() {
  const { shipments, orders, carriers, setData, refreshData } = useOutletContext();
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [modeFilter, setModeFilter] = useState("All");
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState({ text: "", type: "" });
  const [detailShipment, setDetailShipment] = useState(null);
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
      {detailShipment && (
        <div className="modal-overlay" onClick={() => setDetailShipment(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div style={{ fontSize: 10, opacity: 0.6, letterSpacing: 1 }}>SHIPMENT DETAILS</div>
                <h3>{detailShipment.id}</h3>
              </div>
              <button className="modal-close" onClick={() => setDetailShipment(null)}>✕</button>
            </div>
            <div className="modal-body">
              {/* Status bar */}
              <div className="flex items-center gap-2 mb-3">
                <span className={STATUS_BADGES[detailShipment.status] || "badge"}>
                  {detailShipment.status}
                </span>
                <span className="fw-700">{detailShipment._carrier || "—"}</span>
                <span className="text-muted">·</span>
                <span className={`badge ${detailShipment.mode === "LTL" ? "badge-blue" : "badge-green"}`}>
                  {detailShipment.mode || "—"}
                </span>
                <span className="ml-auto fw-700 text-green" style={{ fontSize: 20 }}>
                  ${(detailShipment.total_cost || 0).toLocaleString()}
                </span>
              </div>

              {/* Origin → Destination */}
              <div className="flex items-center gap-3 mb-3" style={{ padding: "12px 16px", background: "var(--bg2)", borderRadius: 12, border: "1px solid var(--border)" }}>
                <div>
                  <div className="text-xs text-muted">ORIGIN</div>
                  <div className="fw-700">{detailShipment.origin || "—"}</div>
                  <div className="text-xs text-muted">Pickup: {detailShipment.pickup_date || "—"}</div>
                </div>
                <div style={{ flex: 1, textAlign: "center" }}>
                  <div className="text-xs text-muted">
                    {detailShipment._linkedOrders?.length > 1 ? `${detailShipment._linkedOrders.length} orders consolidated` : ""}
                  </div>
                  <div style={{ borderTop: "2px solid var(--accent)", margin: "6px 0" }} />
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="text-xs text-muted">DESTINATION</div>
                  <div className="fw-700">{detailShipment.dest || "—"}</div>
                  <div className="text-xs text-muted">Delivery: {detailShipment.delivery_date || "—"}</div>
                </div>
              </div>

              {/* Info Grid */}
              <div className="info-grid">
                <div className="info-box">
                  <div className="info-box-label">Carrier</div>
                  <div className="info-box-value">{detailShipment._carrier || "—"}</div>
                </div>
                <div className="info-box">
                  <div className="info-box-label">Mode</div>
                  <div className="info-box-value">{detailShipment.mode || "—"}</div>
                </div>
                <div className="info-box">
                  <div className="info-box-label">Weight</div>
                  <div className="info-box-value">{(detailShipment.weight || 0).toLocaleString()} lbs</div>
                </div>
                <div className="info-box">
                  <div className="info-box-label">Pieces</div>
                  <div className="info-box-value">{detailShipment.pieces || "—"}</div>
                </div>
                <div className="info-box">
                  <div className="info-box-label">Est. Cost</div>
                  <div className="info-box-value">${(detailShipment.total_cost || 0).toLocaleString()}</div>
                </div>
                <div className="info-box">
                  <div className="info-box-label">Pickup Date</div>
                  <div className="info-box-value">{detailShipment.pickup_date || "—"}</div>
                </div>
              </div>

              {/* Linked Orders */}
              {detailShipment._linkedOrders?.length > 0 && (
                <div className="mt-4">
                  <div className="text-xs fw-700 text-muted mb-2" style={{ letterSpacing: 1 }}>
                    ASSOCIATED ORDERS ({detailShipment._linkedOrders.length})
                  </div>
                  {detailShipment._linkedOrders.map((o) => (
                    <div key={o.id} className="flex items-center gap-2 mb-2" style={{
                      padding: "8px 12px", background: "var(--bg2)",
                      borderRadius: 10, border: "1px solid var(--border)"
                    }}>
                      <span className="mono text-sm" style={{ color: "var(--accent)", fontWeight: 600 }}>
                        {o.id}
                      </span>
                      <span className="text-sm">{o.customer || ""}</span>
                      <span className="text-xs text-muted">·</span>
                      <span className="text-xs text-muted">{o.commodity || ""}</span>
                      <span className="text-xs text-muted">·</span>
                      <span className="text-xs text-muted">{o.origin} → {o.dest}</span>
                      <span className="ml-auto mono text-sm">{(o.weight || 0).toLocaleString()} lbs</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Timeline */}
              <div className="mt-4">
                <div className="text-xs fw-700 text-muted mb-2" style={{ letterSpacing: 1 }}>
                  SHIPMENT TIMELINE
                </div>
                <div className="timeline">
                  <div className="timeline-item done">
                    <div className="timeline-label">Order Created & Rate Confirmed</div>
                    <div className="timeline-time">{detailShipment.pickup_date || "—"}</div>
                  </div>
                  <div className={`timeline-item ${detailShipment.status !== "Planned" ? "done" : ""}`}>
                    <div className="timeline-label">Tendered to Carrier</div>
                    <div className="timeline-time">
                      {detailShipment.status !== "Planned" ? detailShipment.pickup_date || "—" : "Pending"}
                    </div>
                  </div>
                  <div className={`timeline-item ${["In Transit", "Delivered"].includes(detailShipment.status) ? "done" : ""}`}>
                    <div className="timeline-label">Picked Up</div>
                    <div className="timeline-time">
                      {["In Transit", "Delivered"].includes(detailShipment.status) ? detailShipment.pickup_date || "—" : "Pending"}
                    </div>
                  </div>
                  <div className={`timeline-item ${["In Transit", "Delivered"].includes(detailShipment.status) ? "done" : ""}`}>
                    <div className="timeline-label">In Transit</div>
                    <div className="timeline-time">
                      {["In Transit", "Delivered"].includes(detailShipment.status) ? "En route" : "Pending"}
                    </div>
                  </div>
                  <div className={`timeline-item ${detailShipment.status === "Delivered" ? "done" : ""}`}>
                    <div className="timeline-label">Delivered</div>
                    <div className="timeline-time">
                      {detailShipment.status === "Delivered" ? detailShipment.delivery_date || "—" : "Pending"}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              {detailShipment.status === "Planned" && (
                <button className="btn btn-purple" onClick={() => onTender(detailShipment)}>
                  🚛 Tender to Carrier
                </button>
              )}
              {detailShipment.status === "Tendered" && (
                <button className="btn" onClick={() => withdrawTender(detailShipment)}>
                  ↩ Withdraw Tender
                </button>
              )}
              {detailShipment.status === "Planned" && (
                <button className="btn btn-red" onClick={() => deleteShipment(detailShipment)}>
                  🗑️ Delete
                </button>
              )}
              <button className="btn" onClick={() => setDetailShipment(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
      </div>{/* end page-content */}
    </div>
  );
}
