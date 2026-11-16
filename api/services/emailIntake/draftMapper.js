// ═══════════════════════════════════════════════════════════════════
// Email order intake — draft mapper (pure, no I/O).
//
// Turns one AI-extracted order draft into the API order shape that
// orderMutations.apiOrderToDbPatch understands, and decides which
// required / recommended fields a draft is missing.
//
// Split out of intakeService.js (2026-10-25, CLAUDE_RULES §1/§6):
// mapping, persistence and orchestration live in separate modules.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const { normalizeServiceLevel } = require('../serviceLevelVocab');

const REQUIRED = ['customer', 'origin', 'destination', 'weight'];
const RECOMMENDED = ['ready_date', 'due_date'];

function clean(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function isUS(country) {
  const c = String(country || '').trim().toUpperCase();
  return !c || ['US', 'USA', 'UNITED STATES', 'UNITED STATES OF AMERICA'].includes(c);
}

/** "DALLAS, TX 75201" — the format existing TMS orders use. Non-US: "SHENZHEN, CHINA". */
function composeLocation(a) {
  if (!a) return null;
  const city = clean(a.city);
  const state = clean(a.state);
  const zip = clean(a.zip);
  if (!isUS(a.country)) {
    const parts = [city, state, clean(a.country)].filter(Boolean);
    return parts.length ? `${parts.join(', ')}${zip ? ` ${zip}` : ''}` : null;
  }
  if (!city && !zip) return null;
  const left = [city, state].filter(Boolean).join(', ');
  return [left, zip].filter(Boolean).join(' ') || null;
}

function streetLine(a) {
  if (!a) return null;
  return [clean(a.street), composeLocation(a)].filter(Boolean).join(', ') || null;
}

/** Map one extracted draft to the API order shape apiOrderToDbPatch understands. */
function draftToOrderBody(d, ctx = {}) {
  const notes = [
    clean(d.special_instructions),
    d.ship_from && clean(d.ship_from.street) ? `Pickup address: ${streetLine(d.ship_from)}` : null,
    ctx.subject || ctx.fromAddress
      ? `Created from email${ctx.fromAddress ? ` from ${ctx.fromAddress}` : ''}${ctx.subject ? `: "${ctx.subject}"` : ''}`
      : null,
  ].filter(Boolean).join('\n');

  const body = {
    customer: clean(d.customer),
    origin: composeLocation(d.ship_from),
    destination: composeLocation(d.ship_to),
    originZip: clean(d.ship_from && d.ship_from.zip),
    destZip: clean(d.ship_to && d.ship_to.zip),
    shipFromName: clean(d.ship_from && d.ship_from.name),
    shipToName: clean(d.ship_to && d.ship_to.name),
    weight: Number(d.weight_lbs) || 0,
    pieces: Number.isFinite(Number(d.pieces)) ? Number(d.pieces) : 0,
    shipMode: clean(d.ship_mode),
    serviceLevel: normalizeServiceLevel(d.service_level) || null,
    commodity: clean(d.commodity),
    poNum: clean(d.po_number),
    refNum: clean(d.reference_number),
    readyDate: clean(d.ready_date),
    dueDate: clean(d.due_date),
    hazmat: !!d.hazmat,
    notes: notes || null,
  };
  // Drop nulls so apiOrderToDbPatch doesn't write empty columns.
  for (const k of Object.keys(body)) if (body[k] === null) delete body[k];
  return body;
}

function draftLines(d) {
  return (d.lines || []).map((l, i) => ({
    lineNum: i + 1,
    description: clean(l.description) || '',
    itemId: clean(l.item_id),
    qty: Number(l.qty) || 0,
    unitWeight: Number(l.unit_weight_lbs) || 0,
    totalWeight: Number(l.total_weight_lbs) || 0,
  }));
}

/** Which required / recommended fields a draft is missing. */
function missingFor(d) {
  const b = draftToOrderBody(d);
  const missing = [];
  if (!b.customer) missing.push('customer');
  if (!b.origin) missing.push('origin');
  if (!b.destination) missing.push('destination');
  if (!(b.weight > 0)) missing.push('weight');
  if (!b.readyDate) missing.push('ready_date');
  if (!b.dueDate) missing.push('due_date');
  return missing;
}

function rowMissing(drafts) {
  if (drafts.length <= 1) return drafts.length ? missingFor(drafts[0]) : [];
  return drafts.flatMap((d, i) => missingFor(d).map((m) => `order${i + 1}.${m}`));
}

function hasRequiredGaps(missing) {
  return missing.some((m) => REQUIRED.includes(m.split('.').pop()));
}

module.exports = {
  REQUIRED, RECOMMENDED,
  clean, composeLocation, streetLine, draftToOrderBody, draftLines, missingFor, rowMissing, hasRequiredGaps,
};
