import { MODE_COLORS } from "./constants";
import { calcTotalMiles } from "./routeCalculations";
import { fmt$ } from "./routeFormatters";

/**
 * RouteCard — full-width horizontal row card for a route template.
 */
export default function RouteCard({ route, calcCost, onView, onEdit, onDelete, onExecute }) {
  const stops = Array.isArray(route.stops) ? route.stops : [];
  const miles = route.total_miles || calcTotalMiles(stops);
  const cost = calcCost(route);
  const modeColor = MODE_COLORS[route.mode] || "#3b82f6";

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 12,
        border: "1px solid var(--border)",
        cursor: "pointer",
        transition: "all 0.15s ease",
        boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
        display: "flex",
        alignItems: "stretch",
        overflow: "hidden",
      }}
      onClick={() => onView(route)}
      onMouseOver={(e) => { e.currentTarget.style.boxShadow = "0 4px 16px rgba(15,23,42,0.08)"; e.currentTarget.style.borderColor = "#93C5FD"; }}
      onMouseOut={(e) => { e.currentTarget.style.boxShadow = "0 1px 2px rgba(15,23,42,0.04)"; e.currentTarget.style.borderColor = "var(--border)"; }}
    >
      {/* Left accent bar */}
      <div style={{ width: 4, background: modeColor, flexShrink: 0 }} />

      {/* Route info */}
      <div style={{ padding: "14px 20px", flex: "0 0 220px", borderRight: "1px solid #F1F5F9" }}>
        <div style={{ fontSize: 10, color: "var(--text3)", letterSpacing: 0.6, fontWeight: 600 }}>{route.id}</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginTop: 2 }}>{route.name || "Untitled Route"}</div>
        {route.carrier && <div style={{ fontSize: 11, color: "var(--text3)", fontWeight: 500, marginTop: 4 }}>Carrier: {route.carrier}</div>}
      </div>

      {/* Badges */}
      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 6, flex: "0 0 90px", borderRight: "1px solid #F1F5F9" }}>
        <span style={{ padding: "2px 8px", borderRadius: 12, fontSize: 10, fontWeight: 700, background: modeColor + "18", color: modeColor, border: `1px solid ${modeColor}33`, textAlign: "center" }}>
          {route.mode || "TL"}
        </span>
        <span className={route.status === "Active" ? "badge badge-green" : "badge badge-red"} style={{ fontSize: 10, justifyContent: "center" }}>
          {route.status}
        </span>
      </div>

      {/* Stops list */}
      <div style={{ padding: "10px 20px", flex: 1, display: "flex", alignItems: "center", gap: 16, borderRight: "1px solid #F1F5F9", overflow: "hidden" }}>
        {stops.map((stop, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
            <div style={{ width: 18, height: 18, borderRadius: "50%", background: stop.type === "pickup" ? "var(--accent)" : "var(--green)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, flexShrink: 0 }}>
              {stop.sequence}
            </div>
            <div style={{ fontSize: 12, color: "var(--text2)" }}>
              <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", color: stop.type === "pickup" ? "var(--accent)" : "var(--green)", marginRight: 3 }}>{stop.type === "pickup" ? "P" : "D"}</span>
              {stop.location || "\u2014"}
            </div>
            {i < stops.length - 1 && <span style={{ color: "var(--border2)", fontSize: 12, marginLeft: 4 }}>\u2192</span>}
          </div>
        ))}
      </div>

      {/* Stats */}
      <div style={{ padding: "10px 20px", display: "flex", alignItems: "center", gap: 20, flex: "0 0 auto", borderRight: "1px solid #F1F5F9" }}>
        {[
          { label: "Stops", value: stops.length },
          { label: "Miles", value: miles.toLocaleString(), mono: true },
          { label: "Cost", value: cost > 0 ? fmt$(cost) : "\u2014", mono: true, green: true },
        ].map((stat) => (
          <div key={stat.label} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 9, color: "var(--text3)", fontWeight: 600, textTransform: "uppercase" }}>{stat.label}</div>
            <div style={{ fontSize: 14, fontWeight: 700, fontFamily: stat.mono ? "'JetBrains Mono', monospace" : undefined, color: stat.green ? "var(--green)" : "var(--text)" }}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 6 }} onClick={(e) => e.stopPropagation()}>
        <button className="btn btn-sm btn-primary" onClick={() => onExecute(route)} style={{ fontSize: 11, borderRadius: 6 }}>Execute</button>
        <button className="btn btn-sm" onClick={() => onEdit(route)} style={{ fontSize: 11, borderRadius: 6 }}>Edit</button>
        <button className="btn btn-sm" onClick={() => onDelete(route.id)} style={{ fontSize: 11, borderRadius: 6, color: "var(--red)" }}>Delete</button>
      </div>
    </div>
  );
}
