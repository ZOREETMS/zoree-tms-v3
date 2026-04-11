import StopsEditor from "./StopsEditor";
import { MODE_OPTIONS, STATUS_OPTIONS } from "./constants";
import { fmt$, formatTransitTime } from "./routeFormatters";
import { calcTotalMiles, calcLegTransitHours } from "./routeCalculations";
import { calcCost } from "./routeService";

/**
 * RouteEditModal -- add / edit modal for a route template.
 * All business-logic helpers are imported from local modules.
 */
export default function RouteEditModal({
  editRoute,
  setEditRoute,
  carriers,
  locations,
  legMiles,
  fetchingMiles,
  validationErrors,
  setValidationErrors,
  saving,
  onSave,
  onClose,
  message,
  rates,
  isNew,
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 720 }}
      >
        <div className="modal-header">
          <div>
            <div style={{ fontSize: 10, opacity: 0.6, letterSpacing: 1 }}>
              {isNew ? "NEW ROUTE TEMPLATE" : "EDIT ROUTE TEMPLATE"}
            </div>
            <h3>{editRoute.id}</h3>
          </div>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div
          className="modal-body"
          style={{ maxHeight: "75vh", overflowY: "auto" }}
        >
          {/* Inline toast for modal errors */}
          {message.text && message.type === "error" && (
            <div
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                marginBottom: 14,
                fontSize: 13,
                fontWeight: 600,
                background: "#FEF2F2",
                color: "#B91C1C",
                border: "1px solid #FECACA",
              }}
            >
              {message.text}
            </div>
          )}

          {/* Basic Info */}
          <div className="form-row">
            <div className="form-group">
              <label
                className="form-label"
                style={
                  validationErrors.name ? { color: "#DC2626" } : undefined
                }
              >
                Route Name *
              </label>
              <input
                type="text"
                value={editRoute.name}
                onChange={(e) => {
                  setEditRoute({ ...editRoute, name: e.target.value });
                  if (validationErrors.name)
                    setValidationErrors((v) => ({ ...v, name: false }));
                }}
                placeholder="e.g., PHX-Memphis-Nashville"
                style={
                  validationErrors.name
                    ? {
                        borderColor: "#DC2626",
                        boxShadow: "0 0 0 3px rgba(220,38,38,0.08)",
                      }
                    : undefined
                }
              />
            </div>
            <div className="form-group">
              <label className="form-label">Carrier</label>
              <select
                value={editRoute.carrier}
                onChange={(e) =>
                  setEditRoute({ ...editRoute, carrier: e.target.value })
                }
              >
                <option value="">Select Carrier</option>
                {(carriers || []).map((c) => (
                  <option key={c.id || c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div
            className="form-row"
            style={{ gridTemplateColumns: "1fr 1fr 1fr" }}
          >
            <div className="form-group">
              <label className="form-label">Mode</label>
              <select
                value={editRoute.mode}
                onChange={(e) =>
                  setEditRoute({ ...editRoute, mode: e.target.value })
                }
              >
                {MODE_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Max Weight (lbs)</label>
              <input
                type="number"
                value={editRoute.max_weight}
                onChange={(e) =>
                  setEditRoute({
                    ...editRoute,
                    max_weight: Number(e.target.value),
                  })
                }
              />
            </div>
            <div className="form-group">
              <label className="form-label">Status</label>
              <select
                value={editRoute.status}
                onChange={(e) =>
                  setEditRoute({ ...editRoute, status: e.target.value })
                }
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Stops */}
          <div style={{ margin: "18px 0" }}>
            <StopsEditor
              stops={editRoute.stops}
              locations={locations || []}
              onChange={(stops) => {
                setEditRoute({ ...editRoute, stops });
                setValidationErrors({});
              }}
              legMiles={legMiles}
              fetchingMiles={fetchingMiles}
              validationErrors={validationErrors}
            />
          </div>

          {/* Cost Section */}
          <div
            style={{
              padding: "14px 16px",
              background: "#f8faff",
              borderRadius: 10,
              border: "1px solid var(--border)",
              marginBottom: 14,
            }}
          >
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
              Cost & Mileage
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 14,
                marginBottom: 16,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--text3)",
                    fontWeight: 600,
                    marginBottom: 4,
                  }}
                >
                  AUTO-CALCULATED MILES
                </div>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  {fetchingMiles
                    ? "..."
                    : (() => {
                        const total = legMiles.reduce(
                          (s, l) => s + (l.miles || 0),
                          0
                        );
                        return total > 0
                          ? `${total.toLocaleString()} mi`
                          : "0 mi";
                      })()}
                </div>
              </div>
              <div>
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--text3)",
                    fontWeight: 600,
                    marginBottom: 4,
                  }}
                >
                  AUTO TRANSIT EST.
                </div>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    fontFamily: "'JetBrains Mono', monospace",
                    color: "var(--accent)",
                  }}
                >
                  {fetchingMiles
                    ? "..."
                    : (() => {
                        const totalMiles = legMiles.reduce(
                          (s, l) => s + (l.miles || 0),
                          0
                        );
                        const totalHours = calcLegTransitHours(totalMiles);
                        return totalHours > 0
                          ? formatTransitTime(totalHours)
                          : "--";
                      })()}
                </div>
              </div>
              <div>
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--text3)",
                    fontWeight: 600,
                    marginBottom: 4,
                  }}
                >
                  ESTIMATED COST
                </div>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    fontFamily: "'JetBrains Mono', monospace",
                    color: "var(--green)",
                  }}
                >
                  {fmt$(
                    calcCost({ ...editRoute, cost_override: "" }, rates)
                  )}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 14 }}>
              <div className="form-group">
                <label className="form-label">Total Miles</label>
                <input type="number" value={editRoute.miles_override || ""}
                  onChange={(e) => setEditRoute({ ...editRoute, miles_override: e.target.value })}
                  placeholder="Auto" style={{ height: 32, fontSize: 13, width: 100 }} />
              </div>
              <div className="form-group">
                <label className="form-label">Transit Days</label>
                <input type="number" value={editRoute.transit_days || ""}
                  onChange={(e) => setEditRoute({ ...editRoute, transit_days: e.target.value })}
                  placeholder="e.g., 2" step="0.5" style={{ height: 32, fontSize: 13, width: 80 }} />
              </div>
              <div className="form-group">
                <label className="form-label">Cost ($)</label>
                <input type="number" value={editRoute.cost_override || ""}
                  onChange={(e) => setEditRoute({ ...editRoute, cost_override: e.target.value })}
                  placeholder="Auto" step="0.01" style={{ height: 32, fontSize: 13, width: 100 }} />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea
              value={editRoute.notes || ""}
              onChange={(e) =>
                setEditRoute({ ...editRoute, notes: e.target.value })
              }
              placeholder="Optional notes about this route..."
              rows={2}
              style={{ resize: "vertical" }}
            />
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={onSave}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save Route"}
          </button>
        </div>
      </div>
    </div>
  );
}
