// ═══════════════════════════════════════════════════════════════════
// ZoreeTMS API Client — Tier 1 → Tier 2 bridge
// All HTTP calls go through here. Never call Supabase directly.
// Token + tenantId are injected automatically on every request.
// ═══════════════════════════════════════════════════════════════════

const API_BASE = window.ZOREE_API_URL || 'http://localhost:3001/api';

// ── Token management ──────────────────────────────────────────────
const Auth = {
  getToken:    ()        => sessionStorage.getItem('zoree_token'),
  setToken:    (token)   => sessionStorage.setItem('zoree_token', token),
  clearToken:  ()        => sessionStorage.removeItem('zoree_token'),
  getUser:     ()        => { try { return JSON.parse(sessionStorage.getItem('zoree_user')); } catch { return null; } },
  setUser:     (user)    => sessionStorage.setItem('zoree_user', JSON.stringify(user)),
  getTenant:   ()        => { try { return JSON.parse(sessionStorage.getItem('zoree_tenant')); } catch { return null; } },
  setTenant:   (tenant)  => sessionStorage.setItem('zoree_tenant', JSON.stringify(tenant)),
  isLoggedIn:  ()        => !!Auth.getToken(),
};

// ── Core fetch wrapper ────────────────────────────────────────────
async function apiFetch(method, path, body = null) {
  const token = Auth.getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // Handle auth expiry
  if (res.status === 401) {
    Auth.clearToken();
    window.dispatchEvent(new CustomEvent('zoree:session-expired'));
    throw new Error('Session expired — please sign in again');
  }

  // Handle feature gating
  if (res.status === 403) {
    const data = await res.json().catch(() => ({}));
    throw Object.assign(new Error(data.error || 'Access denied'), {
      upgradeRequired: data.upgradeRequired,
    });
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `API error ${res.status}`);
  }

  return res.status === 204 ? null : res.json();
}

// ── Auth API ──────────────────────────────────────────────────────
const AuthAPI = {
  async login(email, password, tenantId = 'zoree-default') {
    const data = await apiFetch('POST', '/auth/login', { email, password, tenantId });
    Auth.setToken(data.token);
    Auth.setUser(data.user);
    Auth.setTenant(data.tenant);
    // Apply tenant branding immediately
    TenantUI.apply(data.tenant);
    return data;
  },

  async logout() {
    try { await apiFetch('POST', '/auth/logout'); } catch {}
    Auth.clearToken();
    Auth.setUser(null);
    Auth.setTenant(null);
    window.location.reload();
  },

  async me() {
    return apiFetch('GET', '/auth/me');
  },
};

// ── Orders API ────────────────────────────────────────────────────
const OrdersAPI = {
  list:   (filters = {}) => apiFetch('GET', '/orders?' + new URLSearchParams(filters)),
  get:    (id)           => apiFetch('GET', `/orders/${id}`),
  create: (payload)      => apiFetch('POST', '/orders', payload),
  update: (id, updates)  => apiFetch('PATCH', `/orders/${id}`, updates),
  delete: (id)           => apiFetch('DELETE', `/orders/${id}`),
  lanes:  ()             => apiFetch('GET', '/orders/lanes/groups'),
};

// ── Shipments API ─────────────────────────────────────────────────
const ShipmentsAPI = {
  list:         (filters = {})     => apiFetch('GET', '/shipments?' + new URLSearchParams(filters)),
  get:          (id)               => apiFetch('GET', `/shipments/${id}`),
  create:       (payload)          => apiFetch('POST', '/shipments', payload),
  update:       (id, updates)      => apiFetch('PATCH', `/shipments/${id}`, updates),
  updateStatus: (id, status)       => apiFetch('PATCH', `/shipments/${id}/status`, { status }),
};

// ── Carriers API ──────────────────────────────────────────────────
const CarriersAPI = {
  list:   ()        => apiFetch('GET', '/carriers'),
  create: (payload) => apiFetch('POST', '/carriers', payload),
  delete: (id)      => apiFetch('DELETE', `/carriers/${id}`),
};

// ── Rates API ─────────────────────────────────────────────────────
const RatesAPI = {
  list:   (filters = {}) => apiFetch('GET', '/rates?' + new URLSearchParams(filters)),
  create: (payload)      => apiFetch('POST', '/rates', payload),
  delete: (id)           => apiFetch('DELETE', `/rates/${id}`),
  quote:  (params)       => apiFetch('GET', '/rates/quote?' + new URLSearchParams(params)),
};

// ── Tenant API ────────────────────────────────────────────────────
const TenantAPI = {
  me:    ()        => apiFetch('GET', '/tenants/me'),
  tiers: ()        => apiFetch('GET', '/tenants/tiers'),
  create:(payload) => apiFetch('POST', '/tenants', payload),
};

// ── Tenant UI: apply branding from tenant config ──────────────────
const TenantUI = {
  apply(tenant) {
    if (!tenant) return;
    // Brand name
    document.querySelectorAll('[data-tenant-name]').forEach(el => el.textContent = tenant.brandName);
    // Logo
    if (tenant.logoUrl) {
      document.querySelectorAll('[data-tenant-logo]').forEach(el => el.src = tenant.logoUrl);
    }
    // Primary color via CSS variable
    if (tenant.primaryColor) {
      document.documentElement.style.setProperty('--accent', tenant.primaryColor);
    }
    // Feature gating — hide nav items for unlocked features
    document.querySelectorAll('[data-feature]').forEach(el => {
      const feature = el.dataset.feature;
      const allowed = tenant.features?.includes('*') || tenant.features?.includes(feature);
      el.style.display = allowed ? '' : 'none';
    });
  },
};

// ── App boot ──────────────────────────────────────────────────────
async function bootApp() {
  // Restore tenant branding on page load
  const tenant = Auth.getTenant();
  if (tenant) TenantUI.apply(tenant);

  // Session expired listener
  window.addEventListener('zoree:session-expired', () => {
    showLoginScreen('Your session has expired. Please sign in again.');
  });

  if (!Auth.isLoggedIn()) {
    showLoginScreen();
    return;
  }

  // Load initial data
  try {
    await Promise.all([
      loadOrders(),
      loadShipments(),
      loadCarriers(),
    ]);
    hideLoginScreen();
    navigate('dashboard');
  } catch (err) {
    console.error('[Boot] Failed to load data:', err);
    if (err.message.includes('Session')) {
      showLoginScreen();
    }
  }
}

// Export to window for use across page scripts
window.ZoreeAPI = {
  Auth, AuthAPI, OrdersAPI, ShipmentsAPI, CarriersAPI, RatesAPI, TenantAPI, TenantUI, bootApp,
};
