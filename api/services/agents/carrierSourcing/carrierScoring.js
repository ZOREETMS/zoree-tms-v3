// Carrier sourcing — pure scoring (no I/O).
//
// score (0-100) = 40 price + 30 on-time + 15 claims + 15 lane history.
// Price is relative to the cheapest priced candidate; a carrier with no
// contract rate on the lane scores 0 on price and is offered as a spot
// load, so a strong carrier without a rate can still rank.
'use strict';

const W = Object.freeze({ price: 40, onTime: 30, claims: 15, history: 15 });

const stateOf = (place) => ((String(place || '').split(',')[1] || '').match(/\b([A-Za-z]{2})\b/) || [])[1]?.toUpperCase() || null;
const laneKey = (o, d) => `${stateOf(o) || '?'}>${stateOf(d) || '?'}`;

/** Carriers allowed to haul this shipment: active, right mode, weight within limit. */
function eligibleCarriers(carriers, shipment) {
  const mode = String(shipment.mode || 'TL').toUpperCase();
  const weight = Number(shipment.weight) || 0;
  return carriers.filter((c) => {
    if (String(c.status || '').toLowerCase() !== 'active') return false;
    if (String(c.mode || '').toUpperCase() !== mode) return false;
    if (weight && c.max_weight && weight > Number(c.max_weight)) return false;
    return true;
  });
}

/** Past shipments per carrier on the same state→state lane. */
function laneHistory(pastShipments, shipment) {
  const key = laneKey(shipment.origin, shipment.dest);
  const counts = new Map();
  for (const s of pastShipments) {
    if (!s.carrier || s.id === shipment.id) continue;
    if (laneKey(s.origin, s.dest) !== key) continue;
    const k = String(s.carrier).toUpperCase();
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return counts;
}

function clamp01(n) { return Math.max(0, Math.min(1, n)); }

/**
 * @param {object[]} carriers   eligible carriers
 * @param {Map} priceByCarrier  UPPER name → cheapest quote {total, rpm, miles, base, fsc, fscPct, rateId, transitDays}
 * @param {Map} history         UPPER name → lane shipment count
 */
function scoreCarriers(carriers, priceByCarrier, history) {
  const prices = [...priceByCarrier.values()].map((q) => q.total).filter((n) => n > 0);
  const best = prices.length ? Math.min(...prices) : null;
  const maxHist = Math.max(1, ...history.values());
  return carriers.map((c) => {
    const k = String(c.name).toUpperCase();
    const q = priceByCarrier.get(k) || null;
    const onTime = Number(c.on_time_pct) || 0;
    const claims = Number(c.claim_ratio) || 0;
    const hist = history.get(k) || 0;
    const parts = {
      price: q && best ? W.price * clamp01(best / q.total) : 0,
      onTime: W.onTime * clamp01((onTime - 85) / 15),   // 85% → 0, 100% → full
      claims: W.claims * clamp01(1 - claims / 2),        // 0% → full, 2%+ → 0
      history: W.history * clamp01(hist / maxHist),
    };
    const score = Math.round(Object.values(parts).reduce((a, b) => a + b, 0));
    const reasons = [
      q ? `contract rate $${q.total.toLocaleString('en-US')}${best && q.total === best ? ' (lowest)' : ` (+$${(q.total - best).toLocaleString('en-US')} vs lowest)`}` : 'no contract rate on this lane — spot offer',
      onTime ? `${onTime}% on-time` : 'no on-time history',
      `${claims}% claims`,
      hist ? `${hist} past load(s) on this lane` : 'new to this lane',
    ];
    return { carrierId: c.id, carrier: c.name, scac: c.scac || null, email: c.contact_email || c.email || null, contactName: c.contact_name || null, score, parts, reasons, quote: q };
  }).sort((a, b) => b.score - a.score);
}

function buildLoadOfferEmail({ shipment, candidate }) {
  const lines = [
    `Hi ${candidate.contactName ? candidate.contactName.split(' ')[0] : `${candidate.carrier} team`},`,
    '',
    `We have a load we'd like to offer ${candidate.carrier}:`,
    '',
    `Load: ${shipment.id}`,
    `Lane: ${shipment.origin} → ${shipment.dest}`,
    `Equipment: ${shipment.equipment || (shipment.mode === 'LTL' ? 'LTL' : 'Dry Van 53ft')} · ${Number(shipment.weight || 0).toLocaleString('en-US')} lbs${shipment.commodity ? ` · ${shipment.commodity}` : ''}`,
    `Pickup: ${shipment.pickup_date || 'TBD'}${shipment.delivery_date ? ` · Deliver by ${shipment.delivery_date}` : ''}`,
    candidate.quote ? `Rate: $${candidate.quote.total.toLocaleString('en-US')} all-in (your contract rate + fuel)` : 'Rate: please send your best all-in rate',
    '',
    'Reply YES to accept, or with your rate and truck availability.',
    '',
    'Thanks,',
    'Zoree TMS',
  ];
  return { subject: `Load offer ${shipment.id}: ${shipment.origin} → ${shipment.dest}`, body: lines.join('\n') };
}

module.exports = { eligibleCarriers, laneHistory, scoreCarriers, buildLoadOfferEmail, laneKey, stateOf, WEIGHTS: W };
