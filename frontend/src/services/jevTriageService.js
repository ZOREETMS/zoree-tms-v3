// Jev carrier-message triage — client for /api/jev (dry run, no writes).
// No credentials:'include': server CORS is origin '*', credentialed fetches are blocked.

function normalizeApiBase(raw) {
  let b = String(raw || '').trim();
  if (!b) b = 'http://localhost:3001';
  b = b.replace(/\/+$/, '').replace(/\/api$/i, '');
  return `${b}/api`;
}

const API_BASE = normalizeApiBase(
  import.meta.env.VITE_API_BASE || window.ZOREE_API_URL || 'http://localhost:3001/api'
);

async function post(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text || `HTTP ${res.status}` }; }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const triageOne = (msg) => post('/jev/triage', msg);

// Real shipments from the TMS (id, carrier, lane, dates) with a carrier message for each.
export async function getLiveSamples() {
  const res = await fetch(`${API_BASE}/jev/samples`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.samples;
}
export const triageBatch = (messages) => post('/jev/triage/batch', { messages });

export const SAMPLE_MESSAGES = [
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

// ZoreeAI chat gate: Jev checks the user's message before a mutating action runs.
export const chatGate = (text, action) => post('/jev/chat-gate', { text, action });

// Carrier recommendation: Jev picks among eligible carriers; Zoree computes premium and route.
export const recommendCarrier = (body) => post('/jev/recommend', body);

// Bulk plan: Zoree builds feasible plans, Jev chooses. With orderIds it plans
// the orders picked on the Orders screen; without, the default 10-order lane.
export const runBulkPlan = (kllmUnavailable, orderIds = []) =>
  post('/jev/bulk-plan', { kllmUnavailable, ...(orderIds.length ? { orderIds } : {}) });

// "Plan with Jev" hand-off: the Orders screen links to the Jev page with the
// selected order IDs in the URL, and the Jev page reads them back.
const JEV_ORDERS_PARAM = 'orders';
export const jevBulkPlanPath = (orderIds = []) =>
  `/jev-bulk-plan${orderIds.length ? `?${JEV_ORDERS_PARAM}=${orderIds.map(encodeURIComponent).join(',')}` : ''}`;
export const readJevOrderIds = (searchParams) =>
  [...new Set(String(searchParams.get(JEV_ORDERS_PARAM) || '').split(',').map((x) => x.trim()).filter(Boolean))];

// Roll-up across lanes for a multi-lane bulk plan; null for a single lane.
export function summarizeBulkPlan(res) {
  const lanes = res?.lanes || [];
  if (lanes.length < 2) return null;
  const planned = lanes.filter((l) => !l.error);
  const picks = planned.map((l) => l.plans.find((p) => p.key === l.pick)).filter(Boolean);
  return {
    lanes: lanes.length,
    failed: lanes.length - planned.length,
    review: planned.filter((l) => l.route !== 'RECOMMEND_FOR_APPROVAL').length,
    cost: picks.reduce((sum, p) => sum + p.cost, 0),
    trucks: picks.reduce((sum, p) => sum + p.trucks, 0),
  };
}
