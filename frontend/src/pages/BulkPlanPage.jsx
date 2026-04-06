import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { BulkPlanApi } from "../lib/api";
import { buildLaneGroups } from "../utils/laneUtils";
import { planAllLanes } from "../services/bulkPlanService";
import PlanSummaryModal from "../components/bulk-plan/PlanSummaryModal";
import OrderEditModal from "../components/bulk-plan/OrderEditModal";

/* ── helpers ── */
function fmt$(n) {
  return "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function BulkPlanPage() {
  const { orders, items = [], refreshData } = useOutletContext();

  const [selectedIds, setSelectedIds] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ text: "", type: "" });
  const [results, setResults] = useState(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [editOrder, setEditOrder] = useState(null);

  /* ── filters ── */
  const [q, setQ] = useState("");
  const [customerFilter, setCustomerFilter] = useState("All");

  function toast(text, type = "info") {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: "", type: "" }), 8000);
  }

  /* ── unplanned orders ── */
  const unplanned = useMemo(() => {
    return orders.filter((o) => {
      const status = String(o.status || "").toLowerCase();
      return status === "unplanned" || !o.shipment_id;
    });
  }, [orders]);

  /* ── customer list ── */
  const customers = useMemo(() => {
    const set = new Set();
    unplanned.forEach((o) => { if (o.customer) set.add(o.customer); });
    return Array.from(set).sort();
  }, [unplanned]);

  /* ── filtered rows ── */
  const filteredOrders = useMemo(() => {
    let rows = unplanned;
    if (customerFilter !== "All") rows = rows.filter((o) => o.customer === customerFilter);
    if (q.trim()) {
      const t = q.toLowerCase().trim();
      rows = rows.filter((o) =>
        [o.id, o.customer, o.origin, o.dest, o.commodity]
          .some((v) => String(v || "").toLowerCase().includes(t))
      );
    }
    return rows;
  }, [unplanned, q, customerFilter]);

  /* ── selection summary ── */
  const selectionSummary = useMemo(() => {
    const sel = unplanned.filter((o) => selectedIds.has(o.id));
    return {
      count: sel.length,
      weight: sel.reduce((s, o) => s + Number(o.weight || 0), 0),
      pieces: sel.reduce((s, o) => s + Number(o.pieces || 0), 0),
    };
  }, [unplanned, selectedIds]);

  /* ── build lane groups from selected orders (via service) ── */
  const lanes = useMemo(() => {
    const selected = unplanned.filter((o) => selectedIds.has(o.id));
    return buildLaneGroups(selected);
  }, [unplanned, selectedIds]);

  /* ── selection helpers ── */
  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    const allIds = filteredOrders.map((o) => o.id);
    const allSelected = allIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) allIds.forEach((id) => next.delete(id));
      else allIds.forEach((id) => next.add(id));
      return next;
    });
  }
  function clearSelection() {
    setSelectedIds(new Set());
  }

  /* ── Plan & Create Shipments (with progressive consolidation + splitting) ── */
  async function onPlan() {
    if (!lanes.length) {
      toast("No orders selected.", "warning");
      return;
    }
    setBusy(true);
    setMessage({ text: "", type: "" });
    setResults(null);

    try {
      // Progressive consolidation: rate individually, try consolidation, compare costs
      const { plans, totalConsolidated, totalIndividual, totalFailed, failedOrderIds } =
        await planAllLanes(lanes, orders, "cost", (msg) => toast(msg, "info"));

      if (!plans.length) {
        const failMsg = failedOrderIds.length
          ? `Failed orders: ${failedOrderIds.join(", ")}`
          : "Check rate table for transit_days, miles, or enable CarrierConnect.";
        toast(`No executable plans — no carriers returned valid quotes. ${failMsg}`, "error");
        setBusy(false);
        return;
      }

      // Build summary message
      const parts = [];
      if (totalConsolidated > 0) parts.push(`${totalConsolidated} consolidated`);
      if (totalIndividual > 0) parts.push(`${totalIndividual} individual`);
      if (totalFailed > 0) parts.push(`${totalFailed} failed`);
      toast(`Creating ${plans.length} shipment(s): ${parts.join(", ")}...`, "info");

      // Execute — create shipments + update orders
      const execRes = await BulkPlanApi.execute(plans);
      setResults(execRes);
      setSelectedIds(new Set());
      await refreshData();

      if (execRes?.shipments?.length > 0) {
        setSummaryOpen(true);
        setMessage({ text: "", type: "" });
      } else {
        toast(
          `Planning completed but no shipments were created. ${
            execRes?.errors?.length ? execRes.errors.map((e) => e.error).join("; ") : "Check API logs."
          }`,
          "error"
        );
      }
    } catch (err) {
      toast(`Planning failed: ${err.message || "Unknown error"}`, "error");
    } finally {
      setBusy(false);
    }
  }

  /* ── render ── */
  const allChecked = filteredOrders.length > 0 && filteredOrders.every((o) => selectedIds.has(o.id));

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Bulk Plan</div>
          <div className="page-sub">Select orders and create shipments in one click</div>
        </div>
        <div className="header-actions">
          <button
            className="btn btn-primary"
            disabled={busy || selectionSummary.count === 0}
            onClick={onPlan}
            style={{ fontWeight: 700 }}
          >
            {busy ? "Planning..." : `Plan ${selectionSummary.count} Order${selectionSummary.count !== 1 ? "s" : ""} \u2192`}
          </button>
        </div>
      </div>

      <div className="page-content">
        {/* Toast */}
        {message.text && (
          <div
            style={{
              padding: "10px 16px", borderRadius: 10, marginBottom: 16, fontSize: 13, fontWeight: 600,
              background: message.type === "error" ? "#fee2e2" : message.type === "success" ? "#dcfce7" : message.type === "warning" ? "#fef9c3" : "#dbeafe",
              color: message.type === "error" ? "#991b1b" : message.type === "success" ? "#14532d" : message.type === "warning" ? "#854d0e" : "#1e3a8a",
              border: `1px solid ${message.type === "error" ? "#fca5a5" : message.type === "success" ? "#86efac" : message.type === "warning" ? "#fde047" : "#93c5fd"}`,
            }}
          >
            {message.text}
          </div>
        )}

        {/* Results banner */}
        {results && results?.shipments?.length > 0 && (
          <div className="card" style={{ marginBottom: 16, border: "1px solid #86efac" }}>
            <div className="card-body" style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 22 }}>&#9989;</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, color: "#059669", fontSize: 14 }}>Shipments Created</div>
                <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 2 }}>
                  {results?.shipments?.length || 0} shipment(s) &middot; {results?.ordersUpdated || 0} order(s) updated to Planned
                </div>
              </div>
              {results?.shipments?.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {results.shipments.map((s) => (
                    <span key={s.id} className="badge badge-green" style={{ fontSize: 11 }}>
                      {s.id} &middot; {s.carrier} &middot; {fmt$(s.total_cost)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="stat-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          <div className="stat-card blue">
            <div className="stat-label">Unplanned Orders</div>
            <div className="stat-value">{unplanned.length}</div>
          </div>
          <div className="stat-card green">
            <div className="stat-label">Selected</div>
            <div className="stat-value">{selectionSummary.count}</div>
          </div>
          <div className="stat-card yellow">
            <div className="stat-label">Total Weight</div>
            <div className="stat-value">{selectionSummary.weight.toLocaleString()} lbs</div>
          </div>
          <div className="stat-card" style={{ borderLeft: "4px solid #8b5cf6" }}>
            <div className="stat-label">Lane Groups</div>
            <div className="stat-value">{lanes.length}</div>
          </div>
        </div>

        {/* Filters */}
        <div className="filter-bar">
          <div className="search-wrap" style={{ flex: 1 }}>
            <input
              placeholder="Search order, customer, lane, commodity..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="search-input"
            />
          </div>
          <select
            value={customerFilter}
            onChange={(e) => setCustomerFilter(e.target.value)}
            style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12, fontFamily: "inherit" }}
          >
            <option value="All">All Customers</option>
            {customers.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <button className="btn btn-secondary btn-sm" onClick={toggleSelectAll}>
            {allChecked ? "Deselect All" : "Select All"}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={clearSelection} disabled={selectedIds.size === 0}>
            Clear
          </button>
        </div>

        {/* Orders table */}
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <input type="checkbox" checked={allChecked} onChange={toggleSelectAll} style={{ accentColor: "var(--accent)" }} />
                </th>
                <th>Order ID</th>
                <th>Customer</th>
                <th>Origin</th>
                <th>Destination</th>
                <th>Commodity</th>
                <th>Weight</th>
                <th>Pieces</th>
                <th>Pickup Date</th>
                <th>Delivery Date</th>
                <th style={{ width: 60 }}>Edit</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={11} style={{ textAlign: "center", padding: 30, color: "var(--text3)" }}>
                    No unplanned orders found
                  </td>
                </tr>
              ) : (
                filteredOrders.map((o) => (
                  <tr key={o.id} style={selectedIds.has(o.id) ? { background: "rgba(59,130,246,0.04)" } : undefined}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(o.id)}
                        onChange={() => toggleSelect(o.id)}
                        style={{ accentColor: "var(--accent)" }}
                      />
                    </td>
                    <td>
                      <span
                        className="mono"
                        style={{ fontWeight: 700, color: "var(--accent)", cursor: "pointer" }}
                        onClick={() => setEditOrder(o)}
                      >
                        {o.id}
                      </span>
                    </td>
                    <td>{o.customer || "-"}</td>
                    <td>{o.origin || "-"}</td>
                    <td>{o.dest || "-"}</td>
                    <td>{o.commodity || "-"}</td>
                    <td>{Number(o.weight || 0).toLocaleString()}</td>
                    <td>{o.pieces || "-"}</td>
                    <td className="mono">{o.ready || o.pickup_date || o.ready_date || "—"}</td>
                    <td className="mono">{o.due || o.delivery_date || o.due_date || "—"}</td>
                    <td>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={(e) => { e.stopPropagation(); setEditOrder(o); }}
                        title="Edit order"
                      >
                        ✏️
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Bottom action */}
        {selectionSummary.count > 0 && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={onPlan}
              style={{ fontWeight: 700, fontSize: 14, padding: "10px 28px", background: "linear-gradient(135deg,#059669,#10b981)", border: "none" }}
            >
              {busy ? "Planning..." : `Plan & Create Shipments (${selectionSummary.count} orders, ${lanes.length} lanes)`}
            </button>
          </div>
        )}
      </div>

      {/* Order Edit Modal */}
      <OrderEditModal
        isOpen={!!editOrder}
        order={editOrder}
        items={items}
        onClose={() => setEditOrder(null)}
        onSaved={async (orderId) => {
          await refreshData();
          toast(`Saved changes to ${orderId}`, "success");
        }}
      />

      {/* Plan Summary Modal */}
      <PlanSummaryModal
        isOpen={summaryOpen}
        shipments={results?.shipments || []}
        ordersUpdated={results?.ordersUpdated || 0}
        onClose={() => setSummaryOpen(false)}
      />
    </div>
  );
}
