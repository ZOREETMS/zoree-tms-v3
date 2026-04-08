import { DbApi } from "../lib/api";

export async function fetchParameters() {
  return DbApi.planningParameters();
}

export async function updateParameter(id, enabled) {
  return DbApi.patch("planning_parameters", id, {
    enabled,
    updated_at: new Date().toISOString(),
  });
}

export function isFeatureEnabled(parameters, key) {
  const param = (parameters || []).find((p) => p.key === key);
  return param ? param.enabled : false;
}
