// ═══════════════════════════════════════════════════════════════════
// Quantum engine preflight — api/services/quantumPreflight.js
// ─────────────────────────────────────────────────────────────────────
// The engine cannot see Zoree's planning constraints. Verified against
// its own OpenAPI schema: a ShipmentInput is exactly 14 fields (id,
// origin/destination city + region + lat/lon, distance_miles,
// weight_lbs, volume_cuft, sla_hours, status) and a CarrierInput is 8.
// There is no field for no_consolidate, dedicated_equip, hazmat,
// preferred_carrier, excluded_carrier, equipment type, mode or service
// level.
//
// Worse, every model is Pydantic `extra: ignore`. Send those fields
// anyway and the request returns 200 with them silently discarded —
// the engine will happily bundle freight that must ship alone, and
// nothing in the response says it did.
//
// So the constraint check has to happen HERE, before the request. An
// order that must not be consolidated is never offered to the engine;
// it is returned in `excluded` with the rule that excluded it, so the
// caller can plan it the normal way and can show a planner why.
//
// This is the mirror image of validateConsolidation() in
// quantumEngineMapper.js: this one guards the request, that one guards
// the response.
// ═══════════════════════════════════════════════════════════════════

'use strict';

/** Statuses that mean the order is no longer ours to plan. */
const COMMITTED_STATUSES = Object.freeze([
  'Tendered', 'Tender Accepted', 'Shipped', 'In Transit', 'Delivered', 'Cancelled',
]);

/**
 * Rules are ordered most-specific first so the reported reason is the
 * most useful one when an order trips several.
 *
 * Each rule: { code, describe, test(order) -> boolean }  (true = exclude)
 */
const RULES = Object.freeze([
  {
    code: 'already_planned',
    describe: 'already has a shipment',
    test: (o) => Boolean(o.shipment_id),
  },
  {
    code: 'committed',
    describe: 'status is at or past Tendered',
    test: (o) => COMMITTED_STATUSES.includes(String(o.status || '')),
  },
  {
    code: 'no_consolidate',
    describe: 'order is flagged no_consolidate',
    test: (o) => o.no_consolidate === true,
  },
  {
    code: 'dedicated_equip',
    describe: 'order requires dedicated equipment',
    test: (o) => o.dedicated_equip === true,
  },
  {
    code: 'hazmat',
    describe: 'hazmat cannot be bundled without a compatibility check the engine does not do',
    test: (o) => o.hazmat === true,
  },
  {
    code: 'excluded_carrier',
    describe: 'order excludes a carrier and the engine cannot honour that',
    test: (o) => Boolean(o.excluded_carrier),
  },
  {
    code: 'preferred_carrier',
    describe: 'order names a preferred carrier and the engine cannot honour that',
    test: (o) => Boolean(o.preferred_carrier),
  },
]);

/**
 * Split orders into what may be sent to the engine and what may not.
 *
 * @param {object[]} orders
 * @param {{ allow?: string[] }} [opts]  rule codes to deliberately ignore
 *        (e.g. ['preferred_carrier'] when you accept that the engine may
 *        override the preference). Pass nothing for the safe default.
 * @returns {{eligible:object[], excluded:{id:string,code:string,reason:string}[], counts:object}}
 */
function preflightOrders(orders, opts = {}) {
  const allow = new Set(opts.allow || []);
  const eligible = [];
  const excluded = [];
  const counts = {};

  for (const o of orders || []) {
    if (!o || !o.id) continue;
    const hit = RULES.find((r) => !allow.has(r.code) && r.test(o));
    if (hit) {
      excluded.push({ id: o.id, code: hit.code, reason: hit.describe });
      counts[hit.code] = (counts[hit.code] || 0) + 1;
    } else {
      eligible.push(o);
    }
  }

  return { eligible, excluded, counts };
}

module.exports = { preflightOrders, RULES, COMMITTED_STATUSES };
