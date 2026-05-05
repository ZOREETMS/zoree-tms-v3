// ═══════════════════════════════════════════════════════════════════
// Service Level Vocabulary — TMS bugs #33 + #66.
//
// OMS historically labelled this dropdown "Priority" with values
// (Standard, Expedite, Critical). TMS labels it "Service Level" with
// values (Standard, Guaranteed, Expedited, Economy, White Glove,
// Time-Critical). The two never matched, so an OMS order created with
// Priority="Expedite" landed in TMS with service_level="Expedite" —
// a value that doesn't exist in any TMS dropdown, doesn't match any
// rate row's service_level column, and produced a phantom STD-tagged
// rate at planning time.
//
// Single source of truth for: normalising any inbound service-level
// label to the canonical TMS vocabulary, mapping the legacy OMS
// "Priority" code to the matching TMS value, and surfacing the short
// (3-letter) code for UI badges.
//
// Used by:
//   - api/services/orderIngest.js — defense-in-depth on OMS push
//   - frontend/zoree-oms.html      — same mapping at the OMS submit site
//                                    (inlined; HTML app can't import this
//                                    Node module — keep them in lock-step)
// ═══════════════════════════════════════════════════════════════════

'use strict';

// Canonical TMS dropdown values. Mirrors NewOrderModal.jsx /
// OrderDetailModal.jsx / TenderAcceptModal.jsx — keep these in sync.
const CANONICAL = Object.freeze([
  'Standard',
  'Guaranteed',
  'Expedited',
  'Economy',
  'White Glove',
  'Time-Critical',
]);

// Lookup table: any label/code we might receive → canonical TMS value.
// Keys are upper-cased + whitespace-collapsed for comparison.
const ALIASES = Object.freeze({
  // Standard
  'STANDARD':       'Standard',
  'STD':            'Standard',
  'NORMAL':         'Standard',
  'REGULAR':        'Standard',
  // Expedited (the OMS "Expedite" was the single biggest cause of
  // bug #66 — mapping it explicitly here means later vocabulary
  // changes don't drop the bug fix on the floor).
  'EXPEDITE':       'Expedited',
  'EXPEDITED':      'Expedited',
  'EXPRESS':        'Expedited',
  'EXP':            'Expedited',
  // OMS legacy "Critical" maps to the closest TMS bucket. Time-Critical
  // is the strict-deadline lane (per TenderAcceptModal). Reasonable
  // semantic mapping; planners can override at edit time.
  'CRITICAL':       'Time-Critical',
  'TIME-CRITICAL':  'Time-Critical',
  'TIME CRITICAL':  'Time-Critical',
  // Economy
  'ECONOMY':        'Economy',
  'ECON':           'Economy',
  // Guaranteed
  'GUARANTEED':     'Guaranteed',
  'GTD':            'Guaranteed',
  // White Glove
  'WHITE GLOVE':    'White Glove',
  'WHITE-GLOVE':    'White Glove',
  'WG':             'White Glove',
});

const SHORT_CODE = Object.freeze({
  'Standard':      'STD',
  'Guaranteed':    'GTD',
  'Expedited':     'EXP',
  'Economy':       'ECON',
  'White Glove':   'WG',
  'Time-Critical': 'CRIT',
});

/**
 * Normalise any inbound service-level value (TMS, OMS, or short code)
 * to the canonical TMS vocabulary. Returns null for empty inputs and
 * the original (title-cased) string for values we don't recognise so a
 * future label rolls through without being silently dropped.
 *
 * @param {string|null|undefined} input
 * @returns {string|null}
 */
function normalizeServiceLevel(input) {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  const key = raw.replace(/\s+/g, ' ').toUpperCase();
  if (ALIASES[key]) return ALIASES[key];
  // Title-case unknown values so downstream comparisons are stable.
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

/** Short tag (STD / EXP / GTD / …) for UI badges. */
function serviceLevelShortCode(input) {
  const canonical = normalizeServiceLevel(input);
  return canonical ? (SHORT_CODE[canonical] || canonical.slice(0, 3).toUpperCase()) : '';
}

module.exports = {
  CANONICAL,
  ALIASES,
  SHORT_CODE,
  normalizeServiceLevel,
  serviceLevelShortCode,
};
