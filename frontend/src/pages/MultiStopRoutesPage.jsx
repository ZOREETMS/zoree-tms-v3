import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { useOutletContext } from "react-router-dom";
import { DbApi, MileageApi } from "../lib/api";

const MODE_OPTIONS = ["TL", "LTL", "FTL"];
const STATUS_OPTIONS = ["Active", "Inactive"];
const STOP_TYPES = ["pickup", "delivery"];

const MODE_COLORS = { TL: "#3b82f6", LTL: "#8b5cf6", FTL: "#059669" };

function haversine(lat1, lng1, lat2, lng2) {
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calcLegMiles(a, b) {
  if (a.lat && a.lng && b.lat && b.lng) {
    return Math.round(haversine(a.lat, a.lng, b.lat, b.lng) * 1.3);
  }
  return 0;
}

function calcLegTransitHours(miles) {
  if (!miles) return 0;
  const AVG_MPH = 50;
  return Math.round((miles / AVG_MPH) * 10) / 10;
}

function formatTransitTime(hours) {
  if (!hours) return "--";
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function calcTotalMiles(stops) {
  let total = 0;
  for (let i = 1; i < stops.length; i++) {
    total += calcLegMiles(stops[i - 1], stops[i]);
  }
  return Math.round(total);
}

function fmt$(n) {
  return (
    "$" +
    Number(n || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function genId() {
  const y = new Date().getFullYear();
  const r = String(Math.floor(1000 + Math.random() * 9000));
  return `RT-${y}-${r}`;
}

const emptyRoute = () => ({
  id: genId(),
  name: "",
  mode: "TL",
  carrier: "",
  max_weight: 44000,
  cost_override: "",
  miles_override: "",
  transit_days: "",
  status: "Active",
  notes: "",
  stops: [
    { sequence: 1, location: "", type: "pickup", lat: null, lng: null },
    { sequence: 2, location: "", type: "delivery", lat: null, lng: null },
  ],
  total_miles: 0,
});

/* ── Location search dropdown ─────────────────────────────────── */
function LocationPicker({ value, locations, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(value || "");
  const ref = useRef(null);

  useEffect(() => {
    setSearch(value || "");
  }, [value]);

  useEffect(() => {
    function handle(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return locations.slice(0, 20);
    const t = search.toLowerCase();
    return locations.filter(
      (l) =>
        String(l.name || "").toLowerCase().includes(t) ||
        String(l.address || "").toLowerCase().includes(t) ||
        String(l.city || "").toLowerCase().includes(t) ||
        String(l.state || "").toLowerCase().includes(t)
    ).slice(0, 20);
  }, [locations, search]);

  return (
    <div ref={ref} style={{ position: "relative", flex: 1 }}>
      <input
        type="text"
        value={search}
        placeholder="Search or type location..."
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
          onChange({ location: e.target.value, lat: null, lng: null });
        }}
        onFocus={() => setOpen(true)}
        style={{ width: "100%" }}
      />
      {open && filtered.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            background: "#fff",
            border: "1px solid var(--border2)",
            borderRadius: 8,
            maxHeight: 180,
            overflowY: "auto",
            zIndex: 999,
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
          }}
        >
          {filtered.map((loc) => {
            const display = [loc.name, loc.city, loc.state]
              .filter(Boolean)
              .join(", ");
            return (
              <div
                key={loc.id || display}
                onClick={() => {
                  setSearch(display);
                  setOpen(false);
                  onChange({
                    location: display,
                    lat: loc.lat || null,
                    lng: loc.lng || null,
                  });
                }}
                style={{
                  padding: "8px 12px",
                  fontSize: 12,
                  cursor: "pointer",
                  borderBottom: "1px solid var(--border)",
                }}
                onMouseOver={(e) =>
                  (e.currentTarget.style.background = "var(--bg)")
                }
                onMouseOut={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                <div style={{ fontWeight: 600 }}>{loc.name}</div>
                <div style={{ fontSize: 11, color: "var(--text3)" }}>
                  {[loc.address, loc.city, loc.state, loc.zip]
                    .filter(Boolean)
                    .join(", ")}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Stops Editor ──────────────────────────────────────────────── */
function StopsEditor({ stops, locations, onChange, legMiles = [], fetchingMiles = false }) {
  function updateStop(idx, field, val) {
    const next = stops.map((s, i) =>
      i === idx ? { ...s, [field]: val } : s
    );
    onChange(next);
  }

  function updateStopLocation(idx, data) {
    const next = stops.map((s, i) =>
      i === idx
        ? { ...s, location: data.location, lat: data.lat, lng: data.lng }
        : s
    );
    onChange(next);
  }

  function addStop() {
    onChange([
      ...stops,
      {
        sequence: stops.length + 1,
        location: "",
        type: "delivery",
        lat: null,
        lng: null,
      },
    ]);
  }

  function removeStop(idx) {
    if (stops.length <= 2) return;
    const next = stops
      .filter((_, i) => i !== idx)
      .map((s, i) => ({ ...s, sequence: i + 1 }));
    onChange(next);
  }

  function moveStop(idx, dir) {
    const ni = idx + dir;
    if (ni < 0 || ni >= stops.length) return;
    const next = [...stops];
    [next[idx], next[ni]] = [next[ni], next[idx]];
    onChange(next.map((s, i) => ({ ...s, sequence: i + 1 })));
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 0.6,
            color: "var(--text2)",
          }}
        >
          Stops ({stops.length})
        </div>
        <button
          type="button"
          className="btn btn-sm"
          onClick={addStop}
          style={{
            fontSize: 11,
            padding: "4px 10px",
            background: "var(--accent)",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
          }}
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
            {idx > 0 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 0 6px 34px",
                  fontSize: 11,
                  color: "var(--text3)",
                }}
              >
                <div
                  style={{
                    width: 2,
                    height: 20,
                    background: (stop.leg_miles || miles) > 0 ? "var(--accent)" : "var(--border2)",
                    marginLeft: -22,
                    borderRadius: 1,
                  }}
                />
                <input
                  type="number"
                  value={stop.leg_miles || ""}
                  onChange={(e) => updateStop(idx, "leg_miles", e.target.value)}
                  placeholder={miles > 0 ? String(miles) : "miles"}
                  style={{
                    width: 70,
                    padding: "3px 6px",
                    fontSize: 11,
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: "#FAFBFC",
                    height: 26,
                    textAlign: "center",
                  }}
                />
                <span style={{ fontSize: 10, color: "var(--text3)" }}>mi</span>
                <span style={{ color: "var(--border2)", margin: "0 2px" }}>|</span>
                <input
                  type="number"
                  value={stop.leg_transit_hrs || ""}
                  onChange={(e) => updateStop(idx, "leg_transit_hrs", e.target.value)}
                  placeholder={hours > 0 ? String(hours) : "hrs"}
                  step="0.5"
                  style={{
                    width: 60,
                    padding: "3px 6px",
                    fontSize: 11,
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: "#FAFBFC",
                    height: 26,
                    textAlign: "center",
                  }}
                />
                <span style={{ fontSize: 10, color: "var(--text3)" }}>hrs transit</span>
              </div>
            )}
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                marginBottom: 0,
                padding: "8px 10px",
                background: idx === 0 ? "rgba(59,130,246,0.04)" : "#f8faff",
                borderRadius: 8,
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

              <select
                value={stop.type}
                onChange={(e) => updateStop(idx, "type", e.target.value)}
                style={{
                  width: 100,
                  padding: "6px 8px",
                  borderRadius: 6,
                  border: "1px solid var(--border2)",
                  fontSize: 11,
                  flexShrink: 0,
                }}
              >
                {STOP_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </select>

              <LocationPicker
                value={stop.location}
                locations={locations}
                onChange={(data) => updateStopLocation(idx, data)}
              />

              <div
                style={{
                  display: "flex",
                  gap: 2,
                  flexShrink: 0,
                }}
              >
                <button
                  type="button"
                  onClick={() => moveStop(idx, -1)}
                  disabled={idx === 0}
                  style={{
                    border: "none",
                    background: "transparent",
                    cursor: idx === 0 ? "default" : "pointer",
                    opacity: idx === 0 ? 0.3 : 1,
                    fontSize: 14,
                    padding: "2px 4px",
                  }}
                  title="Move up"
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={() => moveStop(idx, 1)}
                  disabled={idx === stops.length - 1}
                  style={{
                    border: "none",
                    background: "transparent",
                    cursor: idx === stops.length - 1 ? "default" : "pointer",
                    opacity: idx === stops.length - 1 ? 0.3 : 1,
                    fontSize: 14,
                    padding: "2px 4px",
                  }}
                  title="Move down"
                >
                  ▼
                </button>
                <button
                  type="button"
                  onClick={() => removeStop(idx)}
                  disabled={stops.length <= 2}
                  style={{
                    border: "none",
                    background: "transparent",
                    cursor: stops.length <= 2 ? "default" : "pointer",
                    opacity: stops.length <= 2 ? 0.3 : 1,
                    fontSize: 14,
                    padding: "2px 4px",
                    color: "var(--red)",
                  }}
                  title="Remove stop"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Main Page ─────────────────────────────────────────────────── */
export default function MultiStopRoutesPage() {
  const { carriers, locations, rates, routeTemplates, refreshData } =
    useOutletContext();
  const templates = Array.isArray(routeTemplates) ? routeTemplates : [];

  const [q, setQ] = useState("");
  const [modeFilter, setModeFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [message, setMessage] = useState({ text: "", type: "" });
  const [editRoute, setEditRoute] = useState(null);
  const [saving, setSaving] = useState(false);
  const [detailRoute, setDetailRoute] = useState(null);
  const [legMiles, setLegMiles] = useState([]); // [{miles, origin, dest}] per leg
  const [fetchingMiles, setFetchingMiles] = useState(false);

  function toast(text, type = "info") {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: "", type: "" }), 5000);
  }

  // Fetch PC*MILER mileage for all legs whenever stops change
  const fetchLegMiles = useCallback(async (stops) => {
    if (!stops || stops.length < 2) { setLegMiles([]); return; }
    const filled = stops.filter((s) => s.location && s.location.trim());
    if (filled.length < 2) { setLegMiles([]); return; }

    // Build pairs for consecutive stops that have locations
    const pairs = [];
    for (let i = 1; i < stops.length; i++) {
      const origin = stops[i - 1].location?.trim();
      const dest = stops[i].location?.trim();
      if (origin && dest) {
        pairs.push({ origin, dest });
      } else {
        pairs.push(null);
      }
    }

    const validPairs = pairs.filter(Boolean);
    if (validPairs.length === 0) { setLegMiles(pairs.map(() => ({ miles: 0 }))); return; }

    setFetchingMiles(true);
    try {
      const resp = await MileageApi.bulk(validPairs);
      const results = resp.results || [];
      // Map back to full pairs array (including nulls)
      let ri = 0;
      const mapped = pairs.map((p) => {
        if (!p) return { miles: 0 };
        const r = results[ri++] || {};
        return { miles: r.miles || 0, origin: r.origin, dest: r.dest };
      });
      setLegMiles(mapped);
    } catch {
      setLegMiles(pairs.map(() => ({ miles: 0 })));
    } finally {
      setFetchingMiles(false);
    }
  }, []);

  // Debounced fetch when editRoute stops change
  useEffect(() => {
    if (!editRoute) { setLegMiles([]); return; }
    const timer = setTimeout(() => fetchLegMiles(editRoute.stops), 500);
    return () => clearTimeout(timer);
  }, [editRoute?.stops, fetchLegMiles]);

  const filtered = useMemo(() => {
    let list = templates;
    if (q.trim()) {
      const t = q.toLowerCase();
      list = list.filter((r) => {
        const stops = Array.isArray(r.stops) ? r.stops : [];
        const stopText = stops.map((s) => s.location || "").join(" ");
        return [r.id, r.name, r.carrier, r.mode, stopText].some((v) =>
          String(v || "").toLowerCase().includes(t)
        );
      });
    }
    if (modeFilter !== "All") list = list.filter((r) => r.mode === modeFilter);
    if (statusFilter !== "All")
      list = list.filter((r) => r.status === statusFilter);
    return list;
  }, [templates, q, modeFilter, statusFilter]);

  function calcCost(route) {
    if (route.cost_override && Number(route.cost_override) > 0) {
      return Number(route.cost_override);
    }
    const miles = calcTotalMiles(Array.isArray(route.stops) ? route.stops : []);
    if (!route.carrier || miles === 0) return 0;
    const carrierRates = (rates || []).filter(
      (r) =>
        String(r.carrier || "").toLowerCase() ===
          String(route.carrier || "").toLowerCase() &&
        String(r.mode || "").toUpperCase() ===
          String(route.mode || "TL").toUpperCase() &&
        r.status === "Active"
    );
    if (carrierRates.length === 0) return 0;
    const rate = carrierRates[0];
    const rpm = parseFloat(String(rate.rate || "0").replace(/[^0-9.]/g, ""));
    const fsc = parseFloat(String(rate.fsc || "0").replace(/[^0-9.]/g, "")) / 100;
    return Math.round(miles * rpm * (1 + fsc) * 100) / 100;
  }

  async function saveRoute() {
    if (!editRoute.name.trim()) {
      toast("Route name is required", "error");
      return;
    }
    const validStops = editRoute.stops.filter((s) => s.location.trim());
    if (validStops.length < 2) {
      toast("At least 2 stops with locations are required", "error");
      return;
    }
    setSaving(true);
    try {
      const autoMiles = legMiles.reduce((s, l) => s + (l.miles || 0), 0) || calcTotalMiles(editRoute.stops);
      const totalMiles = editRoute.miles_override ? Number(editRoute.miles_override) : autoMiles;
      const payload = {
        ...editRoute,
        total_miles: totalMiles,
        transit_days: editRoute.transit_days ? Number(editRoute.transit_days) : null,
        miles_override: editRoute.miles_override ? Number(editRoute.miles_override) : null,
        cost_override: editRoute.cost_override ? Number(editRoute.cost_override) : null,
        stops: editRoute.stops,
      };
      await DbApi.upsert("route_templates", payload);
      toast("Route template saved", "success");
      setEditRoute(null);
      await refreshData();
    } catch (err) {
      toast("Save failed: " + err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function deleteRoute(id) {
    if (!window.confirm("Delete this route template?")) return;
    try {
      await DbApi.remove("route_templates", id);
      toast("Route deleted", "success");
      await refreshData();
    } catch (err) {
      toast("Delete failed: " + err.message, "error");
    }
  }

  const totalStops = filtered.reduce(
    (s, r) => s + (Array.isArray(r.stops) ? r.stops.length : 0),
    0
  );
  const totalCost = filtered.reduce((s, r) => s + calcCost(r), 0);

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Multi-Stop Routes</div>
          <div className="page-sub">
            Define reusable route templates with pickup and delivery stops
          </div>
        </div>
        <div className="header-actions">
          <button
            className="btn btn-primary"
            onClick={() => setEditRoute(emptyRoute())}
          >
            + New Route
          </button>
        </div>
      </div>

      <div className="page-content">
        {/* Toast */}
        {message.text && (
          <div
            style={{
              padding: "10px 16px",
              borderRadius: 10,
              marginBottom: 16,
              fontSize: 13,
              fontWeight: 600,
              background:
                message.type === "error"
                  ? "#fee2e2"
                  : message.type === "success"
                  ? "#dcfce7"
                  : "#dbeafe",
              color:
                message.type === "error"
                  ? "#991b1b"
                  : message.type === "success"
                  ? "#14532d"
                  : "#1e3a8a",
              border: `1px solid ${
                message.type === "error"
                  ? "#fca5a5"
                  : message.type === "success"
                  ? "#86efac"
                  : "#93c5fd"
              }`,
            }}
          >
            {message.text}
          </div>
        )}

        {/* Stat Cards */}
        <div
          className="stat-grid"
          style={{ gridTemplateColumns: "repeat(4, 1fr)" }}
        >
          <div className="stat-card blue">
            <div className="stat-label">Total Routes</div>
            <div className="stat-value">{filtered.length}</div>
          </div>
          <div className="stat-card green">
            <div className="stat-label">Active</div>
            <div className="stat-value">
              {filtered.filter((r) => r.status === "Active").length}
            </div>
          </div>
          <div className="stat-card yellow">
            <div className="stat-label">Total Stops</div>
            <div className="stat-value">{totalStops}</div>
          </div>
          <div className="stat-card" style={{ borderLeft: "4px solid #8b5cf6" }}>
            <div className="stat-label">Total Cost</div>
            <div className="stat-value">{fmt$(totalCost)}</div>
          </div>
        </div>

        {/* Search & Filters Bar */}
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            marginBottom: 24,
            flexWrap: "wrap",
          }}
        >
          <div className="search-wrap" style={{ flex: 1, minWidth: 240 }}>
            <input
              placeholder="Search routes, carriers, stops..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="search-input"
              style={{ width: "100%" }}
            />
          </div>
          <select
            value={modeFilter}
            onChange={(e) => setModeFilter(e.target.value)}
            style={{
              padding: "7px 12px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              fontSize: 12,
            }}
          >
            <option value="All">All Modes</option>
            {MODE_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{
              padding: "7px 12px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              fontSize: 12,
            }}
          >
            <option value="All">All Status</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* Tiles Grid */}
        {filtered.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: 60,
              color: "var(--text3)",
              fontSize: 14,
            }}
          >
            <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.4 }}>
              🛣️
            </div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              No route templates found
            </div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              Create your first multi-stop route template to get started
            </div>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280, 1fr))",
              gap: 18,
            }}
          >
            {filtered.map((route) => {
              const stops = Array.isArray(route.stops) ? route.stops : [];
              const pickups = stops.filter((s) => s.type === "pickup");
              const deliveries = stops.filter((s) => s.type === "delivery");
              const miles = route.total_miles || calcTotalMiles(stops);
              const cost = calcCost(route);
              const modeColor = MODE_COLORS[route.mode] || "#3b82f6";

              return (
                <div
                  key={route.id}
                  style={{
                    background: "#fff",
                    borderRadius: 14,
                    border: "1px solid var(--border)",
                    overflow: "hidden",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
                  }}
                  onClick={() => setDetailRoute(route)}
                  onMouseOver={(e) => {
                    e.currentTarget.style.boxShadow =
                      "0 4px 20px rgba(59,130,246,0.12)";
                    e.currentTarget.style.transform = "translateY(-2px)";
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.boxShadow =
                      "0 1px 4px rgba(0,0,0,0.04)";
                    e.currentTarget.style.transform = "translateY(0)";
                  }}
                >
                  {/* Tile Header */}
                  <div
                    style={{
                      padding: "16px 18px 12px",
                      background: `linear-gradient(135deg, ${modeColor}11, ${modeColor}06)`,
                      borderBottom: `2px solid ${modeColor}22`,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        marginBottom: 6,
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: 10,
                            color: "var(--text3)",
                            letterSpacing: 0.8,
                            fontWeight: 600,
                          }}
                        >
                          {route.id}
                        </div>
                        <div
                          style={{
                            fontSize: 15,
                            fontWeight: 700,
                            color: "var(--text)",
                            marginTop: 2,
                          }}
                        >
                          {route.name || "Untitled Route"}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <span
                          style={{
                            padding: "3px 8px",
                            borderRadius: 12,
                            fontSize: 10,
                            fontWeight: 700,
                            background: modeColor + "18",
                            color: modeColor,
                            border: `1px solid ${modeColor}33`,
                          }}
                        >
                          {route.mode || "TL"}
                        </span>
                        <span
                          className={
                            route.status === "Active"
                              ? "badge badge-green"
                              : "badge badge-red"
                          }
                          style={{ fontSize: 10 }}
                        >
                          {route.status}
                        </span>
                      </div>
                    </div>
                    {route.carrier && (
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--text3)",
                          fontWeight: 500,
                        }}
                      >
                        Carrier: {route.carrier}
                      </div>
                    )}
                  </div>

                  {/* Stops Visual */}
                  <div style={{ padding: "12px 18px" }}>
                    {stops.slice(0, 4).map((stop, i) => (
                      <div
                        key={i}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          marginBottom: i < stops.length - 1 && i < 3 ? 6 : 0,
                        }}
                      >
                        <div
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: "50%",
                            background:
                              stop.type === "pickup"
                                ? "var(--accent)"
                                : "var(--green)",
                            color: "#fff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 9,
                            fontWeight: 700,
                            flexShrink: 0,
                          }}
                        >
                          {stop.sequence}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--text2)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          <span
                            style={{
                              fontSize: 9,
                              fontWeight: 700,
                              textTransform: "uppercase",
                              color:
                                stop.type === "pickup"
                                  ? "var(--accent)"
                                  : "var(--green)",
                              marginRight: 4,
                            }}
                          >
                            {stop.type}
                          </span>
                          {stop.location || "—"}
                        </div>
                      </div>
                    ))}
                    {stops.length > 4 && (
                      <div
                        style={{
                          fontSize: 10,
                          color: "var(--text3)",
                          marginTop: 4,
                          fontStyle: "italic",
                        }}
                      >
                        +{stops.length - 4} more stops
                      </div>
                    )}
                  </div>

                  {/* Tile Footer */}
                  <div
                    style={{
                      padding: "10px 18px",
                      borderTop: "1px solid var(--border)",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      background: "#fafbff",
                    }}
                  >
                    <div style={{ display: "flex", gap: 16 }}>
                      <div>
                        <div
                          style={{
                            fontSize: 9,
                            color: "var(--text3)",
                            fontWeight: 600,
                            textTransform: "uppercase",
                          }}
                        >
                          Stops
                        </div>
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 700,
                            color: "var(--text)",
                          }}
                        >
                          {stops.length}
                        </div>
                      </div>
                      <div>
                        <div
                          style={{
                            fontSize: 9,
                            color: "var(--text3)",
                            fontWeight: 600,
                            textTransform: "uppercase",
                          }}
                        >
                          Miles
                        </div>
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 700,
                            fontFamily: "'JetBrains Mono', monospace",
                            color: "var(--text)",
                          }}
                        >
                          {miles.toLocaleString()}
                        </div>
                      </div>
                      <div>
                        <div
                          style={{
                            fontSize: 9,
                            color: "var(--text3)",
                            fontWeight: 600,
                            textTransform: "uppercase",
                          }}
                        >
                          Cost
                        </div>
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 700,
                            fontFamily: "'JetBrains Mono', monospace",
                            color: "var(--green)",
                          }}
                        >
                          {cost > 0 ? fmt$(cost) : "—"}
                        </div>
                      </div>
                    </div>
                    <div
                      style={{ display: "flex", gap: 4 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        className="btn btn-sm"
                        onClick={() => setEditRoute({ ...route, stops: [...(route.stops || [])] })}
                        style={{
                          fontSize: 11,
                          padding: "4px 10px",
                          borderRadius: 6,
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn-sm"
                        onClick={() => deleteRoute(route.id)}
                        style={{
                          fontSize: 11,
                          padding: "4px 10px",
                          borderRadius: 6,
                          color: "var(--red)",
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Add / Edit Modal ──────────────────────────────────────── */}
      {editRoute && (
        <div className="modal-overlay" onClick={() => setEditRoute(null)}>
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 720 }}
          >
            <div className="modal-header">
              <div>
                <div style={{ fontSize: 10, opacity: 0.6, letterSpacing: 1 }}>
                  {templates.find((t) => t.id === editRoute.id)
                    ? "EDIT ROUTE TEMPLATE"
                    : "NEW ROUTE TEMPLATE"}
                </div>
                <h3>{editRoute.id}</h3>
              </div>
              <button
                className="modal-close"
                onClick={() => setEditRoute(null)}
              >
                ✕
              </button>
            </div>

            <div
              className="modal-body"
              style={{ maxHeight: "75vh", overflowY: "auto" }}
            >
              {/* Basic Info */}
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Route Name *</label>
                  <input
                    type="text"
                    value={editRoute.name}
                    onChange={(e) =>
                      setEditRoute({ ...editRoute, name: e.target.value })
                    }
                    placeholder="e.g., Texas Corridor"
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

              <div className="form-row" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
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
                  onChange={(stops) => setEditRoute({ ...editRoute, stops })}
                  legMiles={legMiles}
                  fetchingMiles={fetchingMiles}
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
                    <div style={{ fontSize: 10, color: "var(--text3)", fontWeight: 600, marginBottom: 4 }}>
                      AUTO-CALCULATED MILES
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                      {fetchingMiles ? "..." : (() => {
                        const total = legMiles.reduce((s, l) => s + (l.miles || 0), 0);
                        return total > 0 ? `${total.toLocaleString()} mi` : "0 mi";
                      })()}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--text3)", fontWeight: 600, marginBottom: 4 }}>
                      AUTO TRANSIT EST.
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: "var(--accent)" }}>
                      {fetchingMiles ? "..." : (() => {
                        const totalMiles = legMiles.reduce((s, l) => s + (l.miles || 0), 0);
                        const totalHours = calcLegTransitHours(totalMiles);
                        return totalHours > 0 ? formatTransitTime(totalHours) : "--";
                      })()}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--text3)", fontWeight: 600, marginBottom: 4 }}>
                      ESTIMATED COST
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: "var(--green)" }}>
                      {fmt$(calcCost({ ...editRoute, cost_override: "" }))}
                    </div>
                  </div>
                </div>
                <div className="form-row" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                  <div className="form-group">
                    <label className="form-label">Total Miles (override)</label>
                    <input
                      type="number"
                      value={editRoute.miles_override || ""}
                      onChange={(e) =>
                        setEditRoute({ ...editRoute, miles_override: e.target.value })
                      }
                      placeholder="Auto if blank"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Transit Days</label>
                    <input
                      type="number"
                      value={editRoute.transit_days || ""}
                      onChange={(e) =>
                        setEditRoute({ ...editRoute, transit_days: e.target.value })
                      }
                      placeholder="e.g., 2"
                      step="0.5"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Cost Override ($)</label>
                    <input
                      type="number"
                      value={editRoute.cost_override || ""}
                      onChange={(e) =>
                        setEditRoute({ ...editRoute, cost_override: e.target.value })
                      }
                      placeholder="Auto if blank"
                      step="0.01"
                    />
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
              <button
                className="btn btn-secondary"
                onClick={() => setEditRoute(null)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={saveRoute}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save Route"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Detail / View Modal ─────────────────────────────────── */}
      {detailRoute && !editRoute && (
        <div className="modal-overlay" onClick={() => setDetailRoute(null)}>
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
                <h3>{detailRoute.name || detailRoute.id}</h3>
              </div>
              <button
                className="modal-close"
                onClick={() => setDetailRoute(null)}
              >
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
                  { label: "Mode", value: detailRoute.mode },
                  { label: "Carrier", value: detailRoute.carrier || "—" },
                  { label: "Status", value: detailRoute.status },
                  {
                    label: "Max Weight",
                    value: `${(detailRoute.max_weight || 44000).toLocaleString()} lbs`,
                  },
                  {
                    label: "Total Miles",
                    value: `${(detailRoute.total_miles || calcTotalMiles(detailRoute.stops || [])).toLocaleString()} mi`,
                  },
                  {
                    label: "Cost",
                    value: fmt$(calcCost(detailRoute)),
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
                Stops ({(detailRoute.stops || []).length})
              </div>
              {(detailRoute.stops || []).map((stop, i) => (
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
                        stop.type === "pickup"
                          ? "var(--accent)"
                          : "var(--green)",
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
                      {stop.location || "—"}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color:
                          stop.type === "pickup"
                            ? "var(--accent)"
                            : "var(--green)",
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

              {detailRoute.notes && (
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
                    {detailRoute.notes}
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => setDetailRoute(null)}
              >
                Close
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setDetailRoute(null);
                  setEditRoute({
                    ...detailRoute,
                    stops: [...(detailRoute.stops || [])],
                  });
                }}
              >
                Edit Route
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
