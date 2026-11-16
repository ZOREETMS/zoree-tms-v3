// ═══════════════════════════════════════════════════════════════════
// Document / POD Agent
//   input : { documentText? , fileBase64?, mediaType?, fileName?, shipmentId? }
//   plan  : Claude reads the paper → match shipment (id / BOL / PRO) → checks
//   action: MARK_DELIVERED · CREATE_INVOICE · FLAG_OSD   — confirm tier
// ═══════════════════════════════════════════════════════════════════

'use strict';

const db = require('../../supabase');
const { applyShipmentEvent } = require('../../shipmentEvents');
const { createInvoiceFromShipment, _internals: invoiceInternals } = require('../../invoiceFromShipment');
const genericAudit = require('../../genericTableAudit');
const { extractPod } = require('./podExtractor');
const { matchReference, deliveryExceptions, podNote } = require('./podMatching');

const bad = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };
const COLS = 'id,carrier,mode,origin,dest,weight,pieces,status,bol_number,pro_number,delivery_date,order_ids';

function validateInput(i) {
  const documentText = String(i.documentText || '').trim();
  if (!documentText && !i.fileBase64) throw bad('Attach a POD/BOL photo or PDF, or paste its text.');
  return {
    documentText: documentText || null,
    fileBase64: i.fileBase64 || null,
    mediaType: i.mediaType || null,
    fileName: i.fileName || null,
    shipmentId: i.shipmentId ? String(i.shipmentId).trim() : null,
  };
}

/** The run's stored input keeps file metadata, not the file bytes. */
function snapshot(input) {
  const { fileBase64, ...rest } = input;
  return { ...rest, fileBytes: fileBase64 ? Buffer.byteLength(fileBase64, 'base64') : 0 };
}

async function findShipment(input, pod) {
  const r = pod.references || {};
  const tries = [
    input.shipmentId && ['id', input.shipmentId],
    r.shipment_id && ['id', r.shipment_id],
    r.bol_number && ['bol_number', r.bol_number],
    r.pro_number && ['pro_number', r.pro_number],
  ].filter(Boolean);
  for (const [col, val] of tries) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await db.dbSelect('shipments', { select: COLS, filters: [[col, 'ilike', String(val).trim()]], limit: 1 });
    if (rows[0]) return rows[0];
  }
  return null;
}

function buildActions({ shipment, pod, matchedOn, exceptions, openInvoice }) {
  const actions = [];
  const delivered = shipment.status === 'Delivered';
  if (!delivered && (pod.signature_present || pod.receiver_name)) {
    actions.push({
      type: 'MARK_DELIVERED',
      title: `Mark ${shipment.id} delivered${pod.delivered_date ? ` on ${pod.delivered_date}` : ''}${pod.receiver_name ? ` — signed by ${pod.receiver_name}` : ''}`,
      entityType: 'shipment', entityId: shipment.id, dedupe: pod.delivered_date || 'pod',
      payload: { shipmentId: shipment.id, date: pod.delivered_date, note: podNote(pod, matchedOn), pod: { receiver: pod.receiver_name, pieces: pod.pieces_delivered, docType: pod.doc_type } },
    });
  }
  if (!openInvoice && (delivered || actions.length)) {
    actions.push({
      type: 'CREATE_INVOICE',
      title: `Create invoice for ${shipment.id} (${shipment.carrier || 'carrier'})${exceptions.length ? ' — on hold for OS&D' : ''}`,
      entityType: 'shipment', entityId: shipment.id, dedupe: 'pod-invoice',
      payload: { shipmentId: shipment.id, holdForOsd: exceptions.length > 0 },
    });
  }
  if (exceptions.length) {
    actions.push({
      type: 'FLAG_OSD',
      title: `Flag OS&D on ${shipment.id}: ${exceptions.map((e) => `${e.type}${e.pieces ? ` ${e.pieces} pc` : ''}`).join(', ')}`,
      entityType: 'shipment', entityId: shipment.id, dedupe: exceptions.map((e) => e.type).join(','),
      payload: { shipmentId: shipment.id, exceptions, note: `[Zoree AI · POD] OS&D: ${exceptions.map((e) => `${e.type}${e.pieces ? ` (${e.pieces} pc)` : ''} — ${e.detail}`).join('; ')}` },
    });
  }
  return actions;
}

async function plan(input) {
  const { pod, model, usage } = await extractPod({ text: input.documentText, fileBase64: input.fileBase64, mediaType: input.mediaType, fileName: input.fileName });
  const shipment = await findShipment(input, pod);
  const base = { model, usage, findings: { pod, input: snapshot(input) } };
  if (!shipment) {
    const refs = Object.entries(pod.references || {}).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
    return { ...base, summary: `Read a ${pod.doc_type} but no shipment matches its references (${refs}). Enter the shipment id and run again.`, actions: [] };
  }
  const matchedOn = input.shipmentId ? 'shipment_id (given)' : matchReference(pod, shipment);
  const exceptions = deliveryExceptions(pod, shipment);
  const openInvoice = await invoiceInternals.findOpenInvoiceForShipment(shipment.id);
  const actions = buildActions({ shipment, pod, matchedOn, exceptions, openInvoice });
  return {
    ...base,
    summary: `${pod.doc_type} for ${shipment.id} (${shipment.carrier || 'carrier'}): ${pod.receiver_name ? `signed by ${pod.receiver_name}` : 'no signer'}${pod.delivered_date ? ` on ${pod.delivered_date}` : ''} · ${exceptions.length ? `${exceptions.length} OS&D exception(s)` : 'clean delivery'}${openInvoice ? ` · invoice ${openInvoice.invoice_number || openInvoice.id} already open` : ''}`,
    entityType: 'shipment', entityId: shipment.id,
    findings: { ...base.findings, shipment, matchedOn, exceptions, openInvoice: openInvoice ? { id: openInvoice.id, number: openInvoice.invoice_number, status: openInvoice.status } : null },
    actions,
  };
}

async function recordPodDocument(shipmentId, p, user) {
  const rows = await db.dbSelect('shipments', { filters: [['id', 'eq', shipmentId]], limit: 1 });
  const s = rows[0];
  if (!s) return null;
  const doc = {
    id: `POD-${s.id}`, type: 'POD', status: 'Signed', ship: s.id, carrier: s.carrier,
    generated: p.date || new Date().toISOString().slice(0, 10), origin: s.origin, dest: s.dest,
    weight: s.weight, pieces: (p.pod && p.pod.pieces) || s.pieces, mode: s.mode, order_ids: s.order_ids || [],
    delivery_date: p.date || null,
  };
  const saved = await db.dbUpsert('documents', doc);
  await genericAudit.recordCreate({ table: 'documents', row: saved || doc, user });
  return doc.id;
}

const executors = {
  MARK_DELIVERED: async (p, ctx) => {
    const event = await applyShipmentEvent({ shipmentId: p.shipmentId, type: 'Delivered', note: p.note, date: p.date || undefined, user: ctx.user });
    const documentId = await recordPodDocument(p.shipmentId, p, ctx.user);
    return { shipmentId: p.shipmentId, documentId, ordersUpdated: event && event.transitioned };
  },
  CREATE_INVOICE: async (p, ctx) => {
    const { invoice, reused } = await createInvoiceFromShipment({ shipmentId: p.shipmentId, user: ctx.user });
    return { invoiceId: invoice && invoice.id, invoiceNumber: invoice && invoice.invoice_number, status: invoice && invoice.status, reused: !!reused };
  },
  FLAG_OSD: (p, ctx) => applyShipmentEvent({ shipmentId: p.shipmentId, type: 'Note', note: p.note, user: ctx.user }),
};

module.exports = {
  key: 'document_pod', validateInput, plan, executors, snapshotInput: snapshot,
  editableFields: { MARK_DELIVERED: ['date', 'note'], FLAG_OSD: ['note'] },
};
