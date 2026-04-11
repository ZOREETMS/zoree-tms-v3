import { STOP_TYPES } from "./constants";
import { calcLegTransitHours } from "./routeCalculations";
import { recalcLoadSeq } from "./routeFactory";

/**
 * StopsEditor — ordered stop list with city/state inputs,
 * per-leg miles/transit, stop/load sequence, and reorder controls.
 */
export default function StopsEditor({ stops, locations, onChange, legMiles = [], fetchingMiles = false, validationErrors = {} }) {
  function updateStop(idx, field, val) {
    const next = stops.map((s, i) => (i === idx ? { ...s, [field]: val } : s));
    onChange(field === "stop_seq" ? recalcLoadSeq(next) : next);
  }

  function updateStopFields(idx, fields) {
    const next = stops.map((s, i) => (i === idx ? { ...s, ...fields } : s));
    onChange(next);
  }

  function addStop() {
    const next = [
      ...stops,
      { sequence: stops.length + 1, city: "", state: "", location: "", type: "delivery", stop_seq: stops.length + 1, load_seq: 1, lat: null, lng: null },
    ];
    onChange(recalcLoadSeq(next));
  }

  function removeStop(idx) {
    if (stops.length <= 2) return;
    onChange(recalcLoadSeq(stops.filter((_, i) => i !== idx)));
  }

  function moveStop(idx, dir) {
    const ni = idx + dir;
    if (ni < 0 || ni >= stops.length) return;
    const next = [...stops];
    [next[idx], next[ni]] = [next[ni], next[idx]];
    onChange(recalcLoadSeq(next));
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--text2)" }}>
          Stops / Cities ({stops.length})
        </div>
        <button
          type="button"
          className="btn btn-sm"
          onClick={addStop}
          style={{ fontSize: 11, padding: "4px 10px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
        >
          + Add Stop
        </button>
      </div>

      {stops.map((stop, idx) => {
        const leg = idx > 0 ? (legMiles[idx - 1] || {}) : {};
        const miles = leg.miles || 0;
        const hours = calcLegTransitHours(miles);
        return (
          <div key={idx}>
            {/* Leg connector with miles/transit inputs */}
            {idx > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0 6px 34px", fontSize: 11, color: "var(--text3)" }}>
                <div style={{ width: 2, height: 20, background: (stop.leg_miles || miles) > 0 ? "var(--accent)" : "var(--border2)", marginLeft: -22, borderRadius: 1 }} />
                <input type="number" value={stop.leg_miles || ""} onChange={(e) => updateStop(idx, "leg_miles", e.target.value)}
                  placeholder={miles > 0 ? String(miles) : "miles"}
                  style={{ width: 70, padding: "3px 6px", fontSize: 11, borderRadius: 6, border: "1px solid var(--border)", background: "#FAFBFC", height: 26, textAlign: "center" }} />
                <span style={{ fontSize: 10, color: "var(--text3)" }}>mi</span>
                <span style={{ color: "var(--border2)", margin: "0 2px" }}>|</span>
                <input type="number" value={stop.leg_transit_hrs || ""} onChange={(e) => updateStop(idx, "leg_transit_hrs", e.target.value)}
                  placeholder={hours > 0 ? String(hours) : "hrs"} step="0.5"
                  style={{ width: 60, padding: "3px 6px", fontSize: 11, borderRadius: 6, border: "1px solid var(--border)", background: "#FAFBFC", height: 26, textAlign: "center" }} />
                <span style={{ fontSize: 10, color: "var(--text3)" }}>hrs transit</span>
              </div>
            )}

            {/* Stop row */}
            <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 10px", background: idx === 0 ? "rgba(59,130,246,0.04)" : "#f8faff", borderRadius: 8, border: "1px solid var(--border)" }}>
              {/* Sequence circle */}
              <div style={{ width: 24, height: 24, borderRadius: "50%", background: stop.type === "pickup" ? "var(--accent)" : "var(--green)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                {stop.sequence}
              </div>

              {/* Type selector */}
              <select value={stop.type} onChange={(e) => updateStop(idx, "type", e.target.value)}
                style={{ width: 100, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border2)", fontSize: 11, flexShrink: 0 }}>
                {STOP_TYPES.map((t) => (<option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>))}
              </select>

              {/* City input */}
              <input type="text" value={stop.city || ""}
                onChange={(e) => {
                  const city = e.target.value;
                  const loc = city && stop.state ? `${city}, ${stop.state}` : city || "";
                  updateStopFields(idx, { city, location: loc });
                }}
                placeholder="City"
                style={{ flex: 1, minWidth: 0, ...(validationErrors[`stop_${idx}`] && !stop.city?.trim() ? { borderColor: "#DC2626", boxShadow: "0 0 0 3px rgba(220,38,38,0.08)" } : {}) }} />

              {/* State input */}
              <input type="text" value={stop.state || ""}
                onChange={(e) => {
                  const state = e.target.value.toUpperCase();
                  const loc = stop.city && state ? `${stop.city}, ${state}` : stop.city || "";
                  updateStopFields(idx, { state, location: loc });
                }}
                placeholder="ST" maxLength={2}
                style={{ width: 55, flexShrink: 0, textAlign: "center", ...(validationErrors[`stop_${idx}`] && !stop.state?.trim() ? { borderColor: "#DC2626", boxShadow: "0 0 0 3px rgba(220,38,38,0.08)" } : {}) }} />

              {/* Stop sequence */}
              <div style={{ display: "flex", flexDirection: "column", gap: 1, flexShrink: 0, alignItems: "center" }}>
                <span style={{ fontSize: 8, color: "var(--text3)", fontWeight: 600, letterSpacing: "0.04em" }}>STOP#</span>
                <input type="number" value={stop.stop_seq || stop.sequence || ""} onChange={(e) => updateStop(idx, "stop_seq", e.target.value)}
                  title="Stop Sequence" min="1" style={{ width: 42, textAlign: "center", fontSize: 12, padding: "0 2px", fontWeight: 600 }} />
              </div>

              {/* Load sequence (delivery only) */}
              {stop.type === "delivery" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 1, flexShrink: 0, alignItems: "center" }}>
                  <span style={{ fontSize: 8, color: "var(--text3)", fontWeight: 600, letterSpacing: "0.04em" }}>LOAD#</span>
                  <input type="number" value={stop.load_seq || ""} onChange={(e) => updateStop(idx, "load_seq", e.target.value)}
                    title="Load Sequence" min="1" style={{ width: 42, textAlign: "center", fontSize: 12, padding: "0 2px", fontWeight: 600 }} />
                </div>
              ) : (
                <div style={{ width: 42, flexShrink: 0 }} />
              )}

              {/* Move/Delete controls */}
              <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                <button type="button" onClick={() => moveStop(idx, -1)} disabled={idx === 0} title="Move up"
                  style={{ border: "none", background: "transparent", cursor: idx === 0 ? "default" : "pointer", opacity: idx === 0 ? 0.3 : 1, fontSize: 14, padding: "2px 4px" }}>▲</button>
                <button type="button" onClick={() => moveStop(idx, 1)} disabled={idx === stops.length - 1} title="Move down"
                  style={{ border: "none", background: "transparent", cursor: idx === stops.length - 1 ? "default" : "pointer", opacity: idx === stops.length - 1 ? 0.3 : 1, fontSize: 14, padding: "2px 4px" }}>▼</button>
                <button type="button" onClick={() => removeStop(idx)} disabled={stops.length <= 2} title="Remove stop"
                  style={{ border: "none", background: "transparent", cursor: stops.length <= 2 ? "default" : "pointer", opacity: stops.length <= 2 ? 0.3 : 1, fontSize: 14, padding: "2px 4px", color: "var(--red)" }}>✕</button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
