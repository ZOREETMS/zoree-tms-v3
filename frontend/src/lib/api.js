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

async function api(path, options = {}, _retried = false) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      ...(options.headers || {}),
    },
  });
  // Auto-refresh on 401 and retry once
  if (res.status === 401 && !_retried && !path.includes("/auth/")) {
    const refreshed = await tryRefreshToken();
    if (refreshed) return api(path, options, true);
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
};

export const DbApi = {
  orders() {
    return api("/db/orders?q=select=*%26order=created_at.desc%26limit=500");
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
  // REQ-02: fetch change_history rows for a given shipment.
  history(id, limit = 200) {
    return api(`/shipments/${encodeURIComponent(id)}/history?limit=${limit}`);
  },
  // REQ-03: manually attach an order to a shipment. Backend recalculates
  // weight, pieces, and total_cost (proportional to weight).
  addOrder(shipmentId, orderId) {
    return api(`/shipments/${encodeURIComponent(shipmentId)}/add-order`, {
      method: "POST",
      body: JSON.stringify({ orderId }),
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
  // Back-compat wrappers
  dispute(id, reason) { return InvoicesApi.reject(id, reason || "Disputed"); },
  save(invoice) {
    if (invoice.id) {
      // Legacy patch path — kept for any editing UX that still uses it.
      return api(`/db/invoices/${encodeURIComponent(invoice.id)}`, { method: "PATCH", body: JSON.stringify(invoice) });
    }
    return InvoicesApi.submit(invoice);
  },
  remove(id) {
    return api(`/db/invoices/${encodeURIComponent(id)}`, { method: "DELETE" });
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
