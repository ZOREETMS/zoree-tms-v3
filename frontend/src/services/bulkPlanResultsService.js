// ─────────────────────────────────────────────────────────────────────────────
// Bulk Plan Results service (REQ-28)
//
// Pure logic for turning a bulk-plan outcome into:
//   1. A normalised `results` object the UI can render as a pass/fail table.
//   2. A downloadable .xlsx workbook with two sheets: "Passed" and "Failed".
//
// This is a services-layer module (Rule 4). UI components import and call
// these functions; they never build their own export payloads inline.
//
// Dependencies
//   - xlsx (SheetJS Community Edition). Added to package.json.
// ─────────────────────────────────────────────────────────────────────────────

import * as XLSX from "xlsx";
// Shape + enum come from types/ (Rule 5). Human-readable strings + category
// grouping stay in the services-layer catalog.
import { FAILURE_CODES, makeFailure } from "../types/planningFailure";
import {
  describeFailure,
  failureCategory,
} from "./planningFailureCatalog";

/**
 * Turn raw bulk-plan output into a two-sheet-ready shape.
 *
 * @param {object}   opts
 * @param {object[]} opts.selectedOrders   — orders the user clicked Plan on.
 * @param {object[]} opts.plans            — plan payloads that reached the backend (one per shipment).
 * @param {object[]} opts.shipments        — shipments the backend actually created.
 * @param {object[]} opts.failures         — failure records from ordersService.bulkPlanOrders (pre-backend drops).
 * @param {object[]} opts.backendErrors    — errors returned from BulkPlanApi.execute (post-backend drops).
 * @returns {{
 *   passedRows: Array<object>,
 *   failedRows: Array<object>,
 *   passedCount: number,
 *   failedCount: number,
 * }}
 */
export function buildBulkPlanResults({
  selectedOrders = [],
  plans = [],
  shipments = [],
  failures = [],
  backendErrors = [],
} = {}) {
  // 1. Map shipment → plan → orderIds so we know which orders actually passed.
  const shipmentByOrder = new Map(); // orderId -> shipment
  for (const sh of shipments) {
    const ids = Array.isArray(sh.order_ids) ? sh.order_ids : [];
    for (const oid of ids) shipmentByOrder.set(oid, sh);
  }

  const passedOrderIds = new Set(shipmentByOrder.keys());

  // 2. Pre-backend failures (from the planning engine) are already shaped
  //    as { orderId, code, details }. Keep them as-is.
  const failureByOrder = new Map();
  for (const f of failures) {
    if (!f || !f.orderId) continue;
    failureByOrder.set(f.orderId, f);
  }

  // 3. Post-backend errors: map a shipment-level error back to the orderIds
  //    that were on that plan. Only do this for orders that didn't end up
  //    on a successful shipment.
  for (const err of backendErrors) {
    if (!err) continue;
    const plan = plans.find((p) =>
      (err.shipId && p.shipmentId === err.shipId) ||
      (err.lane && p.laneKey === err.lane)
    );
    const orderIds = plan ? (plan.orderIds || []) : [];
    for (const oid of orderIds) {
      if (passedOrderIds.has(oid)) continue; // survived on a different shipment
      if (failureByOrder.has(oid)) continue; // already have a richer reason
      failureByOrder.set(oid, makeFailure(oid, FAILURE_CODES.BACKEND_INSERT_FAILED, err.error || ""));
    }
  }

  // 4. Any order the user selected but we have no record of — mark UNKNOWN.
  for (const o of selectedOrders) {
    if (!o || !o.id) continue;
    if (passedOrderIds.has(o.id)) continue;
    if (failureByOrder.has(o.id)) continue;
    failureByOrder.set(o.id, makeFailure(o.id, FAILURE_CODES.UNKNOWN));
  }

  // 5. Build display rows. Keep column shape stable — the Excel export
  //    reads the same rows.
  const orderIndex = new Map(selectedOrders.map((o) => [o.id, o]));

  const passedRows = [];
  for (const [orderId, sh] of shipmentByOrder.entries()) {
    const o = orderIndex.get(orderId) || {};
    passedRows.push({
      order_id:      orderId,
      customer:      o.customer || "",
      origin:        o.origin || "",
      destination:   o.dest || "",
      weight:        o.weight || "",
      shipment_id:   sh.id || "",
      carrier:       sh.carrier || "",
      mode:          sh.mode || "",
      total_cost:    sh.total_cost || 0,
      pickup_date:   sh.pickup_date || "",
      delivery_date: sh.delivery_date || "",
    });
  }

  const failedRows = [];
  for (const [orderId, f] of failureByOrder.entries()) {
    const o = orderIndex.get(orderId) || {};
    failedRows.push({
      order_id:      orderId,
      customer:      o.customer || "",
      origin:        o.origin || "",
      destination:   o.dest || "",
      weight:        o.weight || "",
      ready:         o.ready || "",
      due:           o.due || "",
      failure_category: failureCategory(f.code),
      failure_code:     f.code,
      reason:           describeFailure(f),
    });
  }

  return {
    passedRows,
    failedRows,
    passedCount: passedRows.length,
    failedCount: failedRows.length,
  };
}

/** Short filename like "bulk-plan-results-2026-04-20-143215.xlsx". */
function buildFilename(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const y = now.getFullYear();
  const m = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const hh = pad(now.getHours());
  const mm = pad(now.getMinutes());
  const ss = pad(now.getSeconds());
  return `bulk-plan-results-${y}-${m}-${d}-${hh}${mm}${ss}.xlsx`;
}

/**
 * Build a .xlsx workbook and trigger a browser download.
 *
 * @param {ReturnType<typeof buildBulkPlanResults>} results
 */
export function downloadBulkPlanResults(results) {
  if (!results) return;
  const wb = XLSX.utils.book_new();

  const passedSheet = XLSX.utils.json_to_sheet(
    results.passedRows.length ? results.passedRows : [{ order_id: "(none)" }]
  );
  const failedSheet = XLSX.utils.json_to_sheet(
    results.failedRows.length ? results.failedRows : [{ order_id: "(none)" }]
  );

  XLSX.utils.book_append_sheet(wb, passedSheet, `Passed (${results.passedCount})`);
  XLSX.utils.book_append_sheet(wb, failedSheet, `Failed (${results.failedCount})`);

  XLSX.writeFile(wb, buildFilename());
}
