// ═══════════════════════════════════════════════════════════════════
// Kestrel Bay demo reset — puts the KESTREL_BAY domain back to "no
// invoices received yet" so "Read AP Mailbox" reads the carrier emails
// again from scratch.
//
//   node scripts/kbDemoReset.js          dry run: shows what would go
//   node scripts/kbDemoReset.js --yes    backs up, then deletes
//
// What it clears (KESTREL_BAY only — refuses any other domain):
//   AP release / export / audit ledger   via ap_demo_reset (migration 054/055)
//   invoices + invoice_cost_lines + their change_history
//   shipment change_history rows written by those invoices
//   invoice_intakes + invoice_intake_files
//   email_order_intake rows for the AP mailbox (the "already read" marker)
//   invoice_intake_runs (the agent run log, migration 056)
// What it keeps: shipments, carriers, contracts/rates, accessorial
// approvals — the data pack itself.
//
// Every row is written to ../_backup_kb_reset_<timestamp>/ before deletion.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DOMAIN = 'KESTREL_BAY';
const ALLOWED = new Set([DOMAIN]);
const URL_BASE = `${process.env.SUPABASE_URL}/rest/v1`;
const KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json', Prefer: 'return=representation' };

async function rest(method, p, body) {
  const r = await fetch(`${URL_BASE}/${p}`, { method, headers: HEADERS, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let j; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  if (!r.ok) throw new Error(`${method} ${p.split('?')[0]} ${r.status}: ${String(t).slice(0, 300)}`);
  return j;
}
const inList = (a) => `(${a.map((x) => `"${String(x).replace(/"/g, '')}"`).join(',')})`;

/** Everything the reset would remove, read first so it can be shown and backed up. */
async function collect(apMailbox) {
  const invoices = await rest('GET', `invoices?select=*&domain_code=eq.${DOMAIN}`);
  const ids = invoices.map((i) => i.id);
  const intakes = await rest('GET', `invoice_intakes?select=*&domain_code=eq.${DOMAIN}`);
  const intakeIds = intakes.map((i) => i.id);
  const shipments = await rest('GET', `shipments?select=id&domain_code=eq.${DOMAIN}`);
  const shipIds = shipments.map((s) => s.id);
  const costLines = ids.length ? await rest('GET', `invoice_cost_lines?select=*&invoice_id=in.${inList(ids)}`) : [];
  const historyInvoices = ids.length ? await rest('GET', `change_history?select=*&entity_type=eq.invoice&entity_id=in.${inList(ids)}`) : [];
  // Mirror rows the invoice flow writes on each shipment (metadata.invoiceId points at a KB invoice).
  const historyShipments = shipIds.length && ids.length
    ? (await rest('GET', `change_history?select=*&entity_type=eq.shipment&entity_id=in.${inList(shipIds)}`))
      .filter((h) => h.metadata && ids.includes(h.metadata.invoiceId))
    : [];
  const intakeFiles = intakeIds.length ? await rest('GET', `invoice_intake_files?select=intake_id,file_name,size_bytes&intake_id=in.${inList(intakeIds)}`) : [];
  const runs = await rest('GET', `invoice_intake_runs?select=*&domain_code=eq.${DOMAIN}`).catch(() => []);
  const emails = apMailbox
    ? await rest('GET', `email_order_intake?select=*&domain_code=eq.${DOMAIN}&mailbox=eq.${encodeURIComponent(apMailbox)}`)
    : [];
  return { invoices, intakes, costLines, historyInvoices, historyShipments, intakeFiles, emails, runs };
}

function backup(rows) {
  const dir = path.join(__dirname, '..', '..', `_backup_kb_reset_${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, data] of Object.entries(rows)) fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(data, null, 1));
  return dir;
}

async function main() {
  if (!process.env.SUPABASE_URL || !KEY) throw new Error('SUPABASE_URL and the service key must be set in api/.env');
  if (!ALLOWED.has(DOMAIN)) throw new Error(`Refusing to reset ${DOMAIN}`);
  const apply = process.argv.includes('--yes');
  const apMailbox = (process.env.EMAIL_INTAKE_AP_IMAP_USER || '').trim().toLowerCase();

  const rows = await collect(apMailbox);
  const counts = Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.length]));
  console.log(`Kestrel Bay reset — ${apply ? 'APPLYING' : 'dry run (add --yes to apply)'}`);
  console.log(`AP mailbox: ${apMailbox || '(EMAIL_INTAKE_AP_IMAP_USER not set — email markers kept)'}`);
  console.log(counts);
  if (!apply) return;

  const dir = backup(rows);
  console.log(`Backup: ${path.relative(path.join(__dirname, '..', '..'), dir)}`);

  // 1. AP release / export / ledger (function guards which domains may be reset).
  const ap = await rest('POST', 'rpc/ap_demo_reset', { p_domain: DOMAIN });
  console.log('AP ledger cleared:', ap);

  // 2. Children before parents.
  const ids = rows.invoices.map((i) => i.id);
  const intakeIds = rows.intakes.map((i) => i.id);
  const histIds = [...rows.historyInvoices, ...rows.historyShipments].map((h) => h.id);
  if (rows.costLines.length) await rest('DELETE', `invoice_cost_lines?invoice_id=in.${inList(ids)}`);
  if (histIds.length) await rest('DELETE', `change_history?id=in.${inList(histIds)}`);
  if (intakeIds.length) await rest('DELETE', `invoice_intake_files?intake_id=in.${inList(intakeIds)}`);
  await rest('DELETE', `invoice_intakes?domain_code=eq.${DOMAIN}`);
  await rest('DELETE', `invoices?domain_code=eq.${DOMAIN}`);
  if (rows.runs.length) await rest('DELETE', `invoice_intake_runs?domain_code=eq.${DOMAIN}`);
  if (rows.emails.length) await rest('DELETE', `email_order_intake?id=in.${inList(rows.emails.map((e) => e.id))}`);

  const after = await collect(apMailbox);
  const left = Object.entries(after).filter(([, v]) => v.length).map(([k, v]) => `${k}=${v.length}`);
  console.log(left.length ? `NOT CLEAN: ${left.join(', ')}` : 'Clean. Read AP Mailbox will read the carrier emails again.');
}

main().catch((e) => { console.error(`Reset failed: ${e.message}`); process.exit(1); });
