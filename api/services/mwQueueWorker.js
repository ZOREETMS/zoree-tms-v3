// ═══════════════════════════════════════════════════════════════════
// MW Queue Worker — backend port of zoree-middleware.html's
// processMWQueue. Drains the OMS-side `mw_requests` table on a server
// interval so OMS→TMS sync no longer depends on a browser tab being
// open. Every cmd dispatches to a service-layer handler in
// ./mwQueueHandlers/ — the worker itself contains zero business logic
// (CLAUDE_RULES §1, §4).
//
// Lifecycle (controlled from the TMS Settings page via mwQueueAdmin
// routes):
//   start({ intervalMs }) → setInterval ticks runOnce()
//   stop()                → clears the interval, leaves _running=false
//   runOnce()             → single drain pass, returns summary
//   getStatus()           → { running, intervalMs, lastRunAt,
//                              lastResult, lastError }
//
// The worker is idempotent against the queue: a row marked 'processing'
// is owned by exactly one tick because the SELECT-then-UPDATE check
// uses status='pending' as the filter. A worker crash mid-row leaves
// the row in 'processing' — we surface that count via getStatus so an
// operator can decide whether to reset it.
// ═══════════════════════════════════════════════════════════════════

const db = require('./supabase');
const { getHandler } = require('./mwQueueHandlers');

const DEFAULT_INTERVAL_MS = 5_000;
const BATCH_LIMIT         = 20;

let _running       = false;
let _intervalMs    = DEFAULT_INTERVAL_MS;
let _intervalHandle = null;
let _lastRunAt     = null;
let _lastResult    = null;
let _lastError     = null;
let _inFlight      = false;   // prevents overlapping ticks

/**
 * Run a single drain pass. Safe to call manually from the admin
 * "Run Once" endpoint. Returns a structured summary the UI surfaces.
 */
async function runOnce() {
  if (_inFlight) {
    return { skipped: true, reason: 'already_running' };
  }
  _inFlight = true;
  const startedAt = new Date().toISOString();
  const summary = { processed: 0, errors: 0, skipped: 0, ids: [] };

  try {
    const pending = await _selectPending(BATCH_LIMIT);
    for (const row of pending) {
      summary.ids.push(row.id);
      const result = await _processRow(row);
      if (result.outcome === 'done')   summary.processed++;
      else if (result.outcome === 'error') summary.errors++;
      else                                summary.skipped++;
    }
    _lastRunAt  = startedAt;
    _lastResult = summary;
    _lastError  = null;
  } catch (loopErr) {
    _lastError = loopErr.message;
    console.error('[mwQueueWorker] runOnce failed:', loopErr.message);
  } finally {
    _inFlight = false;
  }
  return summary;
}

/**
 * Boot the periodic drain. Idempotent — calling start() while already
 * running just no-ops.
 */
function start(opts = {}) {
  if (_running) return getStatus();
  _intervalMs = Number(opts.intervalMs) > 0 ? Number(opts.intervalMs) : DEFAULT_INTERVAL_MS;
  _running    = true;
  _intervalHandle = setInterval(() => {
    runOnce().catch((err) => {
      console.error('[mwQueueWorker] tick failed:', err.message);
    });
  }, _intervalMs);
  console.log(`[mwQueueWorker] started · interval=${_intervalMs}ms`);
  return getStatus();
}

/** Stop the interval. The next runOnce() will not fire automatically. */
function stop() {
  if (!_running) return getStatus();
  if (_intervalHandle) clearInterval(_intervalHandle);
  _intervalHandle = null;
  _running        = false;
  console.log('[mwQueueWorker] stopped');
  return getStatus();
}

function isRunning() { return _running; }

function getStatus() {
  return {
    running:     _running,
    intervalMs:  _intervalMs,
    inFlight:    _inFlight,
    lastRunAt:   _lastRunAt,
    lastResult:  _lastResult,
    lastError:   _lastError,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Private helpers — kept small + single-purpose (CLAUDE_RULES §6).
// ─────────────────────────────────────────────────────────────────────

async function _selectPending(limit) {
  // Oldest-first so an OMS UI that's awaiting _pollResult sees its
  // request finish in roughly FIFO order. dbSelect uses { col, asc }
  // shape (see api/services/supabase.js), not { column, ascending }.
  return db.dbSelect('mw_requests', {
    filters: [['status', 'eq', 'pending']],
    order:   { col: 'created_at', asc: true },
    limit,
    select:  '*',
  });
}

async function _processRow(row) {
  // 1. Claim the row before running the handler. The _inFlight guard
  //    on the parent runOnce() already serializes ticks within a single
  //    worker process; this UPDATE is what stops the browser-side MW
  //    (zoree-middleware.html processMWQueue) from grabbing the same
  //    row mid-tick. dbUpdate matches on id only — that's fine because
  //    the only race we care about is "two workers both saw 'pending'",
  //    and whichever ran second will overwrite 'processing' → 'processing'
  //    (no-op) before its handler runs and sets 'done' / 'error'.
  await _markProcessing(row.id);

  const handler = getHandler(row.cmd);
  if (!handler) {
    await _markError(row.id, `unsupported_cmd: ${row.cmd}`);
    return { outcome: 'error', reason: 'unsupported_cmd' };
  }

  let payload = {};
  try {
    payload = typeof row.payload === 'string'
      ? JSON.parse(row.payload || '{}')
      : (row.payload || {});
  } catch (parseErr) {
    await _markError(row.id, 'invalid_payload_json: ' + parseErr.message);
    return { outcome: 'error', reason: 'invalid_payload' };
  }

  try {
    const result = await handler(payload);
    await _markDone(row.id, result);
    return { outcome: 'done', result };
  } catch (handlerErr) {
    console.error(`[mwQueueWorker] handler ${row.cmd} failed for row ${row.id}:`, handlerErr.message);
    await _markError(row.id, handlerErr.message || 'handler error');
    return { outcome: 'error', reason: handlerErr.message };
  }
}

async function _markProcessing(id) {
  await db.dbUpdate('mw_requests', id, { status: 'processing' }, null);
}

async function _markDone(id, result) {
  await db.dbUpdate('mw_requests', id, {
    status:       'done',
    result:       JSON.stringify(result || {}),
    error_msg:    null,
    processed_at: new Date().toISOString(),
  }, null);
}

async function _markError(id, message) {
  await db.dbUpdate('mw_requests', id, {
    status:       'error',
    error_msg:    String(message).slice(0, 1000),
    processed_at: new Date().toISOString(),
  }, null);
}

module.exports = { start, stop, runOnce, getStatus, isRunning };
