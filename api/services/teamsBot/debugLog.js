// ═══════════════════════════════════════════════════════════════════
// Append-only debug log for the Teams bot handshake.
//
// The dev servers run in a detached console window, so the usual
// console.log trail is hard to read while diagnosing why Teams isn't
// getting a reply. When TEAMS_BOT_DEBUG=true, every inbound activity
// and every outbound reply attempt is appended to api/teams-bot.log
// with a timestamp — safe to tail, safe to delete.
//
// No-op unless TEAMS_BOT_DEBUG=true. Never throws (a logging failure
// must not break the bot).
// ═══════════════════════════════════════════════════════════════════

'use strict';

const fs = require('fs');
const path = require('path');

const ENABLED = String(process.env.TEAMS_BOT_DEBUG || '').toLowerCase() === 'true';
const LOG_PATH = path.join(__dirname, '..', '..', 'teams-bot.log');

function debugLog(label, data) {
  if (!ENABLED) return;
  try {
    const line = `${new Date().toISOString()} ${label} ${
      data === undefined ? '' : JSON.stringify(data)
    }\n`;
    fs.appendFileSync(LOG_PATH, line);
  } catch (_) { /* logging must never break the bot */ }
}

module.exports = { debugLog, LOG_PATH, ENABLED };
