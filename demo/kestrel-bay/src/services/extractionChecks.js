'use strict';
// Check what Claude read before trusting it. If the read is shaky, a person
// looks at the PDF — the agent never audits numbers it is not sure of.
const MIN_CONFIDENCE = 0.85;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function normalizeCarrier(name, knownCarriers) {
  const n = String(name || '').toLowerCase().replace(/[^a-z ]/g, ' ');
  return knownCarriers.find((k) => n.includes(k.toLowerCase().split(' ')[0])) || null;
}

/**
 * @returns {{ok:boolean, invoice:object|null, problems:string[], passed:string[]}}
 */
function check(extraction, { knownCarriers, seq }) {
  const problems = [];
  const passed = [];
  const f = extraction.fields;
  if (!f) return { ok: false, invoice: null, problems: [`Could not read ${extraction.file}: ${extraction.error || 'unknown error'}`], passed };

  if (!f.invoiceNumber) problems.push('No invoice number on the document.');
  if (!f.shipmentRef) problems.push('No Kestrel Bay shipment reference on the document.');
  if (!Array.isArray(f.lines) || !f.lines.length) problems.push('No charge lines found.');
  if (typeof f.total !== 'number') problems.push('No total found.');

  const lineSum = r2((f.lines || []).reduce((s, l) => s + (Number(l.amount) || 0), 0));
  if (typeof f.total === 'number') {
    if (Math.abs(lineSum - f.total) > 0.01) problems.push(`Lines add up to $${lineSum.toFixed(2)} but the invoice total says $${f.total.toFixed(2)}.`);
    else passed.push(`Lines add up to the printed total ($${f.total.toFixed(2)})`);
  }
  if ((f.lines || []).some((l) => l.category === 'other')) problems.push('A charge line could not be classified as base, fuel or an extra.');

  const carrier = normalizeCarrier(f.carrier, knownCarriers);
  if (!carrier) problems.push(`Carrier "${f.carrier}" is not a contracted carrier.`);
  else passed.push(`Carrier recognised: ${carrier}`);

  const conf = Number(f.confidence);
  if (!(conf >= MIN_CONFIDENCE)) problems.push(`Read confidence ${isNaN(conf) ? 'unknown' : conf.toFixed(2)} is below ${MIN_CONFIDENCE}.`);
  else passed.push(`Read confidence ${conf.toFixed(2)}`);

  const invoice = {
    seq,
    file: extraction.file,
    invoiceNumber: f.invoiceNumber,
    carrier: carrier || f.carrier,
    carrierAsPrinted: f.carrier,
    shipmentId: f.shipmentRef,
    proNumber: f.proNumber,
    invoiceDate: f.invoiceDate,
    lines: (f.lines || []).map((l) => ({
      type: l.category === 'accessorial' ? 'accessorial' : l.category,
      name: l.accessorialType || (l.category === 'accessorial' ? l.description : undefined),
      hours: l.hours ?? undefined,
      description: l.description,
      amount: r2(l.amount),
    })),
    total: r2(f.total),
    readWarnings: f.warnings || [],
  };
  return { ok: problems.length === 0, invoice, problems, passed };
}

module.exports = { check, normalizeCarrier, MIN_CONFIDENCE };
