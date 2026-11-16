// Bulk plan · planner-selected orders. Pure validation for the order IDs the
// Orders screen hands to Jev ("Plan with Jev"): cleans the ID list, keeps only
// plannable orders, and groups them by lane, because orders only share a truck
// and a contract rate within one lane; Jev then chooses a plan per lane.
// No DB/HTTP here so it can be unit-tested in isolation.
'use strict';

const MAX_SELECTED = 50;
const PLANNABLE_STATUSES = new Set(['unplanned', 'planning failed']);

// status 400: the planner's selection is the problem, not the server.
class SelectionError extends Error {
  constructor(message) { super(message); this.name = 'SelectionError'; this.status = 400; }
}

const norm = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').toUpperCase();

// "COLLEGE PARK, GA 30337" -> "COLLEGE PARK"
function cityOf(location) { return String(location ?? '').split(',')[0].trim(); }

// Accepts an array or a comma-separated string. Returns null when nothing was
// selected, which means "use the default demo lane".
function cleanOrderIds(raw) {
  if (raw == null || raw === '') return null;
  const list = Array.isArray(raw) ? raw : String(raw).split(',');
  const ids = [...new Set(list.map((x) => String(x ?? '').trim()).filter(Boolean))];
  if (!ids.length) return null;
  if (ids.length > MAX_SELECTED) throw new SelectionError(`Select at most ${MAX_SELECTED} orders for a Jev plan (${ids.length} selected).`);
  return ids;
}

// rows: order rows fetched for the selected IDs.
// Returns { groups: [{ origin, dest, orders }], skipped } with one group per
// lane (largest first, orders by due date); throws SelectionError when no
// selected order can be planned.
function resolveSelection(orderIds, rows) {
  const byId = new Map((rows || []).map((r) => [String(r.id), r]));
  const skipped = [];
  const orders = [];
  for (const id of orderIds) {
    const o = byId.get(String(id));
    if (!o) { skipped.push({ id, reason: 'Order not found' }); continue; }
    if (!PLANNABLE_STATUSES.has(norm(o.status).toLowerCase())) { skipped.push({ id, reason: `Status is ${o.status || 'blank'}, not Unplanned` }); continue; }
    if (!(Number(o.weight) > 0)) { skipped.push({ id, reason: 'No weight on the order' }); continue; }
    if (!cityOf(o.origin) || !cityOf(o.dest)) { skipped.push({ id, reason: 'Origin or destination is blank' }); continue; }
    orders.push({ ...o, weight: Number(o.weight) });
  }
  if (!orders.length) {
    throw new SelectionError(`None of the selected orders can be planned: ${skipped.map((s) => `${s.id} (${s.reason})`).join('; ')}`);
  }
  const lanes = new Map();
  for (const o of orders) {
    const key = `${norm(o.origin)} -> ${norm(o.dest)}`;
    if (!lanes.has(key)) lanes.set(key, { origin: o.origin, dest: o.dest, orders: [] });
    lanes.get(key).orders.push(o);
  }
  const groups = [...lanes.values()];
  for (const g of groups) g.orders.sort((x, y) => String(x.due || '').localeCompare(String(y.due || '')));
  groups.sort((x, y) => y.orders.length - x.orders.length);
  return { groups, skipped };
}

module.exports = { MAX_SELECTED, SelectionError, cleanOrderIds, resolveSelection, cityOf };
