/**
 * Order constants — shared by OrderFormScreen, OrderDetailScreen, and
 * any future bulk-action UI that needs the same blank order shape or
 * controlled value lists.
 *
 * QA bug #106 + #107 fix:
 *   #106 — Ship From/To Name fields removed from the mobile new-order
 *          flow; replaced by City + State per side. The DB columns
 *          ship_from_name / ship_to_name remain (web edit path still
 *          surfaces them), but mobile no longer collects them so they
 *          stay null on mobile-created orders. New camelCase keys
 *          originCity / originState / destCity / destState carry the
 *          values used to compose the canonical origin/dest string the
 *          orders table already stores.
 *   #107 — Standalone weight/pieces removed from the freight section.
 *          Replaced by a `lines` array (line_num, item_id, description,
 *          qty_ordered, unit_weight, total_weight) — same shape as
 *          POST /api/orders/:id/lines accepts. Weight + pieces are now
 *          rolled up from the lines client-side at save time so the
 *          planner still sees a populated header.
 */
export const EMPTY_ORDER = {
  id: '',
  customer: '',
  origin: '',
  destination: '',
  originCity: '',
  originState: '',
  originZip: '',
  destCity: '',
  destState: '',
  destZip: '',
  shipFromName: '',
  shipToName: '',
  weight: '',
  pieces: '',
  commodity: 'General',
  shipMode: 'TL',
  serviceLevel: '',
  incoterms: '',
  refNum: '',
  poNum: '',
  readyDate: '',
  dueDate: '',
  status: 'Unplanned',
  preferredCarrier: '',
  excludedCarrier: '',
  noConsolidate: false,
  hazmat: false,
  noContractRate: false,
  dedicatedEquip: false,
  notes: '',
  lines: [],
};

export const ORDER_STATUSES = [
  'Unplanned', 'Planned', 'Tendered', 'Tender Accepted',
  'Shipped', 'Delivered', 'Cancelled',
];

export const SHIP_MODES = ['', 'TL', 'LTL', 'Parcel', 'Intermodal'];

export const SERVICE_LEVELS = [
  '', 'Standard', 'Guaranteed', 'Expedited', 'White Glove',
];

export const INCOTERMS = [
  'EXW','FCA','CPT','CIP','DAP','DPU','DDP','FAS','FOB','CFR','CIF',
];
