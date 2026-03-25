import { useMemo, useState, useCallback } from "react";
import { useOutletContext } from "react-router-dom";
import { BulkPlanApi } from "../lib/api";

/* ── helpers ── */
function normalizeZip(value) {
  const m = String(value || "").match(/\b(\d{5})\b/);
  return m ? m[1] : "";
}

function laneKey(order) {
  const origin = order.origin || "";
  const dest = order.dest || "";
  return `${origin} -> ${dest}`;
}

function fmt$(n) {
  return "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const STEPS = [
  { id: "select", label: "1. Select Orders" },
  { id: "lanes", label: "2. Lane Groups" },
  { id: "rates", label: "3. Rate Shopping" },
  { id: "summary", label: "4. Plan Summary" },
];

export default function BulkPlanPage() {
  const { orders, refreshData } = useOutletContext();

  /* ── wizard state ── */
  const [step, setStep] = useState("select");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [laneEdits, setLaneEdits] = useState({});   // laneKey -> { originZip, destZip, freightClass }
  const [optimizeBy, setOptimizeBy] = useState("cost");
  const [rateResults, setRateResults] = useState([]);
  const [pickupDates, setPickupDates] = useState({});  // laneKey -> date string
  const [deliveryDates, setDeliveryDates] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ text: "", type: "" });
  const [executeResults, setExecuteResults] = useState(null);

  /* ── filters (step 1) ── */
  const [q, setQ] = useState("");
  const [customerFilter, setCustomerFilter] = useState("All");

  function toast(text, type = "info") {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: "", type: "" }), 5000);
  }

  /* ── unplanned orders ── */
  const unplanned = useMemo(() => {
    return orders.filter((o) => {
      const status = String(o.status || "").toLowerCase();
      return status === "unplanned" || !o.shipment_id;
    });
  }, [orders]);

  /* ── customer list for filter ── */
  const customers = useMemo(() => {
    const set = new Set();
    unplanned.forEach((o) => { if (o.customer) set.add(o.customer); });
    return Array.from(set).sort();
  }, [unplanned]);

  /* ── filtered rows for step 1 ── */
  const filteredOrders = useMemo(() => {
    let rows = unplanned;
    if (customerFilter !== "All") {
      rows = rows.filter((o) => o.customer === customerFilter);
    }
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

  /* ── lane groups (step 2) ── */
  const lanes = useMemo(() => {
    const groups = new Map();
    const selected = unplanned.filter((o) => selectedIds.has(o.id));
    selected.forEach((o) => {
      const key = laneKey(o);
      if (!groups.has(key)) {
        groups.set(key, {
          laneKey: key,
          origin: o.origin || "",
          destination: o.dest || "",
          originZip: normalizeZip(o.origin_zip || o.origin),
          destZip: normalizeZip(o.dest_zip || o.dest),
          freightClass: o.freight_class || "70",
          totalWeight: 0,
          totalPieces: 0,
          orderIds: [],
        });
      }
      const g = groups.get(key);
      g.totalWeight += Number(o.weight || 0);
      g.totalPieces += Number(o.pieces || 0);
      g.orderIds.push(o.id);
    });
    return Array.from(groups.values());
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

  /* ── lane edit helpers ── */
  function getLaneField(lk, field, fallback) {
    return laneEdits[lk]?.[field] ?? fallback;
  }
  function setLaneField(lk, field, value) {
    setLaneEdits((prev) => ({
      ...prev,
      [lk]: { ...(prev[lk] || {}), [field]: value },
    }));
  }

  /* ── determine load type ── */
  function loadType(weight) {
    return weight >= 10000 ? "TL" : "LTL";
  }

  /* ── build lanes payload with edits merged ── */
  function buildLanesPayload() {
    return lanes.map((l) => ({
      ...l,
      originZip: getLaneField(l.laneKey, "originZip", l.originZip),
      destZip: getLaneField(l.laneKey, "destZip", l.destZip),
      freightClass: getLaneField(l.laneKey, "freightClass", l.freightClass),
    }));
  }

  /* ── rate all lanes ── */
  async function onRate() {
    const payload = buildLanesPayload();
    if (!payload.length) {
      toast("No lanes to rate. Go back and select orders.", "warning");
      return;
    }
    setBusy(true);
    setMessage({ text: "", type: "" });
    try {
      const res = await BulkPlanApi.rate(payload, optimizeBy);
      const results = Array.isArray(res?.results) ? res.results : [];
      setRateResults(results);
      toast(`Rated ${results.length} lane${results.length !== 1 ? "s" : ""} successfully.`, "success");
      setStep("rates");
    } catch (err) {
      toast(`Rating failed: ${err.message || "Unknown error"}`, "error");
    } finally {
      setBusy(false);
    }
  }

  /* ── execute plans ── */
  async function onExecute() {
    const payload = buildLanesPayload();
    const plans = rateResults
      .map((r) => {
        const lane = payload.find((l) => l.laneKey === r.laneKey);
        if (!lane || !r?.bestQuote) return null;
        return {
          laneKey: lane.laneKey,
          origin: lane.origin,
          destination: lane.destination,
          originZip: lane.originZip,
          destZip: lane.destZip,
          totalWeight: lane.totalWeight,
          totalPieces: lane.totalPieces,
          orderIds: lane.orderIds,
          carrier: r.bestQuote.carrier || "",
          mode: r.bestQuote.mode || "LTL",
          totalCost: r.bestQuote.totalCharge || 0,
          pickupDate: pickupDates[lane.laneKey] || "",
          deliveryDate: deliveryDates[lane.laneKey] || r.bestQuote.deliveryDate || "",
          czarliteRate: r.bestQuote.mode === "LTL",
        };
      })
      .filter(Boolean);
    if (!plans.length) {
      toast("No executable plans. Run Rate Shopping first.", "warning");
      return;
    }
    setBusy(true);
    setMessage({ text: "", type: "" });
    try {
      const res = await BulkPlanApi.execute(plans);
      setExecuteResults(res);
      toast(
        `Executed ${res?.shipments?.length || 0} shipment(s). Orders updated: ${res?.ordersUpdated || 0}.`,
        "success"
      );
      await refreshData();
    } catch (err) {
      toast(`Execute failed: ${err.message || "Unknown error"}`, "error");
    } finally {
      setBusy(false);
    }
  }

  /* ═══════════════════════════════════════════
     STEP RENDERERS
  ═══════════════════════════════════════════ */

  /* ── Step 1: Select Orders ── */
  function renderSelectOrders() {
    const allChecked = filteredOrders.length > 0 && filteredOrders.every((o) => selectedIds.has(o.id));
    return (
      <>
        {/* Summary stats */}
        <div className="stat-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          <div className="stat-card blue">
            <div className="stat-label">Selected Orders</div>
            <div className="stat-value">{selectionSummary.count}</div>
            <div className="stat-delta">of {unplanned.length} unplanned</div>
          </div>
          <div className="stat-card green">
            <div className="stat-label">Total Weight</div>
            <div className="stat-value">{selectionSummary.weight.toLocaleString()} lbs</div>
          </div>
          <div className="stat-card" style={{ borderLeft: "4px solid #8b5cf6" }}>
            <div className="stat-label">Total Pieces</div>
            <div className="stat-value">{selectionSummary.pieces.toLocaleString()}</div>
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
        </div>

        {/* Orders table */}
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleSelectAll}
                    style={{ accentColor: "var(--accent)" }}
                  />
                </th>
                <th>Order ID</th>
                <th>Customer</th>
                <th>Origin</th>
                <th>Destination</th>
                <th>Commodity</th>
                <th>Weight</th>
                <th>Pieces</th>
                <th>Ready Date</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", padding: 30, color: "var(--text3)" }}>
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
                    <td style={{ fontWeight: 600, color: "var(--text)" }}>{o.id}</td>
                    <td>{o.customer || "-"}</td>
                    <td>{o.origin || "-"}</td>
                    <td>{o.dest || "-"}</td>
                    <td>{o.commodity || "-"}</td>
                    <td>{Number(o.weight || 0).toLocaleString()}</td>
                    <td>{o.pieces || "-"}</td>
                    <td>{o.ready_date || "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Next button */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16, gap: 10 }}>
          <button
            className="btn btn-primary"
            disabled={selectionSummary.count === 0}
            onClick={() => setStep("lanes")}
          >
            Next: Lane Groups ({selectionSummary.count} orders) &rarr;
          </button>
        </div>
      </>
    );
  }

  /* ── Step 2: Lane Groups ── */
  function renderLaneGroups() {
    return (
      <>
        <div className="stat-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          <div className="stat-card blue">
            <div className="stat-label">Lane Groups</div>
            <div className="stat-value">{lanes.length}</div>
          </div>
          <div className="stat-card green">
            <div className="stat-label">Total Orders</div>
            <div className="stat-value">{selectionSummary.count}</div>
          </div>
          <div className="stat-card" style={{ borderLeft: "4px solid #f59e0b" }}>
            <div className="stat-label">Total Weight</div>
            <div className="stat-value">{selectionSummary.weight.toLocaleString()} lbs</div>
          </div>
        </div>

        {lanes.length === 0 ? (
          <div className="card" style={{ padding: 30, textAlign: "center", color: "var(--text3)" }}>
            No orders selected. Go back to Step 1 and select orders.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>Lane</th>
                  <th>Orders</th>
                  <th>Origin ZIP</th>
                  <th>Dest ZIP</th>
                  <th>Freight Class</th>
                  <th>Weight (lbs)</th>
                  <th>Pieces</th>
                  <th>Load Type</th>
                </tr>
              </thead>
              <tbody>
                {lanes.map((lane) => {
                  const wt = lane.totalWeight;
                  const lt = loadType(wt);
                  return (
                    <tr key={lane.laneKey}>
                      <td style={{ fontWeight: 600, color: "var(--text)" }}>{lane.laneKey}</td>
                      <td>{lane.orderIds.length}</td>
                      <td>
                        <input
                          value={getLaneField(lane.laneKey, "originZip", lane.originZip)}
                          onChange={(e) => setLaneField(lane.laneKey, "originZip", e.target.value)}
                          placeholder="Origin ZIP"
                          maxLength={5}
                          style={{ width: 80 }}
                        />
                      </td>
                      <td>
                        <input
                          value={getLaneField(lane.laneKey, "destZip", lane.destZip)}
                          onChange={(e) => setLaneField(lane.laneKey, "destZip", e.target.value)}
                          placeholder="Dest ZIP"
                          maxLength={5}
                          style={{ width: 80 }}
                        />
                      </td>
                      <td>
                        <select
                          value={getLaneField(lane.laneKey, "freightClass", lane.freightClass)}
                          onChange={(e) => setLaneField(lane.laneKey, "freightClass", e.target.value)}
                        >
                          {["50","55","60","65","70","77.5","85","92.5","100","110","125","150","175","200","250","300","400","500"].map((fc) => (
                            <option key={fc} value={fc}>{fc}</option>
                          ))}
                        </select>
                      </td>
                      <td>{wt.toLocaleString()}</td>
                      <td>{lane.totalPieces}</td>
                      <td>
                        <span className={lt === "TL" ? "badge badge-blue" : "badge badge-amber"}>
                          {lt}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Optimize + actions */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16, gap: 10, flexWrap: "wrap" }}>
          <button className="btn btn-secondary" onClick={() => setStep("select")}>
            &larr; Back to Orders
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)" }}>
              Optimize by:{" "}
              <select
                value={optimizeBy}
                onChange={(e) => setOptimizeBy(e.target.value)}
                style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 12, fontFamily: "inherit" }}
              >
                <option value="cost">Lowest Cost</option>
                <option value="transit">Fastest Transit</option>
              </select>
            </label>
            <button
              className="btn btn-primary"
              disabled={busy || lanes.length === 0}
              onClick={onRate}
            >
              {busy ? "Rating..." : `Rate All ${lanes.length} Lane${lanes.length !== 1 ? "s" : ""}`} &rarr;
            </button>
          </div>
        </div>
      </>
    );
  }

  /* ── Step 3: Rate Shopping ── */
  function renderRates() {
    const payload = buildLanesPayload();
    return (
      <>
        {rateResults.length === 0 ? (
          <div className="card" style={{ padding: 30, textAlign: "center", color: "var(--text3)" }}>
            No rate results yet. Go to Lane Groups and click Rate.
          </div>
        ) : (
          lanes.map((lane) => {
            const rated = rateResults.find((r) => r.laneKey === lane.laneKey);
            const quotes = rated?.quotes || [];
            const best = rated?.bestQuote;
            const pl = payload.find((l) => l.laneKey === lane.laneKey);
            return (
              <div key={lane.laneKey} className="card" style={{ marginBottom: 16 }}>
                <div className="card-header">
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className="card-title">{lane.laneKey}</span>
                    <span className={loadType(lane.totalWeight) === "TL" ? "badge badge-blue" : "badge badge-amber"}>
                      {loadType(lane.totalWeight)}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text3)" }}>
                      {lane.orderIds.length} order{lane.orderIds.length !== 1 ? "s" : ""} &middot; {lane.totalWeight.toLocaleString()} lbs
                    </span>
                  </div>
                  {best && (
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#059669" }}>
                      Best: {best.carrier} &middot; {fmt$(best.totalCharge)}
                    </span>
                  )}
                </div>
                <div className="card-body" style={{ padding: 0 }}>
                  {quotes.length === 0 ? (
                    <div style={{ padding: 20, textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
                      No quotes returned for this lane
                    </div>
                  ) : (
                    <table className="grid" style={{ borderRadius: 0, border: "none", boxShadow: "none" }}>
                      <thead>
                        <tr>
                          <th>Carrier</th>
                          <th>Mode</th>
                          <th>Base Rate</th>
                          <th>FSC</th>
                          <th>Total</th>
                          <th>Transit (days)</th>
                          <th>Discount</th>
                          <th>Best</th>
                        </tr>
                      </thead>
                      <tbody>
                        {quotes.map((quote, i) => {
                          const isBest = best && quote.carrier === best.carrier && quote.totalCharge === best.totalCharge;
                          return (
                            <tr key={i} style={isBest ? { background: "rgba(5,150,105,0.06)" } : undefined}>
                              <td style={{ fontWeight: 600 }}>{quote.carrier || "-"}</td>
                              <td>
                                <span className={quote.mode === "TL" ? "badge badge-blue" : "badge badge-amber"}>
                                  {quote.mode || "-"}
                                </span>
                              </td>
                              <td>{quote.baseRate ? fmt$(quote.baseRate) : "-"}</td>
                              <td>{quote.fsc ? fmt$(quote.fsc) : "-"}</td>
                              <td style={{ fontWeight: 700 }}>{quote.totalCharge ? fmt$(quote.totalCharge) : "-"}</td>
                              <td>{quote.transitDays ?? "-"}</td>
                              <td>{quote.discount ? `${quote.discount}%` : "-"}</td>
                              <td>
                                {isBest && (
                                  <span className="badge badge-green">Best</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            );
          })
        )}

        {/* Nav */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16, gap: 10 }}>
          <button className="btn btn-secondary" onClick={() => setStep("lanes")}>
            &larr; Back to Lanes
          </button>
          <button
            className="btn btn-primary"
            disabled={rateResults.length === 0}
            onClick={() => setStep("summary")}
          >
            Next: Plan Summary &rarr;
          </button>
        </div>
      </>
    );
  }

  /* ── Step 4: Plan Summary ── */
  function renderSummary() {
    const payload = buildLanesPayload();
    const totalCost = rateResults.reduce((s, r) => s + (r.bestQuote?.totalCharge || 0), 0);
    const readyCount = rateResults.filter((r) => r.bestQuote).length;

    return (
      <>
        <div className="stat-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          <div className="stat-card blue">
            <div className="stat-label">Lanes</div>
            <div className="stat-value">{lanes.length}</div>
          </div>
          <div className="stat-card green">
            <div className="stat-label">Orders</div>
            <div className="stat-value">{selectionSummary.count}</div>
          </div>
          <div className="stat-card" style={{ borderLeft: "4px solid #059669" }}>
            <div className="stat-label">Est. Total Cost</div>
            <div className="stat-value">{fmt$(totalCost)}</div>
          </div>
          <div className="stat-card" style={{ borderLeft: "4px solid #8b5cf6" }}>
            <div className="stat-label">Ready to Execute</div>
            <div className="stat-value">{readyCount} / {lanes.length}</div>
          </div>
        </div>

        {/* Summary table with date inputs */}
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Lane</th>
                <th>Carrier</th>
                <th>Mode</th>
                <th>Cost</th>
                <th>Transit</th>
                <th>Pickup Date</th>
                <th>Delivery Date</th>
              </tr>
            </thead>
            <tbody>
              {lanes.map((lane) => {
                const rated = rateResults.find((r) => r.laneKey === lane.laneKey);
                const best = rated?.bestQuote;
                return (
                  <tr key={lane.laneKey}>
                    <td style={{ fontWeight: 600, color: "var(--text)" }}>{lane.laneKey}</td>
                    <td>{best?.carrier || "-"}</td>
                    <td>
                      {best?.mode ? (
                        <span className={best.mode === "TL" ? "badge badge-blue" : "badge badge-amber"}>
                          {best.mode}
                        </span>
                      ) : "-"}
                    </td>
                    <td style={{ fontWeight: 700 }}>{best?.totalCharge ? fmt$(best.totalCharge) : "-"}</td>
                    <td>{best?.transitDays ? `${best.transitDays} days` : "-"}</td>
                    <td>
                      <input
                        type="date"
                        value={pickupDates[lane.laneKey] || ""}
                        onChange={(e) => setPickupDates((prev) => ({ ...prev, [lane.laneKey]: e.target.value }))}
                      />
                    </td>
                    <td>
                      <input
                        type="date"
                        value={deliveryDates[lane.laneKey] || best?.deliveryDate || ""}
                        onChange={(e) => setDeliveryDates((prev) => ({ ...prev, [lane.laneKey]: e.target.value }))}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Execute results */}
        {executeResults && (
          <div className="card" style={{ marginTop: 16, border: "1px solid #86efac" }}>
            <div className="card-body" style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 22 }}>&#9989;</span>
              <div>
                <div style={{ fontWeight: 700, color: "#059669", fontSize: 14 }}>
                  Plan Executed Successfully
                </div>
                <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 2 }}>
                  {executeResults?.shipments?.length || 0} shipment(s) created &middot; {executeResults?.ordersUpdated || 0} order(s) updated
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Nav */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16, gap: 10 }}>
          <button className="btn btn-secondary" onClick={() => setStep("rates")}>
            &larr; Back to Rates
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || readyCount === 0}
            onClick={onExecute}
            style={readyCount > 0 ? { background: "linear-gradient(135deg,#059669,#10b981)", border: "none" } : undefined}
          >
            {busy ? "Executing..." : `Execute Plan (${readyCount} lane${readyCount !== 1 ? "s" : ""})`}
          </button>
        </div>
      </>
    );
  }

  /* ═══════════════════════════════════════════
     MAIN RENDER
  ═══════════════════════════════════════════ */
  return (
    <div>
      {/* Page Header */}
      <div className="page-header" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div className="page-title">&#9889; Bulk Planning Workbench</div>
            <div className="page-sub">Select orders, consolidate by lane, rate-shop, and execute in batch</div>
          </div>
          <div className="header-actions">
            {step === "summary" && rateResults.length > 0 && (
              <button
                className="btn btn-sm"
                style={{ background: "linear-gradient(135deg,#059669,#10b981)", color: "#fff", fontWeight: 600, border: "none" }}
                disabled={busy}
                onClick={onExecute}
              >
                &#9889; Execute Plan
              </button>
            )}
          </div>
        </div>
        {/* Step Tabs */}
        <div style={{ display: "flex", gap: 6 }}>
          {STEPS.map((s) => (
            <button
              key={s.id}
              className={`ord-chip ${step === s.id ? "active-chip" : ""}`}
              onClick={() => setStep(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Page Content */}
      <div className="page-content">
        {/* Toast message */}
        {message.text && (
          <div
            style={{
              padding: "10px 16px",
              borderRadius: 10,
              marginBottom: 16,
              fontSize: 13,
              fontWeight: 600,
              background: message.type === "error" ? "#fee2e2" : message.type === "success" ? "#dcfce7" : message.type === "warning" ? "#fef9c3" : "#dbeafe",
              color: message.type === "error" ? "#991b1b" : message.type === "success" ? "#14532d" : message.type === "warning" ? "#854d0e" : "#1e3a8a",
              border: `1px solid ${message.type === "error" ? "#fca5a5" : message.type === "success" ? "#86efac" : message.type === "warning" ? "#fde047" : "#93c5fd"}`,
            }}
          >
            {message.text}
          </div>
        )}

        {step === "select" && renderSelectOrders()}
        {step === "lanes" && renderLaneGroups()}
        {step === "rates" && renderRates()}
        {step === "summary" && renderSummary()}
      </div>
    </div>
  );
}
