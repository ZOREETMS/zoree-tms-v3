// ═══════════════════════════════════════════════════════════════════
// AI agent demo scenario — seeds a small, self-contained set of loads
// and invoices so every agent has something real to work on.
//
//   node scripts/agentDemoSeed.js          create / refresh (dates move to today)
//   node scripts/agentDemoSeed.js --reset  delete every DEMO row it created
//
// Every row id contains "DEMO", so the set is easy to spot and remove.
// Demo fixtures only — production data never goes through this script.
// See docs/AI_AGENTS.md for the walkthrough that uses these rows.
// ═══════════════════════════════════════════════════════════════════

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const db = require('../services/supabase');

const day = (offset) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString();

function shipments() {
  const base = { mode: 'TL', service_level: 'Standard', equipment: 'Dry Van 53ft', accessorials: 0, order_ids: [] };
  return [
    // Carrier sourcing — planned load, no carrier yet.
    { ...base, id: 'SHP-DEMO-SRC1', status: 'Planned', carrier: null, origin: 'CHICAGO, IL 60632', dest: 'DALLAS, TX 75207', origin_zip: '60632', dest_zip: '75207',
      weight: 38000, pieces: 22, commodity: 'Packaged foods', pickup_date: day(2), delivery_date: day(4), rate: 0, fuel_surcharge: 0, total_cost: 0, bol_number: 'BOL-SHP-DEMO-SRC1', notes: 'AGENT-DEMO' },
    // Track & trace — due today, carrier silent 30h.
    { ...base, id: 'SHP-DEMO-TT1', status: 'In Transit', carrier: 'WERNER ENTERPRISES', origin: 'ATLANTA, GA 30336', dest: 'NEW YORK, NY 10001', origin_zip: '30336', dest_zip: '10001',
      weight: 41000, pieces: 26, pickup_date: day(-2), delivery_date: day(0), shipped_at: hoursAgo(50), updated_at: hoursAgo(30), rate: 2300, fuel_surcharge: 518, total_cost: 2818, bol_number: 'BOL-SHP-DEMO-TT1', pro_number: 'PRO-DEMO-55018', notes: 'AGENT-DEMO' },
    // Track & trace — pickup was yesterday, never picked up.
    { ...base, id: 'SHP-DEMO-TT2', status: 'Tender Accepted', carrier: 'SCHNEIDER NATIONAL', origin: 'MEMPHIS, TN 38118', dest: 'DETROIT, MI 48209', origin_zip: '38118', dest_zip: '48209',
      weight: 35000, pieces: 18, pickup_date: day(-1), delivery_date: day(1), updated_at: hoursAgo(40), rate: 1810, fuel_surcharge: 416, total_cost: 2226, bol_number: 'BOL-SHP-DEMO-TT2', notes: 'AGENT-DEMO' },
    // Track & trace — on schedule (should NOT be flagged).
    { ...base, id: 'SHP-DEMO-TT3', status: 'In Transit', carrier: 'J.B. HUNT TRANSPORT', origin: 'LOS ANGELES, CA 90058', dest: 'PHOENIX, AZ 85043', origin_zip: '90058', dest_zip: '85043',
      weight: 30000, pieces: 20, pickup_date: day(-1), delivery_date: day(2), shipped_at: hoursAgo(20), updated_at: hoursAgo(3), rate: 1050, fuel_surcharge: 236, total_cost: 1286, bol_number: 'BOL-SHP-DEMO-TT3', notes: 'AGENT-DEMO' },
    // POD — delivered today on paper, still In Transit in the TMS.
    { ...base, id: 'SHP-DEMO-POD1', status: 'In Transit', carrier: 'SWIFT TRANSPORTATION', origin: 'HOUSTON, TX 77029', dest: 'AUSTIN, TX 78744', origin_zip: '77029', dest_zip: '78744',
      weight: 24000, pieces: 24, commodity: 'Household appliances', pickup_date: day(-1), delivery_date: day(0), shipped_at: hoursAgo(26), rate: 620, fuel_surcharge: 140, total_cost: 760, bol_number: 'BOL-SHP-DEMO-POD1', pro_number: 'PRO-DEMO-77120', notes: 'AGENT-DEMO' },
    // Freight audit — delivered load billed with fuel + accessorial padding.
    { ...base, id: 'SHP-DEMO-FA1', status: 'Delivered', carrier: 'KLLM TRANSPORT', origin: 'CHICAGO, IL 60632', dest: 'DALLAS, TX 75207', origin_zip: '60632', dest_zip: '75207',
      weight: 38000, pieces: 22, pickup_date: day(-6), delivery_date: day(-4), delivered_at: hoursAgo(96), rate: 2187, fuel_surcharge: 492, total_cost: 2679, miles: 959, bol_number: 'BOL-SHP-DEMO-FA1', notes: 'AGENT-DEMO' },
    // Freight audit — delivered load billed twice.
    { ...base, id: 'SHP-DEMO-FA2', status: 'Delivered', carrier: 'WERNER ENTERPRISES', origin: 'ATLANTA, GA 30336', dest: 'NEW YORK, NY 10001', origin_zip: '30336', dest_zip: '10001',
      weight: 40000, pieces: 24, pickup_date: day(-9), delivery_date: day(-7), delivered_at: hoursAgo(168), rate: 2000, fuel_surcharge: 450, total_cost: 2450, bol_number: 'BOL-SHP-DEMO-FA2', notes: 'AGENT-DEMO' },
  ];
}

function invoices() {
  const common = { payment_terms: 'NET30', tolerance_pct: 5, tolerance_abs_usd: 100, invoice_date: day(-3), due_date: day(27), received_at: hoursAgo(72), notes: 'AGENT-DEMO' };
  return [
    { ...common, id: 'INV-DEMO-FA1', invoice_number: 'KLLM-884213', carrier: 'KLLM TRANSPORT', shipment_id: 'SHP-DEMO-FA1', shipment_ids: ['SHP-DEMO-FA1'], bol_ids: ['BOL-SHP-DEMO-FA1'],
      agreed_cost: 2679, invoiced_amount: 3354, variance: 675, variance_pct: 25.2, status: 'Rejected', decision_reason: 'Outside ±5% and ±$100.00 tolerance (Δ=$675.00, 25.20%).' },
    { ...common, id: 'INV-DEMO-FA2A', invoice_number: 'WERN-30551', carrier: 'WERNER ENTERPRISES', shipment_id: 'SHP-DEMO-FA2', shipment_ids: ['SHP-DEMO-FA2'], bol_ids: ['BOL-SHP-DEMO-FA2'],
      agreed_cost: 2450, invoiced_amount: 2450, variance: 0, variance_pct: 0, status: 'Approved', decision_reason: 'Within both ±5% and ±$100.00 tolerance.', invoice_date: day(-6), received_at: hoursAgo(144) },
    { ...common, id: 'INV-DEMO-FA2B', invoice_number: 'WERN-30551-R', carrier: 'WERNER ENTERPRISES', shipment_id: 'SHP-DEMO-FA2', shipment_ids: ['SHP-DEMO-FA2'], bol_ids: ['BOL-SHP-DEMO-FA2'],
      agreed_cost: 2450, invoiced_amount: 2450, variance: 0, variance_pct: 0, status: 'On Hold', decision_reason: 'Held for review.' },
  ];
}

const COST_LINES = [
  { invoice_id: 'INV-DEMO-FA1', cost_type: 'base', description: 'Linehaul Chicago → Dallas', invoice_cost: 2187, approved_cost: 2187, line_order: 10 },
  { invoice_id: 'INV-DEMO-FA1', cost_type: 'fuel_surcharge', description: 'Fuel surcharge 30.2%', invoice_cost: 660, approved_cost: 492, line_order: 20 },
  { invoice_id: 'INV-DEMO-FA1', cost_type: 'accessorial', description: 'Detention 3 hrs', invoice_cost: 225, approved_cost: 0, line_order: 30 },
  { invoice_id: 'INV-DEMO-FA1', cost_type: 'accessorial', description: 'Lumper', invoice_cost: 282, approved_cost: 0, line_order: 40 },
  { invoice_id: 'INV-DEMO-FA2B', cost_type: 'base', description: 'Linehaul Atlanta → New York', invoice_cost: 2000, approved_cost: 2000, line_order: 10 },
  { invoice_id: 'INV-DEMO-FA2B', cost_type: 'fuel_surcharge', description: 'Fuel surcharge', invoice_cost: 450, approved_cost: 450, line_order: 20 },
];

/** Agent runs that touched demo rows — so a reset demo proposes fresh actions again. */
async function resetAgentHistory(client) {
  const { data, error } = await client.from('agent_actions').select('run_id').like('entity_id', '%DEMO%');
  if (error) {
    if (/agent_actions/.test(error.message)) return; // migration 050 not applied yet
    throw new Error(error.message);
  }
  const runIds = [...new Set((data || []).map((r) => r.run_id))];
  if (runIds.length) {
    const del = await client.from('agent_runs').delete().in('id', runIds); // actions cascade
    if (del.error) throw new Error(del.error.message);
  }
}

const DEMO_ORDER_SENDER = 'orders@acmefoods.example'; // frontend/src/constants/agentDemo.js DEMO_ORDER_EMAIL

/** Orders the Email Order Agent created from the demo order email, and the intake rows. */
async function resetEmailOrders(client) {
  const { data, error } = await client.from('email_order_intake').select('id').eq('from_address', DEMO_ORDER_SENDER);
  if (error) throw new Error(error.message);
  const intakeIds = (data || []).map((r) => r.id);
  if (!intakeIds.length) return;
  const { data: orders, error: oErr } = await client.from('orders').select('id').in('email_intake_id', intakeIds);
  if (oErr) throw new Error(oErr.message);
  const orderIds = (orders || []).map((o) => o.id);
  if (orderIds.length) {
    for (const [table, col] of [['order_lines', 'order_id'], ['orders', 'id']]) {
      // eslint-disable-next-line no-await-in-loop
      const del = await client.from(table).delete().in(col, orderIds);
      if (del.error) throw new Error(`${table}: ${del.error.message}`);
    }
  }
  const del = await client.from('email_order_intake').delete().in('id', intakeIds);
  if (del.error) throw new Error(del.error.message);
}

async function reset() {
  const client = db.getClient();
  await resetAgentHistory(client);
  await resetEmailOrders(client);
  const steps = [
    () => client.from('invoice_cost_lines').delete().like('invoice_id', 'INV-DEMO-%'),
    () => client.from('invoices').delete().like('id', 'INV-DEMO-%'),
    () => client.from('invoices').delete().like('shipment_id', 'SHP-DEMO-%'), // invoices the POD agent created
    () => client.from('documents').delete().like('id', 'POD-SHP-DEMO-%'),
    () => client.from('shipments').delete().like('id', 'SHP-DEMO-%'),
  ];
  for (const step of steps) {
    // eslint-disable-next-line no-await-in-loop
    const { error } = await step();
    if (error) throw new Error(error.message);
  }
  console.log('Demo rows and their agent runs removed (change_history entries are kept — the audit ledger is never deleted).');
}

async function seed() {
  await reset();
  const client = db.getClient();
  for (const [table, rows] of [['shipments', shipments()], ['invoices', invoices()], ['invoice_cost_lines', COST_LINES]]) {
    // eslint-disable-next-line no-await-in-loop
    const { error } = await client.from(table).insert(rows);
    if (error) throw new Error(`${table}: ${error.message}`);
    console.log(`  + ${rows.length} ${table}`);
  }
  console.log('Demo scenario ready. Walkthrough: docs/AI_AGENTS.md');
}

(process.argv.includes('--reset') ? reset() : seed()).catch((err) => { console.error('Seed failed:', err.message); process.exit(1); });
