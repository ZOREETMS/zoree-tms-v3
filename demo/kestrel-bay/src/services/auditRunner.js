'use strict';
// Matches one invoice to its TMS shipment and contract lane and applies the
// rules. Keeps track of what was already billed so duplicates are caught.
const { auditInvoice, r2 } = require('./auditRules');

function createLedger() {
  const byShipment = new Map();
  const byNumber = new Map();
  return {
    priorFor(inv) {
      const a = byNumber.get(`${inv.carrier}|${inv.invoiceNumber}`) || [];
      const b = byShipment.get(inv.shipmentId) || [];
      return [...a, ...b.filter((x) => !a.includes(x))];
    },
    record(inv) {
      const k = `${inv.carrier}|${inv.invoiceNumber}`;
      byNumber.set(k, [...(byNumber.get(k) || []), inv]);
      byShipment.set(inv.shipmentId, [...(byShipment.get(inv.shipmentId) || []), inv]);
    },
  };
}

function auditOne(invoice, pack, ledger) {
  const shipment = pack.shipments.find((s) => s.id === invoice.shipmentId) || null;
  const contract = shipment ? pack.contracts.find((c) => c.carrier === shipment.carrier && c.origin === shipment.origin && c.destination === shipment.destination) || null : null;
  const priorSame = ledger.priorFor(invoice);
  const audit = auditInvoice({ invoice, shipment, contract, priorSame, rules: pack.policy.apRules });
  if (audit.verdict !== 'duplicate') ledger.record(invoice);
  return { invoice, shipment, contract, ...audit };
}

function summarize(results, policy) {
  const total = results.length;
  const auto = results.filter((r) => r.route === 'auto');
  const person = results.filter((r) => r.route === 'person');
  const sum = (arr, f) => r2(arr.reduce((s, r) => s + (f(r) || 0), 0));
  const stated = policy.profile.statedExceptionRate;
  const rate = total ? person.length / total : 0;
  return {
    total,
    autoCleared: auto.length,
    toPerson: person.length,
    billed: sum(results, (r) => r.invoice && r.invoice.total),
    readyToPost: sum(auto, (r) => r.recommendPay),
    overcharges: sum(results, (r) => r.overcharge),
    overchargeCount: results.filter((r) => r.overcharge > 0).length,
    held: sum(results, (r) => r.held),
    heldCount: results.filter((r) => r.held > 0).length,
    exceptionRate: r2(rate * 100),
    statedExceptionRate: r2(stated * 100),
    sampleLooksTypical: rate <= stated * 1.5,
    monthly: {
      invoices: policy.profile.invoicesPerMonth,
      expectedAutoCleared: Math.round(policy.profile.invoicesPerMonth * (1 - stated)),
      expectedToPerson: Math.round(policy.profile.invoicesPerMonth * stated),
      manualStepsToday: policy.profile.invoicesPerMonth * policy.profile.stepsPerInvoiceToday,
    },
  };
}

module.exports = { createLedger, auditOne, summarize };
