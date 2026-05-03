// ═══════════════════════════════════════════════════════════════════
// Fusion Ingest Routes — F1, F2, F4 inbound HTTP entry points.
//
// All endpoints share:
//   - requireIngestKey middleware (shared with /api/ingest/oms-*)
//   - asyncRoute() wrapper for uniform error handling
//
// Each handler is a one-liner that calls into the matching service.
// Business logic lives in api/services/fusionIngest/* per
// CLAUDE_RULES §1 (services-first) and §6 (no large inline blocks).
// ═══════════════════════════════════════════════════════════════════

const router = require('express').Router();
const fusion = require('../services/fusionIngest');
const requireIngestKey = require('../middleware/requireIngestKey');
const asyncRoute = require('../middleware/asyncRoute');

router.use(requireIngestKey);

// Helper: every route accepts a JSON body and returns 202 with the
// service's result wrapped in { ok: true, ... }.
function send202(res, payload) { res.status(202).json({ ok: true, ...payload }); }

// ── F1 — sales orders / shipment requests ─────────────────────────
router.post('/sales-orders', asyncRoute(async (req, res) => {
  send202(res, await fusion.orders.ingestSalesOrder(req.body || {}));
}));

router.post('/shipment-requests', asyncRoute(async (req, res) => {
  send202(res, await fusion.orders.ingestSalesOrder(req.body || {}));
}));

// ── F2 — inventory ────────────────────────────────────────────────
router.post('/inventory/transactions', asyncRoute(async (req, res) => {
  send202(res, await fusion.inventory.ingestTransactions(req.body || {}));
}));

router.post('/inventory/on-hand', asyncRoute(async (req, res) => {
  send202(res, await fusion.inventory.ingestOnHand(req.body || {}));
}));

// ── F4 — master data ──────────────────────────────────────────────
router.post('/items', asyncRoute(async (req, res) => {
  send202(res, await fusion.masterData.ingestItems(req.body || {}));
}));

router.post('/locations', asyncRoute(async (req, res) => {
  send202(res, await fusion.masterData.ingestLocations(req.body || {}));
}));

router.post('/carriers', asyncRoute(async (req, res) => {
  send202(res, await fusion.masterData.ingestCarriers(req.body || {}));
}));

module.exports = router;
