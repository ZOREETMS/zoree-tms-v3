const API_BASE =
  import.meta.env.VITE_API_BASE ||
  window.ZOREE_API_URL ||
  "http://localhost:3001/api";

function token() {
  return localStorage.getItem("zoree_token") || "";
}

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
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
    return api("/db/orders?q=select=*%26order=created_at.desc%26limit=500");
  },
  shipments() {
    return api("/db/shipments?q=select=*%26order=created_at.desc%26limit=500");
  },
  carriers() {
    return api("/db/carriers?q=select=*%26order=name.asc%26limit=500");
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

export const TenderApi = {
  sendEmail(payload) {
    return api("/tender/email", {
      method: "POST",
      body: JSON.stringify(payload),
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
