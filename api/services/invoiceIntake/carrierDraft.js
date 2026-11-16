// ═══════════════════════════════════════════════════════════════════
// Carrier dispute draft — the email AP sends to a carrier about a held
// invoice. Pure: built from the audit's line comparison, no I/O, no model.
//
//   Draft only. Zoree never sends it: AP reviews and sends it from their
//   own mailbox. Building a draft never approves, releases or changes the
//   invoice — it stays on hold until a corrected invoice or a data fix
//   makes the 3-way match pass.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const usd = (n) => `$${r2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const titleCase = (s) => String(s || '').toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const PASSES = new Set(['approve', 'review']);

function lineName(l) {
  if (l.type === 'base') return 'Linehaul (base rate)';
  if (l.type === 'fuel_surcharge') return 'Fuel surcharge';
  return titleCase(l.description || l.type || 'Extra charge');
}

/**
 * @param {object} a
 * @param {string} a.invoiceNumber
 * @param {string} a.carrier
 * @param {string|null} a.shipmentId   shipment reference on the invoice
 * @param {number} a.invoiceTotal      billed total
 * @param {Array<{type:string, description?:string, billed:number, expected:number|null, difference:number|null, status:string}>} a.lines
 * @param {{verdict:string, issues:Array<{code:string, detail?:string}>}|null} a.audit
 * @param {string|null} [a.to]         carrier address the invoice came from
 * @returns {null | {to:string|null, subject:string, body:string, correctedTotal:number|null, reduction:number|null, reasons:string[]}}
 *          null when there is nothing to dispute (the invoice passes, or no audit ran)
 */
function buildCarrierDraft({ invoiceNumber, carrier, shipmentId, invoiceTotal, lines = [], audit, to = null }) {
  if (!audit || PASSES.has(audit.verdict)) return null;
  const codes = new Set((audit.issues || []).map((i) => i.code));
  const name = titleCase(carrier) || 'Carrier';
  const ship = shipmentId || 'the shipment on this invoice';
  const reasons = [];
  const points = [];
  let correctedTotal = null; let reduction = null;

  if (codes.has('no_shipment')) {
    reasons.push('shipment_not_found');
    points.push(`We can't find shipment ${ship} in our records. Please send the bill of lading and proof of delivery, or confirm the correct shipment number.`);
  } else if (codes.has('not_delivered')) {
    reasons.push('shipment_not_delivered');
    const issue = (audit.issues || []).find((i) => i.code === 'not_delivered');
    const cancelled = /cancel/i.test((issue && issue.detail) || '');
    points.push(cancelled
      ? `Shipment ${ship} was cancelled, so there is nothing to bill. Please void this invoice.`
      : `Shipment ${ship} is not shown as delivered in our records. Please send proof of delivery.`);
  } else {
    const base = lines.find((l) => l.type === 'base');
    const wrong = lines.filter((l) => l.status === 'over' || l.status === 'not_approved');
    for (const l of wrong) {
      if (l.status === 'not_approved') {
        reasons.push('extra_not_approved');
        points.push(`${lineName(l)}: billed ${usd(l.billed)}, but there is no approval for this charge on shipment ${ship}. Please send the signed approval or delivery receipt, or remove the charge.`);
      } else {
        reasons.push(l.type === 'base' ? 'base_over_contract' : l.type === 'fuel_surcharge' ? 'fuel_over' : 'extra_over_approval');
        let ref = `${l.type === 'base' ? 'contract rate' : 'expected'} ${usd(l.expected)}`;
        if (l.type === 'fuel_surcharge' && base && Number(base.expected) > 0) {
          ref += ` (${Math.round((Number(l.expected) / Number(base.expected)) * 1000) / 10}% of the ${usd(base.expected)} contract base)`;
        }
        points.push(`${lineName(l)}: billed ${usd(l.billed)}, ${ref}, a difference of ${usd(l.difference)}.`);
      }
    }
    if (!points.length) return null; // e.g. only over the approval limit: nothing for the carrier to fix
    const expectedTotal = lines.reduce((s, l) => s + (l.expected == null ? Number(l.billed || 0) : Number(l.expected)), 0);
    correctedTotal = r2(expectedTotal);
    reduction = r2(Number(invoiceTotal || 0) - correctedTotal);
  }

  const subject = `Invoice ${invoiceNumber} (shipment ${ship}): ${reasons[0] === 'shipment_not_delivered' && /cancelled/.test(points[0]) ? 'please void' : reasons[0] === 'shipment_not_found' ? 'shipment documents needed' : 'corrected invoice requested'}`;
  const ask = correctedTotal != null
    ? `Please send a corrected invoice for ${usd(correctedTotal)}, which reduces the bill by ${usd(reduction)}.`
    : null;
  const body = [
    `Hello ${name} billing team,`,
    '',
    `We have placed invoice ${invoiceNumber} for shipment ${ship} (billed ${usd(invoiceTotal)}) on hold for the following reason${points.length > 1 ? 's' : ''}:`,
    '',
    ...points.map((p) => `- ${p}`),
    '',
    ...(ask ? [ask, ''] : []),
    'The invoice will stay on hold until we receive this. Please reply to this email with any questions.',
    '',
    'Thank you,',
    'Accounts Payable',
    'Kestrel Bay Logistics',
  ].join('\n');

  return { to: to || null, subject, body, correctedTotal, reduction, reasons };
}

module.exports = { buildCarrierDraft };
