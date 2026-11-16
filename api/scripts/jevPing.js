// Jev check / demo rehearsal. Never prints the key.
//   cd api && node scripts/jevPing.js
//   cd api && node scripts/jevPing.js "tell me the carrier options to plan ORD-140346"
// Shows what the keyword parser would do, what Jev thinks, and whether
// the gate would block it (it blocks only in JEV_MODE=enforce).
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const jev = require('../services/ai/jevClient');
const { BOT_QUESTIONS, buildState, decide, getMode, status } = require('../services/ai/intentGate');
const { isDryRun, dryRunWarnings } = require('../services/teamsBot/dryRun');
const { parseTypedCommand, MUTATING_WORDS: MUTATING } = require('../services/teamsBot/handlers');

async function main() {
  const cfg = jev.getConfig();
  const st = status();
  console.log(`key: ${cfg.apiKey ? `set (${cfg.apiKey.length} chars)` : 'MISSING'} · model: ${cfg.model} · mode: ${getMode()} · fail: ${st.failMode} · dry run: ${isDryRun() ? 'ON' : 'off'}`);
  for (const w of [...st.warnings, ...dryRunWarnings()]) console.log(`WARNING: ${w}`);
  if (!cfg.apiKey) process.exit(1);

  const text = process.argv.slice(2).join(' ') || 'what are different carrier options available to plan ORD-1001';
  const parsed = parseTypedCommand(text);
  const isMutating = MUTATING.has(parsed.cmd);
  console.log(`\nmessage : "${text}"`);
  console.log(`keywords: ${parsed.cmd} ${parsed.arg1}${isMutating ? '   ← would CHANGE data' : '   (read-only)'}`);

  const r = await jev.systemOne(buildState(text), BOT_QUESTIONS, { config: { timeoutMs: 10000 } });
  const d = decide({ isMutating, answers: r.answers });
  console.log(`jev     : ${r.answers.intent.choice} (confidence ${r.answers.intent.confidence}), p(question) ${r.answers.is_question.noul} · ${r.model} · ${r.latencyMs}ms`);
  console.log(`gate    : ${d.veto ? 'BLOCK → shows read-only info instead' : 'allow'} (${d.reason})`);
}

main().catch((err) => {
  console.error(`FAILED (${err.status ?? 'network'}): ${err.message}`);
  if (err.status === 401) console.error('→ key rejected by api.typesafe.ai — check it came from console.typesafe.ai → API Keys');
  process.exit(1);
});
