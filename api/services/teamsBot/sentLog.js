// ═══════════════════════════════════════════════════════════════════
// Sent-activity log for the Teams bot `clear` command.
//
// Teams lets a bot delete ONLY its own messages, and only by activity
// id — there is no "clear conversation" API. So we remember the id of
// every activity the bot sends (per conversation), and `clear` walks
// the list calling deleteActivity. The user's own messages can't be
// touched by the bot (Teams restriction); they go via the message's
// ⋯ menu.
//
// Persistence: a small JSON file next to the API (survives nodemon
// restarts, which happen constantly in dev). Dep-free, best-effort —
// a lost log only means older bot messages stop being clearable, so
// I/O failures are swallowed after a console warning.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const fs = require('fs');
const path = require('path');

// .log extension ON PURPOSE (content is JSON): nodemon watches
// js,mjs,cjs,json — a .json file here meant every bot reply wrote the
// log and RESTARTED the API, so the next inbound message hit a dead
// server ("nothing happened" when Sridhar sent `clear`, 2026-08-09).
// teams-bot.log (debugLog) never caused restarts for the same reason.
const FILE = path.join(__dirname, '..', '..', 'teams-bot-sent.log');
const MAX_PER_CONVERSATION = 500;

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8')) || {};
  } catch (_) {
    return {};
  }
}

function save(data) {
  try {
    fs.writeFileSync(FILE, JSON.stringify(data));
  } catch (e) {
    console.warn('[teamsBot/sentLog] persist failed:', e.message);
  }
}

/** Remember an activity the bot sent into a conversation. */
function record(conversationId, activityId) {
  if (!conversationId || !activityId) return;
  const data = load();
  const list = data[conversationId] || [];
  list.push(String(activityId));
  data[conversationId] = list.slice(-MAX_PER_CONVERSATION);
  save(data);
}

/** Return all remembered ids for a conversation and forget them. */
function take(conversationId) {
  if (!conversationId) return [];
  const data = load();
  const list = data[conversationId] || [];
  delete data[conversationId];
  save(data);
  return list;
}

module.exports = { record, take };
