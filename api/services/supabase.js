// ═══════════════════════════════════════════════════════════════════
// Supabase Service — Tier 3 connector
// This is the ONLY file that knows about Supabase credentials.
// All other code calls these functions — no raw Supabase calls elsewhere.
// Multi-tenant: pass tenantId to scope all queries.
// ═══════════════════════════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

// ── Singleton client pool (one per tenant in production) ───────────
const _clients = {};

function getClient(tenantConfig = null) {
  // In production: each tenant has their own Supabase project URL + key
  // In development: one project, queries scoped by tenant_id column
  const url = tenantConfig?.supabaseUrl  || process.env.SUPABASE_URL;
  const key = tenantConfig?.supabaseKey  || process.env.SUPABASE_SERVICE_KEY
                                         || process.env.SUPABASE_ANON_KEY;

  const cacheKey = url;
  if (!_clients[cacheKey]) {
    _clients[cacheKey] = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _clients[cacheKey];
}

// ── Generic query helpers ──────────────────────────────────────────

async function dbSelect(table, query = {}, tenantConfig = null) {
  const db = getClient(tenantConfig);
  let q = db.from(table).select(query.select || '*');

  if (query.filters) {
    query.filters.forEach(([col, op, val]) => {
      if (op === 'eq')  q = q.eq(col, val);
      if (op === 'in')  q = q.in(col, val);
      if (op === 'gte') q = q.gte(col, val);
      if (op === 'lte') q = q.lte(col, val);
      if (op === 'ilike') q = q.ilike(col, val);
    });
  }

  if (query.order) q = q.order(query.order.col, { ascending: query.order.asc ?? false });
  if (query.limit) q = q.limit(query.limit);

  const { data, error } = await q;
  if (error) throw new Error(`[DB] ${table} select failed: ${error.message}`);
  return data || [];
}

async function dbUpsert(table, row, conflictCol = 'id', tenantConfig = null) {
  const db = getClient(tenantConfig);
  const { data, error } = await db.from(table).upsert(row, { onConflict: conflictCol }).select();
  if (error) throw new Error(`[DB] ${table} upsert failed: ${error.message}`);
  return data?.[0] || row;
}

async function dbUpdate(table, id, updates, tenantConfig = null) {
  const db = getClient(tenantConfig);
  const { data, error } = await db.from(table).update(updates).eq('id', id).select();
  if (error) throw new Error(`[DB] ${table} update failed: ${error.message}`);
  return data?.[0];
}

async function dbDelete(table, id, tenantConfig = null) {
  const db = getClient(tenantConfig);
  const { error } = await db.from(table).delete().eq('id', id);
  if (error) throw new Error(`[DB] ${table} delete failed: ${error.message}`);
  return { deleted: true, id };
}

// ── Auth helpers ───────────────────────────────────────────────────

async function signIn(email, password, tenantConfig = null) {
  const db = getClient(tenantConfig);
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return data;
}

async function verifyToken(token, tenantConfig = null) {
  const db = getClient(tenantConfig);
  const { data: { user }, error } = await db.auth.getUser(token);
  if (error || !user) throw new Error('Invalid or expired token');
  return user;
}

module.exports = {
  getClient,
  dbSelect,
  dbUpsert,
  dbUpdate,
  dbDelete,
  signIn,
  verifyToken,
};
