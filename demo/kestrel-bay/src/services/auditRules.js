'use strict';
// Pure audit rules for one carrier invoice against the TMS shipment and the
// contract rate. No I/O. Adapted from Zoree TMS freightAudit/auditRules.js and
// extended with Kestrel Bay's AP rules.
//
// The agent never "disputes" on its own: AP rule says any dispute goes to a
// person. It clears clean invoices and, for the rest, says what is wrong and
// what it recommends.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const money = (n) => `$${r2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cap = (s) => { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); };

function sumBy(lines, type) {
  return r2(lines.filter((l) => l.type === type).reduce((s, l) => s + (Number(l.amount) || 0), 0));
}

function approvalFor(line, approvedExtras) {
  const ap = (approvedExtras || []).find((a) => a.type === String(line.name || '').toLowerCase());
  if (!ap) return null;
  if (ap.maxHours != null && ap.ratePerHour != null) return { ...ap, amount: r2(ap.maxHours * ap.ratePerHour), basis: `${ap.maxHours} hrs × ${money(ap.ratePerHour)}` };
  if (ap.maxAmount != null) return { ...ap, amount: r2(ap.maxAmount), basis: `up to ${money(ap.maxAmount)}` };
  return null;
}

/**
 * verdict: 'clear' | 'overbilled' | 'duplicate' | 'not_payable' | 'unmatched' | 'unreadable'
 * kind of money: overcharge (part of invoice wrong) vs held (whole invoice should not be paid yet)
 */
function auditInvoice({ invoice, shipment, contract, priorSame, rules }) {
  const tol = rules.toleranceUsd ?? 1;
  const issues = [];
  const passed = [];
  const billed = r2(invoice.total);
  const out = (o) => ({ issues, passed, overcharge: 0, held: 0, recommendPay: 0, ...o });

  // 1. Never pay the same invoice twice.
  if (priorSame.length) {
    const p = priorSame[0];
    const sameNumber = p.invoiceNumber === invoice.invoiceNumber;
    issues.push({ code: 'duplicate_invoice', amount: billed, detail: `${sameNumber ? `Same invoice number ${invoice.invoiceNumber}` : `Shipment ${invoice.shipmentId}`} was already received as invoice #${p.seq}${p.proNumber && p.proNumber === invoice.proNumber ? ` (same PRO ${p.proNumber})` : ''}. Pay once — do not pay this copy.` });
    return out({ verdict: 'duplicate', route: 'person', held: billed, recommendation: 'Do not pay. Close as duplicate.' });
  }

  // 2. Shipment must exist in the TMS.
  if (!shipment) {
    issues.push({ code: 'shipment_not_found', amount: billed, detail: `${invoice.shipmentId} is not in the TMS, so there is nothing to check the charges against.` });
    return out({ verdict: 'unmatched', route: 'person', held: billed, recommendation: `Hold. Ask ${invoice.carrier} for the BOL and the correct Kestrel Bay shipment number.` });
  }
  passed.push(`Shipment ${shipment.id} found in TMS (${shipment.status})`);

  // 3. Carrier on the invoice must be the carrier on the shipment.
  if (shipment.carrier !== invoice.carrier) {
    issues.push({ code: 'carrier_mismatch', amount: billed, detail: `Invoice is from ${invoice.carrier} but ${shipment.id} moved with ${shipment.carrier}.` });
    return out({ verdict: 'unmatched', route: 'person', held: billed, recommendation: 'Hold. Confirm which carrier moved the freight.' });
  }

  // 4. Only delivered shipments get paid.
  if (shipment.status !== 'Delivered') {
    issues.push({ code: 'shipment_not_delivered', amount: billed, detail: `${shipment.id} is ${shipment.status} in the TMS.${shipment.status === 'Cancelled' ? ' A cancelled shipment should not be billed.' : ' No delivery on file.'}` });
    return out({ verdict: 'not_payable', route: 'person', held: billed, recommendation: shipment.status === 'Cancelled' ? `Do not pay. Ask ${invoice.carrier} to void the invoice.` : 'Hold until delivery is confirmed.' });
  }

  // 5. Contract rate must be on file.
  if (!contract) {
    issues.push({ code: 'no_contract_rate', amount: billed, detail: `No contract rate for ${shipment.carrier} ${shipment.origin} → ${shipment.destination}.` });
    return out({ verdict: 'unmatched', route: 'person', held: billed, recommendation: 'Hold. Load the contract rate or confirm a spot quote.' });
  }

  const exp = { base: r2(contract.baseRate), fuelPct: contract.fuelPct, fuel: r2(contract.baseRate * contract.fuelPct / 100) };
  const base = sumBy(invoice.lines, 'base');
  const fuel = sumBy(invoice.lines, 'fuel');

  // 6. Pay the contract rate.
  if (base - exp.base > tol) {
    issues.push({ code: 'base_over_contract', amount: r2(base - exp.base), detail: `Base billed ${money(base)}; contract for ${shipment.origin} → ${shipment.destination} is ${money(exp.base)} (${money(base - exp.base)} over).` });
  } else passed.push(`Base ${money(base)} = contract ${money(exp.base)}`);

  // 7. Fuel = contract % of the contract base.
  if (fuel - exp.fuel > tol) {
    const onBilledBase = base ? r2(fuel / base * 100) : null;
    const why = onBilledBase != null && Math.abs(onBilledBase - exp.fuelPct) < 0.05 && base !== exp.base
      ? `They applied the right ${exp.fuelPct}% to the wrong base (${money(base)}).`
      : `That is ${r2(fuel / exp.base * 100)}% of the contract base, not ${exp.fuelPct}%.`;
    issues.push({ code: 'fuel_over_contract', amount: r2(fuel - exp.fuel), detail: `Fuel billed ${money(fuel)}; should be ${exp.fuelPct}% of ${money(exp.base)} = ${money(exp.fuel)} (${money(fuel - exp.fuel)} over). ${why}` });
  } else passed.push(`Fuel ${money(fuel)} = ${exp.fuelPct}% of contract base`);

  // 8. Extras need an approval in the TMS.
  for (const line of invoice.lines.filter((l) => l.type === 'accessorial')) {
    const ap = approvalFor(line, shipment.approvedExtras);
    if (!ap) {
      issues.push({ code: 'extra_not_approved', amount: r2(line.amount), detail: `${cap(line.name || line.description)} ${money(line.amount)} billed, but ${shipment.id} has no ${line.name || 'extra'} approval in the TMS.` });
    } else if (line.amount - ap.amount > tol) {
      issues.push({ code: 'extra_over_approval', amount: r2(line.amount - ap.amount), detail: `${cap(line.name)} ${money(line.amount)} billed vs ${money(ap.amount)} approved (${ap.basis}).` });
    } else {
      passed.push(`${cap(line.name)} ${money(line.amount)} approved in TMS (${ap.basis})`);
    }
  }

  const overcharge = r2(Math.min(billed, issues.reduce((s, i) => s + i.amount, 0)));
  if (overcharge > 0) {
    return out({ verdict: 'overbilled', route: 'person', overcharge, recommendPay: r2(billed - overcharge), expected: exp,
      recommendation: `Short-pay ${money(billed - overcharge)} and dispute ${money(overcharge)} with ${invoice.carrier}.` });
  }

  // 9. Over the threshold → a person signs off even when clean.
  if (billed > (rules.personReviewOver ?? Infinity)) {
    issues.push({ code: 'over_threshold', amount: 0, detail: `Clean, but ${money(billed)} is over the ${money(rules.personReviewOver)} sign-off limit.` });
    return out({ verdict: 'clear', route: 'person', recommendPay: billed, expected: exp, recommendation: `Approve ${money(billed)} — needs a sign-off over ${money(rules.personReviewOver)}.` });
  }
  return out({ verdict: 'clear', route: 'auto', recommendPay: billed, expected: exp, recommendation: `Cleared. Add ${money(billed)} to the ready-to-post list.` });
}

module.exports = { auditInvoice, money, r2 };
