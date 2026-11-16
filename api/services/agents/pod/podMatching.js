// Document / POD agent — pure matching + checks (no I/O).
'use strict';

const norm = (v) => String(v || '').trim().toUpperCase();

/** Which reference on the document matched which shipment column. */
function matchReference(pod, shipment) {
  const r = pod.references || {};
  if (r.shipment_id && norm(r.shipment_id) === norm(shipment.id)) return 'shipment_id';
  if (r.bol_number && norm(r.bol_number) === norm(shipment.bol_number)) return 'bol_number';
  if (r.pro_number && norm(r.pro_number) === norm(shipment.pro_number)) return 'pro_number';
  return null;
}

/** Exceptions on the paper, plus a piece-count mismatch against the shipment. */
function deliveryExceptions(pod, shipment) {
  const out = [...(pod.exceptions || [])];
  const expected = Number(shipment.pieces) || 0;
  const got = Number(pod.pieces_delivered);
  if (expected && Number.isFinite(got) && got !== expected && !out.some((e) => e.type === 'shortage' || e.type === 'overage')) {
    out.push({ type: got < expected ? 'shortage' : 'overage', detail: `POD shows ${got} piece(s); shipment was ${expected}.`, pieces: Math.abs(expected - got) });
  }
  return out;
}

function podNote(pod, matchedOn) {
  return [
    `[Zoree AI · POD] Delivered${pod.delivered_date ? ` ${pod.delivered_date}` : ''}${pod.delivered_time ? ` ${pod.delivered_time}` : ''}`,
    pod.receiver_name ? `signed by ${pod.receiver_name}` : (pod.signature_present ? 'signature present' : 'NO signature'),
    pod.pieces_delivered != null ? `${pod.pieces_delivered} pcs` : null,
    matchedOn ? `matched on ${matchedOn}` : null,
  ].filter(Boolean).join(' · ');
}

module.exports = { matchReference, deliveryExceptions, podNote };
