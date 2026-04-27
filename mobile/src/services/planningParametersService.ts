/**
 * Mobile planning parameters service — feature toggle CRUD for the
 * planning_parameters table. Each row is a {key, label, description,
 * enabled} flag that the planner reads to decide whether a feature
 * is active for this tenant.
 *
 * Pure service layer: calls DbApi, returns plain data.
 *
 * Web parity reference: frontend/src/services/planningParametersService.js.
 */

import { DbApi } from '../lib/api';

export interface PlanningParameter {
  id: string;
  key: string;
  label: string;
  description?: string;
  enabled: boolean;
  updated_at?: string;
}

/** Fetch all planning parameter rows. */
export async function fetchParameters(): Promise<PlanningParameter[]> {
  try {
    const rows = await DbApi.planningParameters();
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

/**
 * Toggle a single parameter on/off. Stamps `updated_at` so the audit
 * row matches what the web writes — keeps ordering / freshness checks
 * working in places that consume the column.
 */
export async function updateParameter(id: string, enabled: boolean): Promise<any> {
  if (!id) throw new Error('updateParameter: id is required');
  return DbApi.patch('planning_parameters', id, {
    enabled,
    updated_at: new Date().toISOString(),
  });
}

/**
 * Lookup helper used by code that wants to read a flag inline (e.g.
 * "should we route through dock scheduling?"). Falls back to false
 * when the parameter is absent so missing rows degrade safely.
 */
export function isFeatureEnabled(
  parameters: PlanningParameter[] | null | undefined,
  key: string,
): boolean {
  const param = (parameters || []).find((p) => p.key === key);
  return param ? !!param.enabled : false;
}
