// ═══════════════════════════════════════════════════════════════════
// Fusion Publisher — TMS event → OIC payload transformer.
//
// Responsible for the SHAPE of the outbound HTTP body only. No I/O here.
// Keeps the policy in one place so the publisher (which handles auth,
// retries, queueing) doesn't grow a payload-shape branch tree.
//
// Inputs:
//   - tmsEvent  the full event payload from eventBus (already merged with
//               shipment + linked-orders context by the caller)
//   - eventType the canonical OIC event_type ('shipment.status' | 'shipment.pod' | 'shipment.invoiced')
//
// Output: a JSON-serializable object matching docs/integrations/oic/samples/F3-tms-shipment-status-event.json
// ═══════════════════════════════════════════════════════════════════

function buildShipmentStatusPayload({ shipment, linkedOrders, eventSeq, via }) {
  return {
    event_type: 'shipment.status',
    event_seq:  eventSeq,
    tms_shipment_id: shipment.id,
    fusion_business_unit_id: shipment.fusion_business_unit_id || null,
    occurred_at: new Date().toISOString(),
    shipment: {
      status:        shipment.status,
      carrier:       shipment.carrier || null,
      bol_number:    shipment.bol_number || null,
      pro_number:    shipment.pro_number || null,
      seal_number:   shipment.seal_number || null,
      pickup_date:   shipment.pickup_date || null,
      delivery_date: shipment.delivery_date || null,
      weight:        Number.isFinite(Number(shipment.weight)) ? Number(shipment.weight) : null,
      weight_uom:    'pounds',
    },
    linked_orders: (linkedOrders || []).map((o) => ({
      tms_order_id:               o.id,
      fusion_so_header_id:        o.fusion_so_header_id || null,
      fusion_shipment_request_id: o.fusion_shipment_request_id || null,
      status:                     o.status,
    })),
    trace: { tms_event_log_id: eventSeq, via: via || null },
  };
}

function buildPodPayload({ shipment, linkedOrders, eventSeq, podReceivedBy, podSignatureUrl, note }) {
  return {
    event_type: 'shipment.pod',
    event_seq:  eventSeq,
    tms_shipment_id: shipment.id,
    fusion_business_unit_id: shipment.fusion_business_unit_id || null,
    occurred_at: new Date().toISOString(),
    pod: {
      delivery_date:     shipment.delivery_date || null,
      pod_received_by:   podReceivedBy || null,
      pod_signature_url: podSignatureUrl || null,
      note:              note || null,
    },
    linked_orders: (linkedOrders || []).map((o) => ({
      tms_order_id:               o.id,
      fusion_so_header_id:        o.fusion_so_header_id || null,
      fusion_shipment_request_id: o.fusion_shipment_request_id || null,
    })),
  };
}

module.exports = { buildShipmentStatusPayload, buildPodPayload };
