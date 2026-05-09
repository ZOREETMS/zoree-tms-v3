// ═══════════════════════════════════════════════════════════════════
// Messaging Hub — reader.
//
// Read-side queries that back the Hub UI.  No writes happen here; that
// keeps the single-writer guarantee (CLAUDE_RULES §10 — no skipping
// services layer).  The reader UNIONs message_log (Messaging Hub
// ledger, this feature) with integration_event_log (Fusion ledger,
// pre-existing) so the Hub UI shows one stream — both ledgers have
// identical inbound/outbound semantics so the UI doesn't need to know
// which physical table a row came from.
//
// API:
//   listMessages   ({ tab, direction, type, status, search, limit, offset, tenantId })
//   getMessage     (id)
//   computeKpis    ({ tenantId })
//   replay         (id)   — returns the row so an adapter can re-emit
//
// Output shape mirrors the existing UI contract from
// frontend/src/services/messagingService.js generateMessages():
//   { id, direction, type, status, ts, ref, dest, source, payload, ... }
// so the components do not change.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const db = require('../supabase');
const { STATUS } = require('./types');

const HUB_TABLE     = 'message_log';
const FUSION_TABLE  = 'integration_event_log';
const DEFAULT_LIMIT = 200;
const MAX_LIMIT     = 1000;

// ── shape mappers ────────────────────────────────────────────────
// One adapter per source table so the UI shape stays stable even
// when the underlying schemas diverge.

function _capDirection(d) {
  return d === 'outbound' ? 'Outbound' : 'Inbound';
}

function _capStatus(code) {
  // Lifecycle -> UI label.  Keep in sync with
  // frontend/src/types/messaging.js MESSAGE_STATUS_COLORS.
  const map = {
    [STATUS.SENT]:         'Sent',
    [STATUS.DELIVERED]:    'Delivered',
    [STATUS.ACKNOWLEDGED]: 'Acknowledged',
    [STATUS.FAILED]:       'Failed',
    [STATUS.PENDING]:      'Pending',
    [STATUS.RECEIVED]:     'Received',
    [STATUS.PROCESSED]:    'Acknowledged', // closest UI label
    [STATUS.REPLAYED]:     'Acknowledged',
  };
  return map[code] || code;
}

function _hubRowToUi(r) {
  return {
    id:           `MSG-${String(r.id).padStart(6, '0')}`,
    rawId:        r.id,
    source:       'hub',
    direction:    _capDirection(r.direction),
    type:         r.message_type,
    status:       _capStatus(r.status),
    ts:           r.received_at,
    ref:          r.shipment_id || r.order_id || r.external_ref || '',
    dest:         r.target_system,
    sourceSystem: r.source_system,
    correlationId: r.correlation_id || null,
    orderId:      r.order_id    || null,
    shipmentId:   r.shipment_id || null,
    attemptCount: r.attempt_count || 0,
    lastError:    r.last_error || null,
    payload:      r.payload,
    headers:      r.headers || null,
    actor:        r.actor || null,
    tenantId:     r.tenant_id,
  };
}

function _fusionRowToUi(r) {
  return {
    id:           `FUS-${String(r.id).padStart(6, '0')}`,
    rawId:        r.id,
    source:       'fusion',
    direction:    _capDirection(r.direction),
    type:         (r.object_type || '').toUpperCase(),
    status:       r.status === 'processed' ? 'Acknowledged'
                : r.status === 'received'  ? 'Received'
                : /^failed/.test(r.status || '') ? 'Failed'
                : r.status === 'replayed'  ? 'Acknowledged'
                : r.status,
    ts:           r.received_at,
    ref:          r.internal_id || r.external_id || '',
    dest:         r.direction === 'outbound' ? 'FUSION' : 'TMS',
    sourceSystem: r.direction === 'outbound' ? 'TMS'    : 'FUSION',
    correlationId: r.oic_instance_id || null,
    orderId:      null,
    shipmentId:   null,
    attemptCount: 0,
    lastError:    r.error || null,
    payload:      r.payload,
    headers:      null,
    actor:        null,
    tenantId:     r.tenant_id || null,
  };
}

// ── filter helpers ───────────────────────────────────────────────

function _statusCodesForUi(uiStatus) {
  // Reverse map UI label → DB codes.
  switch (uiStatus) {
    case 'Sent':         return [STATUS.SENT];
    case 'Delivered':    return [STATUS.DELIVERED];
    case 'Acknowledged': return [STATUS.ACKNOWLEDGED, STATUS.PROCESSED, STATUS.REPLAYED];
    case 'Failed':       return [STATUS.FAILED];
    case 'Pending':      return [STATUS.PENDING];
    case 'Received':     return [STATUS.RECEIVED];
    default:             return null;
  }
}

function _applyHubFilters(query, f) {
  if (f.direction === 'Outbound') query = query.eq('direction', 'outbound');
  if (f.direction === 'Inbound')  query = query.eq('direction', 'inbound');
  if (f.type)                     query = query.eq('message_type', f.type);
  if (f.status) {
    const codes = _statusCodesForUi(f.status);
    if (codes && codes.length === 1) query = query.eq('status', codes[0]);
    else if (codes)                  query = query.in('status', codes);
  }
  if (f.tenantId)                 query = query.eq('tenant_id', f.tenantId);
  return query;
}

// ── public ───────────────────────────────────────────────────────

async function listMessages(filters = {}) {
  const limit  = Math.min(Math.max(Number(filters.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(Number(filters.offset) || 0, 0);

  const client = db.getClient();
  const tab = filters.tab || 'all';

  // Tab "failed" maps cleanly across both ledgers; tab "outbound" /
  // "inbound" filter by direction; tab "all" returns everything.
  const directionFilter = tab === 'outbound' ? 'Outbound'
                        : tab === 'inbound'  ? 'Inbound'
                        : filters.direction || null;
  const statusFilter    = tab === 'failed'   ? 'Failed'
                        : filters.status     || null;

  // Hub side
  let hubQuery = client.from(HUB_TABLE).select('*');
  hubQuery = _applyHubFilters(hubQuery, {
    direction: directionFilter,
    type:      filters.type,
    status:    statusFilter,
    tenantId:  filters.tenantId,
  });
  hubQuery = hubQuery.order('received_at', { ascending: false }).range(offset, offset + limit - 1);

  // Fusion side — map UI status to fusion status codes.
  let fusionQuery = client.from(FUSION_TABLE).select('*');
  if (directionFilter === 'Outbound') fusionQuery = fusionQuery.eq('direction', 'outbound');
  if (directionFilter === 'Inbound')  fusionQuery = fusionQuery.eq('direction', 'inbound');
  if (statusFilter === 'Failed')      fusionQuery = fusionQuery.in('status', ['failed_4xx', 'failed_5xx']);
  if (statusFilter === 'Received')    fusionQuery = fusionQuery.eq('status', 'received');
  if (statusFilter === 'Acknowledged')fusionQuery = fusionQuery.in('status', ['processed', 'replayed']);
  if (filters.tenantId)               fusionQuery = fusionQuery.eq('tenant_id', filters.tenantId);
  fusionQuery = fusionQuery.order('received_at', { ascending: false }).range(offset, offset + limit - 1);

  const [{ data: hubRows, error: hubErr }, { data: fusRows, error: fusErr }] =
    await Promise.all([hubQuery, fusionQuery]);

  if (hubErr) throw new Error(`[messagingHub.reader] hub list failed: ${hubErr.message}`);
  if (fusErr) console.warn('[messagingHub.reader] fusion list failed (non-fatal):', fusErr.message);

  const merged = [
    ...(hubRows || []).map(_hubRowToUi),
    ...(fusRows || []).map(_fusionRowToUi),
  ];

  // Free-text search applied client-side on the merged set, mirroring
  // the existing frontend filter contract.
  let result = merged;
  if (filters.search) {
    const q = String(filters.search).toLowerCase();
    result = result.filter((m) =>
      (m.id || '').toLowerCase().includes(q) ||
      (m.ref || '').toLowerCase().includes(q) ||
      (m.type || '').toLowerCase().includes(q) ||
      (m.dest || '').toLowerCase().includes(q) ||
      (m.correlationId || '').toLowerCase().includes(q)
    );
  }

  // Newest-first across both sources.
  result.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));

  return result.slice(0, limit);
}

async function getMessage(uiId) {
  if (!uiId) return null;
  const m = String(uiId).match(/^(MSG|FUS)-0*(\d+)$/i);
  if (!m) return null;
  const prefix = m[1].toUpperCase();
  const rawId  = Number(m[2]);
  const client = db.getClient();
  if (prefix === 'MSG') {
    const { data, error } = await client.from(HUB_TABLE).select('*').eq('id', rawId).maybeSingle();
    if (error) throw new Error(`[messagingHub.reader] getMessage failed: ${error.message}`);
    return data ? _hubRowToUi(data) : null;
  }
  const { data, error } = await client.from(FUSION_TABLE).select('*').eq('id', rawId).maybeSingle();
  if (error) throw new Error(`[messagingHub.reader] getMessage(fusion) failed: ${error.message}`);
  return data ? _fusionRowToUi(data) : null;
}

async function computeKpis({ tenantId } = {}) {
  // Aggregate from both ledgers.  We keep this as 6 small queries
  // instead of 1 big group-by because supabase-js doesn't expose raw
  // SQL and the cardinality is fine for the KPI bar.
  const client = db.getClient();
  const base = (tbl) => {
    let q = client.from(tbl).select('id', { count: 'exact', head: true });
    if (tenantId) q = q.eq('tenant_id', tenantId);
    return q;
  };
  async function _count(q) {
    const { count, error } = await q;
    if (error) {
      console.warn('[messagingHub.reader] kpi count failed:', error.message);
      return 0;
    }
    return count || 0;
  }

  const [
    hubTotal, hubOutbound, hubInbound, hubDelivered, hubFailed, hubPending,
    fusTotal, fusOutbound, fusInbound, fusDelivered, fusFailed,
  ] = await Promise.all([
    _count(base(HUB_TABLE)),
    _count(base(HUB_TABLE).eq('direction', 'outbound')),
    _count(base(HUB_TABLE).eq('direction', 'inbound')),
    _count(base(HUB_TABLE).eq('status',    'delivered')),
    _count(base(HUB_TABLE).eq('status',    'failed')),
    _count(base(HUB_TABLE).eq('status',    'pending')),
    _count(base(FUSION_TABLE)),
    _count(base(FUSION_TABLE).eq('direction', 'outbound')),
    _count(base(FUSION_TABLE).eq('direction', 'inbound')),
    _count(base(FUSION_TABLE).eq('status',    'processed')),
    _count(base(FUSION_TABLE).in('status',    ['failed_4xx', 'failed_5xx'])),
  ]);

  return {
    total:     hubTotal     + fusTotal,
    outbound:  hubOutbound  + fusOutbound,
    inbound:   hubInbound   + fusInbound,
    delivered: hubDelivered + fusDelivered,
    failed:    hubFailed    + fusFailed,
    pending:   hubPending,
  };
}

async function replay(uiId) {
  // Reader returns the original row.  The actual re-emit lives in the
  // adapter that owns the message type — keeping the writer single
  // and the reader read-only.
  return getMessage(uiId);
}

module.exports = {
  listMessages,
  getMessage,
  computeKpis,
  replay,
};
