// node api/scripts/jevDemo.js  (reads api/.env)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { triageCarrierMessage } = require('../services/ai/carrierMessageTriage');

const SAMPLES = [
  { shipmentRef: 'SHP-10421', carrier: 'Swift', message: 'Confirmed, we got the load. Driver Mike will pick up 0800 tomorrow at the Fremont DC.' },
  { shipmentRef: 'SHP-10422', carrier: 'Knight', message: 'Sorry cant cover this one anymore, truck went down in Stockton. Need to give it back.' },
  { shipmentRef: 'SHP-10423', carrier: 'Estes', message: 'Driver stuck in traffic on I-880, running about 40 min behind, still good for the 2pm appt.' },
  { shipmentRef: 'SHP-10424', carrier: 'Old Dominion', message: 'Blown tire outside Reno, roadside says 6 hrs minimum. Wont make the 10am delivery at Sparks.' },
  { shipmentRef: 'SHP-10425', carrier: 'XPO', message: 'Delivered 11:42, signed by J. Ramirez. POD attached.' },
  { shipmentRef: 'SHP-10426', carrier: 'Schneider', message: 'Driver sat at receiver 4.5 hours past appointment. Billing 3 hrs detention at $75/hr per the rate con.' },
  { shipmentRef: 'SHP-10427', carrier: 'JB Hunt', message: 'Can you do 2450 on this lane instead of 2200? Diesel is up.' },
  { shipmentRef: 'SHP-10428', carrier: 'Werner', message: 'we got it but might be late depending on the shipper, will update' },
  { shipmentRef: 'SHP-10429', carrier: 'Saia', message: 'Heads up - consignee closed early, we will redeliver tomorrow AM. Redelivery fee applies.' },
  { shipmentRef: 'SHP-10430', carrier: 'Landstar', message: 'ok' },
];

(async () => {
  const t0 = Date.now();
  const results = await Promise.all(SAMPLES.map(triageCarrierMessage));
  const wall = Date.now() - t0;
  console.table(results.map((r) => ({
    ref: r.shipmentRef, intent: r.intent, conf: r.confidence.toFixed(2), delay: r.delaySeverity,
    retender: r.needsRetender.toFixed(2), route: r.route, action: r.plannedAction.action, ms: r.latencyMs,
  })));
  const auto = results.filter((r) => r.route === 'SYSTEM_1_AUTO').length;
  const cost = results.reduce((s, r) => s + r.costUsd, 0);
  console.log(`\n${auto}/${results.length} handled by Jev, ${results.length - auto} escalated to Claude`);
  console.log(`Wall clock ${wall} ms for ${results.length} messages | total Jev cost $${cost.toFixed(6)}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
