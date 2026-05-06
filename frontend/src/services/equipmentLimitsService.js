// ═══════════════════════════════════════════════════════════════════
// Equipment Limits Service (frontend) — equipmentLimitsService.js
//
// Thin service wrapper that resolves the LTL / TL weight ceilings
// from the equipment_types table and exposes a React Query hook for
// UI consumption.
//
// Mirrors api/services/equipmentLimits.js on the backend so both
// surfaces read the same source of truth (equipment_types.max_weight
// keyed by code). Replaces the hardcoded LTL_MAX_WEIGHT / TL_MAX_WEIGHT
// constants that previously lived in constants/orders.js.
//
// Per CLAUDE_RULES §3 (server state via React Query) and §4 (no API
// calls inside UI components) — components use the hook, services
// use resolveEquipmentLimits().
// ═══════════════════════════════════════════════════════════════════

import { useQuery } from "@tanstack/react-query";
import { DbApi } from "../lib/api";

const LTL_CODE = "LTL";
const TL_DEFAULT_CODE = "DV53";

const QUERY_KEY = ["equipment-limits"];
const STALE_MS = 60_000; // mirror backend TTL — admins see edits within ~60s.

/**
 * Pure resolver — extract the LTL / TL ceilings from a list of
 * equipment_types rows. Throws if either is missing so callers
 * surface a real error instead of falling back to a stale constant.
 */
export function resolveEquipmentLimits(equipmentTypes) {
  const list = Array.isArray(equipmentTypes) ? equipmentTypes : [];
  const byCode = new Map();
  list.forEach((r) => {
    if (!r || r.status === "Inactive") return;
    if (!r.code) return;
    const w = Number(r.max_weight);
    if (Number.isFinite(w) && w > 0) {
      byCode.set(String(r.code).toUpperCase(), w);
    }
  });
  const ltlMax = byCode.get(LTL_CODE);
  const tlMax  = byCode.get(TL_DEFAULT_CODE);
  if (!Number.isFinite(ltlMax) || ltlMax <= 0) {
    throw new Error(
      `equipmentLimits: equipment_types has no Active row with code='${LTL_CODE}' and a positive max_weight`
    );
  }
  if (!Number.isFinite(tlMax) || tlMax <= 0) {
    throw new Error(
      `equipmentLimits: equipment_types has no Active row with code='${TL_DEFAULT_CODE}' and a positive max_weight`
    );
  }
  return { ltlMax, tlMax };
}

/** Service-layer fetcher — used by non-React callers (e.g. ordersService.js bulk plan). */
export async function fetchEquipmentLimits() {
  const rows = await DbApi.equipmentTypes();
  return resolveEquipmentLimits(rows);
}

/** React Query hook — components call this and read { ltlMax, tlMax } from data. */
export function useEquipmentLimits() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn:  fetchEquipmentLimits,
    staleTime: STALE_MS,
    // Equipment Master edits are infrequent; one refetch per visit is enough.
    refetchOnWindowFocus: false,
  });
}

export const _equipmentLimits = {
  LTL_CODE,
  TL_DEFAULT_CODE,
  QUERY_KEY,
  STALE_MS,
};
