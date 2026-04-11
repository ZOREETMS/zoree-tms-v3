import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

function extractCity(location) {
  if (!location) return "";
  return String(location).split(",")[0].trim().toUpperCase();
}

function buildInsights(orders, shipments) {
  const insights = [];

  /* ── 1. Consolidation: find lanes with 2+ unplanned orders ── */
  const unplanned = (orders || []).filter((o) => o.status === "Unplanned");
  const laneMap = {};
  unplanned.forEach((o) => {
    const key = `${extractCity(o.origin)}→${extractCity(o.dest)}`;
    if (!laneMap[key]) laneMap[key] = { origin: extractCity(o.origin), dest: extractCity(o.dest), orders: [] };
    laneMap[key].orders.push(o);
  });
  const consolidatable = Object.values(laneMap)
    .filter((l) => l.orders.length >= 2)
    .sort((a, b) => b.orders.length - a.orders.length);

  if (consolidatable.length > 0) {
    const top = consolidatable[0];
    insights.push({
      icon: "📦",
      iconBg: "#DBEAFE",
      title: "Consolidation opportunity detected",
      sub: (
        <>
          <span className="insight-highlight">
            {top.orders.length} {top.origin} → {top.dest}
          </span>{" "}
          orders can be consolidated
          {consolidatable.length > 1 ? ` (+${consolidatable.length - 1} more lanes)` : ""}
        </>
      ),
      action: "Review in Bulk Plan",
      to: "/bulk-plan",
    });
  }

  /* ── 2. Savings: estimate from unplanned order volume ─────── */
  const totalWeight = unplanned.reduce((s, o) => s + (parseFloat(o.weight) || 0), 0);
  if (totalWeight > 0) {
    const estSavings = Math.round(totalWeight * 0.02);
    insights.push({
      icon: "💰",
      iconBg: "#DCFCE7",
      title: "Savings opportunity identified",
      sub: (
        <>
          Estimated <span className="insight-highlight">${estSavings.toLocaleString()} savings</span> by
          consolidating {unplanned.length} unplanned orders ({totalWeight.toLocaleString()} lbs)
        </>
      ),
      action: "Plan Orders",
      to: "/bulk-plan",
    });
  }

  /* ── 3. Tender risk: planned but not tendered shipments ──── */
  const plannedNotTendered = (shipments || []).filter((s) => s.status === "Planned");
  if (plannedNotTendered.length > 0) {
    insights.push({
      icon: "⏰",
      iconBg: "#FEF3C7",
      title: "Shipments awaiting tender",
      sub: (
        <>
          <span className="insight-highlight">{plannedNotTendered.length} shipment{plannedNotTendered.length > 1 ? "s" : ""}</span>{" "}
          planned but not yet tendered to carriers
        </>
      ),
      action: "Tender Now",
      to: "/shipments",
    });
  }

  /* ── 4. Exceptions ─────────────────────────────────────────── */
  const exceptions = (shipments || []).filter((s) => s.status === "Exception");
  if (exceptions.length > 0) {
    insights.push({
      icon: "🚨",
      iconBg: "#FEE2E2",
      title: "Shipment exceptions require attention",
      sub: (
        <>
          <span className="insight-highlight">{exceptions.length} shipment{exceptions.length > 1 ? "s" : ""}</span>{" "}
          flagged with exceptions — review immediately
        </>
      ),
      action: "View Exceptions",
      to: "/shipments",
    });
  }

  /* ── Fallback if no insights ──────────────────────────────── */
  if (insights.length === 0) {
    insights.push({
      icon: "✅",
      iconBg: "#DCFCE7",
      title: "All operations running smoothly",
      sub: "No consolidation opportunities, exceptions, or pending actions detected right now.",
      action: null,
      to: null,
    });
  }

  return insights.slice(0, 3);
}

export default function InsightsCard({ orders, shipments }) {
  const navigate = useNavigate();
  const insights = useMemo(() => buildInsights(orders, shipments), [orders, shipments]);

  return (
    <div className="card" style={{ padding: 0, height: "100%" }}>
      <div className="card-header">
        <div>
          <span className="card-title">Zoree AI Insights</span>
          <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text3)", marginTop: 2, textTransform: "none" }}>
            Recommendations based on current shipments and exceptions
          </div>
        </div>
      </div>
      <div className="card-body" style={{ padding: "8px 20px 20px" }}>
        {insights.map((item, i) => (
          <div className="insight-item" key={i}>
            <div className="insight-icon-wrap" style={{ background: item.iconBg }}>
              {item.icon}
            </div>
            <div className="insight-text">
              <div className="insight-title">{item.title}</div>
              <div className="insight-sub">{item.sub}</div>
              {item.action && item.to && (
                <button className="insight-action" onClick={() => navigate(item.to)}>
                  {item.action} &rarr;
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
