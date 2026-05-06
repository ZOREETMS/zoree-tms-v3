// ═══════════════════════════════════════════════════════════════════
// Equipment Limits Service — api/services/equipmentLimits.js
//
// Single source of truth for the LTL / TL weight ceilings used by the
// rate-shop and planner. Reads `equipment_types.max_weight` keyed by
// `code` (LTL → LTL ceiling, DV53 → TL ceiling) and caches the result
// in-process for a short TTL.
//
// This module exists so the bulk-plan loop in api/server.js does NOT
// hardcode `const LTL_MAX = 15000`. The Equipment Master page is the
// authoritative editor for these numbers; planners should be able to
// adjust them without a code deploy.
//
// Per CLAUDE_RULES §4 (services layer) and §10 (no hardcoded values):
// callers MUST go through this service. Direct DB reads from
// server.js for equipment_types.max_weight are a rule violation.
//
// Failure mode: if the equipment_types row is missing or unreachable,
// the getter THROWS. Callers translate the throw into a planning
// failure ("equipment limits unavailable") rather than silently
// falling back to a hardcoded constant — that fallback would mask the
// very bug this service was created to fix.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const TTL_MS = 60_000; // 60s — admins editing Equipment Master see new ceilings within a minute.

// Codes in equipment_types that drive the planner's weight gates.
// LTL row defines the LTL ceiling; the configured TL default trailer
// (DV53 today) defines the TL ceiling.
const LTL_CODE = 'LTL';
const TL_DEFAULT_CODE = 'DV53';

let _cache = {
  loadedAt: 0,
  byCode:   null, // Map<string, number>  code → max_weight
};

function _supabaseUrl() {
  return process.env.SUPABASE_URL
    || 'https://ljbeihotrmyqthxptcgp.supabase.co';
}

function _serviceKey() {
  return process.env.SUPABASE_SERVICE_KEY
    || process.env.SUPABASE_ANON_KEY;
}

function _headers() {
  const key = _serviceKey();
  return {
    apikey:        key,
    Authorization: 'Bearer ' + key,
  };
}

async function _refresh() {
  const url = `${_supabaseUrl()}/rest/v1/equipment_types`
    + `?status=eq.Active&select=code,max_weight`;
  const res = await fetch(url, { headers: _headers() });
  if (!res.ok) {
    throw new Error(
      `equipmentLimits: equipment_types fetch failed (${res.status}): ${await res.text()}`
    );
  }
  const rows = await res.json();
  if (!Array.isArray(rows)) {
    throw new Error('equipmentLimits: equipment_types response was not an array');
  }
  const byCode = new Map();
  rows.forEach((r) => {
    if (r && r.code && Number.isFinite(Number(r.max_weight))) {
      byCode.set(String(r.code).toUpperCase(), Number(r.max_weight));
    }
  });
  _cache = { loadedAt: Date.now(), byCode };
}

async function _ensureFresh() {
  const stale = !_cache.byCode || (Date.now() - _cache.loadedAt) > TTL_MS;
  if (stale) await _refresh();
}

async function _maxWeightFor(code) {
  await _ensureFresh();
  const w = _cache.byCode.get(String(code).toUpperCase());
  if (!Number.isFinite(w) || w <= 0) {
    throw new Error(
      `equipmentLimits: equipment_types has no Active row with code='${code}' and a positive max_weight`
    );
  }
  return w;
}

/** Max weight (lbs) the planner allows on the LTL rate-shop branch. */
async function getLtlMaxWeight() {
  return _maxWeightFor(LTL_CODE);
}

/** Max weight (lbs) for the default TL trailer (DV53). */
async function getTlMaxWeight() {
  return _maxWeightFor(TL_DEFAULT_CODE);
}

/** Force the next call to re-fetch — exposed for admin endpoints / tests. */
function invalidate() {
  _cache = { loadedAt: 0, byCode: null };
}

module.exports = {
  getLtlMaxWeight,
  getTlMaxWeight,
  invalidate,
  // Exposed for tests; not part of the public API.
  _internal: { LTL_CODE, TL_DEFAULT_CODE, TTL_MS },
};
