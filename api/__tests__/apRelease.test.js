// AP release & NetSuite export (migration 054): approval permissions,
// duplicate prevention, revalidation, CSV totals and the audit history.
// Kestrel Bay panel data: 3 clean invoices ($1,464.40), BW-5521 overcharge,
// RF-88214 unapproved liftgate, RF-88213 resend.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../services/apRelease/releasePolicy');
const csv = require('../services/apRelease/netsuiteCsv');
const { createApReleaseService } = require('../services/apRelease');

const AGENT = 'invoice-intake-agent';
const inv = (o) => ({ status: 'Approved', decided_by: AGENT, invoiced_amount: 510.88, invoice_date: '2026-11-10', due_date: '2026-12-10', ...o });
const KB = () => [
  inv({ id: 'INV-1', invoice_number: 'RF-88213', carrier: 'RIDGELINE FREIGHT', shipment_id: 'KB-SH-40117' }),
  inv({ id: 'INV-2', invoice_number: 'RF-88219', carrier: 'RIDGELINE FREIGHT', shipment_id: 'KB-SH-40126' }),
  inv({ id: 'INV-3', invoice_number: 'PE-0931', carrier: 'PIONEER EXPRESS', shipment_id: 'KB-SH-40141', invoiced_amount: 442.64 }),
  inv({ id: 'INV-4', invoice_number: 'BW-5521', carrier: 'BLUEWATER CARRIERS', shipment_id: 'KB-SH-40130', invoiced_amount: 1561.60, agreed_cost: 1439.60, variance: 122, status: 'On Hold', decision_reason: 'Needs AP review: Outside tolerance' }),
  inv({ id: 'INV-5', invoice_number: 'RF-88214', carrier: 'RIDGELINE FREIGHT', shipment_id: 'KB-SH-40122', invoiced_amount: 595.88, variance: 85, status: 'On Hold' }),
];
const FAILING = { verdict: 'dispute', issues: [{ detail: 'Linehaul billed $1,350.00 vs contract $1,250.00' }], passed: [] };
const PASSING = { verdict: 'approve', issues: [], passed: ['Linehaul matches'] };

/** In-memory stand-in for repository.js, with the same uniqueness the DB enforces. */
function fakeRepo(invoices) {
  const s = { invoices: new Map(invoices.map((i) => [i.id, { ...i }])), releases: [], items: [], batches: [], audit: [], history: [] };
  const repo = {
    s,
    currentDomain: () => 'KESTREL_BAY',
    getInvoice: async (id) => (s.invoices.has(id) ? { ...s.invoices.get(id) } : null),
    listInvoicesByIds: async (ids) => ids.filter((id) => s.invoices.has(id)).map((id) => ({ ...s.invoices.get(id) })),
    listInvoicesByStatuses: async (st) => [...s.invoices.values()].filter((i) => st.includes(i.status)),
    listApprovedInvoices: async () => [...s.invoices.values()].filter((i) => i.status === 'Approved'),
    listReleases: async (ids = null) => s.releases.filter((r) => !ids || ids.includes(r.invoice_id)),
    getRelease: async (id) => s.releases.find((r) => r.invoice_id === id) || null,
    // Mirrors ap_resolve_exception: still held, justification, decision + ledger together.
    resolveException: async (a) => {
      const i = s.invoices.get(a.invoiceId);
      if (!['On Hold', 'Pending'].includes(i.status)) throw Object.assign(new Error(`${a.invoiceId} is now ${i.status}`), { status: 409 });
      Object.assign(i, { status: a.decision, decision_reason: a.reason, decided_by: a.by, decided_at: '2026-11-14T17:00:00Z' });
      s.history.push(...(a.history || []));
      s.audit.push({ invoice_id: a.invoiceId, event_type: a.eventType, actor: a.by, actor_role: a.role, detail: a.detail, payload: { ...a.payload, actorId: a.byId } });
      return { ...i };
    },
    // Mirrors ap_release_invoice: locks, refuses stale facts, unique per invoice and per bill, release + ledger together.
    releaseInvoice: async (a) => {
      const i = s.invoices.get(a.invoiceId);
      if (!i || i.status !== 'Approved') throw Object.assign(new Error(`${a.invoiceId} is now ${i && i.status}, not Approved`), { status: 409 });
      if (Math.round(i.invoiced_amount * 100) !== Math.round(a.expectedAmount * 100) || (i.decided_by ?? null) !== a.expectedDecidedBy || (i.decided_at ?? null) !== a.expectedDecidedAt) {
        throw Object.assign(new Error(`${a.invoiceId} changed after it was revalidated — reload and release again`), { status: 409 });
      }
      if (s.releases.some((r) => r.invoice_id === a.invoiceId)) throw Object.assign(new Error('Already released or exported — an invoice can never be exported twice.'), { status: 409 });
      if (s.releases.some((r) => r.carrier_key === a.carrierKey && r.invoice_number_key === a.invoiceNumberKey)) {
        throw Object.assign(new Error('This carrier invoice number is already released under another record — a resend is never paid twice.'), { status: 409 });
      }
      const row = { invoice_id: a.invoiceId, release_path: a.path, released_by: a.by, released_by_id: a.byId, released_at: '2026-11-14T18:00:00Z', note: a.note,
        exception_approved_by: a.exceptionBy, override_justification: a.justification, revalidation_verdict: a.verdict, amount: a.expectedAmount,
        carrier_key: a.carrierKey, invoice_number_key: a.invoiceNumberKey };
      s.releases.push(row);
      s.audit.push({ invoice_id: a.invoiceId, event_type: a.eventType, actor: a.by, actor_role: a.role, detail: a.detail });
      return row;
    },
    listExportItems: async ({ invoiceIds = null, batchIds = null } = {}) => s.items.filter((i) => (!invoiceIds || invoiceIds.includes(i.invoice_id)) && (!batchIds || batchIds.includes(i.batch_id))),
    listBatches: async () => [...s.batches].reverse(),
    getBatch: async (id) => s.batches.find((b) => b.id === id) || null,
    confirmImport: async ({ batchId, by, reference }) => {
      const b = s.batches.find((x) => x.id === batchId && x.status === 'exported');
      if (!b) throw Object.assign(new Error(`${batchId} is not an exported batch (already confirmed?)`), { status: 409 });
      Object.assign(b, { status: 'import_confirmed', confirmed_by: by, import_reference: reference || null });
      s.audit.push({ batch_id: batchId, event_type: 'import_confirmed', actor: by, detail: `AP confirmed ${b.file_name} was imported${reference ? ` — NetSuite import reference ${reference}` : ''}. Zoree did not write to NetSuite.` });
      return b;
    },
    insertAuditEvents: async (rows) => { s.audit.push(...rows); return rows; },
    listAudit: async ({ invoiceId, batchId }) => s.audit.filter((a) => (invoiceId ? a.invoice_id === invoiceId : a.batch_id === batchId)),
    // Mirrors ap_create_export_batch: re-checks eligibility, enforces UNIQUE(invoice) and UNIQUE(carrier, number).
    createExportBatch: async ({ batchId, fileName, createdBy, items, csv: file, sha256 }) => {
      if (!file || !sha256) throw Object.assign(new Error('the CSV and its hash are required'), { status: 409 });
      for (const it of items) {
        const i = s.invoices.get(it.invoice_id);
        if (!i || i.status !== 'Approved') throw Object.assign(new Error(`${it.invoice_id} not Approved`), { status: 409 });
        if (!s.releases.some((r) => r.invoice_id === it.invoice_id)) throw Object.assign(new Error(`${it.invoice_id} not released`), { status: 409 });
        if (s.items.some((x) => x.invoice_id === it.invoice_id || (x.carrier_key === it.carrier_key && x.invoice_number === it.invoice_number))) {
          throw Object.assign(new Error('duplicate key value violates unique constraint'), { status: 409 });
        }
      }
      const total = Math.round(items.reduce((t, it) => t + it.amount, 0) * 100) / 100;
      s.batches.push({ id: batchId, file_name: fileName, status: 'exported', invoice_count: items.length, total_amount: total, created_by: createdBy, created_at: '2026-11-14T00:00:00Z', csv_content: file, csv_sha256: sha256 });
      items.forEach((it, n) => {
        const rel = s.releases.find((r) => r.invoice_id === it.invoice_id);
        s.items.push({ ...it, batch_id: batchId, line_no: n + 1, release_path: rel.release_path, released_by: rel.released_by, released_at: rel.released_at });
        s.audit.push({ invoice_id: it.invoice_id, batch_id: batchId, event_type: 'exported', actor: createdBy, detail: `Exported ${it.invoice_number}` });
      });
      return { id: batchId };
    },
  };
  return repo;
}

function setup({ audits = {}, invoices = KB(), env = {} } = {}) {
  const repo = fakeRepo(invoices);
  const svc = createApReleaseService({
    repo, env,
    auditOne: async (i) => ({ audit: audits[i.id] || PASSING }),
    history: require('../services/changeHistory'),
    now: () => new Date('2026-11-14T18:00:00Z'), rand: () => 'T3ST',
  });
  return { repo, svc };
}
const clerk = { email: 'ap.clerk@kestrelbay.com' };
const controller = { email: 'controller@kestrelbay.com' };

// ── Approval permissions ─────────────────────────────────────────────
test('approving an exception needs a written justification', async () => {
  const { svc } = setup();
  await assert.rejects(svc.resolveException({ invoiceId: 'INV-4', action: 'approve', justification: 'ok', user: clerk }), (e) => e.status === 400 && /justification/.test(e.message));
});

test('only held invoices can be resolved; clean ones are released, not re-approved', async () => {
  const { svc } = setup();
  await assert.rejects(svc.resolveException({ invoiceId: 'INV-1', action: 'approve', justification: 'Looks fine to me, approving.', user: clerk }), (e) => e.status === 409);
});

test('dispute keeps BW-5521 blocked from release and export', async () => {
  const { svc } = setup({ audits: { 'INV-4': FAILING } });
  await svc.resolveException({ invoiceId: 'INV-4', action: 'dispute', justification: 'Billed base and fuel exceed contract; request corrected invoice.', user: clerk });
  await assert.rejects(svc.release({ invoiceId: 'INV-4', user: clerk }), (e) => e.status === 409 && /Disputed/.test(e.message));
  const q = await svc.queue();
  assert.ok(q.blocked.some((b) => b.invoiceNumber === 'BW-5521'));
  assert.ok(!q.awaitingRelease.some((b) => b.invoiceNumber === 'BW-5521'));
});

test('override: non-admin refused, same approver refused, short justification refused, admin + 20 chars allowed', async () => {
  const { svc, repo } = setup({ audits: { 'INV-4': FAILING } });
  await svc.resolveException({ invoiceId: 'INV-4', action: 'approve', justification: 'Carrier quoted a spot rate by phone; ops confirmed.', user: clerk });
  // Revalidation still fails → the normal path is closed.
  await assert.rejects(svc.release({ invoiceId: 'INV-4', user: controller }), (e) => e.status === 409 && /authorized override/.test(e.message));
  await assert.rejects(svc.release({ invoiceId: 'INV-4', user: controller, override: { justification: 'Spot rate agreed by ops manager, see email 11/12.' } }), (e) => e.status === 403 && /authorized approver/.test(e.message));
  await assert.rejects(svc.release({ invoiceId: 'INV-4', user: clerk, isAdmin: true, override: { justification: 'Spot rate agreed by ops manager, see email 11/12.' } }), (e) => e.status === 403 && /Segregation of duties/.test(e.message));
  await assert.rejects(svc.release({ invoiceId: 'INV-4', user: controller, isAdmin: true, override: { justification: 'approved' } }), (e) => e.status === 400);
  const r = await svc.release({ invoiceId: 'INV-4', user: controller, isAdmin: true, override: { justification: 'Spot rate agreed by ops manager, see email 11/12.' } });
  assert.equal(r.path, 'authorized_override');
  assert.equal(repo.s.releases[0].exception_approved_by, clerk.email);
});

test('a named override approver (env) is authorized without the admin role', () => {
  assert.equal(policy.canAuthorizeOverride({ isAdmin: false, email: 'Controller@KestrelBay.com', env: { FREIGHT_AUDIT_OVERRIDE_APPROVERS: 'controller@kestrelbay.com, cfo@kestrelbay.com' } }), true);
  assert.equal(policy.canAuthorizeOverride({ isAdmin: false, email: 'ap.clerk@kestrelbay.com', env: { FREIGHT_AUDIT_OVERRIDE_APPROVERS: 'controller@kestrelbay.com' } }), false);
});

// ── Revalidation ────────────────────────────────────────────────────
test('an approved exception that now passes the 3-way match releases on the revalidated path', async () => {
  const audits = { 'INV-5': FAILING };
  const { svc } = setup({ audits });
  await svc.resolveException({ invoiceId: 'INV-5', action: 'approve', justification: 'Liftgate was ordered by the consignee; approval added in TMS.', user: clerk });
  audits['INV-5'] = PASSING; // the accessorial approval was added to the shipment
  const r = await svc.release({ invoiceId: 'INV-5', user: clerk });
  assert.equal(r.path, 'revalidated');
});

test('an agent-approved invoice whose live data no longer matches is blocked, not overridable', () => {
  const s = policy.classify({ invoice: inv({ id: 'X', invoice_number: 'RF-1', carrier: 'R' }), audit: FAILING });
  assert.equal(s.state, 'blocked');
  assert.match(s.blockers[0], /Revalidation failed/);
});

test('a revalidation that cannot run counts as a failure', async () => {
  const repo = fakeRepo(KB());
  const svc = createApReleaseService({ repo, auditOne: async () => { throw new Error('TMS unreachable'); }, manualDecide: async () => ({}) });
  await assert.rejects(svc.release({ invoiceId: 'INV-1', user: clerk }), (e) => e.status === 409 && /Revalidation failed/.test(e.message));
});

// ── Duplicate prevention ────────────────────────────────────────────
test('the three clean invoices release in a batch and export once for $1,464.40', async () => {
  const { svc } = setup();
  const rel = await svc.releaseMany({ invoiceIds: ['INV-1', 'INV-2', 'INV-3', 'INV-4'], user: clerk });
  assert.equal(rel.released, 3);
  assert.equal(rel.results.find((r) => r.invoiceId === 'INV-4').ok, false); // exception stays blocked
  const out = await svc.createExport({ user: clerk });
  assert.equal(out.count, 3);
  assert.equal(out.total, 1464.40);
  assert.equal(out.batch.id, 'NSX-KESTREL_BAY-20261114-180000-T3ST');
  await assert.rejects(svc.createExport({ user: clerk }), (e) => e.status === 409 && /never exported again/.test(e.message));
});

test('releasing twice is refused', async () => {
  const { svc } = setup();
  await svc.release({ invoiceId: 'INV-1', user: clerk });
  await assert.rejects(svc.release({ invoiceId: 'INV-1', user: clerk }), (e) => e.status === 409 && /Already released/.test(e.message));
});

test('a resend of an exported invoice number (same carrier) is never released or exported', async () => {
  const resend = inv({ id: 'INV-9', invoice_number: 'RF-88213', carrier: 'Ridgeline Freight, LLC', shipment_id: 'KB-SH-40117' });
  const { svc } = setup({ invoices: [...KB(), resend] });
  await svc.release({ invoiceId: 'INV-1', user: clerk });
  await svc.createExport({ user: clerk });
  await assert.rejects(svc.release({ invoiceId: 'INV-9', user: clerk }), (e) => e.status === 409 && /never paid twice/.test(e.message));
});

test('selectForExport drops already-exported bills and a bill picked twice', () => {
  const a = inv({ id: 'A', invoice_number: 'RF-1', carrier: 'RIDGELINE FREIGHT' });
  const b = inv({ id: 'B', invoice_number: 'rf-1', carrier: 'Ridgeline Freight' });
  const c = inv({ id: 'C', invoice_number: 'PE-2', carrier: 'PIONEER EXPRESS' });
  const { picked, skipped } = policy.selectForExport({
    released: [{ invoice: a }, { invoice: b }, { invoice: c }],
    exported: [{ invoice_id: 'Z', carrier_key: 'PIONEEREXPRESS', invoice_number: 'PE-2' }],
  });
  assert.deepEqual(picked.map((p) => p.invoice.id), ['A']);
  assert.equal(skipped.length, 2);
});

// ── CSV totals ──────────────────────────────────────────────────────
test('CSV has one row per bill, totals reconcile, and missing NetSuite config is labelled', async () => {
  const { svc } = setup();
  await svc.releaseMany({ invoiceIds: ['INV-1', 'INV-2', 'INV-3'], user: clerk });
  const out = await svc.createExport({ user: clerk });
  const lines = out.csv.trim().split('\r\n');
  assert.equal(lines.length, 4);
  assert.equal(lines[0].split(',')[0], 'External ID');
  const amountCol = csv.COLUMNS.indexOf('Amount');
  const sum = lines.slice(1).reduce((t, l) => t + Number(l.split(',')[amountCol]), 0);
  assert.equal(Math.round(sum * 100) / 100, 1464.40);
  assert.ok(lines[1].includes('ZOREE-KESTREL_BAY-RIDGELINEFREIGHT-RF-88213'));
  assert.ok(lines[1].includes(csv.CONFIG_NEEDED));
  assert.ok(out.missingConfig.some((m) => /Subsidiary/.test(m)));
});

test('CSV uses configured NetSuite values and re-downloads byte-for-byte', async () => {
  const env = { NETSUITE_SUBSIDIARY: 'Kestrel Bay Logistics', NETSUITE_FREIGHT_EXPENSE_ACCOUNT: '5100 Freight In', NETSUITE_VENDOR_IDS: '{"RIDGELINEFREIGHT":"1234","PIONEEREXPRESS":"1240"}' };
  const { svc } = setup({ env });
  await svc.releaseMany({ invoiceIds: ['INV-1', 'INV-2', 'INV-3'], user: clerk });
  const first = await svc.createExport({ user: clerk });
  assert.ok(!first.csv.includes(csv.CONFIG_NEEDED));
  assert.deepEqual(first.missingConfig, []);
  const again = await svc.batchCsv({ batchId: first.batch.id, user: clerk });
  assert.equal(again.csv, first.csv);
});

test('CSV cells are escaped and formula-safe', () => {
  assert.equal(csv.cell('A, "B"'), '"A, ""B"""');
  assert.equal(csv.cell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
});

// ── Audit history ───────────────────────────────────────────────────
test('every step lands in the AP audit history with who and why', async () => {
  const { svc } = setup({ audits: { 'INV-4': FAILING } });
  await svc.resolveException({ invoiceId: 'INV-4', action: 'dispute', justification: 'Billed base exceeds contract by $100; request correction.', user: clerk });
  await svc.release({ invoiceId: 'INV-4', user: clerk }).catch(() => {});
  await svc.release({ invoiceId: 'INV-1', user: clerk, note: 'Clean 3-way match' });
  const out = await svc.createExport({ user: clerk });
  await svc.batchCsv({ batchId: out.batch.id, user: controller });
  await svc.confirmImport({ batchId: out.batch.id, user: controller, reference: 'NS-IMPORT-4471' });

  const bw = await svc.auditHistory({ invoiceId: 'INV-4' });
  assert.deepEqual(bw.map((e) => e.type), ['exception_disputed', 'release_blocked']);
  assert.match(bw[0].detail, /request correction/);
  assert.equal(bw[0].actor, clerk.email);

  const rf = await svc.auditHistory({ invoiceId: 'INV-1' });
  assert.deepEqual(rf.map((e) => e.type), ['released', 'exported']);
  const batch = await svc.auditHistory({ batchId: out.batch.id });
  assert.ok(batch.some((e) => e.type === 'export_downloaded' && e.actor === controller.email));
  assert.ok(batch.some((e) => e.type === 'import_confirmed' && /NS-IMPORT-4471/.test(e.detail) && /did not write to NetSuite/.test(e.detail)));
  await assert.rejects(svc.confirmImport({ batchId: out.batch.id, user: controller }), (e) => e.status === 409);
});

// ── Review hardening (migration 055) ────────────────────────────────
test('release is refused if the invoice changed after the revalidation it was based on', async () => {
  const { svc, repo } = setup();
  const realAudit = async (i) => { repo.s.invoices.get(i.id).invoiced_amount = 610.88; return { audit: PASSING }; }; // edited mid-release
  const svc2 = createApReleaseService({ repo, auditOne: realAudit, manualDecide: async () => ({}) });
  await assert.rejects(svc2.release({ invoiceId: 'INV-2', user: clerk }), (e) => e.status === 409 && /changed after it was revalidated/.test(e.message));
  assert.equal(repo.s.releases.length, 0);
  assert.ok(svc); // first service untouched
});

test('two records of the same carrier bill released at the same time: only one wins', async () => {
  const twin = inv({ id: 'INV-8', invoice_number: 'pe-0931 ', carrier: 'Pioneer Express Inc.', shipment_id: 'KB-SH-40141', invoiced_amount: 442.64 });
  const { svc } = setup({ invoices: [...KB(), twin] });
  const results = await Promise.allSettled([svc.release({ invoiceId: 'INV-3', user: clerk }), svc.release({ invoiceId: 'INV-8', user: clerk })]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.match(results.find((r) => r.status === 'rejected').reason.message, /never paid twice/);
});

test('the stored CSV is served on re-download and checked against its SHA-256', async () => {
  const { svc, repo } = setup();
  await svc.releaseMany({ invoiceIds: ['INV-1', 'INV-2', 'INV-3'], user: clerk });
  const out = await svc.createExport({ user: clerk });
  assert.match(out.sha256, /^[0-9a-f]{64}$/);
  const again = await svc.batchCsv({ batchId: out.batch.id, user: clerk });
  assert.equal(again.csv, out.csv);
  repo.s.batches[0].csv_content += 'tampered';
  await assert.rejects(svc.batchCsv({ batchId: out.batch.id, user: clerk }), (e) => e.status === 500 && /SHA-256/.test(e.message));
});

test('legacy approve on a held invoice goes through the justification rule', async () => {
  const { svc, repo } = setup();
  await assert.rejects(svc.resolveIfHeld({ invoiceId: 'INV-4', action: 'approve', justification: '', user: clerk }), (e) => e.status === 400);
  assert.equal(repo.s.invoices.get('INV-4').status, 'On Hold');
  assert.equal(await svc.resolveIfHeld({ invoiceId: 'INV-1', action: 'approve', justification: '', user: clerk }), null); // not held → legacy path
});

test('all AP tables are domain-scoped (tenant isolation)', () => {
  const { SCOPED_TABLES } = require('../services/domains/domainCodes');
  const { scopeRequest } = require('../services/domains/domainScope');
  const base = 'https://x.supabase.co/rest/v1/';
  for (const t of ['invoice_ap_releases', 'ap_export_batches', 'ap_export_batch_items', 'ap_audit_events']) {
    assert.ok(SCOPED_TABLES.has(t), t);
    assert.match(scopeRequest({ url: `${base}${t}?id=eq.1`, method: 'GET' }, 'KESTREL_BAY', base).url, /domain_code=eq\.KESTREL_BAY/);
  }
});

test('resolving an exception writes invoice + shipment history in the same call as the decision', async () => {
  const { svc, repo } = setup();
  await svc.resolveException({ invoiceId: 'INV-4', action: 'approve', justification: 'Carrier quoted a spot rate by phone; ops confirmed.', user: clerk });
  assert.deepEqual(repo.s.history.map((h) => `${h.entity_type}:${h.entity_id}:${h.new_value}`), ['invoice:INV-4:Approved', 'shipment:KB-SH-40130:Approved']);
  assert.equal(repo.s.audit.at(-1).event_type, 'exception_approved');
});
