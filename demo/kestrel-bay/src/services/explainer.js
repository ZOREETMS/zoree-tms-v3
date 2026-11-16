'use strict';
// Plain-English layer. The rules decide; Claude explains, drafts the carrier
// email and answers the buying team's questions from the run itself.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const claude = require('./anthropicClient');
const { money } = require('./auditRules');

// Every Claude explanation / draft is saved, so an offline run (no Wi-Fi in
// the room) shows the same words the live run produced.
const CACHE_DIR = path.join(__dirname, '..', '..', 'cache', 'explanations');
const keyOf = (kind, r) => crypto.createHash('sha256').update(JSON.stringify([kind, r.invoice.invoiceNumber, r.invoice.file, r.verdict, r.issues.map((i) => i.detail), r.recommendation])).digest('hex').slice(0, 16);
function readCache(kind, r) { const p = path.join(CACHE_DIR, `${keyOf(kind, r)}.json`); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; }
function writeCache(kind, r, v) { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(path.join(CACHE_DIR, `${keyOf(kind, r)}.json`), JSON.stringify(v, null, 2)); }
async function cached(kind, r, preferCache, live, fallback) {
  const hit = readCache(kind, r);
  if (preferCache && hit) return { ...hit, cached: true };
  if (!claude.available()) return hit ? { ...hit, cached: true } : fallback();
  try { const v = { text: (await live()).text, source: 'claude' }; writeCache(kind, r, v); return v; }
  catch (e) { return hit ? { ...hit, cached: true } : { ...fallback(), error: e.message }; }
}

const SYSTEM = 'You write for an accounts-payable clerk at a 3PL. Plain words, no filler. Use only the figures given; never invent numbers. In this pilot the agent recommends and people act; never suggest posting to NetSuite. Plain text only: no markdown, no asterisks, no headings; short lines or hyphen bullets.';

function fallbackExplain(r) {
  return [r.issues.length ? r.issues.map((i) => i.detail).join(' ') : `Clean: ${r.passed.join('; ')}.`, r.recommendation].join(' ');
}

async function explain(r, { preferCache = false } = {}) {
  const content = [{ type: 'text', text: `Invoice ${r.invoice.invoiceNumber} from ${r.invoice.carrier} for ${r.invoice.shipmentId}, total ${money(r.invoice.total)}. Verdict: ${r.verdict}. Checks passed: ${JSON.stringify(r.passed)}. Issues: ${JSON.stringify(r.issues)}. Recommendation: ${r.recommendation}. In two short sentences tell the clerk what the agent found and what to do.` }];
  return cached('explain', r, preferCache, () => claude.complete({ system: SYSTEM, content, maxTokens: 250 }), () => ({ text: fallbackExplain(r), source: 'rules' }));
}

function fallbackDispute(r) {
  return `Subject: Invoice ${r.invoice.invoiceNumber} (${r.invoice.shipmentId}) — ${money(r.overcharge)} billed over contract\n\nHi ${r.invoice.carrier} billing team,\n\nWe checked invoice ${r.invoice.invoiceNumber} for ${r.invoice.shipmentId} against our contract and the shipment record:\n${r.issues.map((i) => `- ${i.detail}`).join('\n')}\n\nWe will pay ${money(r.recommendPay)} now. Please send a corrected invoice or support for the remaining ${money(r.overcharge)}.\n\nThanks,\nKestrel Bay Logistics — Accounts Payable`;
}

async function draftDispute(r, { preferCache = false } = {}) {
  const content = [{ type: 'text', text: `Draft a short, polite email (subject line + body, under 120 words) from Kestrel Bay Logistics Accounts Payable to ${r.invoice.carrier} about invoice ${r.invoice.invoiceNumber} for shipment ${r.invoice.shipmentId}. Findings: ${JSON.stringify(r.issues.map((i) => i.detail))}. We pay ${money(r.recommendPay)} now and dispute ${money(r.overcharge)}. Ask for a corrected invoice. Sign "Kestrel Bay Logistics — Accounts Payable".` }];
  return cached('dispute', r, preferCache, () => claude.complete({ system: SYSTEM, content, maxTokens: 400 }), () => ({ text: fallbackDispute(r), source: 'rules' }));
}

async function answer(question, job, policy) {
  if (!claude.available()) return { text: 'The model is offline. Every decision and its reason is still in the run table and the audit log.', source: 'rules' };
  const ctx = {
    customer: policy.customer, apRules: policy.apRules, it: policy.it, peakFreeze: policy.peakFreeze, pilot: policy.pilot,
    howItWorks: 'Invoice PDF arrives in the AP mailbox -> Claude reads the PDF into fields -> agent checks the read (lines add up, carrier known, confidence >= 0.85) -> matches the TMS shipment and contract lane (read-only) -> applies AP rules -> clean invoices go on a ready-to-post list, everything else goes to a person with the reason. Claude never decides pay/no-pay; deterministic rules do. Nothing is written to the TMS or NetSuite.',
    summary: job && job.summary,
    results: job && job.results.map((r) => ({ invoice: r.invoice.invoiceNumber, shipment: r.invoice.shipmentId, total: r.invoice.total, verdict: r.verdict, route: r.route, issues: r.issues.map((i) => i.detail), recommendation: r.recommendation })),
  };
  const content = [{ type: 'text', text: `Context (JSON): ${JSON.stringify(ctx)}\n\nQuestion from the Kestrel Bay team: ${question}\n\nAnswer in under 110 words, plainly. If the answer is not in the context, say so and say how you would find out.` }];
  try { return { text: (await claude.complete({ system: SYSTEM, content, maxTokens: 400 })).text, source: 'claude' }; }
  catch (e) { return { text: `Could not reach the model (${e.message}). The run table is still the source of truth.`, source: 'rules' }; }
}

module.exports = { explain, draftDispute, answer, available: claude.available };
