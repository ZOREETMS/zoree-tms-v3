// ═══════════════════════════════════════════════════════════════════
// Rate Matcher — api/services/rateMatcher.js
//
// Mode-agnostic (LTL, TL, Intermodal, …). Given a shipment context
// (origin/dest city, ZIP, country, weight) and an array of candidate
// rate rows for a single carrier on a single mode, return the rate
// that should be used to price the shipment — or null if none apply.
//
// Each rate row carries a `match_type` (migration 021):
//
//   • 'city_to_city'       — case-insensitive EXACT match on origin
//                            and dest CITY names.
//   • 'zip_to_zip'         — exact match on origin_zip / dest_zip
//                            (5-digit ZIPs on both sides).
//   • 'country_to_country' — match on origin_country / dest_country
//                            only; city/zip ignored.
//
// REQ-31 rate-shop: the caller invokes matchRate() per carrier for
// each mode it wants to shop (LTL, TL, …). Every successful match
// produces a quote; the caller concatenates quotes across modes and
// sorts by totalCharge so the cheapest wins regardless of mode.
//
// Matching is STRICT by design: if a rate's match_type can't be
// satisfied with the shipment's data, the rate is skipped and the
// carrier falls through to its city-level carrier fallback (blank
// origin+dest rate) or to a mode-specific default (e.g. CzarLite-
// only for LTL).
//
// Legacy rows predating migration 021 default match_type to
// 'city_to_city' (via the DEFAULT on ADD COLUMN), so behavior is
// unchanged for those rows unless a planner explicitly re-classifies
// the rate via the Edit Rate Modal.
//
// This module is intentionally dependency-free (pure JS, no DB/HTTP)
// so it can be unit-tested in isolation and reused from any planning
// surface (bulk-plan, Plan Group, Plan Selected, Route Optimizer).
// ═══════════════════════════════════════════════════════════════════

'use strict';

/** @typedef {'city_to_city'|'zip_to_zip'|'country_to_country'} MatchType */

/** Canonical list — mirrored in frontend/src/services/rateService.js */
const MATCH_TYPES = Object.freeze({
  CITY:    'city_to_city',
  ZIP:     'zip_to_zip',
  COUNTRY: 'country_to_country',
});

/**
 * Normalize a city name for comparison: lowercase, trimmed, drop any
 * state/zip suffix that might have been concatenated into it.
 * Returns '' if the input is falsy.
 */
function normCity(value) {
  if (!value) return '';
  // Take part before first comma, strip any trailing 5-digit ZIP, trim.
  const head = String(value).split(',')[0] || '';
  return head.replace(/\d{5}/g, '').trim().toLowerCase();
}

/** Normalize a 5-digit ZIP; returns '' if not a 5-digit string. */
function normZip(value) {
  if (!value) return '';
  const m = String(value).match(/\d{5}/);
  return m ? m[0] : '';
}

/** Normalize a country code: uppercase, trimmed. Defaults to '' if missing. */
function normCountry(value) {
  if (!value) return '';
  return String(value).trim().toUpperCase();
}

/**
 * Does a single rate row match the given shipment context?
 * Split out for testability.
 *
 * @param {Object} rate           Rate row from the DB.
 * @param {Object} ctx            Shipment context.
 * @returns {boolean}
 */
function rateMatchesShipment(rate, ctx) {
  if (!rate) return false;

  const type = rate.match_type || MATCH_TYPES.CITY; // legacy rows default to city

  if (type === MATCH_TYPES.CITY) {
    const rateOriginCity = normCity(rate.origin);
    const rateDestCity   = normCity(rate.dest);
    if (!rateOriginCity || !rateDestCity) return false;
    return rateOriginCity === ctx.originCity && rateDestCity === ctx.destCity;
  }

  if (type === MATCH_TYPES.ZIP) {
    const rateOriginZip = normZip(rate.origin_zip);
    const rateDestZip   = normZip(rate.dest_zip);
    if (!rateOriginZip || !rateDestZip) return false;
    if (!ctx.originZip || !ctx.destZip)  return false;
    return rateOriginZip === ctx.originZip && rateDestZip === ctx.destZip;
  }

  if (type === MATCH_TYPES.COUNTRY) {
    const rateOriginCountry = normCountry(rate.origin_country);
    const rateDestCountry   = normCountry(rate.dest_country);
    if (!rateOriginCountry || !rateDestCountry) return false;
    return (
      rateOriginCountry === ctx.originCountry &&
      rateDestCountry   === ctx.destCountry
    );
  }

  // Unknown match_type — refuse to match. Surfaces the bad data instead
  // of silently succeeding with a potentially wrong rate.
  return false;
}

/**
 * Pick the best matching rate from a list of candidates.
 *
 * Lookup ladder:
 *   1. First rate whose match_type is satisfied on geo.
 *   2. Carrier-level fallback — a rate with blank origin AND blank
 *      dest ("applies to any lane for this carrier").
 *   3. null with 'no-match' — caller should price CzarLite-only.
 *
 * Migration 030 dropped the `czarlite_min_wt` / `czarlite_max_wt`
 * weight-break columns; the matcher no longer rejects rates on
 * shipment weight. The single `LTL_MAX` ceiling in api/server.js is
 * the only weight gate on the LTL rating path.
 *
 * @param {Object} ctx   Shipment context (see below).
 * @param {Array}  rates Candidate rate rows (already filtered to the
 *                       relevant carrier + mode + status by the caller).
 * @returns {{
 *   rate:   Object|null,
 *   reason: string        // 'matched:<type>' | 'no-candidates' | 'no-match'
 * }}
 */
function matchRate(ctx, rates) {
  if (!Array.isArray(rates) || rates.length === 0) {
    return { rate: null, reason: 'no-candidates' };
  }

  const context = {
    originCity:    normCity(ctx.originCity),
    destCity:      normCity(ctx.destCity),
    originZip:     normZip(ctx.originZip),
    destZip:       normZip(ctx.destZip),
    originCountry: normCountry(ctx.originCountry) || 'USA',
    destCountry:   normCountry(ctx.destCountry)   || 'USA',
  };

  // Step 1: first rate that matches on GEO.
  for (const r of rates) {
    if (!rateMatchesShipment(r, context)) continue;
    return {
      rate:   r,
      reason: `matched:${r.match_type || MATCH_TYPES.CITY}`,
    };
  }

  // Step 2: carrier-level fallback — a legacy "any lane for this
  // carrier" rate. Qualifies ONLY when match_type is city_to_city
  // (explicit or defaulted) AND origin + dest are blank. A
  // zip_to_zip or country_to_country rate that misses on its own
  // type should NOT silently become a fallback — the planner
  // declared it structured on purpose.
  const fallback = rates.find((r) => {
    const type = r.match_type || MATCH_TYPES.CITY;
    return type === MATCH_TYPES.CITY && !r.origin && !r.dest;
  });
  if (fallback) {
    return { rate: fallback, reason: 'matched:carrier-fallback' };
  }

  return { rate: null, reason: 'no-match' };
}

/**
 * Pick EVERY matching rate from a list of candidates for a single
 * carrier on a single mode. Mirrors matchRate() but returns the full
 * set instead of the first hit, so the planner can surface multiple
 * service levels (Standard + Express, etc.) for the same carrier on
 * the same lane.
 *
 * Lookup ladder:
 *   1. All rates whose match_type is satisfied on geo. If at least
 *      one such rate exists, return them all (the carrier-level
 *      fallback in step 2 is NOT consulted — explicit lane rates
 *      always win over a blanket "any lane for this carrier" row).
 *   2. Carrier-level fallback (blank origin AND blank dest, match_type
 *      city_to_city). Returned as a single rate.
 *   3. Empty array with 'no-match' — caller may price CzarLite-only.
 *
 * Migration 030 dropped the per-rate weight-break columns, so the
 * matcher no longer filters on shipment weight.
 *
 * @param {Object} ctx   Shipment context (same shape as matchRate).
 * @param {Array}  rates Candidate rate rows for one carrier + mode.
 * @returns {{
 *   rates:  Array<{ rate: Object, reason: string }>,
 *   reason: string        // 'matched' | 'no-candidates' | 'no-match'
 * }}
 */
function matchAllRates(ctx, rates) {
  if (!Array.isArray(rates) || rates.length === 0) {
    return { rates: [], reason: 'no-candidates' };
  }

  const context = {
    originCity:    normCity(ctx.originCity),
    destCity:      normCity(ctx.destCity),
    originZip:     normZip(ctx.originZip),
    destZip:       normZip(ctx.destZip),
    originCountry: normCountry(ctx.originCountry) || 'USA',
    destCountry:   normCountry(ctx.destCountry)   || 'USA',
  };

  // Step 1: collect every rate that matches on GEO.
  const matched = [];
  for (const r of rates) {
    if (!rateMatchesShipment(r, context)) continue;
    matched.push({
      rate:   r,
      reason: `matched:${r.match_type || MATCH_TYPES.CITY}`,
    });
  }

  if (matched.length > 0) {
    return { rates: matched, reason: 'matched' };
  }

  // Step 2: carrier-level fallback (same rule as matchRate).
  const fallback = rates.find((r) => {
    const type = r.match_type || MATCH_TYPES.CITY;
    return type === MATCH_TYPES.CITY && !r.origin && !r.dest;
  });
  if (fallback) {
    return {
      rates:  [{ rate: fallback, reason: 'matched:carrier-fallback' }],
      reason: 'matched',
    };
  }

  return { rates: [], reason: 'no-match' };
}

module.exports = {
  MATCH_TYPES,
  matchRate,
  matchAllRates,
  // Exposed for unit tests; not part of the public API.
  _internal: { rateMatchesShipment, normCity, normZip, normCountry },
};
