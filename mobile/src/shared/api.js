/**
 * Portable API client for Zoree TMS.
 * Works in both web (localStorage) and React Native (AsyncStorage)
 * by accepting a storage adapter via configureApi().
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

/**
 * QA bug #59 ("Invalid or expired token") fix:
 * Hook for callers (AuthContext) to register a token-refresh routine.
 * When api() sees a 401 and a refresher is registered, it tries to
 * refresh once and retries the request. Without a refresher, behaviour
 * is unchanged (throws as before).
 */
let _onUnauthorized = null;
export function configureAuthHooks({ onUnauthorized }) {
  _onUnauthorized = typeof onUnauthorized === "function" ? onUnauthorized : null;
}

/**
 * QA bug #90 ("Network request failed" on order save) fix:
 * Naked fetch on iOS / RN throws a TypeError("Network request failed")
 * the moment the app loses network for a few hundred ms — even if
 * connectivity comes back immediately. The user sees the failure with
 * no recourse. We now:
 *
 *   - Cap each request at 15s via AbortController so a hung connection
 *     fails fast instead of locking the form spinner forever.
 *   - Retry once on transient network errors (fetch threw OR HTTP 502 /
 *     503 / 504). One retry is enough to cover the common case
 *     (cellular hand-off, LTE blip) without doubling load on real
 *     outages.
 *   - Surface a friendlier error message ("Cannot reach server. Check
 *     your connection and try again.") so callers don't have to parse
 *     fetch's opaque TypeError.
 *
 * Auth refresh path (#59) is preserved unchanged.
 */
const REQUEST_TIMEOUT_MS = 15000;
const TRANSIENT_HTTP_STATUSES = new Set([502, 503, 504]);

function isTransientFetchError(err) {
  if (!err) return false;
  const msg = String(err.message || err).toLowerCase();
  // RN / iOS / Android each phrase the offline error slightly
  // differently — treat any of these as retryable.
  return (
    msg.includes("network request failed") ||
    msg.includes("failed to fetch") ||
    msg.includes("network error") ||
    msg.includes("typeerror") ||
    err.name === "AbortError"
  );
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function api(path, options = {}) {
  const t = typeof token === "function" ? token() : "";
  const authToken = t instanceof Promise ? await t : t;

  const send = async (bearer) =>
    fetchWithTimeout(
      `${_apiBase}${path}`,
      {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
          ...(options.headers || {}),
        },
      },
      REQUEST_TIMEOUT_MS,
    );

  // First attempt. If fetch itself throws (offline) we fall through to
  // the retry block. HTTP errors (4xx/5xx) come back as a Response and
  // are handled below.
  let res;
  let firstErr = null;
  try {
    res = await send(authToken);
  } catch (err) {
    firstErr = err;
  }

  // Transient retry: one retry on network throw OR a 5xx that's
  // typically caused by an upstream blip. Keeps real 4xx errors
  // (validation, auth) on the fast path — those don't get retried.
  if (
    (firstErr && isTransientFetchError(firstErr)) ||
    (res && TRANSIENT_HTTP_STATUSES.has(res.status))
  ) {
    try {
      res = await send(authToken);
      firstErr = null;
    } catch (retryErr) {
      firstErr = retryErr;
    }
  }

  if (firstErr) {
    // Surface a human-readable error instead of "TypeError: Network
    // request failed". Callers (OrderFormScreen, etc.) already pass
    // err.message into Alert.alert, so this is what the user sees.
    if (isTransientFetchError(firstErr)) {
      throw new Error("Cannot reach server. Check your connection and try again.");
    }
    throw firstErr;
  }

  // 401 = expired/invalid token. Try a one-shot refresh through the
  // registered hook; if it returns a fresh token, retry once.
  if (res.status === 401 && _onUnauthorized && !options._didRetry) {
    try {
      const fresh = await _onUnauthorized();
      if (fresh && typeof fresh === "string") {
        res = await send(fresh);
      }
    } catch {
      // Treat refresh errors as a refresh-miss; original 401 surfaces below.
    }
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
    return api("/orders").then((res) => res.orders || []);
  },
  shipments() {
    return api("/db/shipments?q=select=*%26order=created_at.desc%26limit=500");
  },
  carriers() {
    return api("/db/carriers?q=select=*%26order=name.asc%26limit=500");
  },
  /**
   * QA bug #113 — Customer dropdown on the mobile New Order form was
   * sourced solely from distinct customer names on existing orders, so
   * it surfaced only ~3 entries while the web pulled the full
   * `oms_customers` master. We now expose the OMS customer master here
   * and merge it into the dropdown options upstream
   * (services/optionsService.customerOptions). `active=true` matches the
   * filter the OMS app itself applies in zoree-oms.html so deactivated
   * customers don't return.
   *
   * Returns [] on error rather than throwing — the caller (DataContext)
   * already wraps with .catch(()=>[]) for graceful fallback to
   * order-derived customers, but failing soft here means the rest of the
   * Promise.all batch isn't poisoned by a single endpoint that 4xx's.
   */
  customers() {
    return api(
      "/db/oms_customers?q=select=id,name,active%26active=eq.true%26order=name.asc%26limit=500",
    );
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
  planningParameters() {
    return api("/db/planning_parameters?q=select=*%26order=label.asc%26limit=200");
  },
  dockLoadingDurations() {
    return api("/db/dock_loading_durations?q=select=*%26order=mode.asc%26limit=50");
  },
  dockAppointments(date) {
    const filter = date ? `%26date=eq.${encodeURIComponent(date)}` : '';
    return api(`/db/dock_appointments?q=select=*${filter}%26order=date.asc,start.asc%26limit=200`);
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
  create(payload) {
    return api("/orders", {
      method: "POST",
      body: JSON.stringify(payload || {}),
    });
  },
  update(id, patch) {
    return api(`/orders/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch || {}),
    });
  },
  /**
   * QA bug #121 — mobile Order Detail had no Delete action, so users had
   * to bounce to the web to remove a wrongly-created order. The backend
   * exposes DELETE /api/orders/:id (added alongside this fix); it
   * cascades through the audit trail (REQ-02) and unassigns any linked
   * shipment via the same `cleanupOrphanShipmentAfterUnassign` helper
   * already used by status-change paths.
   *
   * Service-layer callers should prefer `services/ordersService.deleteOrder`
   * which adds confirmation framing — this raw method exists so
   * future bulk-action UIs (web parity) can drive the endpoint directly.
   */
  remove(id) {
    return api(`/orders/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
};

/**
 * Service-layer shipments client. Prefer this over DbApi.upsert/patch/
 * remove for shipments. Mobile-bug 57 + 63 fixes routed through here.
 */
export const ShipmentsApi = {
  list(params = {}) {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
    return api(`/shipments${qs ? `?${qs}` : ""}`);
  },
  get(id) {
    return api(`/shipments/${encodeURIComponent(id)}`);
  },
  create(payload) {
    return api("/shipments", {
      method: "POST",
      body: JSON.stringify(payload || {}),
    });
  },
  update(id, patch) {
    return api(`/shipments/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch || {}),
    });
  },
  /** QA bug #63: status update via /:id/status (validated server-side). */
  updateStatus(id, status) {
    return api(`/shipments/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
  },
  /** QA bug #57: cascade-aware delete (server unassigns linked orders). */
  remove(id) {
    return api(`/shipments/${encodeURIComponent(id)}`, { method: "DELETE" });
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

// QA #131: the previous mobile invoice save POSTed the camelCase form
// shape ({ num, shipId, paymentTerms, amount, agreed, date, due, … })
// straight to /api/db/invoices, but the DB columns are
// invoice_number / shipment_id / payment_terms / invoiced_amount /
// agreed_cost / invoice_date / due_date. PostgREST returned 400
// "DB upset" because none of the camelCase keys exist as columns.
//
// Fix: route NEW invoices through /api/invoices (the audit-aware
// endpoint that already accepts the camelCase contract and runs the
// REQ-06 tolerance decision), and translate edit-shape PATCHes to
// snake_case before they hit /api/db/invoices/:id.
export function mapInvoiceFormToCreatePayload(form) {
  return {
    invoiceNumber:   form.num || form.invoiceNumber,
    carrier:         form.carrier,
    carrierId:       form.carrierId || null,
    shipmentId:      form.shipId || form.shipmentId || null,
    // Mobile collects extraShipIds as a comma-separated string ("SHP-1, SHP-2").
    // /api/invoices wants a string[] (shipmentIds). Split + trim defensively.
    shipmentIds: (() => {
      if (Array.isArray(form.shipmentIds)) return form.shipmentIds;
      const all = [form.shipId, form.extraShipIds]
        .filter(Boolean)
        .join(",")
        .split(",")
        .map((s) => String(s).trim())
        .filter(Boolean);
      return all.length > 1 ? all : undefined;
    })(),
    invoicedAmount:  parseFloat(form.amount) || 0,
    invoiceDate:     form.date || null,
    paymentTerms:    form.paymentTerms || "NET30",
    notes:           form.notes || null,
    metadata:        form.metadata || {},
  };
}

export function mapInvoiceFormToEditPatch(form) {
  // Edit path goes through /api/db/invoices/:id which is a passthrough
  // to PostgREST — keys MUST match the column names.
  const patch = {};
  if (form.num != null)          patch.invoice_number  = form.num;
  if (form.carrier != null)      patch.carrier         = form.carrier;
  if (form.shipId != null)       patch.shipment_id     = form.shipId || null;
  if (form.status != null)       patch.status          = form.status;
  if (form.date != null)         patch.invoice_date    = form.date || null;
  if (form.due != null)          patch.due_date        = form.due || null;
  if (form.paymentTerms != null) patch.payment_terms   = form.paymentTerms;
  if (form.amount != null)       patch.invoiced_amount = parseFloat(form.amount) || 0;
  if (form.agreed != null)       patch.agreed_cost     = form.agreed === "" ? null : parseFloat(form.agreed);
  if (form.notes != null)        patch.notes           = form.notes || null;
  return patch;
}

export const InvoicesApi = {
  list() {
    return api("/db/invoices?q=select=*%26order=created_at.desc%26limit=500");
  },
  async save(invoice) {
    if (invoice.id) {
      const patch = mapInvoiceFormToEditPatch(invoice);
      return api(`/db/invoices/${encodeURIComponent(invoice.id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
    }
    // /api/invoices returns { invoice, decision }. Unwrap to the row so
    // the saveInvoice() contract stays "returns the saved invoice".
    const res = await api("/invoices", {
      method: "POST",
      body: JSON.stringify(mapInvoiceFormToCreatePayload(invoice)),
    });
    return res?.invoice || res;
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
