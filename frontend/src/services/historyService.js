// ═══════════════════════════════════════════════════════════════════
// History Service — REQ-02.
// Fetches change_history rows from the backend and maps them into the
// shape OrderDetailModal's History tab already consumes:
//
//   [
//     { user, ts, type, changes: [ { label, old, new } ] },
//     ...
//   ]
//
// where `type` is one of: plan | unassign | create | delete | tender |
// status | edit (default). Rows with action='edit' that share the same
// (entity, user, timestamp-to-the-second) are grouped into one
// change-set, so the UI shows "3 fields changed" instead of three
// separate rows.
// ═══════════════════════════════════════════════════════════════════

import { OrdersApi, ShipmentsApi } from "../lib/api";

// Human-friendly labels for DB column names that appear as `field`.
const FIELD_LABELS = {
  customer: "Customer",
  origin: "Origin",
  dest: "Destination",
  weight: "Weight",
  pieces: "Pieces",
  ship_mode: "Ship Mode",
  commodity: "Commodity",
  incoterms: "Incoterms",
  ref_num: "Ref #",
  po_num: "PO #",
  po_number: "PO #",
  ready: "Ready Date",
  due: "Due Date",
  status: "Status",
  shipment_id: "Shipment",
  origin_zip: "Origin ZIP",
  dest_zip: "Destination ZIP",
  // REQ-24: human-friendly labels for the dedicated Location Name columns.
  ship_from_name: "Ship From Name",
  ship_to_name: "Ship To Name",
  hazmat: "Hazmat",
  preferred_carrier: "Preferred Carrier",
  excluded_carrier: "Excluded Carrier",
  no_consolidate: "No Consolidate",
  dedicated_equip: "Dedicated Equipment",
  no_contract_rate: "Spot Rate",
  notes: "Notes",
  // REQ-02: line-item edits go through the dedicated /orders/:id/lines
  // endpoint and are recorded with field='line_<N>' and the cascading
  // parent-order totals as line_count.
  line_count: "Line Count",
};

function prettyLabel(field) {
  if (!field) return "—";
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  // REQ-02: 'line_<N>' → 'Line <N>' for the line-items audit rows.
  const lineMatch = /^line_(\d+)$/.exec(field);
  if (lineMatch) return `Line ${lineMatch[1]}`;
  return field
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function fmtTs(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: "numeric", month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch (_) { return iso; }
}

function bucketKey(row) {
  // Group rows into a change-set by (action, user, timestamp to the second).
  const sec = (row.created_at || "").replace(/\.\d+/, "").replace(/Z$/, "");
  return `${row.action}|${row.username || ""}|${sec}`;
}

function mapEditChange(row) {
  return {
    label: prettyLabel(row.field),
    old: row.old_value ?? "",
    new: row.new_value ?? "",
  };
}

function synthesizeNonEditChanges(row) {
  // For actions that don't correspond to a per-field edit, show a single
  // synthetic "change" row so the UI has something to render.
  const md = row.metadata || {};
  switch (row.action) {
    case "plan":
      return [{ label: "Shipment", old: "—", new: md.shipmentId || row.new_value || "Planned" }];
    case "unassign":
      return [{ label: "Shipment", old: md.previousShipmentId || row.old_value || "—", new: "—" }];
    case "create":
      return [{ label: "Order", old: "—", new: "Created" }];
    case "delete":
      return [{ label: "Order", old: "Existed", new: "Deleted" }];
    case "tender":
      return [{ label: "Carrier", old: "—", new: md.carrier || md.to || "Tendered" }];
    case "status":
      return [{ label: prettyLabel(row.field || "status"), old: row.old_value ?? "—", new: row.new_value ?? "—" }];
    default:
      return [{ label: prettyLabel(row.field || row.action), old: row.old_value ?? "—", new: row.new_value ?? "—" }];
  }
}

/**
 * Shape backend rows into the History-tab format. Preserves chronological
 * order as received (newest first per the API's default sort).
 */
export function shapeHistoryRows(rows) {
  const out = [];
  const buckets = new Map();

  for (const r of rows || []) {
    const key = bucketKey(r);
    if (r.action === "edit") {
      if (!buckets.has(key)) {
        const entry = {
          user: r.username || "system",
          userRole: r.user_role || null,
          ts: fmtTs(r.created_at),
          tsRaw: r.created_at,
          type: "edit",
          action: "edit",
          changes: [],
        };
        buckets.set(key, entry);
        out.push(entry);
      }
      buckets.get(key).changes.push(mapEditChange(r));
    } else {
      out.push({
        user: r.username || "system",
        userRole: r.user_role || null,
        ts: fmtTs(r.created_at),
        tsRaw: r.created_at,
        type: r.action,           // the UI special-cases 'plan' and 'unassign'
        action: r.action,
        changes: synthesizeNonEditChanges(r),
        metadata: r.metadata || {},
      });
    }
  }
  return out;
}

/**
 * Fetch and shape the history for an order.
 * @param {string} orderId
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<Array>}
 */
export async function getOrderHistory(orderId, opts = {}) {
  if (!orderId) return [];
  try {
    const res = await OrdersApi.history(orderId, opts.limit || 200);
    return shapeHistoryRows(res?.rows || []);
  } catch (e) {
    console.error("[historyService] getOrderHistory failed:", e.message);
    return [];
  }
}

/**
 * Fetch and shape the history for a shipment.
 * @param {string} shipmentId
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<Array>}
 */
export async function getShipmentHistory(shipmentId, opts = {}) {
  if (!shipmentId) return [];
  try {
    const res = await ShipmentsApi.history(shipmentId, opts.limit || 200);
    return shapeHistoryRows(res?.rows || []);
  } catch (e) {
    console.error("[historyService] getShipmentHistory failed:", e.message);
    return [];
  }
}
