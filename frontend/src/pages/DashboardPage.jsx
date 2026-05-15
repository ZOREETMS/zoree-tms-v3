import { useMemo } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
// QA P217 (2026-05-11): shared stats so the web and mobile dashboards
// agree. The function lives in services/analyticsService.js with
// synced copies in shared/ and mobile/src/shared/ — keep them in
// lockstep until the repo finishes consolidating onto one module.
import { computeDashboardStats } from "../services/analyticsService";

export default function DashboardPage() {
  const { shipments, orders, carriers, refreshData } = useOutletContext();
  const navigate = useNavigate();

  const stats = useMemo(
    () => computeDashboardStats(shipments, orders),
    [shipments, orders],
  );

  const carrierVolume = useMemo(() => {
    const map = {};
    shipments.forEach(s => { const c = s.carrier || "Unknown"; map[c] = (map[c] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [shipments]);
  const maxVol = carrierVolume.length > 0 ? carrierVolume[0][1] : 1;

  const today = new Date();
  const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const dateStr = `${days[today.getDay()]}, ${months[today.getMonth()]} ${today.getDate()}, ${today.getFullYear()}`;

  const costDisplay = stats.totalCost >= 1000 ? "$" + Math.round(stats.totalCost / 1000) + "K" : "$" + stats.totalCost.toLocaleString();

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-sub">{dateStr} · All Regions</div>
        </div>
        <div className="header-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => refreshData && refreshData()}>↻ Sync</button>
          <button className="btn btn-secondary btn-sm">📥 Export</button>
          <button className="btn btn-primary btn-sm" onClick={() => navigate("/shipments")}>+ New Shipment</button>
        </div>
      </div>

      <div className="page-content">
        {/* ── Stat Cards ── */}
        <div className="stat-grid">
          <div className="stat-card blue">
            {/* QA follow-up: the label here used to read "Active
                Shipments", but the value below is the unfiltered total
                of every row in the shipments table — including
                Delivered and Cancelled. HomePage.jsx applies a real
                active-only filter (status !== "Delivered" &&
                status !== "Cancelled"), so the two pages disagreed by
                exactly the Delivered+Cancelled count (e.g. 500 here
                vs 417 there). Renaming to "Total Shipments" makes the
                card honest about what it counts; the in-transit
                number beneath it carries the "of which actually
                moving" context that the old label was implying. The
                in-transit count comes from computeDashboardStats —
                same helper Home reads, so the sub-stat stays in
                lockstep across pages. */}
            <div className="stat-label">Total Shipments</div>
            <div className="stat-value">{shipments.length}</div>
            <div className="stat-delta"><span className="up">↑ {stats.inTransit}</span> in transit</div>
          </div>
          <div className="stat-card green">
            <div className="stat-label">On-Time Delivery</div>
            <div className="stat-value">{stats.onTimePct}%</div>
            <div className="stat-delta">{stats.delivered} delivered</div>
          </div>
          <div className="stat-card yellow">
            <div className="stat-label">Freight Spend (MTD)</div>
            <div className="stat-value">{costDisplay}</div>
            <div className="stat-delta">{shipments.length} shipments</div>
          </div>
          <div className="stat-card red">
            <div className="stat-label">Exceptions</div>
            <div className="stat-value">{stats.exceptions}</div>
            <div className="stat-delta"><span className="down">↑ {stats.unplanned}</span> orders unplanned</div>
          </div>
        </div>

        {/* ── Row 2: Status Breakdown + Spend Trend ── */}
        <div className="two-col" style={{ marginBottom: 16 }}>
          <div className="card" style={{ padding: 0 }}>
            <div className="card-header">
              <span className="card-title">Shipment Status Breakdown</span>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate("/shipments")}>View all →</button>
            </div>
            <div className="card-body">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[
                  { val: stats.inTransit, label: "IN TRANSIT", color: "#22d3ee" },
                  { val: stats.planned, label: "PLANNED", color: "#818cf8" },
                  { val: stats.tendered, label: "TENDERED", color: "#fbbf24" },
                  { val: stats.exceptions, label: "EXCEPTIONS", color: "#fb923c" },
                ].map((item) => (
                  <div key={item.label} style={{ textAlign: "center", padding: 14, background: "var(--bg3)", borderRadius: 10 }}>
                    <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 26, fontWeight: 800, color: item.color }}>{item.val}</div>
                    <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>{item.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 0 }}>
            <div className="card-header">
              <span className="card-title">Freight Spend Trend (7 days)</span>
            </div>
            <div className="card-body">
              <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 60 }}>
                {[35, 42, 28, 51, 39, 45, 40].map((v, i) => (
                  <div key={i} style={{
                    flex: 1, background: "var(--accent)",
                    borderRadius: "3px 3px 0 0", opacity: 0.7, minWidth: 8,
                    height: `${(v / 51) * 100}%`
                  }} />
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
                <span style={{ fontSize: 11, color: "var(--text3)" }}>7 days ago</span>
                <span style={{ fontSize: 11, color: "var(--text3)" }}>Today</span>
              </div>
              <div style={{ marginTop: 12, display: "flex", gap: 20 }}>
                <div>
                  <div style={{ fontSize: 10, color: "var(--text3)" }}>AVG DAILY</div>
                  <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 18, fontWeight: 700 }}>
                    ${stats.totalCost > 0 ? Math.round(stats.totalCost / 7).toLocaleString() : "0"}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "var(--text3)" }}>TOTAL</div>
                  <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 18, fontWeight: 700, color: "var(--yellow)" }}>
                    ${stats.totalCost.toLocaleString()}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Row 3: Alerts + Carrier Volume ── */}
        <div className="two-col">
          <div className="card" style={{ padding: 0 }}>
            <div className="card-header">
              <span className="card-title">Recent Alerts</span>
              <button className="btn btn-ghost btn-sm">View all →</button>
            </div>
            <div className="card-body" style={{ padding: 12 }}>
              {stats.exceptions > 0 && (
                <div className="alert alert-danger">
                  <span className="alert-icon">🚨</span>
                  <div className="alert-text">
                    <div className="alert-title">{stats.exceptions} Shipment Exception{stats.exceptions > 1 ? "s" : ""}</div>
                    Needs immediate attention. Check shipments page.
                  </div>
                </div>
              )}
              {stats.unplanned > 0 && (
                <div className="alert alert-warning">
                  <span className="alert-icon">⚠️</span>
                  <div className="alert-text">
                    <div className="alert-title">{stats.unplanned} Orders Unplanned</div>
                    Orders need planning. Use Bulk Plan to optimize.
                  </div>
                </div>
              )}
              <div className="alert alert-info" style={{ marginBottom: 0 }}>
                <span className="alert-icon">ℹ️</span>
                <div className="alert-text">
                  <div className="alert-title">{stats.planned} Shipments due for tendering today</div>
                  Optimal window closes at 5:00 PM CST.
                </div>
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 0 }}>
            <div className="card-header">
              <span className="card-title">Top Carriers by Volume (MTD)</span>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate("/carriers")}>View all →</button>
            </div>
            <div className="card-body">
              {carrierVolume.length === 0 ? (
                <div style={{ color: "var(--text3)", fontSize: 13, textAlign: "center", padding: 20 }}>No shipments yet</div>
              ) : carrierVolume.map(([name, count], i) => (
                <div key={name} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, color: "var(--text)" }}>{name}</span>
                    <span style={{ color: "var(--text3)", fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{count} shipment{count > 1 ? "s" : ""}</span>
                  </div>
                  <div className="progress-wrap">
                    <div className="progress-bar" style={{
                      width: `${(count / maxVol) * 100}%`,
                      background: i === 0 ? "var(--accent)" : i === 1 ? "#818cf8" : "var(--green)"
                    }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
