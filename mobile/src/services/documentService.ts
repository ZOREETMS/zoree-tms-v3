/**
 * Mobile document service — orchestration layer for documents
 * (BOL / POD / Hazmat / Invoice) on the documents screens.
 *
 * Pure service layer: calls DbApi, returns plain data, no React
 * state, no UI side-effects.
 *
 * Web parity reference: frontend/src/services/documentService.js.
 * Field shape parity is critical — a document created on mobile
 * is rendered on web (and vice versa) by the same DocumentViewer.
 *
 * The print-style document templates (full HTML BOL / POD layouts)
 * are intentionally not ported — mobile shows documents in a
 * field-list viewer instead. Generation still happens here so the
 * row writes the same payload the web's templates read from.
 */

import { DbApi } from '../lib/api';

/* ── Field-shape mappers (camelCase ↔ snake_case) ─────────────────── */

/**
 * Map a UI-shaped doc to the DB row shape. Mirrors the web's
 * `docToDb` so a mobile-saved doc reads identically on web.
 */
export function docToDb(doc: any): Record<string, any> {
  return {
    id: doc.id,
    type: doc.type,
    status: doc.status || 'Pending',
    ship: doc.ship,
    carrier: doc.carrier,
    generated: doc.generated,
    origin: doc.origin || null,
    dest: doc.dest || null,
    weight: doc.weight || null,
    pieces: doc.pieces || null,
    mode: doc.mode || null,
    bol_type: doc.bolType || null,
    pickup_date: doc.pickupDate || null,
    delivery_date: doc.deliveryDate || null,
    order_ids: doc.orderIds || [],
    orders: doc.orders || [],
    line_items: doc.lineItems || [],
    incoterms: doc.incoterms || null,
  };
}

/**
 * Map a DB row to the UI-shaped doc. The viewer reads camelCase
 * fields; this normalizer handles snake_case → camelCase.
 */
export function dbToDoc(row: any): Record<string, any> {
  if (!row) return {};
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    ship: row.ship,
    carrier: row.carrier,
    generated: row.generated,
    origin: row.origin,
    dest: row.dest,
    weight: row.weight,
    pieces: row.pieces,
    mode: row.mode,
    bolType: row.bol_type,
    pickupDate: row.pickup_date,
    deliveryDate: row.delivery_date,
    orderIds: row.order_ids || [],
    orders: row.orders || [],
    lineItems: row.line_items || [],
    incoterms: row.incoterms || null,
  };
}

/* ── Document types ──────────────────────────────────────────────── */

export const DOC_TYPES = ['BOL', 'POD', 'Hazmat', 'Invoice'] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** Status options per document type — narrows what the user can pick. */
export const STATUS_BY_TYPE: Record<DocType, readonly string[]> = {
  BOL: ['Pending', 'Signed', 'Voided'],
  POD: ['Pending', 'Received', 'Disputed'],
  Hazmat: ['Pending', 'Filed', 'Expired'],
  Invoice: ['Pending', 'Sent', 'Paid', 'Disputed'],
};

/* ── API persistence ──────────────────────────────────────────────── */

/**
 * Fetch all documents from the backend, normalizing rows to the
 * UI shape. Returns an empty array on any error so the screen
 * can still render with a fallback list.
 */
export async function fetchDocuments(): Promise<any[]> {
  try {
    const rows = await DbApi.documents();
    if (Array.isArray(rows)) return rows.map(dbToDoc);
    return [];
  } catch {
    return [];
  }
}

/** Save (create or update) a document. */
export async function saveDocument(doc: any): Promise<any> {
  if (!doc || !doc.id) throw new Error('saveDocument: doc.id is required');
  const payload = docToDb(doc);
  return DbApi.upsert('documents', payload);
}

/** Patch only the status field. Used by the viewer's "Mark X" actions. */
export async function updateDocumentStatus(docId: string, nextStatus: string): Promise<any> {
  if (!docId) throw new Error('updateDocumentStatus: docId is required');
  if (!nextStatus) throw new Error('updateDocumentStatus: nextStatus is required');
  return DbApi.patch('documents', docId, { status: nextStatus });
}

/** Permanently delete a document row. */
export async function removeDocument(docId: string): Promise<any> {
  if (!docId) throw new Error('removeDocument: docId is required');
  return DbApi.remove('documents', docId);
}

/* ── Generators ──────────────────────────────────────────────────── */

/**
 * Build a new BOL row from a shipment. Mirrors the web's
 * `generateBOLForShipment` payload exactly so a mobile-generated
 * BOL is indistinguishable from one generated on web.
 *
 * Uses the shipment's bol_type (BOL / MBOL / CBOL) for the id
 * prefix when present, so master / consolidated BOLs are
 * disambiguated in the documents grid.
 */
export function generateBOLForShipment(
  shipment: any,
  orders: any[] = [],
  lineItems: any[] = [],
): any {
  const bolType = shipment?.bol_type || 'BOL';
  const prefix = bolType === 'MBOL' ? 'MBOL' : bolType === 'CBOL' ? 'CBOL' : 'BOL';
  return {
    id: `${prefix}-${shipment?.id}`,
    type: 'BOL',
    ship: shipment?.id,
    carrier: shipment?.carrier || '',
    generated: new Date().toISOString().split('T')[0],
    status: 'Pending',
    origin: shipment?.origin || '',
    dest: shipment?.dest || '',
    weight: shipment?.weight || 0,
    pieces: shipment?.pieces || 0,
    mode: shipment?.mode || '',
    pickupDate: shipment?.pickup_date || '',
    deliveryDate: shipment?.delivery_date || '',
    bolType: shipment?.bol_type || 'BOL',
    orderIds: shipment?.order_ids || [],
    orders: orders || [],
    lineItems: lineItems || [],
    incoterms: (orders || []).map((o) => o?.incoterms).find(Boolean) || null,
  };
}

/** Build a new POD row from a shipment. */
export function generatePODForShipment(shipment: any, orders: any[] = []): any {
  return {
    id: `POD-${shipment?.id}`,
    type: 'POD',
    ship: shipment?.id,
    carrier: shipment?.carrier || '',
    generated: new Date().toISOString().split('T')[0],
    status: 'Pending',
    origin: shipment?.origin || '',
    dest: shipment?.dest || '',
    weight: shipment?.weight || 0,
    pieces: shipment?.pieces || 0,
    deliveryDate: shipment?.delivery_date || '',
    orderIds: shipment?.order_ids || [],
    orders: orders || [],
  };
}

/** Build a new Hazmat declaration from a shipment. */
export function generateHazmatForShipment(shipment: any): any {
  return {
    id: `HZM-${shipment?.id}`,
    type: 'Hazmat',
    ship: shipment?.id,
    carrier: shipment?.carrier || '',
    generated: new Date().toISOString().split('T')[0],
    status: 'Pending',
    origin: shipment?.origin || '',
    dest: shipment?.dest || '',
    weight: shipment?.weight || 0,
    pieces: shipment?.pieces || 0,
    mode: shipment?.mode || '',
  };
}

/** Build a new commercial invoice from a shipment. */
export function generateInvoiceForShipment(shipment: any): any {
  return {
    id: `INV-COM-${shipment?.id}`,
    type: 'Invoice',
    ship: shipment?.id,
    carrier: shipment?.carrier || '',
    generated: new Date().toISOString().split('T')[0],
    status: 'Pending',
    origin: shipment?.origin || '',
    dest: shipment?.dest || '',
    weight: shipment?.weight || 0,
    pieces: shipment?.pieces || 0,
  };
}

/**
 * Dispatch helper — builds a document of the given type from a shipment.
 * Used by the GenerateDocumentModal.
 */
export function generateDocumentForShipment(
  type: DocType,
  shipment: any,
  orders: any[] = [],
  lineItems: any[] = [],
): any {
  switch (type) {
    case 'BOL':     return generateBOLForShipment(shipment, orders, lineItems);
    case 'POD':     return generatePODForShipment(shipment, orders);
    case 'Hazmat':  return generateHazmatForShipment(shipment);
    case 'Invoice': return generateInvoiceForShipment(shipment);
    default: throw new Error(`generateDocumentForShipment: unknown type "${type}"`);
  }
}

/* ── Stats ───────────────────────────────────────────────────────── */

export interface DocStats {
  total: number;
  bolsGenerated: number;
  podsPending: number;
  podsReceived: number;
}

export function computeDocStats(documents: any[]): DocStats {
  const total = documents.length;
  const bolsGenerated = documents.filter((d) => d.type === 'BOL').length;
  const podsPending = documents.filter((d) => d.type === 'POD' && d.status === 'Pending').length;
  const podsReceived = documents.filter((d) => d.type === 'POD' && d.status === 'Received').length;
  return { total, bolsGenerated, podsPending, podsReceived };
}
