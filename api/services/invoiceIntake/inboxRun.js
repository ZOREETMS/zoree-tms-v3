// ═══════════════════════════════════════════════════════════════════
// AP inbox run — read every new PDF in the domain's inbox folder.
//
//   list folder → skip files already read (by hash)
//     → Claude reads the new PDFs (up to 4 at a time)
//     → each goes through intakePdf one at a time, in arrival order
//       (order matters: a resend must be seen after the original)
//
// A run is a background job per domain; the UI polls status() and shows
// each invoice as it is decided. Job state is in memory — it describes
// work in flight; every result is also in invoice_intakes.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const inboxFolder = require('./inboxFolder');
const repo = require('./intakeRepository');
const extractor = require('./pdfExtractor');
const intake = require('./intakeService');
const intakeRuns = require('./intakeRuns');
const { currentDomain, runInDomain } = require('../domains/domainContext');

const READ_CONCURRENCY = 4;
const jobs = new Map(); // domain → job

/** Run tasks with at most `limit` in flight; returns one promise per task, in order. */
function limited(tasks, limit) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= limit || !queue.length) return;
    active += 1;
    const { task, resolve, reject } = queue.shift();
    task().then(resolve, reject).finally(() => { active -= 1; next(); });
  };
  return tasks.map((task) => new Promise((resolve, reject) => { queue.push({ task, resolve, reject }); next(); }));
}

function view(job) {
  if (!job) return null;
  const { id, status, startedAt, finishedAt, total, skipped, current, results, error } = job;
  return { id, status, startedAt, finishedAt, total, skipped, current, results, error };
}

/** Folder contents + which files were already read + the latest run. */
async function status() {
  const domain = currentDomain();
  const { folder, exists, files, tooLarge } = inboxFolder.list(domain);
  const seen = await repo.processedHashes();
  const rows = files.map((f) => ({ name: f.name, size: f.size, alreadyRead: seen.has(f.sha256) }));
  return {
    domain, folder, exists, tooLarge,
    files: rows,
    waiting: rows.filter((r) => !r.alreadyRead).length,
    alreadyRead: rows.filter((r) => r.alreadyRead).length,
    job: view(jobs.get(domain)),
  };
}

async function run(job, user) {
  const { files } = inboxFolder.list(job.domain);
  const seen = await repo.processedHashes();
  const fresh = files.filter((f) => !seen.has(f.sha256));
  job.skipped = files.length - fresh.length;
  job.total = fresh.length;

  const reads = limited(fresh.map((f) => () => extractor.extract(f.buffer)), READ_CONCURRENCY);
  reads.forEach((p) => p.catch(() => {})); // a failed read is reported by intakePdf, not here

  for (let i = 0; i < fresh.length; i += 1) {
    const f = fresh[i];
    job.current = f.name;
    let result;
    try {
      result = await intake.intakePdf({ fileName: f.name, buffer: f.buffer, user, preRead: reads[i] }); // eslint-disable-line no-await-in-loop
    } catch (e) {
      result = { fileName: f.name, status: 'failed', summary: e.message, problems: [e.message] };
    }
    job.results.push(result);
  }
  job.current = null;
}

/** Start a run for the current domain. One run at a time per domain. */
function start({ user }) {
  const domain = currentDomain();
  const running = jobs.get(domain);
  if (running && running.status === 'running') { const e = new Error('The inbox is already being read'); e.status = 409; throw e; }
  const job = { id: Date.now().toString(36), domain, status: 'running', startedAt: new Date().toISOString(), finishedAt: null,
    total: 0, skipped: 0, current: null, results: [], error: null };
  jobs.set(domain, job);
  runInDomain(domain, () => intakeRuns.track(
    { trigger: 'manual', channel: 'inbox_folder', startedBy: (user && user.email) || 'unknown', domains: [domain] },
    () => run(job, user),
  ))
    .then(() => { job.status = 'done'; })
    .catch((e) => { job.status = 'failed'; job.error = e.message; })
    .finally(() => { job.finishedAt = new Date().toISOString(); });
  return view(job);
}

module.exports = { status, start, _internals: { limited } };
