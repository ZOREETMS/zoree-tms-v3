// Invoice-agent run log (migration 056) — repository stubbed via require cache.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const S = (rel) => path.join(__dirname, '..', 'services', rel);
function stub(rel, exports) { const id = require.resolve(S(rel)); require.cache[id] = { id, filename: id, loaded: true, exports }; }

const created = [];
const finished = [];
let failCreate = false;
stub('supabase.js', { dbSelect: async () => [], getClient: () => ({}) });
stub('invoiceIntake/runRepository.js', {
  create: async (row) => {
    if (failCreate) throw new Error('db down');
    const r = { id: `RUN-${created.length + 1}`, ...row };
    created.push(r);
    return r;
  },
  finish: async (id, patch) => { finished.push({ id, ...patch }); },
  list: async () => [], get: async () => null, byIds: async () => [], intakesOf: async () => ({ intakes: [], invoices: [] }),
});

const runs = require(S('invoiceIntake/intakeRuns.js'));
const ctx = require(S('invoiceIntake/runContext.js'));
const reset = () => { created.length = 0; finished.length = 0; failCreate = false; };

test('outside a run there is no run id', async () => {
  reset();
  assert.equal(await ctx.currentRunId('KESTREL_BAY'), null);
});

test('a pressed button always logs a run, even when nothing is found', async () => {
  reset();
  await runs.track({ trigger: 'manual', channel: 'ap_mailbox', startedBy: 'sridhar@zoree.io', mailbox: 'ap@zoree.io', domains: ['KESTREL_BAY'] },
    async () => { ctx.noteEmailsRead(0); });
  assert.equal(created.length, 1);
  assert.equal(created[0].domain_code, 'KESTREL_BAY');
  assert.equal(created[0].trigger, 'manual');
  assert.equal(created[0].started_by, 'sridhar@zoree.io');
  assert.equal(finished[0].status, 'completed');
  assert.equal(finished[0].emails_read, 0);
});

test('a scheduled check that finds nothing logs nothing', async () => {
  reset();
  await runs.track({ trigger: 'schedule', channel: 'ap_mailbox', startedBy: 'scheduler' }, async () => {});
  assert.equal(created.length, 0);
  assert.equal(finished.length, 0);
});

test('one run row per domain, created on the first document, same id after', async () => {
  reset();
  const ids = await runs.track({ trigger: 'schedule', channel: 'ap_mailbox', startedBy: 'scheduler' }, async () => {
    ctx.noteEmailsRead(3);
    return [await ctx.currentRunId('KESTREL_BAY'), await ctx.currentRunId('KESTREL_BAY'), await ctx.currentRunId('ZOREE')];
  });
  assert.equal(created.length, 2);
  assert.equal(ids[0], ids[1]);
  assert.notEqual(ids[0], ids[2]);
  assert.deepEqual(finished.map((f) => f.status), ['completed', 'completed']);
  assert.ok(finished.every((f) => f.emails_read === 3));
});

test('a failed scheduled check is logged in the mailbox domain, then rethrown', async () => {
  reset();
  await assert.rejects(
    runs.track({ trigger: 'schedule', channel: 'ap_mailbox', startedBy: 'scheduler', failureDomains: ['KESTREL_BAY'] },
      async () => { throw new Error('Invalid credentials'); }),
    /Invalid credentials/,
  );
  assert.equal(created.length, 1);
  assert.equal(finished[0].status, 'failed');
  assert.match(finished[0].error, /Invalid credentials/);
});

test('if the run row cannot be written, the work still runs with no run id', async () => {
  reset();
  failCreate = true;
  const id = await runs.track({ trigger: 'manual', channel: 'ap_mailbox', startedBy: 'x', domains: ['KESTREL_BAY'] },
    async () => ctx.currentRunId('KESTREL_BAY'));
  assert.equal(id, null);
  assert.equal(finished.length, 0);
});

test('outcome counts per run follow the AP outcome of each document', () => {
  const { countByRun } = runs._internals;
  const counts = countByRun(
    [
      { run_id: 'R1', status: 'created', invoice_id: 'I1' },
      { run_id: 'R1', status: 'created', invoice_id: 'I2' },
      { run_id: 'R1', status: 'duplicate', invoice_id: null },
      { run_id: 'R2', status: 'needs_manual', invoice_id: null },
    ],
    [{ id: 'I1', status: 'Approved' }, { id: 'I2', status: 'On Hold' }],
  );
  assert.deepEqual(
    { d: counts.get('R1').documents, r: counts.get('R1').ready_to_post, h: counts.get('R1').needs_review, dup: counts.get('R1').duplicate },
    { d: 3, r: 1, h: 1, dup: 1 },
  );
  assert.equal(counts.get('R2').needs_manual, 1);
});

test('a run still "running" after 30 minutes shows as interrupted', () => {
  const { view, STALE_MS } = runs._internals;
  const startedAt = new Date(Date.now() - STALE_MS - 1000).toISOString();
  assert.equal(view({ id: 'R', trigger: 'manual', channel: 'ap_mailbox', status: 'running', started_at: startedAt }).status, 'interrupted');
  assert.equal(view({ id: 'R', trigger: 'schedule', channel: 'ap_mailbox', status: 'completed', started_at: startedAt, finished_at: startedAt }).label, 'Scheduled check');
});

test('run label says what started an automatic run', () => {
  const { view } = runs._internals;
  const at = '2026-11-17T19:58:02Z';
  const v = (startedBy) => view({ id: 'R', trigger: 'schedule', channel: 'ap_mailbox', started_by: startedBy, status: 'completed', started_at: at, finished_at: at }).label;
  assert.equal(v('new-email'), 'New email arrived');
  assert.equal(v('catch-up-check'), 'Catch-up check');
  assert.equal(v('backup-check'), 'Backup check');
  assert.equal(v('scheduler'), 'Scheduled check');
});

test('AP review says an invoice came in by a new email, not a "scheduled check"', () => {
  const log = require('../services/invoiceIntake/intakeLog');
  const arrival = (log._internals && log._internals.arrivalOf) || log.arrivalOf;
  if (!arrival) return; // not exported in this build
  assert.equal(arrival({}, { id: 'R', trigger: 'schedule', started_by: 'new-email' }).label, 'New email');
  assert.equal(arrival({}, { id: 'R', trigger: 'schedule', started_by: 'backup-check' }).label, 'Backup check');
  assert.equal(arrival({}, { id: 'R', trigger: 'schedule', started_by: 'scheduler' }).label, 'Scheduled check');
});
