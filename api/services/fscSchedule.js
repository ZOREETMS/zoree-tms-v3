// ═══════════════════════════════════════════════════════════════════
// FSC Schedule Service
// ─────────────────────────────────────────────────────────────────────
// Business logic for per-carrier EIA fuel-surcharge bracket schedules
// (carrier_fsc_schedules, migration 045). A schedule is a list of
// { min_price, fsc_pct } brackets; the bracket with the LARGEST
// min_price <= the current EIA diesel price supplies the FSC percent
// applied to linehaul — the same rule as the CHR national FSC table.
// ═══════════════════════════════════════════════════════════════════

const { getClient, dbSelect } = require('./supabase');

const MAX_BRACKETS = 2000;

/**
 * Pure bracket lookup. `brackets` is [{ min_price, fsc_pct }, ...] in any
 * order; returns the fsc_pct (percent, e.g. 17.4) of the largest
 * min_price <= price, or null when no bracket applies / list is empty.
 */
function lookupFscPct(brackets, price) {
  const p = parseFloat(price);
  if (!Number.isFinite(p) || !Array.isArray(brackets) || !brackets.length) return null;
  let best = null;
  for (const b of brackets) {
    const min = parseFloat(b.min_price);
    if (!Number.isFinite(min) || min > p) continue;
    if (best === null || min > best.min) best = { min, pct: parseFloat(b.fsc_pct) };
  }
  return best && Number.isFinite(best.pct) ? best.pct : null;
}

/** Brackets for one carrier, sorted by min_price ascending. */
async function getSchedule(carrierId) {
  return dbSelect('carrier_fsc_schedules', {
    filters: [['carrier_id', 'eq', carrierId]],
    order: { col: 'min_price', asc: true },
    limit: MAX_BRACKETS,
  });
}

/**
 * Brackets for many carriers in one query — used by the rating hot path.
 * @returns {Promise<Object<string, Array>>} map carrier_id → brackets[]
 */
async function getSchedulesByCarrier(carrierIds) {
  const ids = (carrierIds || []).filter(Boolean);
  if (!ids.length) return {};
  const rows = await dbSelect('carrier_fsc_schedules', {
    filters: [['carrier_id', 'in', ids]],
    limit: MAX_BRACKETS * ids.length,
  });
  const byCarrier = {};
  rows.forEach((r) => { (byCarrier[r.carrier_id] = byCarrier[r.carrier_id] || []).push(r); });
  return byCarrier;
}

/**
 * Validate + normalize an uploaded bracket list. Accepts fsc_pct as
 * percent (17.4) or fraction (0.174) — when EVERY value is <= 1.5 the
 * whole list is treated as fractions and scaled ×100 (a real percent
 * schedule never tops out below 1.5%). Dedupes on min_price (last wins).
 * Throws { status: 400 } on structural problems.
 */
function normalizeBrackets(input) {
  if (!Array.isArray(input) || !input.length) {
    throw Object.assign(new Error('brackets must be a non-empty array of { min_price, fsc_pct }'), { status: 400 });
  }
  if (input.length > MAX_BRACKETS) {
    throw Object.assign(new Error(`too many brackets (max ${MAX_BRACKETS})`), { status: 400 });
  }
  const parsed = [];
  for (let i = 0; i < input.length; i++) {
    const min = parseFloat(input[i]?.min_price);
    const pct = parseFloat(input[i]?.fsc_pct);
    if (!Number.isFinite(min) || min < 0) {
      throw Object.assign(new Error(`row ${i + 1}: min_price must be a number >= 0`), { status: 400 });
    }
    if (!Number.isFinite(pct) || pct < 0) {
      throw Object.assign(new Error(`row ${i + 1}: fsc_pct must be a number >= 0`), { status: 400 });
    }
    parsed.push({ min_price: min, fsc_pct: pct });
  }
  const fractional = parsed.every((b) => b.fsc_pct <= 1.5);
  const byPrice = new Map();
  for (const b of parsed) {
    const pct = fractional ? Math.round(b.fsc_pct * 100 * 10000) / 10000 : b.fsc_pct;
    if (pct > 100) throw Object.assign(new Error(`fsc_pct ${pct} exceeds 100%`), { status: 400 });
    byPrice.set(b.min_price, { min_price: b.min_price, fsc_pct: pct });
  }
  return [...byPrice.values()].sort((a, b) => a.min_price - b.min_price);
}

/**
 * Atomically replace a carrier's schedule (delete + bulk insert).
 * Returns the inserted, sorted bracket list.
 */
async function replaceSchedule(carrierId, brackets) {
  if (!carrierId) throw Object.assign(new Error('carrierId is required'), { status: 400 });
  const rows = normalizeBrackets(brackets).map((b) => ({ ...b, carrier_id: carrierId }));

  const db = getClient();
  const { error: delErr } = await db.from('carrier_fsc_schedules').delete().eq('carrier_id', carrierId);
  if (delErr) throw new Error(`[DB] carrier_fsc_schedules delete failed: ${delErr.message}`);

  const { data, error: insErr } = await db.from('carrier_fsc_schedules').insert(rows).select();
  if (insErr) throw new Error(`[DB] carrier_fsc_schedules insert failed: ${insErr.message}`);
  return (data || []).sort((a, b) => a.min_price - b.min_price);
}

/** Remove a carrier's schedule entirely. */
async function deleteSchedule(carrierId) {
  if (!carrierId) throw Object.assign(new Error('carrierId is required'), { status: 400 });
  const db = getClient();
  const { error } = await db.from('carrier_fsc_schedules').delete().eq('carrier_id', carrierId);
  if (error) throw new Error(`[DB] carrier_fsc_schedules delete failed: ${error.message}`);
  return { deleted: true, carrier_id: carrierId };
}

module.exports = {
  lookupFscPct,
  getSchedule,
  getSchedulesByCarrier,
  normalizeBrackets,
  replaceSchedule,
  deleteSchedule,
};
