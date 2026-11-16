// ═══════════════════════════════════════════════════════════════════
// Append-only JSONL log of every Jev decision (api/jev-decisions.log).
//
// This is the evaluation trail for shadow mode: each line records what
// the regex dispatcher chose, what Jev answered (model id, choice,
// probabilities, confidence), and whether the gate vetoed. Review it
// before switching JEV_MODE to enforce, and to tune JEV_VETO_THRESHOLD.
//
// Covered by *.log in .gitignore. Never throws — logging must not break
// the bot.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_LOG_PATH = path.join(__dirname, '..', '..', 'jev-decisions.log');
const MAX_TEXT = 500;

// JEV_DECISION_LOG overrides the path (tests point it at a temp file).
function logPath() {
  return process.env.JEV_DECISION_LOG || DEFAULT_LOG_PATH;
}

function logDecision(entry) {
  try {
    const safe = { ts: new Date().toISOString(), ...entry };
    if (typeof safe.text === 'string') safe.text = safe.text.slice(0, MAX_TEXT);
    fs.appendFileSync(logPath(), `${JSON.stringify(safe)}\n`);
  } catch (_) { /* never break the caller */ }
}

module.exports = { logDecision, logPath, DEFAULT_LOG_PATH };
