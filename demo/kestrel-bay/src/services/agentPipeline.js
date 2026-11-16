'use strict';
// The agent, end to end:  invoice PDF → Claude reads it → check the read →
// match TMS shipment + contract → AP rules → clear or route to a person.
// Progress is published step by step so the UI can show the run live.
const fs = require('fs');
const path = require('path');
const dataPack = require('./dataPack');
const extractor = require('./invoiceExtractor');
const extractionChecks = require('./extractionChecks');
const auditRunner = require('./auditRunner');

const INBOX = path.join(__dirname, '..', '..', 'inbox');

function listInbox() {
  return fs.readdirSync(INBOX).filter((f) => f.toLowerCase().endsWith('.pdf')).sort();
}

function unreadableResult(seq, file, check) {
  return {
    invoice: check.invoice || { seq, file, invoiceNumber: file, carrier: '—', shipmentId: '—', lines: [], total: 0 },
    verdict: 'unreadable', route: 'person', issues: check.problems.map((p) => ({ code: 'read_check_failed', amount: 0, detail: p })),
    passed: check.passed, overcharge: 0, held: check.invoice ? check.invoice.total : 0, recommendPay: 0,
    recommendation: 'A person opens the PDF and keys it. The agent does not audit numbers it could not read reliably.',
  };
}

/**
 * @param {object} job       runStore job (mutated with progress)
 * @param {object} opts      { offline: use cached reads only }
 */
async function run(job, { offline = false } = {}) {
  const pack = dataPack.load();
  const files = listInbox();
  const knownCarriers = [...new Set(pack.contracts.map((c) => c.carrier))];
  job.total = files.length;
  job.emit('intake', `${files.length} invoice PDFs in the AP inbox`);

  // Read all PDFs in parallel (limit 4), audit strictly in arrival order.
  const reads = new Array(files.length);
  let next = 0;
  async function worker() {
    while (next < files.length) {
      const i = next++;
      job.emit('reading', `Reading ${files[i]}`, { seq: i + 1 });
      reads[i] = extractor.extract(path.join(INBOX, files[i]), { preferCache: offline });
      await reads[i];
    }
  }
  const workers = Array.from({ length: Math.min(4, files.length) }, worker);

  const ledger = auditRunner.createLedger();
  for (let i = 0; i < files.length; i += 1) {
    while (!reads[i]) await new Promise((r) => setTimeout(r, 25));
    const ex = await reads[i];
    const seq = i + 1;
    const check = extractionChecks.check(ex, { knownCarriers, seq });
    let result;
    if (!check.ok) result = unreadableResult(seq, ex.file, check);
    else {
      result = auditRunner.auditOne(check.invoice, pack, ledger);
      result.passed = [...check.passed, ...result.passed];
    }
    result.read = { source: ex.source, ms: ex.ms, error: ex.error, confidence: ex.fields && ex.fields.confidence, warnings: (ex.fields && ex.fields.warnings) || [] };
    job.results.push(result);
    job.emit('decided', `${result.invoice.invoiceNumber}: ${result.verdict}`, { seq });
  }
  await Promise.all(workers);
  job.summary = auditRunner.summarize(job.results, pack.policy);
  job.checks = pack.checks;
  return job;
}

module.exports = { run, listInbox, INBOX };
