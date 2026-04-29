// ═══════════════════════════════════════════════════════════════════
// MW Queue Admin Routes
//
// Surfaces the lifecycle of the backend MW queue worker so the TMS
// Settings page can inspect / start / stop / step it. Auth is injected
// by server.js (verifyToken + getUserRole) because those helpers depend
// on Supabase env that only the parent app has loaded — keeps this
// module dependency-free other than the worker service it controls.
//
// All four endpoints require `admin` role. The status endpoint is
// safe to poll (read-only); start/stop/run-once are mutating.
// CLAUDE_RULES §4: routes do auth + dispatch only, business logic
// lives in api/services/mwQueueWorker.js.
// ═══════════════════════════════════════════════════════════════════

const express = require('express');
const worker = require('../services/mwQueueWorker');

/**
 * Build the router. The parent app passes in the auth helpers because
 * they're closures over server.js state (Supabase client, etc.) and
 * can't be simply imported.
 *
 * @param {object} deps
 * @param {(req,res) => Promise<object|null>} deps.verifyToken
 *   Returns the authenticated user or null+ends response.
 * @param {(user) => string} deps.getUserRole
 *   Returns the user's active role string.
 */
function buildMwQueueAdminRouter({ verifyToken, getUserRole }) {
  const router = express.Router();

  async function requireAdmin(req, res) {
    const user = await verifyToken(req, res);
    if (!user) return null;                       // verifyToken already responded 401
    const role = getUserRole(user);
    if (role !== 'admin') {
      res.status(403).json({ error: `Role '${role}' cannot control the MW queue worker. Required: admin.` });
      return null;
    }
    return user;
  }

  // GET /api/mw-queue/status — current worker state. Safe for the UI to
  // poll on a short interval; no side effects.
  router.get('/status', async (req, res) => {
    const user = await requireAdmin(req, res);
    if (!user) return;
    res.json(worker.getStatus());
  });

  // POST /api/mw-queue/start — begin periodic drain. Body may include
  // { intervalMs: <number> }. Idempotent — double-start is a no-op.
  router.post('/start', async (req, res) => {
    const user = await requireAdmin(req, res);
    if (!user) return;
    const intervalMs = Number(req.body && req.body.intervalMs) || undefined;
    res.json(worker.start(intervalMs ? { intervalMs } : {}));
  });

  // POST /api/mw-queue/stop — halt periodic drain. Pending rows stay
  // pending until something starts the worker again (manual or boot).
  router.post('/stop', async (req, res) => {
    const user = await requireAdmin(req, res);
    if (!user) return;
    res.json(worker.stop());
  });

  // POST /api/mw-queue/run-once — drain a single batch on demand. Used
  // by the UI's "Run Once" button so an operator can flush the queue
  // without flipping the auto-loop on.
  router.post('/run-once', async (req, res) => {
    const user = await requireAdmin(req, res);
    if (!user) return;
    try {
      const summary = await worker.runOnce();
      res.json({ summary, status: worker.getStatus() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { buildMwQueueAdminRouter };
