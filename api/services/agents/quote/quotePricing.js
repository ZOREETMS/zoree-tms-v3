// Quote agent — pure pricing + reply drafting (no I/O).
'use strict';

const roundUp = (n, step = 5) => Math.ceil(n / step) * step;
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

function marginSettings(env = process.env, override) {
  const pct = Number.isFinite(Number(override)) && override !== null && override !== '' ? Number(override) : (Number(env.AGENT_QUOTE_MARGIN_PCT) || 15);
  return { pct, minUsd: Number(env.AGENT_QUOTE_MIN_MARGIN_USD) || 150, validDays: Number(env.AGENT_QUOTE_VALID_DAYS) || 7 };
}

/** Sell price = cost × (1 + pct), never less than cost + minimum margin; rounded up to $5. */
function applyMargin(cost, { pct, minUsd }) {
  const sell = roundUp(Math.max(cost * (1 + pct / 100), cost + minUsd));
  return { cost, sell, marginUsd: sell - cost, marginPct: cost ? Math.round(((sell - cost) / cost) * 1000) / 10 : 0 };
}

/** Cheapest quote per carrier, best 3 overall. */
function pickOptions(quotes, n = 3) {
  const seen = new Set();
  const out = [];
  for (const q of quotes) {
    if (seen.has(q.carrier)) continue;
    seen.add(q.carrier);
    out.push(q);
    if (out.length === n) break;
  }
  return out;
}

function addDays(iso, days) {
  const d = iso ? new Date(iso) : new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Customer-facing quote email. Carrier names and cost stay internal.
 * @param {object} args { contactName, customer, lanes:[{origin,dest,weight,equipment,pickupDate,sell,transitDays}], validUntil, diesel }
 */
function buildQuoteEmail({ contactName, lanes, validUntil, diesel, subject }) {
  const greet = contactName ? `Hi ${String(contactName).split(' ')[0]},` : 'Hello,';
  const lines = lanes.map((l, i) => {
    const parts = [
      `${lanes.length > 1 ? `${i + 1}. ` : ''}${l.origin} → ${l.dest}`,
      `   ${l.equipment || 'Dry Van 53ft'}${l.weight ? `, ${Number(l.weight).toLocaleString('en-US')} lbs` : ''}${l.pickupDate ? `, pickup ${l.pickupDate}` : ''}`,
      l.sell ? `   All-in rate: ${money(l.sell)} (linehaul + fuel)${l.transitDays ? ` · ${l.transitDays}-day transit` : ''}` : '   We are checking capacity on this lane and will follow up shortly.',
    ];
    return parts.join('\n');
  });
  const fuelLine = diesel ? `\nFuel is priced on the EIA national diesel average for the week of ${diesel.week} ($${diesel.price.toFixed(3)}/gal).` : '';
  const body = [
    greet,
    '',
    'Thanks for the request. Here is our quote:',
    '',
    ...lines,
    fuelLine,
    `Quote valid through ${validUntil}. Accessorials (detention, lumper, liftgate) billed at cost if needed.`,
    '',
    'Reply to this email to book and we will confirm the truck.',
    '',
    'Thanks,',
    'Zoree TMS',
  ].join('\n');
  return { subject: subject ? `RE: ${String(subject).replace(/^re:\s*/i, '')}` : `Quote: ${lanes.map((l) => `${l.origin} → ${l.dest}`).join('; ')}`, body };
}

module.exports = { applyMargin, pickOptions, buildQuoteEmail, marginSettings, addDays, roundUp };
