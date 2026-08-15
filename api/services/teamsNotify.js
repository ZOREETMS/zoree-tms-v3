// ═══════════════════════════════════════════════════════════════════
// Microsoft Teams outbound notifications (webhook publisher).
//
// Posts Adaptive Cards to a Teams channel via an incoming webhook
// (Teams "Workflows" → "Post to a channel when a webhook request is
// received", or a legacy O365 incoming-webhook connector — both accept
// the same {type:"message", attachments:[…]} envelope).
//
// No-op unless TEAMS_WEBHOOK_URL is set (mirrors fusionPublisher's
// env-gating idiom). All sends are fire-and-forget: a Teams outage
// must never break a tender.
//
// Called from server.js at three seams (see docs/TEAMS_SETUP.md):
//   • POST /api/tender/email        → notifyTenderSent
//   • POST /api/notify              → notifyTenderAccepted (web+mobile funnel)
//   • PATCH /api/shipments/:id/status → notifyTenderAccepted / notifyTenderRejected
// plus an optional eventBus subscription for ORDER_CREATED
// (TEAMS_NOTIFY_ORDERS=true — default off, bulk ingests are noisy).
//
// Dedupe: accept fires from BOTH the status PATCH and the client's
// POST /api/notify broadcast; a (shipmentId|kind) TTL map collapses
// the pair into one card.
//
// Env:
//   TEAMS_WEBHOOK_URL      — the Teams workflow/connector URL (required)
//   TEAMS_NOTIFY_ENABLED   — set 'false' to hard-disable (default on when URL set)
//   TEAMS_NOTIFY_ORDERS    — 'true' to also post new-order cards (default off)
//   ZOREE_WEB_URL          — base URL for "Open in Zoree" deep links
// ═══════════════════════════════════════════════════════════════════

'use strict';

const WEBHOOK_URL = process.env.TEAMS_WEBHOOK_URL || '';
const ENABLED =
  !!WEBHOOK_URL &&
  String(process.env.TEAMS_NOTIFY_ENABLED || 'true').toLowerCase() !== 'false';
const NOTIFY_ORDERS =
  String(process.env.TEAMS_NOTIFY_ORDERS || '').toLowerCase() === 'true';
const { webLink } = require('./teamsConfig');

// ── Diagnostics (surfaced on /health → teams) ──────────────────────
const state = { lastOkAt: null, lastError: null, lastErrorAt: null, sent: 0 };

function getTeamsNotifyHealth() {
  return {
    configured: !!WEBHOOK_URL,
    enabled: ENABLED,
    ordersFeed: NOTIFY_ORDERS,
    sent: state.sent,
    lastOkAt: state.lastOkAt,
    lastError: state.lastError,
    lastErrorAt: state.lastErrorAt,
  };
}

// ── Dedupe (accept path fires from two seams) ──────────────────────
const DEDUPE_TTL_MS = 30 * 1000;
const recentKeys = new Map(); // key → ts

function isDuplicate(key) {
  const now = Date.now();
  // opportunistic sweep so the map can't grow unbounded
  for (const [k, ts] of recentKeys) {
    if (now - ts > DEDUPE_TTL_MS) recentKeys.delete(k);
  }
  if (recentKeys.has(key)) return true;
  recentKeys.set(key, now);
  return false;
}

// ── Card builders ──────────────────────────────────────────────────
function factSet(facts) {
  return {
    type: 'FactSet',
    facts: facts
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([title, value]) => ({ title, value: String(value) })),
  };
}

function buildCard({ title, color, facts, shipmentId }) {
  return {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body: [
      {
        type: 'TextBlock',
        text: title,
        weight: 'Bolder',
        size: 'Medium',
        color: color || 'Default',
        wrap: true,
      },
      factSet(facts),
    ],
    actions: [
      {
        type: 'Action.OpenUrl',
        title: 'Open in Zoree TMS',
        url: shipmentId ? webLink('shipments', shipmentId) : webLink(),
      },
    ],
  };
}

// ── Transport ──────────────────────────────────────────────────────
async function postCard(card) {
  if (!ENABLED) return { skipped: true };
  const envelope = {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: card,
      },
    ],
  };
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Teams webhook HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    state.sent += 1;
    state.lastOkAt = new Date().toISOString();
    return { ok: true };
  } catch (err) {
    // Crash-prevention handlers in server.js swallow rejections silently,
    // so log loudly here — this is the only trace a failed send leaves.
    state.lastError = err.message || String(err);
    state.lastErrorAt = new Date().toISOString();
    console.error('[teamsNotify] send failed:', state.lastError);
    return { ok: false, error: state.lastError };
  }
}

// ── Public notify functions (all fire-and-forget safe) ─────────────
function notifyTenderSent({ shipmentId, carrier, to, origin, dest, refNum }) {
  if (!ENABLED) return;
  if (isDuplicate(`${shipmentId}|sent`)) return;
  postCard(buildCard({
    title: `📤 Tender sent — ${shipmentId || 'shipment'}`,
    color: 'Accent',
    shipmentId,
    facts: [
      ['Shipment', shipmentId],
      ['Carrier', carrier],
      ['Tender email', to],
      ['Lane', origin && dest ? `${origin} → ${dest}` : null],
      ['Ref #', refNum],
    ],
  }));
}

function notifyTenderAccepted({ shipmentId, carrier, mode, pickupDate, deliveryDate }) {
  if (!ENABLED) return;
  if (isDuplicate(`${shipmentId}|accepted`)) return;
  postCard(buildCard({
    title: `✅ Tender ACCEPTED — ${shipmentId || 'shipment'}`,
    color: 'Good',
    shipmentId,
    facts: [
      ['Shipment', shipmentId],
      ['Carrier', carrier],
      ['Mode', mode],
      ['Pickup', pickupDate],
      ['Delivery', deliveryDate],
    ],
  }));
}

function notifyTenderRejected({ shipmentId, carrier }) {
  if (!ENABLED) return;
  if (isDuplicate(`${shipmentId}|rejected`)) return;
  postCard(buildCard({
    title: `❌ Tender REJECTED — ${shipmentId || 'shipment'}`,
    color: 'Attention',
    shipmentId,
    facts: [
      ['Shipment', shipmentId],
      ['Carrier', carrier],
      ['Next step', 'Re-plan with another carrier'],
    ],
  }));
}

function notifyOrderCreated(order) {
  if (!ENABLED || !NOTIFY_ORDERS) return;
  const id = order && order.id;
  if (!id || isDuplicate(`${id}|order_created`)) return;
  postCard(buildCard({
    title: `🆕 New order ready to plan — ${id}`,
    color: 'Accent',
    facts: [
      ['Order', id],
      ['Customer', order.customer],
      ['Lane', order.origin && order.dest ? `${order.origin} → ${order.dest}` : null],
    ],
  }));
}

// ── start() — subscribe to the in-process bus (server.js listen cb) ─
function start({ bus, EVENTS } = {}) {
  if (!ENABLED) {
    console.log('   💬 Teams notify: NOT configured (set TEAMS_WEBHOOK_URL in api/.env)');
    return;
  }
  if (NOTIFY_ORDERS && bus && EVENTS) {
    bus.on(EVENTS.ORDER_CREATED, (payload) => {
      try { notifyOrderCreated(payload || {}); }
      catch (err) { console.error('[teamsNotify] order-created hook failed:', err.message); }
    });
  }
  console.log(`   💬 Teams notify: ACTIVE (orders feed ${NOTIFY_ORDERS ? 'on' : 'off'})`);
}

module.exports = {
  start,
  notifyTenderSent,
  notifyTenderAccepted,
  notifyTenderRejected,
  notifyOrderCreated,
  getTeamsNotifyHealth,
  // exported for tests
  _postCard: postCard,
  _isDuplicate: isDuplicate,
};
