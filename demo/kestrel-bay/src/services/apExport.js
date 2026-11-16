'use strict';
// Ready-to-post list for AP. NetSuite is read-only in the pilot, so this is
// the handoff: a clerk reviews and posts; the agent never touches NetSuite.
const csvEscape = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

function readyToPostRows(results, decisions) {
  return results
    .map((r) => ({ r, d: decisions[r.invoice.seq] }))
    .filter(({ r, d }) => (r.route === 'auto' && !d) || (d && (d.action === 'approve' || d.action === 'short_pay')))
    .map(({ r, d }) => ({
      invoice: r.invoice.invoiceNumber,
      carrier: r.invoice.carrier,
      shipment: r.invoice.shipmentId,
      billed: r.invoice.total.toFixed(2),
      payAmount: Number(d && d.amount != null ? d.amount : r.recommendPay).toFixed(2),
      basis: r.contract ? `Contract ${r.contract.origin} → ${r.contract.destination}: base ${r.contract.baseRate.toFixed(2)} + ${r.contract.fuelPct}% fuel` : '',
      clearedBy: d ? `${d.by} (${d.action.replace('_', ' ')})` : 'agent (rules)',
      sourcePdf: r.invoice.file || '',
    }));
}

function toCsv(rows) {
  const cols = ['invoice', 'carrier', 'shipment', 'billed', 'payAmount', 'basis', 'clearedBy', 'sourcePdf'];
  return [cols.join(','), ...rows.map((row) => cols.map((c) => csvEscape(row[c])).join(','))].join('\n');
}

module.exports = { readyToPostRows, toCsv };
