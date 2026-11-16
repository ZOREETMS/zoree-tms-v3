// Track & trace — pure risk rules (no I/O).
'use strict';

const DAY = 86400000;
const dayOf = (v) => (v ? String(v).slice(0, 10) : null);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

/**
 * Classify one moving load.
 * @returns {{level:'high'|'medium'|'ok', code:string, reason:string}}
 */
function assessShipment(s, { today, staleHours = 24, now = Date.now() } = {}) {
  const t = today || new Date(now).toISOString().slice(0, 10);
  const pickup = dayOf(s.pickup_date);
  const deliver = dayOf(s.delivery_date);
  const lastTouch = Date.parse(s.updated_at || s.shipped_at || s.created_at || 0) || 0;
  const silentHours = lastTouch ? Math.round((now - lastTouch) / 3600000) : null;

  if (s.status === 'Tender Accepted' && pickup && pickup < t) {
    return { level: 'high', code: 'missed_pickup', reason: `Pickup was due ${pickup} (${daysBetween(pickup, t)}d ago) and the load is not picked up.` };
  }
  if (s.status === 'In Transit' && deliver && deliver < t) {
    return { level: 'high', code: 'past_due', reason: `Delivery was due ${deliver} (${daysBetween(deliver, t)}d ago) and there is no POD.` };
  }
  if (s.status === 'In Transit' && deliver && daysBetween(t, deliver) <= 1 && silentHours !== null && silentHours >= staleHours) {
    return { level: 'medium', code: 'eta_risk', reason: `Due ${deliver === t ? 'today' : 'tomorrow'} and no carrier update for ${silentHours}h.` };
  }
  if (s.status === 'Tender Accepted' && pickup === t && silentHours !== null && silentHours >= staleHours) {
    return { level: 'medium', code: 'pickup_unconfirmed', reason: `Pickup is today and the carrier has not confirmed (${silentHours}h quiet).` };
  }
  return { level: 'ok', code: 'on_track', reason: 'On schedule.' };
}

/** Only loads whose key date is inside the lookback window, so old fixtures don't flood the queue. */
function inWindow(s, { today, lookbackDays = 14 }) {
  const key = dayOf(s.status === 'Tender Accepted' ? s.pickup_date : s.delivery_date);
  if (!key) return false;
  return daysBetween(key, today) <= lookbackDays;
}

function buildCheckCallEmail(s, risk) {
  return {
    subject: `Status check: ${s.id}${s.pro_number ? ` / PRO ${s.pro_number}` : ''} ${s.origin} → ${s.dest}`,
    body: [
      `Hi ${s.carrier || 'team'},`,
      '',
      `Can you send a status update on ${s.id}${s.pro_number ? ` (PRO ${s.pro_number})` : ''}${s.bol_number ? ` / ${s.bol_number}` : ''}?`,
      `Lane: ${s.origin} → ${s.dest}`,
      s.status === 'Tender Accepted' ? `Scheduled pickup: ${s.pickup_date || 'n/a'}` : `Scheduled delivery: ${s.delivery_date || 'n/a'}`,
      '',
      'Please reply with current location, ETA, and any issues.',
      '',
      'Thanks,',
      'Zoree TMS',
    ].join('\n'),
    risk: risk.code,
  };
}

function buildDelayNotice({ shipment, customer, update }) {
  return {
    subject: `Update on your shipment ${shipment.id}: new ETA ${update.eta_date || 'pending'}`,
    body: [
      `Hello${customer ? ` ${customer}` : ''},`,
      '',
      `Your shipment ${shipment.id} (${shipment.origin} → ${shipment.dest}) is running behind.`,
      update.delay_reason ? `Reason from the carrier: ${update.delay_reason}.` : null,
      update.location ? `Last reported location: ${update.location}.` : null,
      `New estimated delivery: ${update.eta_date || 'we are confirming with the carrier'}${shipment.delivery_date ? ` (was ${shipment.delivery_date})` : ''}.`,
      '',
      'We are watching it and will update you again if anything changes.',
      '',
      'Thanks,',
      'Zoree TMS',
    ].filter((l) => l !== null).join('\n'),
  };
}

module.exports = { assessShipment, inWindow, buildCheckCallEmail, buildDelayNotice, daysBetween };
