// ═══════════════════════════════════════════════════════════════════
// MW Queue Handler — Registry
//
// Single source of truth mapping `mw_requests.cmd` → handler function.
// Adding a new cmd is a one-line registry addition; the worker stays
// untouched. Cmds without a registry entry are returned as
// 'unsupported_cmd' so the worker can mark them error and move on
// without poisoning the cycle (CLAUDE_RULES §6: no deeply nested code).
// ═══════════════════════════════════════════════════════════════════

const { handlePushOrder } = require('./pushOrderHandler');
const { handlePushShip }  = require('./pushShipHandler');
const { handlePushPod }   = require('./pushPodHandler');

const HANDLERS = Object.freeze({
  PUSH_ORDER_TO_TMS: handlePushOrder,
  PUSH_SHIP_STATUS:  handlePushShip,
  PUSH_POD_STATUS:   handlePushPod,
});

/**
 * Look up the handler for a cmd. Returns null when the cmd has no
 * registered handler — the worker treats null as "unsupported" and
 * marks the row error rather than throwing, so legacy cmds the
 * browser MW used to handle (PULL_TMS_*, PUSH_ITEM_*, PUSH_LOCATION_*)
 * don't break the loop.
 */
function getHandler(cmd) {
  return HANDLERS[String(cmd || '').toUpperCase()] || null;
}

module.exports = { HANDLERS, getHandler };
