'use strict';
// End-to-end check: runs the real agent (Claude reads the PDFs) and compares
// both the read and the decision with what AP expects. --offline uses cached reads.
process.chdir(require('path').join(__dirname, '..'));
const pipeline = require('../src/services/agentPipeline');
const runStore = require('../src/services/runStore');
const expected = require('./expected-invoices.json');

const EXPECT = {
  1: { verdict: 'clear', route: 'auto', codes: [] },
  2: { verdict: 'overbilled', route: 'person', codes: ['extra_not_approved'], overcharge: 85 },
  3: { verdict: 'clear', route: 'auto', codes: [] },
  4: { verdict: 'overbilled', route: 'person', codes: ['base_over_contract', 'fuel_over_contract'], overcharge: 122 },
  5: { verdict: 'clear', route: 'auto', codes: [] },
  6: { verdict: 'duplicate', route: 'person', codes: ['duplicate_invoice'] },
  7: { verdict: 'unmatched', route: 'person', codes: ['shipment_not_found'] },
  8: { verdict: 'not_payable', route: 'person', codes: ['shipment_not_delivered'] },
  9: { verdict: 'clear', route: 'auto', codes: [] },                       // crooked phone scan, still read
  10: { verdict: 'unreadable', route: 'person', codes: ['read_check_failed'] }, // total ≠ lines → a person keys it
};

(async () => {
  const job = runStore.newJob('shadow');
  await pipeline.run(job, { offline: process.argv.includes('--offline') });
  let bad = 0;
  for (const r of job.results) {
    const e = EXPECT[r.invoice.seq];
    const x = expected.find((v) => v.seq === r.invoice.seq);
    const readOk = x && r.invoice.invoiceNumber === x.invoiceNumber && r.invoice.shipmentId === x.shipmentId && r.invoice.total === x.total;
    const codes = r.issues.map((i) => i.code).sort().join(',');
    const ok = readOk && r.verdict === e.verdict && r.route === e.route && codes === e.codes.slice().sort().join(',') && (e.overcharge == null || r.overcharge === e.overcharge);
    if (!ok) bad += 1;
    console.log(`${ok ? 'OK  ' : 'FAIL'} #${r.invoice.seq} ${String(r.invoice.invoiceNumber).padEnd(9)} read=${r.read.source}/${r.read.confidence} ${readOk ? 'read-ok' : 'READ-MISMATCH'}  ${r.verdict.padEnd(11)} ${r.route.padEnd(6)} over=$${r.overcharge}  ${codes || 'clean'}`);
    if (r.verdict === 'clear') console.log(`        why clean: ${r.passed.join(' | ')}`);
    else console.log(`        ${r.issues.map((i) => i.detail).join(' | ')}`);
  }
  console.log('\nSummary:', JSON.stringify(job.summary));
  if (bad) { console.error(`\n${bad} mismatch(es)`); process.exit(1); }
  console.log('\nAll PDFs read correctly and decided as AP expects.');
})();
