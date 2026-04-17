// ═══════════════════════════════════════════════════════════════════
// User Management Service — REQ-08.
//
// Brokers between Supabase Auth (auth.users — credentials) and the
// new public.user_profiles table (roles + active_role). Every write
// that affects roles goes through this service so the two stores
// stay consistent.
//
// Writes require the service_role key (SUPABASE_SERVICE_KEY from env).
// ═══════════════════════════════════════════════════════════════════

const db = require('./supabase');

const ROLE_WHITELIST = new Set(['admin', 'planner', 'finance', 'viewer']);

function assertRoles(roles) {
  if (!Array.isArray(roles) || roles.length === 0) {
    const e = new Error('roles must be a non-empty array');
    e.status = 400;
    throw e;
  }
  for (const r of roles) {
    if (!ROLE_WHITELIST.has(r)) {
      const e = new Error(`Unknown role '${r}'. Allowed: ${[...ROLE_WHITELIST].join(', ')}`);
      e.status = 400;
      throw e;
    }
  }
}

function chooseActiveRole(roles, requested) {
  if (requested && roles.includes(requested)) return requested;
  // Priority: admin > planner > finance > viewer when none requested.
  for (const r of ['admin', 'planner', 'finance', 'viewer']) {
    if (roles.includes(r)) return r;
  }
  return roles[0];
}

/** Fetch the profile for a given auth user id. Returns null if missing. */
async function getProfile(userId) {
  const rows = await db.dbSelect('user_profiles', {
    filters: [['id', 'eq', userId]], limit: 1,
  });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/**
 * Auto-provision a profile for a user who exists in auth.users but has
 * no row in user_profiles yet. Used to keep pre-migration users signed
 * in. They default to the 'viewer' role (least privilege).
 */
async function ensureProfile({ userId, email, fullName }) {
  let p = await getProfile(userId);
  if (p) return p;
  const row = {
    id: userId,
    email: email || '',
    full_name: fullName || null,
    roles: ['viewer'],
    active_role: 'viewer',
  };
  return db.dbUpsert('user_profiles', row, 'id');
}

/** Full list of users for the admin UI. Joins auth.users with
 *  user_profiles so we can show the email even for profiles that
 *  haven't been updated lately. */
async function listUsers({ supabaseUrl, serviceKey, fetchImpl = fetch } = {}) {
  // 1) Everyone in user_profiles
  const profiles = await db.dbSelect('user_profiles', {
    select: 'id,email,full_name,roles,active_role,disabled,created_at,updated_at',
    order: { col: 'created_at', asc: false },
    limit: 500,
  });

  // 2) Join against auth.users if we can reach the admin API. This gives
  //    us last-sign-in info and catches any auth users that haven't been
  //    profile-synced yet.
  let authUsers = [];
  if (supabaseUrl && serviceKey) {
    try {
      const res = await fetchImpl(`${supabaseUrl}/auth/v1/admin/users?per_page=500`, {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
      });
      if (res.ok) {
        const body = await res.json();
        authUsers = Array.isArray(body?.users) ? body.users : (Array.isArray(body) ? body : []);
      }
    } catch (_) { /* best effort */ }
  }

  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const out = [];
  // Users that have a profile
  for (const p of profiles) {
    const au = authUsers.find((u) => u.id === p.id);
    out.push({
      id: p.id,
      email: p.email,
      fullName: p.full_name,
      roles: p.roles,
      activeRole: p.active_role,
      disabled: !!p.disabled,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      lastSignInAt: au?.last_sign_in_at || null,
      emailConfirmedAt: au?.email_confirmed_at || null,
    });
  }
  // Users that exist in auth but have no profile yet — flagged for admin attention.
  for (const au of authUsers) {
    if (profileById.has(au.id)) continue;
    out.push({
      id: au.id,
      email: au.email,
      fullName: au.user_metadata?.full_name || null,
      roles: [],
      activeRole: null,
      disabled: false,
      needsProfile: true,
      lastSignInAt: au.last_sign_in_at || null,
      emailConfirmedAt: au.email_confirmed_at || null,
    });
  }
  return out;
}

/**
 * Create a brand-new user via Supabase's admin API, then insert their
 * user_profiles row with the assigned roles.
 * The password is never logged.
 */
async function createUser({ email, password, fullName, roles, activeRole }, { supabaseUrl, serviceKey, fetchImpl = fetch }) {
  if (!email || !password) {
    const e = new Error('email and password are required');
    e.status = 400;
    throw e;
  }
  assertRoles(roles);
  const finalActive = chooseActiveRole(roles, activeRole);

  // 1. Create in auth.users via admin API
  const res = await fetchImpl(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName || null },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(body?.msg || body?.error || `auth admin create failed (${res.status})`);
    e.status = res.status === 422 ? 409 : 500;
    throw e;
  }
  const userId = body?.id || body?.user?.id;
  if (!userId) {
    const e = new Error('auth admin create did not return a user id');
    e.status = 500;
    throw e;
  }

  // 2. Insert the profile row
  const profile = await db.dbUpsert('user_profiles', {
    id: userId,
    email,
    full_name: fullName || null,
    roles,
    active_role: finalActive,
  }, 'id');

  return { id: userId, email, fullName: fullName || null, roles, activeRole: finalActive, profile };
}

/**
 * Update an existing user's profile (roles / active_role / full_name /
 * disabled). Password changes happen via auth admin PATCH — if `password`
 * is provided, we update it alongside.
 */
async function updateUser({ userId, roles, activeRole, fullName, disabled, password }, { supabaseUrl, serviceKey, fetchImpl = fetch }) {
  if (!userId) { const e = new Error('userId is required'); e.status = 400; throw e; }

  // If roles are supplied, validate + reconcile active_role
  const patch = {};
  if (Array.isArray(roles)) {
    assertRoles(roles);
    patch.roles = roles;
    // Keep active_role consistent: use provided if in list, else re-pick a sane default
    patch.active_role = chooseActiveRole(roles, activeRole || undefined);
  } else if (activeRole) {
    // Switching active_role only — must still be in the user's roles
    const existing = await getProfile(userId);
    if (!existing) { const e = new Error('User profile not found'); e.status = 404; throw e; }
    if (!existing.roles.includes(activeRole)) {
      const e = new Error(`active_role '${activeRole}' is not in user's assigned roles [${existing.roles.join(',')}]`);
      e.status = 400;
      throw e;
    }
    patch.active_role = activeRole;
  }
  if (fullName !== undefined) patch.full_name = fullName || null;
  if (disabled !== undefined) patch.disabled = !!disabled;
  patch.updated_at = new Date().toISOString();

  const updated = await db.dbUpdate('user_profiles', userId, patch);

  // Optional: update password via auth admin API
  if (password) {
    const r = await fetchImpl(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password }),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      const e = new Error(body?.msg || `auth admin password update failed (${r.status})`);
      e.status = 500;
      throw e;
    }
  }

  return updated;
}

/** Switch the current user's active_role. Used by the role switcher. */
async function switchActiveRole({ userId, nextActiveRole }) {
  return updateUser({ userId, activeRole: nextActiveRole }, { supabaseUrl: null, serviceKey: null });
}

async function deleteUser({ userId }, { supabaseUrl, serviceKey, fetchImpl = fetch }) {
  if (!userId) { const e = new Error('userId is required'); e.status = 400; throw e; }
  // Delete auth user first (cascades to user_profiles via FK ON DELETE CASCADE)
  const res = await fetchImpl(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.json().catch(() => ({}));
    const e = new Error(body?.msg || `auth admin delete failed (${res.status})`);
    e.status = 500;
    throw e;
  }
  return { deleted: true, id: userId };
}

module.exports = {
  ROLE_WHITELIST: [...ROLE_WHITELIST],
  getProfile,
  ensureProfile,
  listUsers,
  createUser,
  updateUser,
  switchActiveRole,
  deleteUser,
  chooseActiveRole,
  _internal: { assertRoles },
};
