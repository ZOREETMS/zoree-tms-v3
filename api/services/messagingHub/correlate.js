// ═══════════════════════════════════════════════════════════════════
// Messaging Hub — correlation resolver.
//
// Inbound messages arrive carrying *external* identifiers — an OMS
// sales-order number, a carrier load number, an SCAC + PRO, etc.
// Before the row hits message_log we want to attach the local
// order_id / shipment_id where we can, so the Hub UI can drill from a
// shipment timeline into every message it produced.
//
// This module is intentionally cheap: each lookup is a single indexed
// SELECT and is best-effort.  When a match is not found the writer
// still records the row with order_id / shipment_id NULL — that's the
// "needs triage" surface (zoree_db_rules.pdf §Data Integrity 1 — we
// keep the audit row even when linkage is unknown).
//
// API:
//   resolveOrderByExternalRef    (externalRef)  → orderId    | null
//   resolveShipmentByExternalRef (externalRef)  → shipmentId | null
//   resolveByCorrelationId       (correlationId) →
//                              { orderId, shipmentId } | null
//
// All errors are swallowed and logged; a correlation failure must
// never break the message capture.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const db = require('../supabase');

async function resolveOrderByExternalRef(externalRef) {
  if (!externalRef) return null;
  try {
    const rows = await db.dbSelect('orders', {
      filters: [['ref_num', 'eq', String(externalRef)]],
      select:  'id', limit: 1,
    });
    if (rows && rows.length) return String(rows[0].id);
    // Fall back to the order's own id field (some OMS payloads send
    // the TMS-side id directly when echoing a confirmation back).
    const byId = await db.dbSelect('orders', {
      filters: [['id', 'eq', String(externalRef)]],
      select:  'id', limit: 1,
    });
    return byId && byId.length ? String(byId[0].id) : null;
  } catch (err) {
    console.warn('[messagingHub.correlate] order lookup failed:', err.message);
    return null;
  }
}

async function resolveShipmentByExternalRef(externalRef) {
  if (!externalRef) return null;
  try {
    const rows = await db.dbSelect('shipments', {
      filters: [['id', 'eq', String(externalRef)]],
      select:  'id', limit: 1,
    });
    if (rows && rows.length) return String(rows[0].id);
    // Carrier responses sometimes echo back our BOL or PRO in place of
    // the shipment id — try those too.
    const byBol = await db.dbSelect('shipments', {
      filters: [['bol_number', 'eq', String(externalRef)]],
      select:  'id', limit: 1,
    });
    if (byBol && byBol.length) return String(byBol[0].id);
    const byPro = await db.dbSelect('shipments', {
      filters: [['pro_number', 'eq', String(externalRef)]],
      select:  'id', limit: 1,
    });
    return byPro && byPro.length ? String(byPro[0].id) : null;
  } catch (err) {
    console.warn('[messagingHub.correlate] shipment lookup failed:', err.message);
    return null;
  }
}

// When a previous outbound message used the same correlation_id, find
// it and inherit its order/shipment linkage.  This is the primary path
// for correlating a TENDER_RESPONSE to its originating SHIPMENT_TENDER.
async function resolveByCorrelationId(correlationId) {
  if (!correlationId) return null;
  try {
    const client = db.getClient();
    const { data, error } = await client
      .from('message_log')
      .select('order_id, shipment_id')
      .eq('correlation_id', String(correlationId))
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return {
      orderId:    data.order_id    || null,
      shipmentId: data.shipment_id || null,
    };
  } catch (err) {
    console.warn('[messagingHub.correlate] correlation lookup failed:', err.message);
    return null;
  }
}

module.exports = {
  resolveOrderByExternalRef,
  resolveShipmentByExternalRef,
  resolveByCorrelationId,
};
