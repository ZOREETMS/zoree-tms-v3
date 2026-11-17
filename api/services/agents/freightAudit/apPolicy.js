// ═══════════════════════════════════════════════════════════════════
// Freight Audit — AP policy (the customer's AP rules the agent follows)
//
//   approvalLimitUsd  any invoice over this goes to a person, even when
//                     every line matches (default $2,500)
//   erpReadOnly       the ERP (NetSuite) is read-only during a pilot, so
//                     the agent never posts payables: it hands AP a
//                     ready-to-post list instead (default on)
//   shadowMode        during a live-system change freeze the agent only
//                     reads and suggests; every action needs a person
//                     (default freeze Nov 20 – Jan 5, every year)
//   manualExceptions  an authorized user may approve a held invoice as a
//                     manual exception, accepting a known discrepancy with a
//                     reason, evidence and an explicit amount confirmation
//                     (default off — the customer must agree to it)
//
// Env overrides (api/.env):
//   FREIGHT_AUDIT_APPROVAL_LIMIT_USD=2500
//   FREIGHT_AUDIT_ERP_READ_ONLY=true|false
//   FREIGHT_AUDIT_FREEZE=11-20..01-05        (MM-DD..MM-DD, may wrap the year)
//   FREIGHT_AUDIT_SHADOW_MODE=auto|on|off    (auto = on inside the freeze)
//   FREIGHT_AUDIT_MANUAL_EXCEPTIONS=on|off   (default off)
//   FREIGHT_AUDIT_OVERRIDE_APPROVERS=a@x.com,b@x.com  (who may; empty = anyone who can edit invoices)
// Pure: no I/O. `now` is injectable for tests.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const DEFAULTS = Object.freeze({ approvalLimitUsd: 2500, erpReadOnly: true, freeze: '11-20..01-05', shadowMode: 'auto', manualExceptions: false });

function parseFreeze(text) {
  const m = /^(\d{2})-(\d{2})\.\.(\d{2})-(\d{2})$/.exec(String(text || '').trim());
  if (!m) return null;
  return { from: Number(m[1]) * 100 + Number(m[2]), to: Number(m[3]) * 100 + Number(m[4]), label: String(text).trim() };
}

/** True when `now` (month-day) falls in the freeze window; the window may wrap New Year. */
function inFreeze(freeze, now) {
  if (!freeze) return false;
  const md = (now.getMonth() + 1) * 100 + now.getDate();
  return freeze.from <= freeze.to ? md >= freeze.from && md <= freeze.to : md >= freeze.from || md <= freeze.to;
}

const flag = (v, dflt) => (v === undefined || v === '' ? dflt : !/^(false|0|off|no)$/i.test(String(v).trim()));

/**
 * @param {{env?:object, now?:Date}} [opts]
 * @returns {{approvalLimitUsd:number, erpReadOnly:boolean, shadowMode:boolean, freeze:string|null, freezeActive:boolean, manualExceptions:boolean, exceptionApprovers:string[]}}
 */
function getApPolicy({ env = process.env, now = new Date() } = {}) {
  const limit = Number(env.FREIGHT_AUDIT_APPROVAL_LIMIT_USD);
  const freeze = parseFreeze(env.FREIGHT_AUDIT_FREEZE || DEFAULTS.freeze);
  const freezeActive = inFreeze(freeze, now);
  const shadowSetting = String(env.FREIGHT_AUDIT_SHADOW_MODE || DEFAULTS.shadowMode).trim().toLowerCase();
  const shadowMode = shadowSetting === 'on' ? true : shadowSetting === 'off' ? false : freezeActive;
  return {
    approvalLimitUsd: Number.isFinite(limit) && limit > 0 ? limit : DEFAULTS.approvalLimitUsd,
    erpReadOnly: flag(env.FREIGHT_AUDIT_ERP_READ_ONLY, DEFAULTS.erpReadOnly),
    shadowMode,
    freeze: freeze ? freeze.label : null,
    freezeActive,
    manualExceptions: flag(env.FREIGHT_AUDIT_MANUAL_EXCEPTIONS, DEFAULTS.manualExceptions),
    exceptionApprovers: String(env.FREIGHT_AUDIT_OVERRIDE_APPROVERS || '').split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean),
  };
}

module.exports = { getApPolicy, parseFreeze, inFreeze, DEFAULTS };
