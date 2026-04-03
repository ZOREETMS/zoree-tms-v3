import { useMemo, useState, useEffect, useCallback } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { MileageApi } from "../lib/api";

import { MODE_OPTIONS, STATUS_OPTIONS } from "../components/multi-stop/constants";
import { calcTotalMiles } from "../components/multi-stop/routeCalculations";
import { fmt$ } from "../components/multi-stop/routeFormatters";
import { emptyRoute, recalcLoadSeq } from "../components/multi-stop/routeFactory";
import { calcCost, saveRoute, deleteRoute } from "../components/multi-stop/routeService";
import RouteCard from "../components/multi-stop/RouteCard";
import RouteEditModal from "../components/multi-stop/RouteEditModal";
import RouteDetailModal from "../components/multi-stop/RouteDetailModal";
import ExecuteRouteModal from "../components/multi-stop/ExecuteRouteModal";

export default function MultiStopRoutesPage() {
  const { carriers, locations, rates, routeTemplates, orders, refreshData } =
    useOutletContext();
  const templates = Array.isArray(routeTemplates) ? routeTemplates : [];

  /* ── State ─────────────────────────────────────────────────── */
  const [q, setQ] = useState("");
  const [modeFilter, setModeFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [message, setMessage] = useState({ text: "", type: "" });
  const [editRoute, setEditRoute] = useState(null);
  const [saving, setSaving] = useState(false);
  const [detailRoute, setDetailRoute] = useState(null);
  const [executeRoute, setExecuteRoute] = useState(null);
  const [validationErrors, setValidationErrors] = useState({});
  const [legMiles, setLegMiles] = useState([]);
  const [fetchingMiles, setFetchingMiles] = useState(false);

  /* ── Auto-create route from orderIds query param ──────────── */
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const idsParam = searchParams.get("orderIds");
    if (!idsParam || !orders?.length) return;
    // templates may still be loading — they'll trigger re-run via dependency
    const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
    const matched = ids.map((id) => orders.find((o) => o.id === id)).filter(Boolean);
    if (matched.length < 2) { setSearchParams({}, { replace: true }); return; }

    // Check if an existing route with a carrier covers these stops
    const normalize = (s) => (s || "").trim().toLowerCase().split(",")[0];
    const orderOrigins = [...new Set(matched.map((o) => normalize(o.origin)))];
    const orderDests = matched.map((o) => normalize(o.dest)).sort();
    const existingRoute = templates.find((t) => {
      if (!t.carrier) return false; // only match routes with a carrier assigned
      const tStops = Array.isArray(t.stops) ? t.stops : [];
      const tPickups = tStops.filter((s) => s.type === "pickup").map((s) => normalize(s.location || s.city));
      const tDeliveries = tStops.filter((s) => s.type === "delivery").map((s) => normalize(s.location || s.city)).sort();
      return tPickups.some((p) => orderOrigins.includes(p))
        && orderDests.every((d) => tDeliveries.some((td) => td.includes(d) || d.includes(td)));
    });

    if (existingRoute) {
      // Reuse existing route with carrier — go straight to execute
      setExecuteRoute(existingRoute);
      setSearchParams({}, { replace: true });
      toast(`Matched route "${existingRoute.name}" (${existingRoute.carrier}) — assign orders and execute`, "info");
      return;
    }

    // Build new route from orders
    const originOrder = matched[0];
    const originLoc = originOrder.origin || "";
    const originCity = originLoc.split(",")[0]?.trim() || "";
    const originState = originLoc.split(",")[1]?.trim().split(/\s/)[0] || "";
    const stops = [
      { sequence: 1, city: originCity, state: originState, location: originLoc, type: "pickup", stop_seq: 1, load_seq: "", lat: null, lng: null },
    ];
    matched.forEach((o, i) => {
      const loc = o.dest || "";
      const city = loc.split(",")[0]?.trim() || "";
      const state = loc.split(",")[1]?.trim().split(/\s/)[0] || "";
      stops.push({
        sequence: i + 2, city, state, location: loc, type: "delivery",
        stop_seq: i + 2, load_seq: matched.length - i, lat: null, lng: null,
        orderIds: [o.id], orderWeight: Number(o.weight || 0),
      });
    });
    const totalWeight = matched.reduce((s, o) => s + Number(o.weight || 0), 0);
    const route = {
      ...emptyRoute(),
      name: `Multi-Stop: ${originCity} → ${matched.map((o) => (o.dest || "").split(",")[0]?.trim()).join(" → ")}`,
      stops,
      max_weight: Math.max(44000, totalWeight),
    };
    setEditRoute(route);
    setSearchParams({}, { replace: true });
    toast("Multi-stop route created from selected orders — review stops and save", "info");
  }, [searchParams, orders, templates]);

  /* ── Helpers ────────────────────────────────────────────────── */
  function toast(text, type = "info") {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: "", type: "" }), 5000);
  }

  const costFor = useCallback((route) => calcCost(route, rates), [rates]);

  /* ── PC*MILER leg mileage fetch (debounced) ────────────────── */
  const fetchLegMiles = useCallback(async (stops) => {
    if (!stops || stops.length < 2) { setLegMiles([]); return; }
    const filled = stops.filter((s) => s.location && s.location.trim());
    if (filled.length < 2) { setLegMiles([]); return; }

    const pairs = [];
    for (let i = 1; i < stops.length; i++) {
      const origin = stops[i - 1].location?.trim();
      const dest = stops[i].location?.trim();
      pairs.push(origin && dest ? { origin, dest } : null);
    }
    const validPairs = pairs.filter(Boolean);
    if (validPairs.length === 0) { setLegMiles(pairs.map(() => ({ miles: 0 }))); return; }

    setFetchingMiles(true);
    try {
      const resp = await MileageApi.bulk(validPairs);
      const results = resp.results || [];
      let ri = 0;
      setLegMiles(
        pairs.map((p) => {
          if (!p) return { miles: 0 };
          const r = results[ri++] || {};
          return { miles: r.miles || 0, origin: r.origin, dest: r.dest };
        })
      );
    } catch {
      setLegMiles(pairs.map(() => ({ miles: 0 })));
    } finally {
      setFetchingMiles(false);
    }
  }, []);

  useEffect(() => {
    if (!editRoute) { setLegMiles([]); return; }
    const timer = setTimeout(() => fetchLegMiles(editRoute.stops), 500);
    return () => clearTimeout(timer);
  }, [editRoute?.stops, fetchLegMiles]);

  /* ── Filtered list + aggregate stats ───────────────────────── */
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
    if (statusFilter !== "All") list = list.filter((r) => r.status === statusFilter);
    return list;
  }, [templates, q, modeFilter, statusFilter]);

  const totalStops = useMemo(
    () => filtered.reduce((s, r) => s + (Array.isArray(r.stops) ? r.stops.length : 0), 0),
    [filtered]
  );
  const totalCost = useMemo(
    () => filtered.reduce((s, r) => s + costFor(r), 0),
    [filtered, costFor]
  );

  /* ── Route action handlers ─────────────────────────────────── */
  function openEdit(route) {
    const stops = (route.stops || []).map((s) => {
      if (s.city) return s;
      const parts = String(s.location || "").split(",").map((p) => p.trim());
      return { ...s, city: parts[0] || "", state: parts[1] || "" };
    });
    setEditRoute({ ...route, stops: recalcLoadSeq(stops) });
    setValidationErrors({});
  }

  function handleDetailEdit(route) {
    setDetailRoute(null);
    openEdit(route);
  }

  function handleSave() {
    saveRoute(editRoute, legMiles, {
      toast,
      setSaving,
      setEditRoute,
      refreshData,
      setValidationErrors,
    });
  }

  function handleDelete(id) {
    deleteRoute(id, { toast, refreshData });
  }

  /* ── Determine if editing a new route ──────────────────────── */
  const isNew = editRoute && !templates.find((t) => t.id === editRoute.id);

  /* ── Render ─────────────────────────────────────────────────── */
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
            onClick={() => { setEditRoute(emptyRoute()); setValidationErrors({}); }}
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
              background: message.type === "error" ? "#fee2e2" : message.type === "success" ? "#dcfce7" : "#dbeafe",
              color: message.type === "error" ? "#991b1b" : message.type === "success" ? "#14532d" : "#1e3a8a",
              border: `1px solid ${message.type === "error" ? "#fca5a5" : message.type === "success" ? "#86efac" : "#93c5fd"}`,
            }}
          >
            {message.text}
          </div>
        )}

        {/* Stat Cards */}
        <div className="stat-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          <div className="stat-card blue">
            <div className="stat-label">Total Routes</div>
            <div className="stat-value">{filtered.length}</div>
          </div>
          <div className="stat-card green">
            <div className="stat-label">Active</div>
            <div className="stat-value">{filtered.filter((r) => r.status === "Active").length}</div>
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

        {/* Search & Filters */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 24, flexWrap: "wrap" }}>
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
            style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }}
          >
            <option value="All">All Modes</option>
            {MODE_OPTIONS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }}
          >
            <option value="All">All Status</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {/* Route Cards Grid */}
        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: 60, color: "var(--text3)", fontSize: 14 }}>
            <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.4 }}>
              {"\uD83D\uDEE3\uFE0F"}
            </div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>No route templates found</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              Create your first multi-stop route template to get started
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {filtered.map((route) => (
              <RouteCard
                key={route.id}
                route={route}
                calcCost={costFor}
                onView={setDetailRoute}
                onEdit={openEdit}
                onDelete={handleDelete}
                onExecute={setExecuteRoute}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {editRoute && (
        <RouteEditModal
          editRoute={editRoute}
          setEditRoute={setEditRoute}
          carriers={carriers}
          locations={locations}
          legMiles={legMiles}
          fetchingMiles={fetchingMiles}
          validationErrors={validationErrors}
          setValidationErrors={setValidationErrors}
          saving={saving}
          onSave={handleSave}
          onClose={() => setEditRoute(null)}
          message={message}
          rates={rates}
          isNew={isNew}
        />
      )}

      {detailRoute && !editRoute && (
        <RouteDetailModal
          route={detailRoute}
          onClose={() => setDetailRoute(null)}
          onEdit={handleDetailEdit}
          calcCost={costFor}
        />
      )}

      {executeRoute && (
        <ExecuteRouteModal
          route={executeRoute}
          orders={orders}
          onClose={() => setExecuteRoute(null)}
          onSuccess={(masterId, cbolCount) => {
            setExecuteRoute(null);
            toast(`Created MBOL ${masterId} with ${cbolCount} CBOLs`, "success");
            refreshData();
          }}
        />
      )}
    </div>
  );
}
