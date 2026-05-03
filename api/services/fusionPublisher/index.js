// ═══════════════════════════════════════════════════════════════════
// Fusion Publisher — F3 (TMS → Fusion via OIC).
//
// Subscribes to the in-process eventBus (SHIPMENT_UPDATED, ORDER_UPDATED)
// and posts shipment status / PoD events to OIC's inbound REST endpoint.
// OIC unpacks, transforms, and calls Fusion — TMS never holds Fusion creds.
//
// Why in-process and not a worker process?
//   The event volume is bounded by shipment writes (REQ-23 ship-confirm,
//   REQ-20 timeline events, manual edits). The same node process already
//   runs mwQueueWorker for OMS sync; adding another in-process consumer
//   keeps the operational surface small.
//
// Gating:
//   - OIC_PUBLISH_ENABLED must be 'true' to enable any outbound traffic.
//   - OIC_PUBLISH_INVOICES_ENABLED='true' is required separately for F3c
//     (freight invoices).
//
// Auth:
//   OAuth 2.0 client-credentials. Token cached in-memory; refresh on 401.
//
// Failure handling:
//   Retry via createRetryQueue (1s → 5min cap, 8 retries). On terminal
//   failure, the row is persisted to integration_event_log with
//   direction='outbound', status='failed_5xx' for replay via
//   POST /api/integration/fusion/replay.
// ═══════════════════════════════════════════════════════════════════

const db        = require('../supabase');
const { bus, EVENTS } = require('../eventBus');
const transformer = require('./transformer');
const { createRetryQueue } = require('./retryQueue');

const PUBLISH_ENABLED = String(process.env.OIC_PUBLISH_ENABLED || '').toLowerCase() === 'true';

const OIC_BASE_URL   = process.env.OIC_BASE_URL   || '';
const OIC_TOKEN_URL  = process.env.OIC_TOKEN_URL  || '';
const OIC_CLIENT_ID  = process.env.OIC_CLIENT_ID  || '';
const OIC_CLIENT_SEC = process.env.OIC_CLIENT_SECRET || '';
const SHIPMENT_FLOW_PATH = '/ic/api/integration/v1/flows/rest/ZOREE_TMS_SHIPMENT_STATUS/1.0/events';

let cachedToken = null;
let cachedTokenExpiresAt = 0;

async function getOicToken() {
  const now = Date.now();
  if (cachedToken && cachedTokenExpiresAt > now + 30_000) return cachedToken;
  if (!OIC_TOKEN_URL || !OIC_CLIENT_ID || !OIC_CLIENT_SEC) {
    throw new Error('OIC publisher: missing OIC_TOKEN_URL / OIC_CLIENT_ID / OIC_CLIENT_SECRET');
  }
  const res = await fetch(OIC_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${OIC_CLIENT_ID}:${OIC_CLIENT_SEC}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OIC token endpoint returned ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  cachedToken = json.access_token;
  // Default 55min cache if expires_in missing.
  cachedTokenExpiresAt = Date.now() + ((json.expires_in || 3300) * 1000);
  return cachedToken;
}

async function postToOic(path, payload) {
  if (!OIC_BASE_URL) throw new Error('OIC publisher: missing OIC_BASE_URL');
  const token = await getOicToken();
  const url = OIC_BASE_URL.replace(/\/+$/, '') + path;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(payload),
  });
  // 401 → invalidate cached token so next attempt re-fetches.
  if (res.status === 401) { cachedToken = null; cachedTokenExpiresAt = 0; }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`OIC ${path} returned ${res.status}: ${text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json().catch(() => ({}));
}

async function persistOutboundFailure(item, err) {
  try {
    const client = db.getClient();
    await client.from('integration_event_log').insert({
      source:          'fusion',
      object_type:     item.objectType || 'shipment_status',
      direction:       'outbound',
      external_id:     item.externalId || null,
      internal_id:     item.tmsShipmentId || null,
      status:          err && err.status && err.status >= 400 && err.status < 500 ? 'failed_4xx' : 'failed_5xx',
      error:           (err && err.message) ? err.message.slice(0, 2000) : 'unknown',
      payload:         item.payload,
    });
  } catch (logErr) {
    console.error('[fusionPublisher] failed to persist outbound failure:', logErr.message);
  }
}

const queue = createRetryQueue({
  maxConcurrency:  Number(process.env.OIC_PUBLISH_CONCURRENCY) || 4,
  maxRetries:      Number(process.env.OIC_PUBLISH_MAX_RETRIES) || 8,
  baseDelayMs:     1000,
  maxDelayMs:      5 * 60 * 1000,
  onTerminalFailure: persistOutboundFailure,
});

// ── Hydrate the shipment + linked orders context the publisher needs.
// We accept a minimal shipment-updated event from the bus and join in
// the fields the OIC payload needs (linked Fusion ids, addresses, etc).
async function hydrateShipmentContext(shipmentId) {
  const shipRows = await db.dbSelect('shipments', {
    filters: [['id', 'eq', shipmentId]],
    limit: 1,
    select: 'id,status,carrier,order_ids,bol_number,pro_number,seal_number,pickup_date,delivery_date,weight,fusion_shipment_id',
  });
  const shipment = Array.isArray(shipRows) && shipRows.length ? shipRows[0] : null;
  if (!shipment) return null;

  const orderIds = Array.isArray(shipment.order_ids) ? shipment.order_ids.map(String).filter(Boolean) : [];
  if (!orderIds.length) return { shipment, linkedOrders: [] };

  const orders = await db.dbSelect('orders', {
    filters: [['id', 'in', orderIds]],
    select: 'id,status,fusion_so_header_id,fusion_shipment_request_id,fusion_business_unit_id',
  });
  // Take BU id from the first linked order — they share within a shipment.
  shipment.fusion_business_unit_id = (orders || [])
    .map((o) => o.fusion_business_unit_id)
    .find(Boolean) || null;
  // Skip the publish entirely if no linked order has a Fusion id (i.e. the
  // shipment is OMS-sourced — F3 doesn't apply).
  const fusionLinked = (orders || []).filter((o) => o.fusion_so_header_id);
  if (!fusionLinked.length) return null;

  return { shipment, linkedOrders: fusionLinked };
}

// ── Publish a shipment status event.
async function publishShipmentStatus({ shipmentId, eventSeq, via }) {
  if (!PUBLISH_ENABLED) return; // gated off
  const ctx = await hydrateShipmentContext(shipmentId);
  if (!ctx) return; // no Fusion-linked orders on this shipment

  const payload = transformer.buildShipmentStatusPayload({
    shipment: ctx.shipment,
    linkedOrders: ctx.linkedOrders,
    eventSeq,
    via,
  });

  queue.enqueue({
    id:            `ship-status:${shipmentId}:${eventSeq}`,
    objectType:    'shipment_status',
    externalId:    ctx.shipment.fusion_shipment_id || null,
    tmsShipmentId: shipmentId,
    payload,
    work: async () => { await postToOic(SHIPMENT_FLOW_PATH, payload); },
  });
}

// ── Bus subscription glue. Debounces per-shipment so a multi-order
// shipment fires one publish, not N.
const debounceTimers = new Map();
const DEBOUNCE_MS = 50;
let monoSeq = 0;

function attachListeners() {
  bus.on(EVENTS.SHIPMENT_UPDATED, (evt) => {
    const id = evt && evt.id;
    if (!id) return;
    if (debounceTimers.has(id)) clearTimeout(debounceTimers.get(id));
    const t = setTimeout(() => {
      debounceTimers.delete(id);
      monoSeq += 1;
      publishShipmentStatus({ shipmentId: id, eventSeq: monoSeq, via: evt.via || null })
        .catch((err) => console.error('[fusionPublisher] publish failed for', id, err.message));
    }, DEBOUNCE_MS);
    debounceTimers.set(id, t);
  });

  // ORDER_UPDATED → only relevant when status flipped through a shipment;
  // the SHIPMENT_UPDATED listener above already covers that. We don't
  // double-publish here. Hook left for future fan-out (e.g. when an order
  // is reassigned to a new shipment).
}

function start() {
  if (!PUBLISH_ENABLED) {
    console.log('[fusionPublisher] disabled (set OIC_PUBLISH_ENABLED=true to enable)');
    return;
  }
  attachListeners();
  console.log('[fusionPublisher] enabled — subscribed to SHIPMENT_UPDATED');
}

module.exports = {
  start,
  publishShipmentStatus,    // exposed for the replay route
  hydrateShipmentContext,   // exposed for unit tests
  _internal: { getOicToken, postToOic },
};
