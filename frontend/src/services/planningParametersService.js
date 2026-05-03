import { DbApi } from "../lib/api";
import { invalidateQuoteCache } from "./ordersService";

export async function fetchParameters() {
  return DbApi.planningParameters();
}

export async function updateParameter(id, enabled) {
  const result = await DbApi.patch("planning_parameters", id, {
    enabled,
    updated_at: new Date().toISOString(),
  });
  // Toggling lane_preferences (or any planning param) gates the
  // server-side pref branch — invalidate cached quotes so the
  // next plan run reflects the new flag.
  invalidateQuoteCache();
  return result;
}

export function isFeatureEnabled(parameters, key) {
  const param = (parameters || []).find((p) => p.key === key);
  return param ? param.enabled : false;
}
