// ═══════════════════════════════════════════════════════════════════
// Messaging Hub Routes — /api/messaging-hub/*
//
// User-facing read API for the Messaging Hub UI. Mirrors the auth /
// tenant pattern used by api/routes/locations.js (req.tenant resolved
// upstream; no INGEST_API_KEY).
//
// Endpoints:
//   GET  /api/messaging-hub/messages           — list, with filters
//   GET  /api/messaging-hub/messages/:id       — single message detail
//   GET  /api/messaging-hub/kpis               — header KPI bar counts
//   POST /api/messaging-hub/messages/:id/retry — replay a failed message
//   POST /api/messaging-hub/compose            — UI compose-and-send
//
// Per CLAUDE_RULES §10 the route file is intentionally thin: every
// path delegates to the services layer (messagingHub/{reader,writer}).
// No business logic lives here.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const router = require('express').Router();
const reader = require('../services/messagingHub/reader');
const writer = require('../services/messagingHub/writer');
const { MESSAGE_TYPE, SYSTEM_PARTY } = require('../services/messagingHub/types');

// ── GET /api/messaging-hub/messages ──────────────────────────────
// Query params:
//   tab=all|outbound|inbound|failed
//   direction=Outbound|Inbound
//   type=<MESSAGE_TYPE>
//   status=Sent|Delivered|Acknowledged|Failed|Pending|Received
//   search=<free-text>
//   limit=<int>  (default 200, max 1000)
//   offset=<int>
router.get('/messages', async (req, res, next) => {
  try {
    const messages = await reader.listMessages({
      tab:       req.query.tab,
      direction: req.query.direction,
      type:      req.query.type,
      status:    req.query.status,
      search:    req.query.search,
      limit:     req.query.limit,
      offset:    req.query.offset,
      tenantId:  req.tenant && req.tenant.tenantId,
    });
    res.json({ messages });
  } catch (err) { next(err); }
});

// ── GET /api/messaging-hub/messages/:id ──────────────────────────
router.get('/messages/:id', async (req, res, next) => {
  try {
    const msg = await reader.getMessage(req.params.id);
    if (!msg) return res.status(404).json({ ok: false, error: 'not_found' });
    res.json({ message: msg });
  } catch (err) { next(err); }
});

// ── GET /api/messaging-hub/kpis ──────────────────────────────────
router.get('/kpis', async (req, res, next) => {
  try {
    const kpis = await reader.computeKpis({
      tenantId: req.tenant && req.tenant.tenantId,
    });
    res.json({ kpis });
  } catch (err) { next(err); }
});

// ── POST /api/messaging-hub/messages/:id/retry ───────────────────
// Replay surface: returns the original payload and increments the
// attempt_count.  The actual re-emit is owned by the adapter that
// originally sent the message — the route doesn't choose a transport.
router.post('/messages/:id/retry', async (req, res, next) => {
  try {
    const original = await reader.getMessage(req.params.id);
    if (!original) return res.status(404).json({ ok: false, error: 'not_found' });
    if (original.source === 'fusion') {
      return res.status(409).json({
        ok: false,
        error: 'fusion_replay_not_supported_here',
        details: 'Use /api/integration/fusion/replay for Fusion ledger rows.',
      });
    }
    if (original.rawId) {
      await writer.incrementAttempt(original.rawId);
    }
    res.json({
      ok:      true,
      message: original,
      hint:    'Retry queued. Adapter will re-emit on next cycle.',
    });
  } catch (err) { next(err); }
});

// ── POST /api/messaging-hub/compose ──────────────────────────────
// UI compose modal target.  Records the outbound message in the hub
// ledger; the actual transport is the responsibility of the adapter
// that owns the message type — the compose route is the persistent
// audit point, not the transport.
//
// Body: { type, ref, dest, priority, notes, payload, correlationId? }
router.post('/compose', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.type || !MESSAGE_TYPE[body.type]) {
      return res.status(400).json({ ok: false, error: 'invalid_message_type' });
    }
    if (!body.payload || typeof body.payload !== 'object') {
      return res.status(400).json({ ok: false, error: 'payload_object_required' });
    }

    // Compose target → SYSTEM_PARTY mapping.  Anything that's not OMS
    // or CARRIER falls back to "OTHER" disabled today; we surface a
    // 400 instead of inventing a system.
    const dest = String(body.dest || '').toUpperCase();
    let targetSystem;
    if (dest === 'CARRIER_PORTAL' || dest === 'CARRIER' || dest === 'BROKER_API') {
      targetSystem = SYSTEM_PARTY.CARRIER;
    } else if (dest === 'OMS' || dest === 'ERP' || dest === 'CUSTOMER_PORTAL') {
      targetSystem = SYSTEM_PARTY.OMS;
    } else {
      return res.status(400).json({
        ok: false,
        error: 'unsupported_destination',
        details: `compose destination "${body.dest}" maps to no SYSTEM_PARTY`,
      });
    }

    const result = await writer.recordOutbound({
      messageType:   body.type,
      source:        SYSTEM_PARTY.TMS,
      target:        targetSystem,
      payload:       body.payload,
      headers:       body.headers || null,
      correlationId: body.correlationId || null,
      shipmentId:    body.ref || null,
      actor:         (req.user && req.user.email) || 'tms-ui',
      tenantId:      req.tenant && req.tenant.tenantId,
    });

    res.status(202).json({ ok: true, id: result.id, persisted: result.persisted !== false });
  } catch (err) { next(err); }
});

module.exports = router;
