// ═══════════════════════════════════════════════════════════════════
// Tendering Routes — /api/tendering/*  +  /api/ingest/carrier-tender-response
//
// Hosts the two carrier-edge hops the Messaging Hub plan §6 calls for:
//
//   POST /api/tendering/out
//        User-facing (auth via upstream verifyToken / req.user).
//        Records an outbound TMS→Carrier tender in the hub ledger.
//        The actual transport (EDI 204 gateway, REST client, etc.) is
//        owned by the adapter layer; this route exists today so the
//        UI's "Tender to Carrier" action has a stable backend hook.
//
//   POST /api/ingest/carrier-tender-response
//        Server-to-server (auth via INGEST_API_KEY, mirrors
//        api/routes/ingest.js — the carrier integration partner is
//        not a user).  Records an inbound Carrier→TMS response.
//
// Per CLAUDE_RULES §10 these routes are thin: they delegate to
// services/tendering/{tenderOut,tenderIn}.js.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const router = require('express').Router();
const tenderOut = require('../services/tendering/tenderOut');
const tenderIn  = require('../services/tendering/tenderIn');

// Same shape as api/routes/ingest.js requireIngestKey — kept inline
// to avoid a cross-file middleware import for one consumer.
function requireIngestKey(req, res, next) {
  const required = process.env.INGEST_API_KEY;
  if (!required) return next(); // dev/test: auth disabled
  const got = req.headers['x-api-key'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (got && got === required) return next();
  return res.status(401).json({ ok: false, error: 'invalid or missing X-API-Key' });
}

// ── POST /api/tendering/out ──────────────────────────────────────
router.post('/out', async (req, res, next) => {
  try {
    const result = await tenderOut.tenderShipment(req.body || {}, req.user || null);
    res.status(202).json({ ok: true, ...result });
  } catch (err) { next(err); }
});

// ── POST /api/ingest/carrier-tender-response ─────────────────────
// Mounted at the /api/ingest base too — see server.js wiring.
function carrierTenderResponseHandler(req, res, next) {
  // Wrapped in async so next() reaches the global error handler.
  (async () => {
    try {
      const result = await tenderIn.recordTenderResponse(req.body || {}, {
        email: 'carrier-ingest',
        tenantId: req.tenant && req.tenant.tenantId,
      });
      res.status(202).json({ ok: true, ...result });
    } catch (err) { next(err); }
  })();
}

router.post('/response', requireIngestKey, carrierTenderResponseHandler);

module.exports = router;
module.exports.carrierTenderResponseHandler = carrierTenderResponseHandler;
module.exports.requireIngestKey = requireIngestKey;
