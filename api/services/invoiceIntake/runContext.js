// ═══════════════════════════════════════════════════════════════════
// Which invoice-agent run the current work belongs to (migration 056).
//
// A run (a scheduled mailbox check, a "Read AP Mailbox" click, an inbox
// folder read) sets a scope; everything it calls — down to intakePdf —
// can ask for the run id without the id being passed through every layer.
// Same pattern as domains/domainContext.js.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

const als = new AsyncLocalStorage();

/** Run fn with `scope` as the current run scope (see intakeRuns.track). */
function withScope(scope, fn) {
  return als.run(scope, fn);
}

/** The current run scope, or null outside a run. */
function currentScope() {
  return als.getStore() || null;
}

/**
 * Run id for `domain`'s share of the current run; null outside a run.
 * Never throws: logging a run must never stop an invoice being read.
 */
async function currentRunId(domain) {
  const scope = currentScope();
  if (!scope) return null;
  try {
    return await scope.idFor(domain);
  } catch (e) {
    console.warn('[intakeRuns] run not recorded:', e.message);
    return null;
  }
}

/** Count emails read by the current run (no-op outside a run). */
function noteEmailsRead(n) {
  const scope = currentScope();
  if (scope) scope.emailsRead = (scope.emailsRead || 0) + (Number(n) || 0);
}

module.exports = { withScope, currentScope, currentRunId, noteEmailsRead };
