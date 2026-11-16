// Freight audit — pure line-level rules (no I/O).
//
// Expected charges come from the rated shipment (base, fuel,
// accessorials the planner approved). When the carrier is on the EIA
// fuel program, expected fuel is re-derived from its bracket schedule at
// the current diesel price, so a stale or wrong fuel % is caught even if
// the shipment snapshot carried it.
'use strict';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const money = (n) => `$${r2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const TOLERANCE_USD = 1; // rounding noise

function sumBy(lines, type) {
  return r2(lines.filter((l) => l.cost_type === type).reduce((s, l) => s + (Number(l.invoice_cost) || 0), 0));
}

/** Expected charge breakdown for the shipment(s) on an invoice. */
function expectedCharges(shipments, { eiaFscPct = null } = {}) {
  const base = r2(shipments.reduce((s, x) => s + (Number(x.rate) || 0), 0));
  const snapshotFuel = r2(shipments.reduce((s, x) => s + (Number(x.fuel_surcharge) || 0), 0));
  const fuel = eiaFscPct != null ? r2(base * (eiaFscPct / 100)) : snapshotFuel;
  const accessorial = r2(shipments.reduce((s, x) => s + (Number(x.accessorials) || 0), 0));
  const total = r2(shipments.reduce((s, x) => s + (Number(x.total_cost) || 0), 0));
  return { base, fuel, fuelSource: eiaFscPct != null ? 'eia' : 'shipment', eiaFscPct, accessorial, total };
}

/**
 * @param {object} args
 * @param {object} args.invoice
 * @param {object[]} args.lines        invoice_cost_lines
 * @param {object[]} args.shipments    shipments on the invoice
 * @param {object[]} args.siblings     other open invoices for the same shipment(s)
 * @param {object} args.expected       expectedCharges(...)
 * @param {object[]} [args.approvals] shipment_accessorial_approvals rows for these shipments
 * @returns {{issues:object[], recoverable:number, payAmount:number, verdict:'dispute'|'approve'|'hold'|'needs_data'}}
 */
function auditInvoice({ invoice, lines, shipments, siblings, expected, approvals = [], policy = {} }) {
  const issues = [];
  const passed = []; // checks that cleared — shown to AP so a clean verdict is explainable
  const billed = r2(invoice.invoiced_amount);

  if (!shipments.length) {
    const named = shipmentIdsNamed(invoice);
    return { issues: [{ code: 'no_shipment', severity: 'high', amount: 0, detail: named.length
      ? `Shipment ${named.join(', ')} is not in the TMS, so there is nothing to check this invoice against. Hold it and ask the carrier for the BOL and POD.`
      : 'Invoice is not linked to a shipment, so there is no rated cost to audit against. Link the shipment/BOL first.' }], passed, recoverable: 0, payAmount: 0, verdict: 'needs_data', toPerson: true };
  }
  passed.push(`Shipment ${shipments.map((s) => s.id).join(', ')} found`);

  const mismatched = carrierMismatch(invoice.carrier, shipments);
  if (mismatched.length) {
    issues.push({ code: 'carrier_mismatch', severity: 'high', amount: 0, detail: `Invoice is from ${invoice.carrier} but ${mismatched.map((s) => `${s.id} moved with ${s.carrier}`).join(', ')}. Confirm which carrier hauled it before paying.` });
  }

  const undelivered = shipments.filter((s) => s.status && s.status !== 'Delivered');
  if (undelivered.length) {
    const cancelled = undelivered.some((s) => s.status === 'Cancelled');
    issues.push({ code: 'not_delivered', severity: 'high', amount: cancelled ? billed : 0, detail: cancelled
      ? `${undelivered.map((s) => `${s.id} is ${s.status}`).join(', ')} — a cancelled shipment should not be billed. Ask the carrier to void this invoice.`
      : `${undelivered.map((s) => `${s.id} is ${s.status}`).join(', ')} — no delivery on file. Do not pay before POD.` });
  } else passed.push('Delivered');

  if (siblings.length) {
    const ids = siblings.map((s) => s.invoice_number || s.id).join(', ');
    const sameNumber = siblings.some((s) => s.invoice_number && s.invoice_number === invoice.invoice_number);
    issues.push({ code: 'duplicate_invoice', severity: 'high', amount: billed, detail: sameNumber
      ? `Invoice number ${invoice.invoice_number} was already received (${ids}). Pay once — hold the full ${money(billed)}.`
      : `Shipment ${shipments.map((s) => s.id).join(', ')} is already billed on ${ids}. This looks like a duplicate — hold the full ${money(billed)}.` });
  }

  if (lines.length) {
    const base = sumBy(lines, 'base');
    const fuel = sumBy(lines, 'fuel_surcharge');
    if (base - expected.base > TOLERANCE_USD) {
      issues.push({ code: 'base_over_contract', severity: 'high', amount: r2(base - expected.base), detail: `Linehaul billed ${money(base)} vs contract ${money(expected.base)}.` });
    } else passed.push(`Linehaul ${money(base)} matches contract`);
    if (fuel - expected.fuel > TOLERANCE_USD) {
      const billedPct = expected.base ? r2((fuel / expected.base) * 100) : null;
      issues.push({ code: 'fuel_over', severity: 'high', amount: r2(fuel - expected.fuel), detail: `Fuel billed ${money(fuel)}${billedPct != null ? ` (${billedPct}% of linehaul)` : ''} vs ${money(expected.fuel)} expected${expected.fuelSource === 'eia' ? ` at the EIA bracket (${expected.eiaFscPct}%)` : ' on the rated shipment'}.${fuelOnWrongBase({ base, fuel, expected })}` });
    } else passed.push(`Fuel ${money(fuel)} matches expected`);
    checkAccessorials({ lines, expected, approvals, issues, passed });
  } else if (billed - expected.total > TOLERANCE_USD) {
    issues.push({ code: 'unexplained_variance', severity: 'medium', amount: r2(billed - expected.total), detail: `Billed ${money(billed)} vs rated ${money(expected.total)} with no line breakdown. Request an itemized invoice.` });
  }

  const duplicate = issues.some((i) => i.code === 'duplicate_invoice');
  const lineOver = r2(issues.filter((i) => i.code !== 'duplicate_invoice').reduce((s, i) => s + i.amount, 0));
  const recoverable = duplicate ? billed : Math.min(lineOver, billed);
  const payAmount = duplicate || undelivered.length ? 0 : r2(Math.max(0, billed - recoverable));
  let verdict = 'approve';
  if (recoverable > 0) verdict = 'dispute';
  else if (undelivered.length) verdict = 'hold';
  if (issues.some((i) => i.code === 'carrier_mismatch') && verdict === 'approve') verdict = 'hold';
  // AP rule: anything over the auto-approve limit goes to a person, even when every line matches.
  const limit = Number(policy.approvalLimitUsd) || 0;
  if (verdict === 'approve' && limit && billed > limit) {
    verdict = 'review';
    issues.push({ code: 'over_approval_limit', severity: 'info', amount: 0, detail: `Every line matches, but ${money(billed)} is over the ${money(limit)} auto-approve limit, so a person approves it.` });
  } else if (verdict === 'approve' && limit) passed.push(`Under the ${money(limit)} auto-approve limit`);
  return { issues, passed, recoverable: r2(recoverable), payAmount: verdict === 'hold' ? 0 : payAmount, verdict, toPerson: verdict !== 'approve' };
}

/**
 * Extras need an approval on the shipment.
 *  - Lines that carry an accessorial_type (PDF intake) are matched to
 *    approval rows of that type when the shipment has any approval rows.
 *  - Everything else keeps the legacy check: total extras vs the
 *    shipment's approved accessorials amount.
 */
function checkAccessorials({ lines, expected, approvals, issues, passed }) {
  const accLines = lines.filter((l) => l.cost_type === 'accessorial');
  if (!accLines.length) return;
  const typed = approvals.length ? accLines.filter((l) => l.accessorial_type) : [];
  const legacy = accLines.filter((l) => !typed.includes(l));

  const byType = new Map();
  for (const l of typed) byType.set(l.accessorial_type, [...(byType.get(l.accessorial_type) || []), l]);
  for (const [type, ls] of byType) {
    const billed = r2(ls.reduce((s, l) => s + (Number(l.invoice_cost) || 0), 0));
    const rows = approvals.filter((a) => a.accessorial_type === type);
    const label = type.replace(/_/g, ' ');
    if (!rows.length) {
      issues.push({ code: 'accessorial_unapproved', severity: 'medium', amount: billed, detail: `${cap(label)} ${money(billed)} billed, but there is no ${label} approval on the shipment.` });
      continue;
    }
    const approved = r2(rows.reduce((s, a) => s + approvedAmount(a), 0));
    const basis = rows.map(basisText).join(' + ');
    if (billed - approved > TOLERANCE_USD) {
      issues.push({ code: 'accessorial_over_approval', severity: 'medium', amount: r2(billed - approved), detail: `${cap(label)} ${money(billed)} billed vs ${money(approved)} approved (${basis}).` });
    } else passed.push(`${cap(label)} ${money(billed)} approved on the shipment (${basis})`);
  }

  if (legacy.length) {
    const acc = r2(legacy.reduce((s, l) => s + (Number(l.invoice_cost) || 0), 0));
    if (acc - expected.accessorial > TOLERANCE_USD) {
      const names = legacy.map((l) => `${l.description || 'accessorial'} ${money(l.invoice_cost)}`).join(', ');
      issues.push({ code: 'accessorial_unapproved', severity: 'medium', amount: r2(acc - expected.accessorial), detail: `Extra charges billed ${money(acc)} (${names}) but only ${money(expected.accessorial)} is approved on the shipment in the TMS. Extras need an approval before they are paid, so dispute it or get the approval and supporting receipts.` });
    } else passed.push(`Accessorials ${money(acc)} within ${money(expected.accessorial)} approved on the shipment`);
  }
}

function approvedAmount(a) {
  if (a.max_hours != null && a.rate_per_hour != null) return r2(Number(a.max_hours) * Number(a.rate_per_hour));
  return r2(a.max_amount);
}

function basisText(a) {
  if (a.max_hours != null && a.rate_per_hour != null) return `${Number(a.max_hours)} hrs × ${money(a.rate_per_hour)}`;
  return `up to ${money(a.max_amount)}`;
}

const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);

/** Carrier applied the right fuel % to an overbilled linehaul → say so plainly. */
function fuelOnWrongBase({ base, fuel, expected }) {
  if (!expected.base || !base || base - expected.base <= TOLERANCE_USD) return '';
  const pctOnBilled = (fuel / base) * 100;
  const pctExpected = (expected.fuel / expected.base) * 100;
  return Math.abs(pctOnBilled - pctExpected) < 0.05 ? ` The fuel % is right but was applied to the overbilled linehaul (${money(base)} instead of ${money(expected.base)}).` : '';
}

function carrierKey(name) {
  return String(name || '').toLowerCase().replace(/[^a-z ]/g, ' ').trim().split(/\s+/)[0] || '';
}

/** Shipments whose carrier does not match the invoicing carrier (first-word match, case-insensitive). */
function carrierMismatch(invoiceCarrier, shipments) {
  const k = carrierKey(invoiceCarrier);
  if (!k) return [];
  return shipments.filter((s) => s.carrier && carrierKey(s.carrier) !== k);
}

/** Shipment ids the invoice names, whether or not they exist in the TMS. */
function shipmentIdsNamed(invoice) {
  if (Array.isArray(invoice.shipment_ids) && invoice.shipment_ids.length) return invoice.shipment_ids;
  return invoice.shipment_id ? [invoice.shipment_id] : [];
}

function closingLine(audit) {
  if (audit.payAmount > 0) return `We will pay ${money(audit.payAmount)} now. Please send a corrected invoice or supporting documents for the remaining ${money(audit.recoverable)}.`;
  if (audit.issues.some((i) => i.code === 'no_shipment' || (i.code === 'not_delivered' && !i.amount))) return 'We are holding this invoice. Please send the BOL and signed POD so we can match it to the shipment.';
  if (audit.issues.some((i) => i.code === 'duplicate_invoice')) return 'This invoice was already received, so we are paying it once. Please confirm this copy was sent in error.';
  return 'We are holding this invoice. Please void it or confirm whether it was sent in error.';
}

function buildDisputeEmail({ invoice, carrier, audit, shipments }) {
  const named = shipments.length ? shipments.map((s) => s.id) : shipmentIdsNamed(invoice);
  return {
    subject: audit.payAmount > 0
      ? `Invoice ${invoice.invoice_number || invoice.id} — short-paid ${money(audit.recoverable)} pending correction`
      : `Invoice ${invoice.invoice_number || invoice.id} — on hold, not payable as billed`,
    body: [
      `Hi ${carrier || 'team'},`,
      '',
      `We audited invoice ${invoice.invoice_number || invoice.id} (${money(invoice.invoiced_amount)}) for ${named.join(', ') || 'an unidentified shipment'} against the rated load:`,
      '',
      ...audit.issues.map((i) => `- ${i.detail}`),
      '',
      closingLine(audit),
      '',
      'Thanks,',
      'Zoree TMS · Freight Audit',
    ].join('\n'),
  };
}

module.exports = { expectedCharges, auditInvoice, buildDisputeEmail, carrierKey, money, r2 };
