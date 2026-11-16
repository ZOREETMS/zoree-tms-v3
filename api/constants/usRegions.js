// ═══════════════════════════════════════════════════════════════════
// US Region Map — api/constants/usRegions.js
// ─────────────────────────────────────────────────────────────────────
// Maps a two-letter US state code to one of the four region labels the
// Otodus Quantum engine expects in `origin_region` / `destination_region`
// (its bundled scripts/sample_input.json uses "Midwest"). The engine
// keys its rate_table on these labels, so origin/destination regions and
// rate_table regions MUST come from this one map — if the two disagree,
// the engine silently finds no rate row and falls back to its own
// defaults, which is invisible in the response.
//
// Census Bureau's four-region division. Deliberately a static constant,
// not a table: it changes never, and a lookup table would add a join to
// every batch mapped.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const NORTHEAST = 'Northeast';
const MIDWEST   = 'Midwest';
const SOUTH     = 'South';
const WEST      = 'West';

const STATE_REGION = Object.freeze({
  CT: NORTHEAST, ME: NORTHEAST, MA: NORTHEAST, NH: NORTHEAST, NJ: NORTHEAST,
  NY: NORTHEAST, PA: NORTHEAST, RI: NORTHEAST, VT: NORTHEAST,

  IA: MIDWEST, IL: MIDWEST, IN: MIDWEST, KS: MIDWEST, MI: MIDWEST,
  MN: MIDWEST, MO: MIDWEST, ND: MIDWEST, NE: MIDWEST, OH: MIDWEST,
  SD: MIDWEST, WI: MIDWEST,

  AL: SOUTH, AR: SOUTH, DC: SOUTH, DE: SOUTH, FL: SOUTH, GA: SOUTH,
  KY: SOUTH, LA: SOUTH, MD: SOUTH, MS: SOUTH, NC: SOUTH, OK: SOUTH,
  SC: SOUTH, TN: SOUTH, TX: SOUTH, VA: SOUTH, WV: SOUTH,

  AK: WEST, AZ: WEST, CA: WEST, CO: WEST, HI: WEST, ID: WEST,
  MT: WEST, NM: WEST, NV: WEST, OR: WEST, UT: WEST, WA: WEST, WY: WEST,
});

/**
 * @param {string|null|undefined} state two-letter code, any case
 * @returns {string|null} region label, or null when the state is unknown.
 *   Callers must treat null as "cannot map this shipment" rather than
 *   substituting a default — a wrong region silently mis-rates the load.
 */
function regionForState(state) {
  if (!state || typeof state !== 'string') return null;
  return STATE_REGION[state.trim().toUpperCase()] || null;
}

module.exports = { REGIONS: { NORTHEAST, MIDWEST, SOUTH, WEST }, STATE_REGION, regionForState };
