// ═══════════════════════════════════════════════════════════════════
// Independent read check — Jev verifies what Claude read.
//
// Claude reads the invoice PDF into fields and reports its own
// confidence. A model grading its own work is weak evidence, so Jev
// (TypeSafe System 1) answers, independently, whether those fields match
// the text actually printed in the PDF. The lower of its answers is the
// "Jev score". readChecks sends the invoice to a person when the score is
// low, when the PDF has no text layer, or when Jev can't be reached —
// a failed check never lets an invoice through.
//
// Env:
//   INVOICE_INTAKE_JEV_VERIFY   on (default) | off
//   INVOICE_INTAKE_JEV_MIN      minimum Jev score, default 0.8
//   INVOICE_INTAKE_JEV_TIMEOUT_MS  per call, default 8000
// ═══════════════════════════════════════════════════════════════════
'use strict';

const jev = require('../ai/jevClient');
const { extractText } = require('./pdfText');

const MIN_TEXT = 40;          // fewer printed characters than this = no usable text layer
const MAX_TEXT = 12000;       // invoices are short; cap what is sent

const QUESTIONS = {
  fields_match: {
    type: 'noul',
    instructions: 'Every value in agent_read (invoice number, carrier, shipment reference, invoice date) is printed in invoice_text with the same meaning',
  },
  lines_match: {
    type: 'noul',
    instructions: 'Each charge line amount in agent_read is printed in invoice_text for that same charge, and no charge printed in invoice_text is missing from agent_read',
  },
  total_matches: {
    type: 'noul',
    instructions: 'The total in agent_read is exactly the amount due printed in invoice_text',
  },
};

function enabled(env = process.env) {
  return String(env.INVOICE_INTAKE_JEV_VERIFY || 'on').toLowerCase() !== 'off';
}
function minScore(env = process.env) {
  const n = Number(env.INVOICE_INTAKE_JEV_MIN);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.8;
}
function timeoutMs(env = process.env) {
  const n = Number(env.INVOICE_INTAKE_JEV_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 8000;
}

/** Only the fields Jev judges. */
function agentRead(f) {
  return {
    invoiceNumber: f.invoiceNumber || null,
    carrier: f.carrier || null,
    shipmentRef: f.shipmentRef || null,
    invoiceDate: f.invoiceDate || null,
    lines: (f.lines || []).map((l) => ({ description: l.description || '', amount: l.amount })),
    total: f.total,
  };
}

/**
 * @param {{ buffer: Buffer, fields: object }} args
 * @param {object} [opts]  { systemOne, env } — test seams
 * @returns {Promise<{ status:'checked'|'off'|'no_text'|'error', score?:number, answers?:object, min:number, model?:string, latencyMs?:number, detail?:string }>}
 */
async function verify({ buffer, fields }, opts = {}) {
  const env = opts.env || process.env;
  const min = minScore(env);
  if (!enabled(env)) return { status: 'off', min };
  if (!fields) return { status: 'error', min, detail: 'nothing was read' };
  const text = extractText(buffer);
  if (text.length < MIN_TEXT) return { status: 'no_text', min, detail: 'the PDF has no readable text layer (a scan or image)' };
  const call = opts.systemOne || ((s, q) => jev.systemOne(s, q, { config: { timeoutMs: timeoutMs(env) } }));
  try {
    const res = await call({ invoice_text: text.slice(0, MAX_TEXT), agent_read: agentRead(fields) }, QUESTIONS);
    const a = res.answers || {};
    const answers = {
      fields_match: Number(a.fields_match?.noul),
      lines_match: Number(a.lines_match?.noul),
      total_matches: Number(a.total_matches?.noul),
    };
    const vals = Object.values(answers);
    if (vals.some((v) => !Number.isFinite(v))) return { status: 'error', min, detail: 'Jev returned an incomplete answer' };
    const score = Math.round(Math.min(...vals) * 100) / 100;
    return { status: 'checked', score, answers, min, model: res.model, latencyMs: res.latencyMs };
  } catch (e) {
    return { status: 'error', min, detail: e.message };
  }
}

module.exports = { verify, QUESTIONS, agentRead, enabled, minScore };
