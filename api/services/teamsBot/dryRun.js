// ═══════════════════════════════════════════════════════════════════
// Teams bot dry-run switch — for demos and rehearsals.
//
// TEAMS_BOT_DRY_RUN=true: any command that would change TMS data
// (plan, tender, accept, status changes, …) replies with what it WOULD
// do and changes nothing — no PATCH, no tender record, no carrier email.
// Read-only commands (rate, order, shipment, today, …) run normally, so
// the demo still shows real data.
//
// `clear`/`reset` are not TMS data (they only delete the bot's own chat
// messages), so they keep working in dry-run.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const { textActivity } = require('./connector');

const DATA_COMMANDS = new Set([
  'plan', 'unplan', 'unassign', 'tender', 'accept', 'reject', 'withdraw',
  'intransit', 'transit', 'pickup', 'delivered', 'deliver',
]);

const ON = new Set(['true', '1', 'yes', 'on']);
const OFF = new Set(['', 'false', '0', 'no', 'off']);

function rawFlag() {
  return String(process.env.TEAMS_BOT_DRY_RUN || '').trim().toLowerCase();
}

function isDryRun() {
  return ON.has(rawFlag());
}

// Unrecognised values mean OFF — surface them so a demo operator notices.
function dryRunWarnings() {
  const v = rawFlag();
  return ON.has(v) || OFF.has(v) ? [] : [`TEAMS_BOT_DRY_RUN='${v}' is not recognised — dry run is OFF`];
}

// Without an id the real command only prints its usage line — let it.
function shouldDryRun(cmd, arg1) {
  return isDryRun() && DATA_COMMANDS.has(cmd) && Boolean(arg1);
}

function dryRunReply(cmd, arg1, arg2) {
  const command = [cmd, arg1, arg2].filter(Boolean).join(' ');
  return textActivity(
    `🧪 **Dry run** — would run \`${command}\`. Nothing was changed ` +
    '(TEAMS_BOT_DRY_RUN is on).'
  );
}

module.exports = { isDryRun, shouldDryRun, dryRunReply, dryRunWarnings, DATA_COMMANDS };
