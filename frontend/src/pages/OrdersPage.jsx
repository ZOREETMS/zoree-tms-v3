import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { DbApi, OrdersApi } from "../lib/api";
import OrderLinesEditor from "../components/OrderLinesEditor";

const STATUS_BADGES = {
  Unplanned: "badge badge-amber",
  Planned: "badge badge-teal",
  Consolidated: "badge badge-blue",
  Tendered: "badge badge-purple",
  "In Transit": "badge badge-blue",
  Delivered: "badge badge-green",
  Cancelled: "badge badge-red",
};

export default function OrdersPage() {
  const { orders, shipments, carriers, setData, refreshData } = useOutletContext();
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState({ text: "", type: "" });
  const [selectedOrders, setSelectedOrders] = useState(new Set());
  const [detailOrder, setDetailOrder] = useState(null);
  const [detailLines, setDetailLines] = useState([]);
  const [detailBusy, setDetailBusy] = useState(false);
  const [sortCol, setSortCol] = useState("id");
  const [sortAsc, setSortAsc] = useState(false);

  function toast(text, type = "info") {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: "", type: "" }), 4000);
  }

  // Filter + sort
  const rows = useMemo(() => {
    let filtered = orders;
    if (statusFilter !== "All") {
      filtered = filtered.filter((o) => o.status === statusFilter);
    }
    if (q.trim()) {
      const t = q.toLowerCase().trim();
      filtered = filtered.filter((o) =>
        [o.id, o.customer, o.origin, o.dest, o.commodity, o.shipment_id]
          .some((v) => String(v || "").toLowerCase().includes(t))
      );
    }
    // Sort
    return [...filtered].sort((a, b) => {
      const av = String(a[sortCol] || "").toLowerCase();
      const bv = String(b[sortCol] || "").toLowerCase();
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [orders, q, statusFilter, sortCol, sortAsc]);

  function toggleSort(col) {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(true); }
  }

  // Selection
  function toggleSelect(id) {
    setSelectedOrders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    if (selectedOrders.size === rows.length) setSelectedOrders(new Set());
    else setSelectedOrders(new Set(rows.map((o) => o.id)));
  }

  // Actions
  async function deleteOrder(id) {
    const o = orders.find((x) => x.id === id);
    if (!o || o.status !== "Unplanned") {
      toast("Only Unplanned orders can be deleted", "warning");
      return;
    }
    if (!window.confirm(`Delete order ${id}? This cannot be undone.`)) return;
    setBusyId(id);
    try {
      await DbApi.patch("orders", id, { status: "Cancelled" });
      toast(`Order ${id} deleted`, "success");
      await refreshData();
    } catch (err) {
      toast(`Failed: ${err.message}`, "error");
    } finally {
      setBusyId("");
    }
  }

  async function unplanOrder(id) {
    const o = orders.find((x) => x.id === id);
    if (!o) return;
    if (o.status === "Tendered") {
      toast("Withdraw tender first before unplanning", "warning");
      return;
    }
    if (!window.confirm(`Unplan order ${id}? It will be removed from its shipment.`)) return;
    setBusyId(id);
    try {
      await DbApi.patch("orders", id, { status: "Unplanned", shipment_id: null });
      toast(`Order ${id} unplanned`, "success");
      await refreshData();
    } catch (err) {
      toast(`Failed: ${err.message}`, "error");
    } finally {
      setBusyId("");
    }
  }

  async function openDetail(orderId) {
    const o = orders.find((x) => x.id === orderId);
    setDetailOrder(o);
    setDetailBusy(true);
    try {
      const full = await OrdersApi.full(orderId);
      setDetailLines(Array.isArray(full?.lines) ? full.lines : []);
    } catch {
      setDetailLines([]);
    } finally {
      setDetailBusy(false);
    }
  }

  async function saveLines() {
    if (!detailOrder) return;
    setDetailBusy(true);
    try {
      await OrdersApi.saveLines(detailOrder.id, detailLines);
      toast(`Saved ${detailLines.length} lines for ${detailOrder.id}`, "success");
      await refreshData();
    } finally {
      setDetailBusy(false);
    }
  }

  const statusCounts = useMemo(() => {
    const c = { All: orders.length };
    orders.forEach((o) => { c[o.status] = (c[o.status] || 0) + 1; });
    return c;
  }, [orders]);

  const selectedUnplanned = useMemo(() => {
    return orders.filter((o) => selectedOrders.has(o.id) && o.status === "Unplanned");
  }, [orders, selectedOrders]);

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
          <div className="page-title">Orders</div>
          <div className="page-sub">Auto-consolidates open orders by lane every run</div>
        </div>
        <div className="header-actions">
          <button className="btn btn-primary btn-sm">+ New Order</button>
        </div>
      </div>
      <div className="page-content">

      {/* Status Chips */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {[
          { key: "All", emoji: "📋", color: null },
          { key: "Unplanned", emoji: "🟡", color: "#ca8a04" },
          { key: "Planned", emoji: "🟢", color: "#16a34a" },
          { key: "Consolidated", emoji: "🔵", color: "#2563eb" },
          { key: "Tendered", emoji: "🟠", color: "#d97706" },
          { key: "In Transit", emoji: "🚛", color: "#0284c7" },
          { key: "Delivered", emoji: "✅", color: "#059669" },
          { key: "Cancelled", emoji: "🔴", color: "#dc2626" },
        ].map((s) => (
          <button
            key={s.key}
            className={`ord-chip ${statusFilter === s.key ? "active-chip" : ""}`}
            onClick={() => setStatusFilter(s.key)}
          >
            {s.emoji} {s.key} {statusCounts[s.key] ? `(${statusCounts[s.key]})` : ""}
          </button>
        ))}
      </div>

      {/* Search + Filters */}
      <div className="filter-bar">
        <div className="search-wrap">
          <input
            placeholder="Search order, customer, lane, commodity..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="search-input"
          />
        </div>
        <select className="fsel" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="All">All Customers</option>
        </select>
      </div>

      {/* Selection Bar */}
      {selectedOrders.size > 0 && (
        <div className="selection-bar">
          <input type="checkbox" checked onChange={toggleSelectAll} />
          <strong>{selectedOrders.size} order{selectedOrders.size !== 1 ? "s" : ""} selected</strong>
          <span className="ml-auto" />
          <button className="btn btn-sm" onClick={() => setSelectedOrders(new Set())}>
            ✕ Clear
          </button>
          {selectedUnplanned.length > 0 && (
            <button className="btn btn-sm btn-green">⚡ Plan Selected</button>
          )}
        </div>
      )}

      {/* Toast */}
      {message.text && (
        <div className={`toast toast-${message.type || "info"}`} style={{ marginBottom: 12 }}>
          {message.text}
        </div>
      )}

      {/* Orders Table */}
      <div className="card" style={{ padding: 0 }}><div className="table-wrap">
      <table className="grid" style={{ border: "none", boxShadow: "none" }}>
        <thead>
          <tr>
            <th style={{ width: 36 }}>
              <input
                type="checkbox"
                checked={selectedOrders.size === rows.length && rows.length > 0}
                onChange={toggleSelectAll}
              />
            </th>
            <th onClick={() => toggleSort("id")}>Order ID <SortIcon col="id" /></th>
            <th onClick={() => toggleSort("customer")}>Customer <SortIcon col="customer" /></th>
            <th onClick={() => toggleSort("origin")}>Origin <SortIcon col="origin" /></th>
            <th onClick={() => toggleSort("dest")}>Destination <SortIcon col="dest" /></th>
            <th onClick={() => toggleSort("weight")}>Weight <SortIcon col="weight" /></th>
            <th>Pieces</th>
            <th onClick={() => toggleSort("commodity")}>Commodity <SortIcon col="commodity" /></th>
            <th>Ready</th>
            <th>Due</th>
            <th>Shipment</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={13} className="empty-state">No orders found</td></tr>
          ) : rows.map((o) => (
            <tr key={o.id}>
              <td>
                <input
                  type="checkbox"
                  checked={selectedOrders.has(o.id)}
                  onChange={() => toggleSelect(o.id)}
                />
              </td>
              <td>
                <a href="#" onClick={(e) => { e.preventDefault(); openDetail(o.id); }}
                   className="mono" style={{ color: "var(--accent)", fontWeight: 600 }}>
                  {o.id}
                </a>
              </td>
              <td>{o.customer || "—"}</td>
              <td className="text-sm">{o.origin || "—"}</td>
              <td className="text-sm">{o.dest || "—"}</td>
              <td className="mono">{(o.weight || 0).toLocaleString()} lbs</td>
              <td className="mono">{o.pieces || "—"}</td>
              <td className="text-sm">{o.commodity || "—"}</td>
              <td className="mono text-sm">{o.ready || "—"}</td>
              <td className="mono text-sm">{o.due || "—"}</td>
              <td>
                {o.shipment_id ? (
                  <span className="mono text-sm" style={{ color: "var(--green)" }}>
                    {o.shipment_id}
                  </span>
                ) : "—"}
              </td>
              <td>
                <span className={STATUS_BADGES[o.status] || "badge badge-blue"}>
                  {o.status || "—"}
                </span>
              </td>
              <td style={{ whiteSpace: "nowrap" }}>
                {o.status === "Unplanned" && (<>
                  <button className="btn btn-primary btn-sm" disabled={busyId === o.id}>⚡ Plan</button>{" "}
                  <button className="btn btn-secondary btn-sm" onClick={() => openDetail(o.id)}>✏️</button>{" "}
                  <button
                    style={{ background: "rgba(220,38,38,.08)", color: "#dc2626", border: "1px solid rgba(220,38,38,.2)", padding: "4px 8px", borderRadius: 6, fontSize: 12, cursor: "pointer" }}
                    disabled={busyId === o.id}
                    onClick={() => deleteOrder(o.id)}
                  >🗑️</button>
                </>)}
                {o.status === "Planned" && (<>
                  <button
                    className="btn btn-secondary btn-sm"
                    style={{ background: "rgba(16,185,129,.08)", color: "#059669", borderColor: "rgba(16,185,129,.35)", fontSize: 11 }}
                    disabled={busyId === o.id}
                  >📤 Tender</button>{" "}
                  <button
                    className="btn btn-secondary btn-sm"
                    style={{ background: "rgba(245,158,11,.08)", color: "#b45309", borderColor: "rgba(245,158,11,.35)", fontSize: 11 }}
                    disabled={busyId === o.id}
                    onClick={() => unplanOrder(o.id)}
                  >🔓 Unplan</button>
                </>)}
                {o.status === "Consolidated" && (
                  <button
                    className="btn btn-secondary btn-sm"
                    style={{ background: "rgba(245,158,11,.08)", color: "#b45309", borderColor: "rgba(245,158,11,.35)", fontSize: 11 }}
                    disabled={busyId === o.id}
                    onClick={() => unplanOrder(o.id)}
                  >🔓 Unplan</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div></div>{/* end table-wrap, card */}

      <div className="text-sm text-muted mt-2">
        {rows.length} of {orders.length} orders
      </div>

      {/* Order Detail Modal */}
      {detailOrder && (
        <div className="modal-overlay" onClick={() => setDetailOrder(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>ORDER DETAILS — {detailOrder.id}</h3>
              <button className="modal-close" onClick={() => setDetailOrder(null)}>✕</button>
            </div>
            <div className="modal-body">
              {/* Status + Customer */}
              <div className="flex items-center gap-2 mb-3">
                <span className={STATUS_BADGES[detailOrder.status] || "badge"}>
                  {detailOrder.status}
                </span>
                <span className="fw-700">{detailOrder.customer || "—"}</span>
                {detailOrder.shipment_id && (
                  <span className="badge badge-teal ml-auto">→ {detailOrder.shipment_id}</span>
                )}
              </div>

              {/* Origin → Destination */}
              <div className="flex items-center gap-3 mb-3">
                <div>
                  <div className="text-xs text-muted">ORIGIN</div>
                  <div className="fw-700">{detailOrder.origin || "—"}</div>
                </div>
                <div style={{ flex: 1, borderTop: "2px solid var(--accent)", margin: "10px 0" }} />
                <div style={{ textAlign: "right" }}>
                  <div className="text-xs text-muted">DESTINATION</div>
                  <div className="fw-700">{detailOrder.dest || "—"}</div>
                </div>
              </div>

              {/* Info Grid */}
              <div className="info-grid">
                <div className="info-box">
                  <div className="info-box-label">Weight</div>
                  <div className="info-box-value">{(detailOrder.weight || 0).toLocaleString()} lbs</div>
                </div>
                <div className="info-box">
                  <div className="info-box-label">Pieces</div>
                  <div className="info-box-value">{detailOrder.pieces || "—"}</div>
                </div>
                <div className="info-box">
                  <div className="info-box-label">Commodity</div>
                  <div className="info-box-value">{detailOrder.commodity || "—"}</div>
                </div>
                <div className="info-box">
                  <div className="info-box-label">Ready Date</div>
                  <div className="info-box-value">{detailOrder.ready || "—"}</div>
                </div>
                <div className="info-box">
                  <div className="info-box-label">Due Date</div>
                  <div className="info-box-value">{detailOrder.due || "—"}</div>
                </div>
                <div className="info-box">
                  <div className="info-box-label">Shipment ID</div>
                  <div className="info-box-value" style={{ color: "var(--green)" }}>
                    {detailOrder.shipment_id || "—"}
                  </div>
                </div>
              </div>

              {/* Line Items */}
              <div className="mt-4">
                <OrderLinesEditor
                  orderId={detailOrder.id}
                  lines={detailLines}
                  onChange={setDetailLines}
                  onSave={saveLines}
                  onClear={() => {
                    if (window.confirm("Clear all lines?")) {
                      OrdersApi.clearLines(detailOrder.id).then(() => {
                        setDetailLines([]);
                        toast("Lines cleared", "success");
                      });
                    }
                  }}
                  busy={detailBusy}
                />
              </div>
            </div>
            <div className="modal-footer">
              {detailOrder.status === "Unplanned" && (
                <button className="btn btn-green">⚡ Plan This Order</button>
              )}
              {(detailOrder.status === "Planned" || detailOrder.status === "Consolidated") && (
                <button className="btn" onClick={() => unplanOrder(detailOrder.id)}>
                  🔓 Unplan
                </button>
              )}
              <button className="btn" onClick={() => setDetailOrder(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
      </div>{/* end page-content */}
    </div>
  );
}
