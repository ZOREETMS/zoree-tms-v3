// ═══════════════════════════════════════════════════════════════════
// Check what Claude read before anything is saved. If the read is
// shaky, a person keys the invoice — the audit never runs on numbers
// the agent is not sure of. Pure functions, no I/O.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const MIN_CONFIDENCE = Number(process.env.INVOICE_INTAKE_MIN_CONFIDENCE) || 0.85;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const COST_TYPE = { base: 'base', fuel: 'fuel_surcharge', accessorial: 'accessorial', discount: 'discount', other: 'other' };

const firstWord = (s) => String(s || '').toLowerCase().replace(/[^a-z ]/g, ' ').trim().split(/\s+/)[0] || '';

/** Map a printed carrier name onto a carrier on file (first-word match). */
function matchCarrier(printed, knownCarriers) {
  const k = firstWord(printed);
  if (!k) return null;
  return (knownCarriers || []).find((c) => firstWord(c) === k) || null;
}

const WHAT = { fields_match: 'invoice number, carrier, shipment or date', lines_match: 'charge lines', total_matches: 'total' };

/** The independent Jev check (readVerifier) as problems / passed lines. */
function verifyLines(v) {
  if (!v || v.status === 'off') return { problems: [], passed: [] };
  if (v.status === 'checked') {
    if (v.score >= v.min) return { problems: [], passed: [`Independent check (Jev): the read matches the PDF text (${v.score.toFixed(2)})`] };
    const off = Object.entries(v.answers || {}).filter(([, n]) => n < v.min).map(([k]) => WHAT[k] || k);
    return { problems: [`Independent check (Jev) scored the read ${v.score.toFixed(2)}, below ${v.min}: the ${off.join(', ') || 'read'} may not match the PDF.`], passed: [] };
  }
  if (v.status === 'no_text') return { problems: ['The independent check (Jev) could not run: the PDF has no readable text layer (a scan or image). A person keys it.'], passed: [] };
  return { problems: [`The independent check (Jev) could not run${v.detail ? ` (${v.detail})` : ''}. A person keys it.`], passed: [] };
}

/**
 * @param {object} fields         normalized extraction
 * @param {object} ctx            { knownCarriers: string[], verify?: readVerifier result }
 * @returns {{ ok:boolean, problems:string[], passed:string[], carrier:string|null, lines:object[] }}
 */
function check(fields, { knownCarriers = [], now = new Date(), verify = null } = {}) {
  const problems = [];
  const passed = [];
  if (!fields) return { ok: false, problems: ['Nothing could be read from the PDF.'], passed, carrier: null, lines: [] };

  if (!fields.invoiceNumber) problems.push('No invoice number on the document.');
  if (!fields.shipmentRef) problems.push('No shipment reference on the document — cannot match it to a load.');
  if (!fields.lines.length) problems.push('No charge lines found.');
  if (fields.total == null) problems.push('No total found.');
  if (fields.lines.some((l) => l.amount == null)) problems.push('A charge line has no readable amount.');
  if (fields.lines.some((l) => l.category === 'other')) problems.push('A charge line could not be classified as linehaul, fuel, an extra or a discount.');

  // Credits are applied by a person against the original invoice; the agent
  // audits charges only.
  if ((fields.total != null && fields.total < 0) || fields.lines.some((l) => l.amount != null && l.amount < 0)) {
    problems.push('Negative amounts — this looks like a credit memo. A person applies credits against the original invoice.');
  }
  // A date after tomorrow is a misread or a document that should not exist yet.
  const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  if (fields.invoiceDate && fields.invoiceDate > tomorrow) problems.push(`Invoice date ${fields.invoiceDate} is in the future — check the date on the document.`);

  const signed = fields.lines.reduce((s, l) => s + (l.category === 'discount' ? -1 : 1) * (Number(l.amount) || 0), 0);
  if (fields.total != null && fields.lines.length) {
    if (Math.abs(r2(signed) - fields.total) > 0.01) problems.push(`Lines add up to $${r2(signed).toFixed(2)} but the printed total is $${fields.total.toFixed(2)}.`);
    else passed.push(`Lines add up to the printed total ($${fields.total.toFixed(2)})`);
  }

  const carrier = matchCarrier(fields.carrier, knownCarriers);
  if (!carrier) problems.push(`Carrier "${fields.carrier || '—'}" is not a carrier on file — carrier onboarding is needed before this invoice can be audited.`);
  else passed.push(`Carrier on file: ${carrier}`);

  if (!(fields.confidence >= MIN_CONFIDENCE)) problems.push(`Read confidence ${fields.confidence.toFixed(2)} is below ${MIN_CONFIDENCE}.`);
  else passed.push(`Read confidence ${fields.confidence.toFixed(2)}`);

  const v = verifyLines(verify);
  problems.push(...v.problems);
  passed.push(...v.passed);

  const lines = fields.lines.map((l, i) => ({
    cost_type: COST_TYPE[l.category] || 'other',
    description: l.description,
    invoice_cost: Math.abs(Number(l.amount) || 0),
    approved_cost: Math.abs(Number(l.amount) || 0),
    line_order: (i + 1) * 10,
    accessorial_type: l.category === 'accessorial' ? (l.accessorialType || 'other') : null,
  }));
  return { ok: problems.length === 0, problems, passed, carrier, lines };
}

module.exports = { check, matchCarrier, verifyLines, MIN_CONFIDENCE };
