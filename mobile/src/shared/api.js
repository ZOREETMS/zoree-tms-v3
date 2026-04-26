/**
 * Portable API client for Zoree TMS.
 * Works in both web (localStorage) and React Native (AsyncStorage)
 * by accepting a storage adapter via `configureApi()`.
 */

let _storage = {
  getItem: (key) => null,
  setItem: (key, value) => {},
  removeItem: (key) => {},
};

let _apiBase = "http://localhost:3001/api";

/**
 * Configure the API client with platform-specific storage and base URL.
 * Must be called before any API calls.
 */
export function configureApi({ storage, apiBase }) {
  if (storage) _storage = storage;
  if (apiBase) _apiBase = normalizeApiBase(apiBase);
}

function normalizeApiBase(raw) {
  let b = String(raw || "").trim();
  if (!b) b = "http://localhost:3001";
  b = b.replace(/\/+$/, "").replace(/\/api$/i, "");
  return `${b}/api`;
}

function token() {
  return _storage.getItem("zoree_token") || "";
}

async function api(path, options = {}) {
  const t = typeof token === "function" ? token() : "";
  const authToken = t instanceof Promise ? await t : t;

  const res = await fetch(`${_apiBase}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(options.headers || {}),
    },
  });
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
    return api("/orders").then((res) => res.orders || []);
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
  documents() {
    return api("/db/documents?q=select=*%26order=generated.desc%26limit=500");
  },
  equipmentTypes() {
    return api("/db/equipment_types?q=select=*%26order=name.asc%26limit=200");
  },
  vehicles() {
    return api("/db/vehicles?q=select=*%26order=unit.asc%26limit=500");
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
    if (invoice.id)
      return api(`/db/invoices/${encodeURIComponent(invoice.id)}`, {
        method: "PATCH",
        body: JSON.stringify(invoice),
      });
    return api("/db/invoices", {
      method: "POST",
      body: JSON.stringify(invoice),
    });
  },
  remove(id) {
    return api(`/db/invoices/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  approve(id) {
    return api(`/db/invoices/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "Approved" }),
    });
  },
  dispute(id) {
    return api(`/db/invoices/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "Disputed" }),
    });
  },
};

export const MileageApi = {
  get(origin, dest) {
    return api(
      `/mileage?origin=${encodeURIComponent(origin)}&dest=${encodeURIComponent(dest)}`
    );
  },
  bulk(pairs) {
    return api("/mileage/bulk", {
      method: "POST",
      body: JSON.stringify({ pairs }),
    });
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
