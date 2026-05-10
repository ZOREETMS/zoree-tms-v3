// ═══════════════════════════════════════════════════════════════════
// Order History Service — REQ-02 Phase 1 (mobile parity, 2026-05-10).
//
// Fetches change_history rows for an order from the backend and shapes
// them into the same bucketed structure the web's OrderDetailModal
// History tab already consumes. Mirrors:
//
//   frontend/src/services/historyService.js          (web web)
//   mobile/src/services/shipmentDetailService.ts     (existing mobile shipment-side parity)
//
// The single source of truth for FIELD_LABELS is the web file — keep
// that and this list in lockstep so an order edited on web shows the
// same labels on mobile (e.g. "Service Level" not "service_level").
// ═══════════════════════════════════════════════════════════════════

// @ts-expect-error — shared/api.js is JS, no .d.ts.
import { OrdersApi } from '../lib/api';

// ── Public types ────────────────────────────────────────────────────

export interface OrderHistoryChange {
  label: string;
  old: string;
  new: string;
}

export interface OrderHistoryEntry {
  user: string;
  userRole: string | null;
  ts: string;        // formatted local time
  tsRaw: string;     // raw ISO
  type: string;      // 'edit' | 'plan' | 'unassign' | 'create' | 'delete' | 'tender' | 'status' | 'untender'
  action: string;    // raw action — for downstream filtering
  changes: OrderHistoryChange[];
  metadata?: Record<string, unknown>;
}

// ── Field-label map (mirrors web FIELD_LABELS) ──────────────────────

const FIELD_LABELS: Record<string, string> = {
  customer: 'Customer',
  origin: 'Origin',
  dest: 'Destination',
  weight: 'Weight',
  pieces: 'Pieces',
  ship_mode: 'Ship Mode',
  commodity: 'Commodity',
  incoterms: 'Incoterms',
  ref_num: 'Reference #',
  po_num: 'PO Number',
  po_number: 'PO Number',
  // TMS bug #2: service_level diffs land in change_history with this column
  // name. Without an entry here the History tab would render the raw value.
  service_level: 'Service Level',
  ready: 'Ready Date',
  due: 'Due Date',
  status: 'Status',
  shipment_id: 'Shipment',
  origin_zip: 'Origin ZIP',
  dest_zip: 'Destination ZIP',
  // REQ-24 dedicated location-name columns.
  ship_from_name: 'Ship From Name',
  ship_to_name: 'Ship To Name',
  hazmat: 'Hazmat',
  preferred_carrier: 'Preferred Carrier',
  excluded_carrier: 'Excluded Carrier',
  no_consolidate: 'No Consolidate',
  dedicated_equip: 'Dedicated Equipment',
  no_contract_rate: 'Spot Rate',
  notes: 'Notes',
  // Line-item edits land with field='line_<N>' and the parent's totals
  // as line_count.
  line_count: 'Line Count',
};

function prettyLabel(field: string | null | undefined): string {
  if (!field) return '—';
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  const lineMatch = /^line_(\d+)$/.exec(field);
  if (lineMatch) return `Line ${lineMatch[1]}`;
  return field
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function fmtTs(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    return iso || '';
  }
}

/**
 * Group rows into a change-set by (action, user, timestamp-to-the-second).
 * Mirrors the web bucketing so an "edit 3 fields at once" produces a
 * single timeline entry on both clients.
 */
function bucketKey(row: any): string {
  const sec = String(row.created_at || '').replace(/\.\d+/, '').replace(/Z$/, '');
  return `${row.action}|${row.username || ''}|${sec}`;
}

function mapEditChange(row: any): OrderHistoryChange {
  return {
    label: prettyLabel(row.field),
    old:   row.old_value ?? '',
    new:   row.new_value ?? '',
  };
}

function synthesizeNonEditChanges(row: any): OrderHistoryChange[] {
  const md = row.metadata || {};
  switch (row.action) {
    case 'plan':
      return [{ label: 'Shipment', old: '—', new: md.shipmentId || row.new_value || 'Planned' }];
    case 'unassign':
      return [{ label: 'Shipment', old: md.previousShipmentId || row.old_value || '—', new: '—' }];
    case 'create':
      return [{ label: 'Order', old: '—', new: 'Created' }];
    case 'delete':
      return [{ label: 'Order', old: 'Existed', new: 'Deleted' }];
    case 'tender':
      return [{ label: 'Carrier', old: '—', new: md.carrier || md.to || 'Tendered' }];
    case 'status':
      return [{ label: prettyLabel(row.field || 'status'), old: row.old_value ?? '—', new: row.new_value ?? '—' }];
    default:
      return [{ label: prettyLabel(row.field || row.action), old: row.old_value ?? '—', new: row.new_value ?? '—' }];
  }
}

/**
 * Shape backend change_history rows into the History-tab format.
 * Preserves chronological order (newest first per the API's default sort).
 *
 * Exported so unit tests can exercise the bucketing/synthesis logic
 * without touching the network.
 */
export function shapeOrderHistoryRows(rows: any[]): OrderHistoryEntry[] {
  const out: OrderHistoryEntry[] = [];
  const buckets = new Map<string, OrderHistoryEntry>();

  for (const r of rows || []) {
    const key = bucketKey(r);
    if (r.action === 'edit') {
      let entry = buckets.get(key);
      if (!entry) {
        entry = {
          user:     r.username || 'system',
          userRole: r.user_role || null,
          ts:       fmtTs(r.created_at),
          tsRaw:    r.created_at,
          type:     'edit',
          action:   'edit',
          changes:  [],
        };
        buckets.set(key, entry);
        out.push(entry);
      }
      entry.changes.push(mapEditChange(r));
    } else {
      out.push({
        user:     r.username || 'system',
        userRole: r.user_role || null,
        ts:       fmtTs(r.created_at),
        tsRaw:    r.created_at,
        type:     r.action,
        action:   r.action,
        changes:  synthesizeNonEditChanges(r),
        metadata: r.metadata || {},
      });
    }
  }
  return out;
}

/**
 * Fetch and shape the history for an order.
 *
 * Soft-fails: returns [] on any error. History is decorative on mobile
 * — a missing trail must not block the rest of the OrderDetailScreen.
 */
export async function loadOrderHistory(orderId: string, limit = 200): Promise<OrderHistoryEntry[]> {
  if (!orderId) return [];
  try {
    const res: any = await OrdersApi.history(orderId, limit);
    return shapeOrderHistoryRows(res?.rows || []);
  } catch (e) {
    console.warn('[orderHistoryService] history load failed:', (e as any)?.message);
    return [];
  }
}

/**
 * TMS bug #1 mobile parity: ask the backend to record a cleared_at
 * marker so subsequent loadOrderHistory calls return only rows newer
 * than the marker. Resolves with the server's clearedAt ISO string.
 */
export async function clearOrderHistory(orderId: string): Promise<string> {
  if (!orderId) throw new Error('orderId is required');
  const res: any = await OrdersApi.clearHistory(orderId);
  return res?.clearedAt || new Date().toISOString();
}
