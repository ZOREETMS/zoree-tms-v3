import { calcTotalMiles } from "./routeCalculations";
import { fmt$ } from "./routeFormatters";

/**
 * RouteDetailModal -- read-only detail view for a route template.
 */
export default function RouteDetailModal({ route, onClose, onEdit, calcCost }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 600 }}
      >
        <div className="modal-header">
          <div>
            <div style={{ fontSize: 10, opacity: 0.6, letterSpacing: 1 }}>
              ROUTE DETAILS
            </div>
            <h3>{route.name || route.id}</h3>
          </div>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          {/* Info Grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 14,
              marginBottom: 20,
            }}
          >
            {[
              { label: "Mode", value: route.mode },
              { label: "Carrier", value: route.carrier || "\u2014" },
              { label: "Status", value: route.status },
              {
                label: "Max Weight",
                value: `${(route.max_weight || 44000).toLocaleString()} lbs`,
              },
              {
                label: "Total Miles",
                value: `${(
                  route.total_miles ||
                  calcTotalMiles(route.stops || [])
                ).toLocaleString()} mi`,
              },
              {
                label: "Cost",
                value: fmt$(calcCost(route)),
              },
            ].map((item) => (
              <div key={item.label}>
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--text3)",
                    fontWeight: 700,
                    textTransform: "uppercase",
                  }}
                >
                  {item.label}
                </div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    marginTop: 4,
                    color: "var(--text)",
                  }}
                >
                  {item.value}
                </div>
              </div>
            ))}
          </div>

          {/* Stops List */}
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              color: "var(--text2)",
              marginBottom: 10,
            }}
          >
            Stops ({(route.stops || []).length})
          </div>
          {(route.stops || []).map((stop, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                background: "#f8faff",
                borderRadius: 8,
                marginBottom: 6,
                border: "1px solid var(--border)",
              }}
            >
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  background:
                    stop.type === "pickup" ? "var(--accent)" : "var(--green)",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {stop.sequence}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {stop.location || "\u2014"}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color:
                      stop.type === "pickup" ? "var(--accent)" : "var(--green)",
                    fontWeight: 700,
                    textTransform: "uppercase",
                  }}
                >
                  {stop.type}
                </div>
              </div>
              {stop.lat && stop.lng && (
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--text3)",
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  {Number(stop.lat).toFixed(2)}, {Number(stop.lng).toFixed(2)}
                </div>
              )}
            </div>
          ))}

          {route.notes && (
            <div style={{ marginTop: 14 }}>
              <div
                style={{
                  fontSize: 10,
                  color: "var(--text3)",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  marginBottom: 4,
                }}
              >
                Notes
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text2)",
                  padding: "8px 12px",
                  background: "#f8faff",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                }}
              >
                {route.notes}
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
          <button className="btn btn-primary" onClick={() => onEdit(route)}>
            Edit Route
          </button>
        </div>
      </div>
    </div>
  );
}
