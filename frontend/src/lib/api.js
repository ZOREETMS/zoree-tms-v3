/** Same idea as legacy `zoreeApiOrigin() + '/api'` in test/index.html — always end with exactly one `/api`. */
function normalizeApiBase(raw) {
  let b = String(raw || "").trim();
  if (!b) b = "http://localhost:3001";
  b = b.replace(/\/+$/, "").replace(/\/api$/i, "");
  return `${b}/api`;
}

const API_BASE = normalizeApiBase(
  import.meta.env.VITE_API_BASE || window.ZOREE_API_URL || "http://localhost:3001/api"
);

function token() {
  return localStorage.getItem("zoree_token") || "";
}

let _refreshing = null;
async function tryRefreshToken() {
  if (_refreshing) return _refreshing;
  const rt = localStorage.getItem("zoree_refresh_token");
  if (!rt) return false;
  _refreshing = fetch(`${API_BASE}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: rt }),
  })
    .then(async (r) => {
      if (!r.ok) return false;
      const d = await r.json();
      if (d.token) {
        localStorage.setItem("zoree_token", d.token);
        if (d.refreshToken) localStorage.setItem("zoree_refresh_token", d.refreshToken);
        return true;
      }
      return false;
    })
    .catch(() => false)
    .finally(() => { _refreshing = null; });
  return _refreshing;
}

// Session-expired signal. Fired exactly once per "user is no longer
// authenticated" event (token missing/expired AND refresh failed) so
// AuthContext can drop the user and App re-renders LoginPage. Without
// this, a stale token surfaces as "Missing Authorization header" inside
// whichever feature modal happened to make the call (Plan, Tender, …).
// The thrown SessionExpiredError is a marker — callers don't need to
// special-case it; they just won't see it because the UI has already
// switched to the login screen by the time the rejection propagates.
let _sessionExpiredFired = false;
export class SessionExpiredError extends Error {
  constructor() { super("Session expired"); this.name = "SessionExpiredError"; this.code = "SESSION_EXPIRED"; }
}
function fireSessionExpired() {
  if (_sessionExpiredFired) return;
  _sessionExpiredFired = true;
  try {
    localStorage.removeItem("zoree_token");
    localStorage.removeItem("zoree_refresh_token");
    localStorage.removeItem("zoree_user");
  } catch (_) { /* storage disabled — listener will still re-render */ }
  try {
    window.dispatchEvent(new CustomEvent("zoree:session-expired"));
  } catch (_) { /* SSR / non-browser */ }
}
// Reset the latch when a fresh login succeeds so a later session
// expiry can fire again. AuthContext.login calls this after storing
// the new token.
export function resetSessionExpiredLatch() { _sessionExpiredFired = false; }

async function api(path, options = {}, _retried = false) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      ...(options.headers || {}),
    },
  });
  // Auto-refresh on 401 and retry once. /auth/* is exempt so a wrong
  // password during login doesn't get treated as a session expiry.
  if (res.status === 401 && !_retried && !path.includes("/auth/")) {
    const refreshed = await tryRefreshToken();
    if (refreshed) return api(path, options, true);
    // Refresh failed (no refresh token, or refresh token rejected) →
    // session is genuinely gone. Bounce to login instead of surfacing
    // "Missing Authorization header" inside a feature modal.
    fireSessionExpired();
    throw new SessionExpiredError();
  }
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text || `HTTP ${res.status}` };
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// REQ-08: extended auth API for multi-role switching.
export const AuthApiExt = {
  setActiveRole(activeRole) {
    return api("/auth/active-role", {
      method: "PATCH",
      body: JSON.stringify({ activeRole }),
    });
  },
};

// REQ-08: admin user-management API.
export const UsersApi = {
  list() {
    return api("/users");
  },
  create({ email, password, fullName, roles, activeRole }) {
    return api("/users", {
      method: "POST",
      body: JSON.stringify({ email, password, fullName, roles, activeRole }),
    });
  },
  update(id, patch) {
    return api(`/users/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },
  remove(id) {
    return api(`/users/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
};

// QA bug #261c: programmatic-access API keys. Admin-only on every
// endpoint. `create` returns the raw token exactly once in the
// response — the UI must capture it on screen because the server
// retains only a sha-256 hash.
export const ApiKeysApi = {
  list() {
    return api("/api-keys");
  },
  create({ name, role }) {
    return api("/api-keys", {
      method: "POST",
      body: JSON.stringify({ name, role }),
    });
  },
  revoke(id) {
    return api(`/api-keys/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
};

export const AuthApi = {
  login(email, password) {
    return api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },
  me() {
    return api("/auth/me");
  },
  roles() {
    return api("/roles");
  },
  updateRole(role, permissions) {
    return api(`/roles/${encodeURIComponent(role)}`, {
      method: "PATCH",
      body: JSON.stringify({ permissions }),
    });
  },
  createRole({ roleKey, displayName, description, defaultLevel } = {}) {
    return api("/roles", {
      method: "POST",
      body: JSON.stringify({ roleKey, displayName, description, defaultLevel }),
    });
  },
  deleteRole(role) {
    return api(`/roles/${encodeURIComponent(role)}`, {
      method: "DELETE",
    });
  },
};

export const DbApi = {
  orders() {
    return api("/db/orders?q=select=*%26order=created_at.desc%26limit=500");
  },
  // True row count for the orders table — paired with `orders()` above
  // because that call is hard-capped at 500 rows. Header chips, the
  // OrdersPage "All" status count, and Dashboard KPIs that need the
  // real total (not the page size) should call this instead of reading
  // `orders.length`. Returns just a number; backend endpoint:
  // GET /api/orders/count → { total }.
  ordersCount() {
    return api("/orders/count").then((r) => Number(r?.total) || 0);
  },
  shipments() {
    return api("/db/shipments?q=select=*%26order=created_at.desc%26limit=500");
  },
  carriers() {
    return api("/db/carriers?q=select=*%26order=name.asc%26limit=500");
  },
  lanePreferences() {
    return api("/db/lane_preferences?q=select=*%26order=id%26limit=200");
  },
  items() {
    return api("/db/items?q=select=*%26order=id.asc%26limit=500");
  },
  locations() {
    return api("/db/locations?q=select=*%26order=name.asc%26limit=500");
  },
  packagingUnits() {
    return api("/db/packaging_units?q=select=*%26order=id.asc%26limit=500");
  },
  rates() {
    return api("/db/rates?q=select=*%26order=lane%26limit=500");
  },
  drivers() {
    return api("/db/drivers?q=select=*%26order=name.asc%26limit=500");
  },
  invoices() {
    return api("/db/invoices?q=select=*%26order=created_at.desc%26limit=500");
  },
  routeTemplates() {
    return api("/db/route_templates?q=select=*%26order=created_at.desc%26limit=200");
  },
  equipmentTypes() {
    return api("/db/equipment_types?q=select=*%26order=name.asc%26limit=500");
  },
  planningParameters() {
    return api("/db/planning_parameters?q=select=*%26order=category.asc%26limit=100");
  },
  dockLoadingDurations() {
    return api("/db/dock_loading_durations?q=select=*%26order=mode.asc%26limit=50");
  },
  documents() {
    return api("/db/documents?q=select=*%26order=created_at.desc%26limit=500");
  },
  warehouseDockConfigs() {
    return api("/db/warehouse_dock_config?q=select=*%26order=warehouse.asc%26limit=200");
  },
  remove(table, id) {
    return api(`/db/${table}/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  upsert(table, payload) {
    return api(`/db/${table}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  patch(table, id, payload) {
    return api(`/db/${table}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  /**
   * Generic filtered read. `query` is the Supabase-style filter that
   * sits inside the `q=` param (e.g. "select=*&lane=eq.AVRT-CHI-DAL").
   * Service-layer callers should prefer domain-specific helpers, but
   * this escape hatch keeps one-off lookups out of the raw fetch layer
   * so the view never builds URLs itself (CLAUDE_RULES §4).
   */
  query(table, query) {
    const q = encodeURIComponent(query);
    return api(`/db/${table}?q=${q}`);
  },
  async saveCarrier(carrier) {
    if (carrier?.id) return this.patch("carriers", carrier.id, carrier);
    return this.upsert("carriers", carrier);
  },
};

// Migration 045: EIA fuel surcharge — per-carrier bracket schedules +
// the cached EIA U.S. On-Highway Diesel index. Backend: api/routes/fsc.js.
export const FscApi = {
  eiaCurrent(refresh = false) {
    return api(`/fsc/eia/current${refresh ? "?refresh=1" : ""}`);
  },
  eiaManual({ price, priceDate }) {
    return api("/fsc/eia/manual", {
      method: "POST",
      body: JSON.stringify({ price, priceDate }),
    });
  },
  getSchedule(carrierId) {
    return api(`/fsc/schedule/${encodeURIComponent(carrierId)}`);
  },
  saveSchedule(carrierId, brackets) {
    return api(`/fsc/schedule/${encodeURIComponent(carrierId)}`, {
      method: "PUT",
      body: JSON.stringify({ brackets }),
    });
  },
  deleteSchedule(carrierId) {
    return api(`/fsc/schedule/${encodeURIComponent(carrierId)}`, { method: "DELETE" });
  },
  preview(carrierId, linehaul) {
    return api(`/fsc/preview/${encodeURIComponent(carrierId)}?linehaul=${encodeURIComponent(linehaul || 0)}`);
  },
};

export const OrdersApi = {
  list() {
    return api("/orders");
  },
  get(id) {
    return api(`/orders/${encodeURIComponent(id)}`);
  },
  create(payload) {
    return api("/orders", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  update(id, payload) {
    return api(`/orders/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  remove(id) {
    return api(`/orders/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },
  full(id) {
    return api(`/orders/${encodeURIComponent(id)}/full`);
  },
  lines(id) {
    return api(`/orders/${encodeURIComponent(id)}/lines`);
  },
  saveLines(id, lines) {
    return api(`/orders/${encodeURIComponent(id)}/lines`, {
      method: "POST",
      body: JSON.stringify(lines),
    });
  },
  clearLines(id) {
    return api(`/orders/${encodeURIComponent(id)}/lines`, {
      method: "DELETE",
    });
  },
  // REQ-02: fetch change_history rows for a given order.
  history(id, limit = 200) {
    return api(`/orders/${encodeURIComponent(id)}/history?limit=${limit}`);
  },
  // TMS bug #1: persistent Clear History — records a cleared_at marker
  // server-side so subsequent history() calls only return rows newer
  // than the marker. The audit ledger is preserved.
  clearHistory(id) {
    return api(`/orders/${encodeURIComponent(id)}/history/clear`, {
      method: "POST",
    });
  },
};

export const ShipmentsApi = {
  // Create a shipment via the dedicated endpoint so the backend writes
  // the 'create' change_history row alongside the row insert. Manual
  // creates that previously went through DbApi.upsert("shipments", ...)
  // skipped the audit, leaving the Shipment Details timeline without a
  // real "Order Created" timestamp.
  create(payload) {
    return api("/shipments", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  remove(id) {
    return api(`/shipments/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  // Audited PATCH for shipment field updates. Goes through
  // /api/shipments/:id (shipService.updateShipment) so dock-field
  // changes write change_history rows and trigger the OMS dock mirror —
  // the previous DbApi.patch("shipments", ...) path skipped both.
  // Payload uses camelCase keys (dockDoor, dockTime, loadingStart,
  // loadingEnd, …) matching api/services/shipments.js mappers.
  update(id, payload) {
    return api(`/shipments/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload || {}),
    });
  },
  // REQ-02: fetch change_history rows for a given shipment.
  history(id, limit = 200) {
    return api(`/shipments/${encodeURIComponent(id)}/history?limit=${limit}`);
  },
  // TMS bug #1: persistent Clear History (shipment-side parity with OrdersApi).
  clearHistory(id) {
    return api(`/shipments/${encodeURIComponent(id)}/history/clear`, {
      method: "POST",
    });
  },
  // REQ-03: manually attach an order to a shipment. Backend recalculates
  // weight, pieces, and total_cost (proportional to weight).
  addOrder(shipmentId, orderId) {
    return api(`/shipments/${encodeURIComponent(shipmentId)}/add-order`, {
      method: "POST",
      body: JSON.stringify({ orderId }),
    });
  },
  // REQ-184/185/187: auto-create an invoice from this shipment. Backend
  // copies costs into invoice_cost_lines, sets status='On Hold', links
  // shipment_id + bol_ids, and writes the audit trail. Idempotent — if
  // the shipment already has an open invoice, the response carries the
  // existing one with `reused: true`.
  createInvoice(shipmentId) {
    return api(`/shipments/${encodeURIComponent(shipmentId)}/invoice`, {
      method: "POST",
    });
  },
  // Carrier (re)assignment for an existing shipment. Goes through the
  // dedicated endpoint so the backend writes change_history rows and
  // broadcasts SHIPMENT_UPDATED — the previous DbApi.patch("shipments",
  // ...) path skipped both, which left the Shipment Details modal showing
  // the previous carrier after a change.
  changeCarrier(shipmentId, payload) {
    return api(`/shipments/${encodeURIComponent(shipmentId)}/change-carrier`, {
      method: "POST",
      body: JSON.stringify(payload || {}),
    });
  },
  // Record a manual timeline event (Picked Up / Delivered / Exception / ...).
  // The backend transitions shipment + linked order status where applicable
  // and writes change_history rows on both sides.
  addEvent(shipmentId, { type, note, date }) {
    return api(`/shipments/${encodeURIComponent(shipmentId)}/events`, {
      method: "POST",
      body: JSON.stringify({ type, note, date }),
    });
  },
};

export const TenderApi = {
  sendEmail(payload) {
    return api("/tender/email", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
};

export const OmsApi = {
  push(payload) {
    return api("/oms/push", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
};

// MW Queue Worker admin API — surfaces the lifecycle of the backend
// queue drainer that ports zoree-middleware.html's processMWQueue. All
// endpoints are admin-only on the server side (see api/routes/mwQueueAdmin.js).
export const MwQueueApi = {
  status() {
    return api("/mw-queue/status");
  },
  start(intervalMs) {
    return api("/mw-queue/start", {
      method: "POST",
      body: JSON.stringify(intervalMs ? { intervalMs } : {}),
    });
  },
  stop() {
    return api("/mw-queue/stop", { method: "POST" });
  },
  runOnce() {
    return api("/mw-queue/run-once", { method: "POST" });
  },
};

// Thin wrapper around POST /api/notify → wsBroadcast on the server.
// Lets the services layer fan-out events to every connected TMS client
// and to external listeners (zoree-oms.html's OmsLive, Middleware) with
// no direct fetch() calls from UI components (CLAUDE_RULES §4).
export const NotifyApi = {
  broadcast(event, data) {
    return api("/notify", {
      method: "POST",
      body: JSON.stringify({ event, data: data || {} }),
    });
  },
};

// REQ-06: invoices now go through domain endpoints that run the tolerance
// decision server-side. The generic /db/invoices proxy is kept as a
// fallback for list reads (admin) but writes should use the new routes.
export const InvoicesApi = {
  // List via the domain endpoint (finance | admin gated)
  list(params = {}) {
    const qs = new URLSearchParams();
    if (params.status)   qs.set("status", params.status);
    if (params.carrier)  qs.set("carrier", params.carrier);
    if (params.shipment) qs.set("shipment", params.shipment);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return api(`/invoices${suffix}`);
  },
  // Submit a new invoice. Server runs the tolerance decision and
  // returns { invoice, decision: { status, sentToAp, reason, variance, variancePct, tolerance* } }
  submit(payload) {
    return api("/invoices", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  // REQ-184: run the carrier-tolerance check on an existing invoice.
  // Server compares sum(approved_cost) vs agreed_cost and returns
  // { invoice, decision: { status: Approved|Rejected, reason, variance,
  // variancePct, tolerancePct, toleranceAbs, sentToAp, ... } }.
  // Approved invoices are auto-sent to AP (mirrors submitInvoice).
  decide(id) {
    return api(`/invoices/${encodeURIComponent(id)}/decide`, {
      method: "POST",
    });
  },
  // Manual override — finance/admin can force Approved/Rejected regardless
  // of tolerance decision (e.g. accessorials or disputed adjustments).
  approve(id, reason) {
    return api(`/invoices/${encodeURIComponent(id)}/approve`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  },
  reject(id, reason) {
    return api(`/invoices/${encodeURIComponent(id)}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  },
  sendToAp(id) {
    return api(`/invoices/${encodeURIComponent(id)}/send-to-ap`, { method: "POST" });
  },
  // Bug #157: edit an existing invoice via the domain endpoint. Server
  // maps client camelCase field names → DB columns (the previous /db/*
  // passthrough required the UI to know that the column was agreed_cost,
  // not agreed_rate, and quietly 400'd otherwise).
  update(id, patch) {
    return api(`/invoices/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch || {}),
    });
  },
  // REQ-186: per-line cost breakdown. Each line has invoice_cost
  // (carrier-billed) and approved_cost (finance-approved). Edits are
  // recorded in the parent invoice's change_history.
  listCostLines(invoiceId) {
    return api(`/invoices/${encodeURIComponent(invoiceId)}/cost-lines`);
  },
  updateCostLine(invoiceId, lineId, patch) {
    return api(`/invoices/${encodeURIComponent(invoiceId)}/cost-lines/${encodeURIComponent(lineId)}`, {
      method: "PATCH",
      body: JSON.stringify(patch || {}),
    });
  },
  // QA 226 (2026-05-12): append a cost line to an existing invoice.
  // Backed by POST /api/invoices/:id/cost-lines.
  addCostLine(invoiceId, line) {
    return api(`/invoices/${encodeURIComponent(invoiceId)}/cost-lines`, {
      method: "POST",
      body: JSON.stringify(line || {}),
    });
  },
  // QA P215 (2026-05-11): one-shot create-from-shipment. Backed by
  // POST /api/invoices/from-shipment which delegates to
  // api/services/invoiceFromShipment (idempotent — returns
  // { invoice, costLines, reused: true } if an open invoice already
  // exists for the shipment). The web's "🧾 Invoice" button on
  // ShipmentsPage and the AI CREATE_INVOICE_FROM_SHIPMENT action
  // both route through this helper so the audit + cost-line
  // composition stays in one place.
  createFromShipment(shipmentId) {
    if (!shipmentId) {
      return Promise.reject(new Error("shipmentId is required"));
    }
    return api("/invoices/from-shipment", {
      method: "POST",
      body: JSON.stringify({ shipmentId }),
    });
  },
  // Back-compat wrappers
  dispute(id, reason) { return InvoicesApi.reject(id, reason || "Disputed"); },
  save(invoice) {
    if (invoice && invoice.id) {
      // Bug #157: route through the domain PATCH endpoint instead of the
      // generic /db/* passthrough. Strip `id` so it isn't echoed back as
      // an editable column.
      const { id, ...rest } = invoice;
      return InvoicesApi.update(id, rest);
    }
    return InvoicesApi.submit(invoice);
  },
  // REQ-192: route deletes through the domain endpoint so the audit
  // pipeline gets the 'delete' history row. The previous generic
  // /db/invoices DELETE path bypassed it.
  remove(id, reason) {
    return api(`/invoices/${encodeURIComponent(id)}`, {
      method: "DELETE",
      body: JSON.stringify({ reason: reason || undefined }),
    });
  },
};

export const MileageApi = {
  get(origin, dest) {
    return api(`/mileage?origin=${encodeURIComponent(origin)}&dest=${encodeURIComponent(dest)}`);
  },
  bulk(pairs) {
    return api("/mileage/bulk", {
      method: "POST",
      body: JSON.stringify({ pairs }),
    });
  },
};

export const RouteApi = {
  async executeRoute(masterShipment, childShipments, orderUpdates) {
    // 1. Create MBOL
    await api(`/db/shipments`, {
      method: "POST",
      body: JSON.stringify(masterShipment),
    });
    // 2. Create CBOLs
    for (const child of childShipments) {
      await api(`/db/shipments`, {
        method: "POST",
        body: JSON.stringify(child),
      });
    }
    // 3. Update orders with shipment assignments
    for (const update of orderUpdates) {
      await api(`/db/orders/${encodeURIComponent(update.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "Planned", shipment_id: update.shipment_id }),
      });
    }
    return { ok: true };
  },
};

export const BulkPlanApi = {
  rate(lanes, optimizeBy = "cost", options = {}) {
    const includeModes = Array.isArray(options.includeModes) ? options.includeModes : undefined;
    return api("/bulk-plan/rate", {
      method: "POST",
      body: JSON.stringify({ lanes, optimizeBy, ...(includeModes ? { includeModes } : {}) }),
    });
  },
  execute(plans) {
    return api("/bulk-plan/execute", {
      method: "POST",
      body: JSON.stringify({ plans }),
    });
  },
  // Bulk-create orders from a parsed CSV/XLSX upload. Backend route at
  // api/server.js → POST /api/bulk-plan/import. Each `orders[i]` requires
  // { customer, origin, destination } and accepts optional weight, pieces,
  // commodity, readyDate, dueDate. Server returns
  // { created, orders, errors } where errors is per-row.
  import(orders) {
    return api("/bulk-plan/import", {
      method: "POST",
      body: JSON.stringify({ orders }),
    });
  },
};

// REQ-29 / REQ-30 — location master search + create from order screens.
// All writes land on `oms_locations` (source of truth). The DB trigger
// propagates the row to TMS `locations` and records an audit entry in
// `mw_requests` (cmd='PUSH_LOCATION_TO_TMS').
export const LocationsApi = {
  /**
   * @param {string} q          — partial name or city
   * @param {"oms"|"tms"} source — which table to search
   * @param {number} [limit=20]
   * @returns {Promise<{locations: Array}>}
   */
  search(q, source = "oms", limit = 20) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    params.set("source", source);
    params.set("limit", String(limit));
    return api(`/locations/search?${params.toString()}`);
  },

  /**
   * Body: { id, name, type, address, city, state, zip, country, dockDoors, active }
   */
  create(input) {
    return api("/locations", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
};
