// Measure the Jev intent gate on a labeled message set.
//   cd api && node scripts/jevEval.js            (3 runs per message)
//   cd api && node scripts/jevEval.js --runs 5
//   cd api && node scripts/jevEval.js --timeout 5000   (default: JEV_TIMEOUT_MS, as production)
// Calls Jev only — never the TMS, the database or a carrier.
// Writes api/eval-results/jev-eval-<timestamp>.md and .json.
'use strict';

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const jev = require('../services/ai/jevClient');
const { runEval } = require('../services/ai/jevEval');
const { toMarkdown } = require('../services/ai/jevEvalReport');

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  const n = i === -1 ? NaN : Number.parseInt(process.argv[i + 1], 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function main() {
  if (!jev.isConfigured()) {
    console.error('TYPESAFE_API_KEY is not set in api/.env');
    process.exit(1);
  }
  const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, 'jevEvalCases.json'), 'utf8'));
  const runs = argValue('--runs', 3);
  console.log(`Running ${cases.length} messages × ${runs} runs = ${cases.length * runs} Jev calls…`);

  const report = await runEval(cases, {
    runs,
    concurrency: argValue('--concurrency', 4),
    timeoutMs: argValue('--timeout', undefined),
  });
  const s = report.summary;

  const outDir = path.join(__dirname, '..', 'eval-results');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = s.startedAt.replace(/[:.]/g, '-');
  const mdPath = path.join(outDir, `jev-eval-${stamp}.md`);
  fs.writeFileSync(mdPath, toMarkdown(report));
  fs.writeFileSync(path.join(outDir, `jev-eval-${stamp}.json`), JSON.stringify(report, null, 2));

  console.log(`\nKeyword parser would change data on ${s.questions.keywordWouldChangeData}/${s.questions.total} questions`);
  console.log(`Jev blocked ${s.questions.runsBlocked}/${s.questions.runsOnThose} of those calls (${s.questions.blockRatePct}%)`);
  console.log(`False blocks on commands: ${s.commands.runsFalselyBlocked}/${s.commands.runsOnThose} (${s.commands.falseBlockRatePct}%)`);
  console.log(`Inconsistent: ${s.inconsistentCases.join(', ') || 'none'} · errors: ${s.errors} (${s.timeouts} timeouts at ${s.timeoutMs} ms)`);
  console.log(`Latency p50 ${s.latencyMs.p50} ms · p95 ${s.latencyMs.p95} ms · cost $${s.costUsd.total}`);
  console.log(`\nReport: ${mdPath}`);
}

main().catch((err) => {
  console.error(`FAILED: ${err.message}`);
  process.exit(1);
});
