import { DbApi } from "../../lib/api";
import { calcTotalMiles } from "./routeCalculations";

/**
 * Calculate route cost from carrier rates or manual override.
 */
export function calcCost(route, rates) {
  if (route.cost_override && Number(route.cost_override) > 0) {
    return Number(route.cost_override);
  }
  const miles = calcTotalMiles(Array.isArray(route.stops) ? route.stops : []);
  if (!route.carrier || miles === 0) return 0;

  const carrierRates = (rates || []).filter(
    (r) =>
      String(r.carrier || "").toLowerCase() === String(route.carrier || "").toLowerCase() &&
      String(r.mode || "").toUpperCase() === String(route.mode || "TL").toUpperCase() &&
      r.status === "Active"
  );
  if (carrierRates.length === 0) return 0;

  const rate = carrierRates[0];
  const rpm = parseFloat(String(rate.rate || "0").replace(/[^0-9.]/g, ""));
  const fsc = parseFloat(String(rate.fsc || "0").replace(/[^0-9.]/g, "")) / 100;
  return Math.round(miles * rpm * (1 + fsc) * 100) / 100;
}

/**
 * Save route template to database with validation.
 * Returns { ok: true } on success, { error: string } on validation failure.
 */
export async function saveRoute(editRoute, legMiles, { toast, setSaving, setEditRoute, refreshData, setValidationErrors }) {
  const errors = {};
  if (!editRoute.name.trim()) errors.name = true;
  editRoute.stops.forEach((s, i) => {
    if (!s.city || !s.city.trim()) errors[`stop_${i}`] = true;
  });
  if (Object.keys(errors).length > 0) {
    setValidationErrors(errors);
    toast(errors.name ? "Route name is required" : "All stops must have a city and state", "error");
    return { error: true };
  }
  setValidationErrors({});

  const stopsWithLocation = editRoute.stops.map((s) => ({
    ...s,
    location: [s.city, s.state].filter(Boolean).join(", "),
  }));
  const validStops = stopsWithLocation.filter((s) => s.location.trim());
  if (validStops.length < 2) {
    toast("At least 2 stops with cities are required", "error");
    return { error: true };
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
    return { ok: true };
  } catch (err) {
    toast("Save failed: " + err.message, "error");
    return { error: err.message };
  } finally {
    setSaving(false);
  }
}

/**
 * Delete route template with confirmation.
 */
export async function deleteRoute(id, { toast, refreshData }) {
  if (!window.confirm("Delete this route template?")) return;
  try {
    await DbApi.remove("route_templates", id);
    toast("Route deleted", "success");
    await refreshData();
  } catch (err) {
    toast("Delete failed: " + err.message, "error");
  }
}
