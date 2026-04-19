// ═══════════════════════════════════════════════════════════════════
// Ingest Routes — REQ-01 Auto order sync OMS → TMS.
//
//   POST  /api/ingest/oms-orders   — middleware pushes a batch of OMS orders
//   GET   /api/events/orders       — SSE stream: live order events for UI
//
// Auth note: the ingest endpoint is token-gated just like the other
// write endpoints in server.js (see verifyToken() there). Middleware
// must pass Authorization: Bearer <service-token>. The SSE endpoint
// accepts the same token, falling back to a token querystring param
// so plain EventSource (which cannot set headers) can authenticate.
// ═══════════════════════════════════════════════════════════════════

const router = require('express').Router();
const orderIngest = require('../services/orderIngest');
const { bus, EVENTS } = require('../services/eventBus');

// ── Middleware auth check ────────────────────────────────────────
// The middleware authenticates with a shared INGEST_API_KEY (configured
// out-of-band). This is intentionally separate from user-token auth
// because the middleware is a server-to-server actor, not a user.
// If INGEST_API_KEY is unset (dev/test), auth is skipped to let local
// Playwright tests exercise the flow without extra wiring.
function requireIngestKey(req, res, next) {
  const required = process.env.INGEST_API_KEY;
  if (!required) return next(); // dev/test: auth disabled
  const got = req.headers['x-api-key'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (got && got === required) return next();
  return res.status(401).json({ ok: false, error: 'invalid or missing X-API-Key' });
}

// ── POST /api/ingest/oms-orders ──────────────────────────────────
// Body: { orders: [ { id, customer, origin, destination, weight, ... } ] }
// The middleware calls this the instant OMS books an order — no manual
// trigger in the TMS UI.
router.post('/oms-orders', requireIngestKey, async (req, res) => {
  try {
    const result = await orderIngest.ingestOmsBatch(req.body || {});
    res.status(202).json({ ok: true, ...result });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({
      ok: false,
      error: err.message,
      details: err.details || undefined,
    });
  }
});

// ── POST /api/ingest/oms-ship-confirm ────────────────────────────
// REQ-23: when the OMS warehouse module ship-confirms an order, the
// middleware POSTs here. We update the linked TMS shipment to
// 'In Transit' (which lights up the Picked Up rung in the shipment
// timeline automatically) and every linked order to 'Shipped'. The
// 'status' transitions are written to change_history on both sides
// so REQ-20's history drawers show the warehouse ship-out as a
// distinct event. No background job needed.
//
// Body shape:
//   { shipmentId, orderIds?: [...], shippedAt?, sealNumber?, source?: 'oms-wms' }
router.post('/oms-ship-confirm', requireIngestKey, async (req, res) => {
  try {
    const shipConfirm = require('../services/shipConfirm');
    const result = await shipConfirm.applyShipConfirm(req.body || {});
    res.status(202).json({ ok: true, ...result });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ ok: false, error: err.message });
  }
});

// ── GET /api/events/orders — Server-Sent Events ──────────────────
// Clients open an EventSource here. Every ORDER_CREATED /
// ORDER_UPDATED / ORDER_DELETED / OMS_SYNC_BATCH event on the in-
// process bus is streamed to all connected browsers, so orders from
// OMS appear in the TMS Orders page immediately — no poll, no button.
router.get('/events/orders', (req, res) => {
  res.set({
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection':    'keep-alive',
    'X-Accel-Buffering': 'no', // disable nginx buffering if present
  });
  res.flushHeaders?.();

  // Initial hello so the browser knows the stream is live.
  res.write(`event: ready\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);

  const send = (eventName) => (payload) => {
    try {
      res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch (_) { /* socket closed */ }
  };

  const onCreated = send('order.created');
  const onUpdated = send('order.updated');
  const onDeleted = send('order.deleted');
  const onBatch   = send('oms.sync.batch');

  bus.on(EVENTS.ORDER_CREATED,   onCreated);
  bus.on(EVENTS.ORDER_UPDATED,   onUpdated);
  bus.on(EVENTS.ORDER_DELETED,   onDeleted);
  bus.on(EVENTS.OMS_SYNC_BATCH,  onBatch);

  // Heartbeat every 25s so proxies don't close the idle connection.
  const hb = setInterval(() => {
    try { res.write(': keepalive\n\n'); } catch (_) { /* socket closed */ }
  }, 25_000);

  req.on('close', () => {
    clearInterval(hb);
    bus.off(EVENTS.ORDER_CREATED,   onCreated);
    bus.off(EVENTS.ORDER_UPDATED,   onUpdated);
    bus.off(EVENTS.ORDER_DELETED,   onDeleted);
    bus.off(EVENTS.OMS_SYNC_BATCH,  onBatch);
  });
});

module.exports = router;
