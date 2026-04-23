// ═══════════════════════════════════════════════════════════════════
// In-process Event Bus — used by REQ-01 auto order sync.
// Allows any service (OMS ingest, bulk plan, etc.) to broadcast
// events to SSE subscribers without adding a message broker.
//
// This is a singleton: the first require() creates the emitter,
// every subsequent require() returns the same instance.
// Keep emitter names stable — they are part of the public SSE contract.
// ═══════════════════════════════════════════════════════════════════

const { EventEmitter } = require('events');

const bus = new EventEmitter();
// Reasonable upper bound — each SSE client is one listener.
bus.setMaxListeners(200);

// Event name constants (import these instead of string literals)
const EVENTS = {
  ORDER_CREATED: 'order.created',
  ORDER_UPDATED: 'order.updated',
  ORDER_DELETED: 'order.deleted',
  OMS_SYNC_BATCH: 'oms.sync.batch', // fired once per /api/ingest/oms-orders POST
  // Shipment-level real-time signal. Bridged to the WebSocket broadcast
  // channel in server.js so the TMS Shipments page (and any open detail
  // modal) refresh live when a WMS ship-confirm or POD flips the status.
  SHIPMENT_UPDATED: 'shipment.updated',
};

module.exports = { bus, EVENTS };
