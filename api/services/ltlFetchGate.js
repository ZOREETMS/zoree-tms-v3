// ════════════════════════════════════════════════════════════════════
// ltlFetchGate — single, unit-testable function that decides whether
// the bulk-plan rate endpoint should fetch LTL quotes for a lane.
//
// QA #136: the previous gate (`wantsLtl && wt <= LTL_MAX`) skipped the
// LTL fetch entirely when the shipment was over the LTL ceiling, so an
// order explicitly planned as LTL got back zero LTL quotes — only TL
// rates rendered. The new rule:
//
//   • If LTL is the only allowed mode (user picked LTL explicitly),
//     ALWAYS fetch LTL quotes. Quotes that exceed LTL_MAX are still
//     marked `infeasible = true` downstream, so the UI can warn the
//     user, but the comparison is shown.
//   • If both LTL and TL are allowed (default), keep the weight
//     ceiling as a fetch optimisation — TL quotes will cover heavier
//     lanes, so we don't pay the LTL fetch cost we'd discard.
//
// This module is pure (no IO) so it can be unit-tested without the
// API server running.
// ════════════════════════════════════════════════════════════════════

'use strict';

/**
 * @param {Object} args
 * @param {boolean} args.wantsLtl  — LTL is in the lane's allowedModes.
 * @param {boolean} args.wantsTl   — TL is in the lane's allowedModes.
 * @param {number}  args.weight    — Total lane weight (lbs).
 * @param {number}  args.ltlMax    — LTL ceiling from equipment_types.LTL.max_weight.
 * @returns {boolean} true if the planner should issue an /api/ltl/quote call.
 */
function shouldFetchLtl({ wantsLtl, wantsTl, weight, ltlMax }) {
  if (!wantsLtl) return false;
  // User explicitly chose LTL only → fetch even past the ceiling so
  // the UI can render the "infeasible / overweight" LTL quote next to
  // the TL alternatives (QA #136).
  const explicitLtlOnly = wantsLtl && !wantsTl;
  if (explicitLtlOnly) return true;
  // Default mixed-mode lane: skip the LTL fetch above the ceiling
  // since TL covers heavier loads anyway.
  return Number(weight) <= Number(ltlMax);
}

module.exports = { shouldFetchLtl };
