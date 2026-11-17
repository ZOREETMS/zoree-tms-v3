// ═══════════════════════════════════════════════════════════════════
// Invoice-agent run log (migration 056).
//
// track() wraps one run — a scheduled mailbox check, a "Read AP Mailbox"
// click, an inbox-folder read. Every invoice document read inside it is
// linked to the run (invoice_intakes.run_id). A run row is per client
// domain, created the first time that domain gets a document, so:
//   - a pressed button always logs a row (its domain is created up front)
//   - a scheduled check that finds nothing logs nothing (no 288 empty
//     rows a day); a failed one is logged so the error is visible
// Outcome counts are derived from the linked intakes, never stored.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const runContext = require('./runContext');
const runRepo = require('./runRepository');
const intakeLog = require('./intakeLog');
const { runInDomain } = require('../domains/domainContext');

const STALE_MS = 30 * 60 * 1000; // a 'running' row older than this was cut off (server restart)

const LABEL = {
  schedule: 'Scheduled check',
  ap_mailbox: 'Read AP Mailbox',
  inbox_folder: 'Read inbox folder',
};

/** Pure: how a run is named in the UI. */
// What started an automatic run (started_by, set by apWatcher).
const AUTO_LABEL = { 'new-email': 'New email arrived', 'catch-up-check': 'Catch-up check', 'backup-check': 'Backup check' };

function labelOf(run) {
  if (!run) return null;
  if (run.trigger === 'schedule') return AUTO_LABEL[run.started_by] || LABEL.schedule;
  return LABEL[run.channel] || 'Manual run';
}

function createScope({ trigger, channel, startedBy, mailbox = null, tenantId = null }) {
  const runs = new Map(); // domain → Promise<run row>
  return {
    trigger, channel, startedBy, mailbox, emailsRead: null, runs,
    idFor(domain) {
      if (!runs.has(domain)) {
        const p = runInDomain(domain, () => runRepo.create({
          domain_code: domain, tenant_id: tenantId, trigger, channel,
          started_by: String(startedBy || 'unknown').slice(0, 200), mailbox, status: 'running',
        }));
        p.catch(() => {}); // reported by runContext.currentRunId when awaited
        runs.set(domain, p);
      }
      return runs.get(domain).then((row) => row.id);
    },
  };
}

async function finishAll(scope, error = null) {
  const finishedAt = new Date().toISOString();
  await Promise.all([...scope.runs].map(async ([domain, pending]) => {
    let row;
    try { row = await pending; } catch { return; }
    await runInDomain(domain, () => runRepo.finish(row.id, {
      status: error ? 'failed' : 'completed',
      error: error ? String(error).slice(0, 1000) : null,
      emails_read: scope.emailsRead,
      finished_at: finishedAt,
    })).catch((e) => console.warn('[intakeRuns] could not close run:', e.message));
  }));
}

/**
 * Run `fn` as one logged agent run.
 * @param {{ trigger:'schedule'|'manual', channel:'ap_mailbox'|'inbox_folder', startedBy:string,
 *           mailbox?:string, tenantId?:string, domains?:string[], failureDomains?:string[] }} opts
 *   domains         always get a run row (the domain a person pressed the button in)
 *   failureDomains  get a row if the run fails before any document was read
 */
async function track(opts, fn) {
  const { domains = [], failureDomains = [] } = opts;
  const scope = createScope(opts);
  domains.forEach((d) => { scope.idFor(d).catch(() => {}); });
  try {
    const out = await runContext.withScope(scope, fn);
    await finishAll(scope);
    return out;
  } catch (err) {
    failureDomains.forEach((d) => { scope.idFor(d).catch(() => {}); });
    await finishAll(scope, err && err.message ? err.message : String(err));
    throw err;
  }
}

const emptyCounts = () => ({ documents: 0, ready_to_post: 0, needs_review: 0, disputed: 0, duplicate: 0, needs_manual: 0, failed: 0, deleted: 0 });

/** Pure: outcome counts per run id, from the intakes and their invoices. */
function countByRun(intakes, invoices) {
  const invById = new Map(invoices.map((i) => [i.id, i]));
  const out = new Map();
  for (const row of intakes) {
    if (!out.has(row.run_id)) out.set(row.run_id, emptyCounts());
    const c = out.get(row.run_id);
    c.documents += 1;
    const outcome = intakeLog.outcomeOf(row, invById.get(row.invoice_id));
    c[outcome] = (c[outcome] || 0) + 1;
  }
  return out;
}

/** Pure: one run as the UI shows it. */
function view(run, counts = emptyCounts(), now = Date.now()) {
  const started = Date.parse(run.started_at);
  const finished = run.finished_at ? Date.parse(run.finished_at) : null;
  const interrupted = run.status === 'running' && Number.isFinite(started) && now - started > STALE_MS;
  return {
    id: run.id,
    trigger: run.trigger,
    channel: run.channel,
    label: labelOf(run),
    startedBy: run.started_by,
    mailbox: run.mailbox,
    status: interrupted ? 'interrupted' : run.status,
    emailsRead: run.emails_read,
    error: run.error,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    durationMs: finished && Number.isFinite(started) ? finished - started : null,
    counts,
  };
}

/** Latest runs for the current domain, with outcome counts. */
async function listRuns({ limit = 50 } = {}) {
  const rows = await runRepo.list(limit);
  const { intakes, invoices } = await runRepo.intakesOf(rows.map((r) => r.id));
  const counts = countByRun(intakes, invoices);
  return rows.map((r) => view(r, counts.get(r.id)));
}

/** One run and every document it read (same entries as the AP review list). */
async function runDetail(id) {
  const run = await runRepo.get(id);
  if (!run) { const e = new Error('Run not found in this domain'); e.status = 404; throw e; }
  const { entries, summary } = await intakeLog.list({ limit: 200, runId: id });
  const counts = emptyCounts();
  for (const e of entries) {
    counts.documents += 1;
    counts[e.outcome] = (counts[e.outcome] || 0) + 1;
  }
  return { run: view(run, counts), entries, summary };
}

module.exports = { track, listRuns, runDetail, labelOf, _internals: { createScope, countByRun, view, STALE_MS } };
