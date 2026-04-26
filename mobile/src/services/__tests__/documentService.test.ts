/**
 * Unit tests for mobile/src/services/documentService.ts.
 * DbApi is mocked.
 */

import {
  DOC_TYPES,
  STATUS_BY_TYPE,
  computeDocStats,
  dbToDoc,
  docToDb,
  fetchDocuments,
  generateBOLForShipment,
  generateDocumentForShipment,
  generateHazmatForShipment,
  generateInvoiceForShipment,
  generatePODForShipment,
  removeDocument,
  saveDocument,
  updateDocumentStatus,
} from '../documentService';
import { DbApi } from '../../lib/api';

jest.mock('../../lib/api', () => ({
  DbApi: {
    documents: jest.fn(),
    upsert: jest.fn(),
    patch: jest.fn(),
    remove: jest.fn(),
  },
}));

describe('enum exports', () => {
  it('exposes the four supported document types', () => {
    expect(DOC_TYPES).toEqual(['BOL', 'POD', 'Hazmat', 'Invoice']);
  });

  it('maps each type to its allowed statuses', () => {
    expect(STATUS_BY_TYPE.BOL).toEqual(expect.arrayContaining(['Pending', 'Signed']));
    expect(STATUS_BY_TYPE.POD).toEqual(expect.arrayContaining(['Pending', 'Received']));
    expect(STATUS_BY_TYPE.Hazmat).toEqual(expect.arrayContaining(['Pending', 'Filed']));
    expect(STATUS_BY_TYPE.Invoice).toEqual(expect.arrayContaining(['Pending', 'Sent']));
  });
});

describe('docToDb / dbToDoc', () => {
  it('round-trips a doc through camelCase ↔ snake_case', () => {
    const doc = {
      id: 'BOL-1',
      type: 'BOL',
      status: 'Signed',
      ship: 'SHP-1',
      carrier: 'XPO',
      generated: '2026-04-01',
      origin: 'Chicago, IL',
      dest: 'Dallas, TX',
      weight: 1500,
      pieces: 12,
      mode: 'TL',
      bolType: 'MBOL',
      pickupDate: '2026-04-02',
      deliveryDate: '2026-04-05',
      orderIds: ['ORD-1'],
      orders: [{ id: 'ORD-1' }],
      lineItems: [{ description: 'box', qty: 5 }],
      incoterms: 'FOB',
    };
    const db = docToDb(doc);
    expect(db.bol_type).toBe('MBOL');
    expect(db.pickup_date).toBe('2026-04-02');
    expect(db.delivery_date).toBe('2026-04-05');
    expect(db.order_ids).toEqual(['ORD-1']);
    expect(db.line_items).toHaveLength(1);

    const back = dbToDoc(db);
    expect(back.bolType).toBe('MBOL');
    expect(back.pickupDate).toBe('2026-04-02');
    expect(back.lineItems[0].description).toBe('box');
  });

  it('coerces optional fields to null when blank in docToDb', () => {
    const db = docToDb({ id: 'X', type: 'BOL' });
    expect(db.origin).toBeNull();
    expect(db.weight).toBeNull();
    expect(db.bol_type).toBeNull();
    expect(db.pickup_date).toBeNull();
    expect(db.order_ids).toEqual([]);
  });

  it('dbToDoc handles null-shaped row safely', () => {
    expect(dbToDoc(null)).toEqual({});
  });
});

describe('fetchDocuments', () => {
  beforeEach(() => jest.clearAllMocks());

  it('maps API rows through dbToDoc', async () => {
    (DbApi.documents as jest.Mock).mockResolvedValue([
      { id: 'BOL-1', type: 'BOL', bol_type: 'MBOL', pickup_date: '2026-04-01' },
    ]);
    const out = await fetchDocuments();
    expect(out).toHaveLength(1);
    expect(out[0].bolType).toBe('MBOL');
    expect(out[0].pickupDate).toBe('2026-04-01');
  });

  it('returns [] on error or non-array response', async () => {
    (DbApi.documents as jest.Mock).mockRejectedValue(new Error('500'));
    expect(await fetchDocuments()).toEqual([]);
    (DbApi.documents as jest.Mock).mockResolvedValue(null);
    expect(await fetchDocuments()).toEqual([]);
  });
});

describe('mutations', () => {
  beforeEach(() => jest.clearAllMocks());

  it('saveDocument requires an id and upserts', async () => {
    (DbApi.upsert as jest.Mock).mockResolvedValue({ ok: true });
    await expect(saveDocument({})).rejects.toThrow(/id is required/);
    await saveDocument({ id: 'BOL-1', type: 'BOL' });
    expect(DbApi.upsert).toHaveBeenCalledWith('documents', expect.objectContaining({ id: 'BOL-1' }));
  });

  it('updateDocumentStatus PATCHes status only', async () => {
    (DbApi.patch as jest.Mock).mockResolvedValue({ ok: true });
    await updateDocumentStatus('BOL-1', 'Signed');
    expect(DbApi.patch).toHaveBeenCalledWith('documents', 'BOL-1', { status: 'Signed' });
  });

  it('updateDocumentStatus rejects when args missing', async () => {
    await expect(updateDocumentStatus('', 'Signed')).rejects.toThrow(/docId is required/);
    await expect(updateDocumentStatus('BOL-1', '')).rejects.toThrow(/nextStatus is required/);
  });

  it('removeDocument requires an id and deletes', async () => {
    await expect(removeDocument('')).rejects.toThrow(/docId is required/);
    (DbApi.remove as jest.Mock).mockResolvedValue({ ok: true });
    await removeDocument('BOL-1');
    expect(DbApi.remove).toHaveBeenCalledWith('documents', 'BOL-1');
  });
});

describe('generators', () => {
  const shipment = {
    id: 'SHP-2026-1234',
    carrier: 'XPO',
    origin: 'Chicago, IL',
    dest: 'Dallas, TX',
    weight: 1500,
    pieces: 12,
    mode: 'TL',
    pickup_date: '2026-04-02',
    delivery_date: '2026-04-05',
    order_ids: ['ORD-1', 'ORD-2'],
  };

  it('generateBOLForShipment uses BOL- prefix for normal BOLs', () => {
    const doc = generateBOLForShipment(shipment, [{ incoterms: 'FOB' }]);
    expect(doc.id).toBe('BOL-SHP-2026-1234');
    expect(doc.type).toBe('BOL');
    expect(doc.status).toBe('Pending');
    expect(doc.carrier).toBe('XPO');
    expect(doc.weight).toBe(1500);
    expect(doc.incoterms).toBe('FOB');
    expect(doc.bolType).toBe('BOL');
    expect(doc.generated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('generateBOLForShipment uses MBOL/CBOL prefix when shipment.bol_type set', () => {
    const mbol = generateBOLForShipment({ ...shipment, bol_type: 'MBOL' });
    expect(mbol.id).toBe('MBOL-SHP-2026-1234');
    expect(mbol.bolType).toBe('MBOL');
    const cbol = generateBOLForShipment({ ...shipment, bol_type: 'CBOL' });
    expect(cbol.id).toBe('CBOL-SHP-2026-1234');
  });

  it('generatePODForShipment builds a POD row', () => {
    const doc = generatePODForShipment(shipment, []);
    expect(doc.id).toBe('POD-SHP-2026-1234');
    expect(doc.type).toBe('POD');
    expect(doc.deliveryDate).toBe('2026-04-05');
    expect(doc.orderIds).toEqual(['ORD-1', 'ORD-2']);
  });

  it('generateHazmatForShipment builds a Hazmat row', () => {
    const doc = generateHazmatForShipment(shipment);
    expect(doc.id).toBe('HZM-SHP-2026-1234');
    expect(doc.type).toBe('Hazmat');
  });

  it('generateInvoiceForShipment builds a commercial invoice row', () => {
    const doc = generateInvoiceForShipment(shipment);
    expect(doc.id).toBe('INV-COM-SHP-2026-1234');
    expect(doc.type).toBe('Invoice');
  });

  it('generateDocumentForShipment dispatches by type', () => {
    expect(generateDocumentForShipment('BOL', shipment).type).toBe('BOL');
    expect(generateDocumentForShipment('POD', shipment).type).toBe('POD');
    expect(generateDocumentForShipment('Hazmat', shipment).type).toBe('Hazmat');
    expect(generateDocumentForShipment('Invoice', shipment).type).toBe('Invoice');
    expect(() => generateDocumentForShipment('UNKNOWN' as any, shipment)).toThrow(/unknown type/);
  });
});

describe('computeDocStats', () => {
  it('counts totals, BOLs, POD pending, POD received', () => {
    const docs = [
      { type: 'BOL', status: 'Signed' },
      { type: 'BOL', status: 'Pending' },
      { type: 'POD', status: 'Pending' },
      { type: 'POD', status: 'Received' },
      { type: 'POD', status: 'Received' },
      { type: 'Hazmat', status: 'Filed' },
    ];
    const s = computeDocStats(docs);
    expect(s.total).toBe(6);
    expect(s.bolsGenerated).toBe(2);
    expect(s.podsPending).toBe(1);
    expect(s.podsReceived).toBe(2);
  });

  it('returns zeroes for an empty list', () => {
    expect(computeDocStats([])).toEqual({
      total: 0, bolsGenerated: 0, podsPending: 0, podsReceived: 0,
    });
  });
});
