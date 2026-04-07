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
  async saveCarrier(carrier) {
    if (carrier?.id) return this.patch("carriers", carrier.id, carrier);
    return this.upsert("carriers", carrier);
  },
};

export const OrdersApi = {
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

export const InvoicesApi = {
  list() {
    return api("/db/invoices?q=select=*%26order=created_at.desc%26limit=500");
  },
  save(invoice) {
    if (invoice.id) return api(`/db/invoices/${encodeURIComponent(invoice.id)}`, { method: "PATCH", body: JSON.stringify(invoice) });
    return api("/db/invoices", { method: "POST", body: JSON.stringify(invoice) });
  },
  remove(id) {
    return api(`/db/invoices/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  approve(id) {
    return api(`/db/invoices/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ status: "Approved" }) });
  },
  dispute(id) {
    return api(`/db/invoices/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ status: "Disputed" }) });
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
  rate(lanes, optimizeBy = "cost") {
    return api("/bulk-plan/rate", {
      method: "POST",
      body: JSON.stringify({ lanes, optimizeBy }),
    });
  },
  execute(plans) {
    return api("/bulk-plan/execute", {
      method: "POST",
      body: JSON.stringify({ plans }),
    });
  },
};
