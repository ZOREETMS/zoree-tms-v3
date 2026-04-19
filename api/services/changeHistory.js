// ═══════════════════════════════════════════════════════════════════
// Change History Service — REQ-02.
//
// Records every mutation against orders, shipments, rates, and
// carriers to the change_history table. The public API is:
//
//   recordChange({ entityType, entityId, action, field?, before?, after?,
//                  user, metadata? })
//
//   recordFieldDiffs({ entityType, entityId, before, after, user,
//                      fields, metadata? })      // one row per changed field
//
//   recordChangeBatch(rows)                       // used by bulk plan
//
//   getHistory(entityType, entityId, { limit, before })
//
// "user" is the object returned by verifyToken() in server.js. We
// degrade gracefully if it's missing (system-triggered events).
//
// This file is the ONLY writer of change_history rows.
// ═══════════════════════════════════════════════════════════════════

const db = require('./supabase');

const TABLE = 'change_history';

const ALLOWED_ENTITIES = new Set(['order', 'shipment', 'rate', 'carrier', 'invoice']);
const ALLOWED_ACTIONS  = new Set([
  'create', 'edit', 'delete', 'plan', 'unassign', 'tender', 'untender', 'status',
  // REQ-20: allow 'invoice' rows against shipments so the shipment history
  // drawer shows invoice approve/reject alongside the lifecycle events.
  // DB check constraint broadened in parallel by migration 016.
  'invoice',
]);

// ── Display helpers ──────────────────────────────────────────────
function userLabel(user) {
  if (!user) return 'system';
  if (typeof user === 'string') return user; // already a label
  return (
    user.email ||
    (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) ||
    user.name ||
    user.username ||
    'system'
  );
}
function userId(user) {
  if (!user || typeof user !== 'object') return null;
  return user.id || user.sub || null;
}
function userRole(user) {
  if (!user || typeof user !== 'object') return null;
  return (user.user_metadata && user.user_metadata.role) || user.role || null;
}

function stringify(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try { return JSON.stringify(v); } catch (_) { return String(v); }
}

function ensureEntity(t)  { if (!ALLOWED_ENTITIES.has(t)) throw new Error(`Invalid entityType '${t}'`); }
function ensureAction(a)  { if (!ALLOWED_ACTIONS.has(a)) throw new Error(`Invalid action '${a}'`); }

// ── Row builder ──────────────────────────────────────────────────
function buildRow({ entityType, entityId, action, field = null, before = undefined, after = undefined, user = null, metadata = null, tenantId = null, createdAt = null }) {
  ensureEntity(entityType);
  ensureAction(action);
  if (!entityId) throw new Error('entityId is required');

  return {
    entity_type: entityType,
    entity_id:   String(entityId),
    action,
    field,
    old_value:   stringify(before),
    new_value:   stringify(after),
    username:    userLabel(user),
    user_id:     userId(user),
    user_role:   userRole(user),
    metadata:    (metadata && typeof metadata === 'object') ? metadata : {},
    tenant_id:   tenantId || null,
    created_at:  createdAt || new Date().toISOString(),
  };
}

// ── Public API ───────────────────────────────────────────────────

async function recordChange(input) {
  const row = buildRow(input);
  try {
    // Use dbUpsert with an unreachable conflict col → behaves as pure insert.
    return await db.dbUpsert(TABLE, row, 'id');
  } catch (err) {
    // Never break the main write path because audit logging failed.
    // Log to console and swallow.
    console.error('[changeHistory] recordChange failed:', err.message);
    return null;
  }
}

/**
 * Compare before/after objects on a list of fields and write one
 * row per changed field. Returns the array of rows inserted.
 *
 * `fields` may be either:
 *   - an array of column names (uses the same name as `field` in history), or
 *   - an object { columnName: 'human label', ... }
 */
async function recordFieldDiffs({ entityType, entityId, before, after, user, fields, metadata = null, tenantId = null }) {
  if (!before || !after) return [];
  const keys = Array.isArray(fields) ? fields : Object.keys(fields || {});
  const labelFor = (k) => (Array.isArray(fields) ? k : (fields[k] || k));

  const rows = [];
  for (const key of keys) {
    const b = before[key];
    const a = after[key];
    if (stringify(b) === stringify(a)) continue;
    rows.push(buildRow({
      entityType,
      entityId,
      action: 'edit',
      field:  labelFor(key),
      before: b,
      after:  a,
      user,
      metadata,
      tenantId,
    }));
  }
  if (!rows.length) return [];
  return recordChangeBatch(rows);
}

async function recordChangeBatch(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  // Validate and normalize any plain objects that came in without
  // having gone through buildRow yet.
  const normalized = rows.map((r) => (r && r.entity_type && r.action ? r : buildRow(r)));
  try {
    const client = db.getClient();
    const { data, error } = await client.from(TABLE).insert(normalized).select();
    if (error) throw new Error(error.message);
    return data || [];
  } catch (err) {
    console.error('[changeHistory] recordChangeBatch failed:', err.message);
    return [];
  }
}

async function getHistory(entityType, entityId, { limit = 200, before = null } = {}) {
  ensureEntity(entityType);
  if (!entityId) throw new Error('entityId is required');
  const filters = [
    ['entity_type', 'eq', entityType],
    ['entity_id',   'eq', String(entityId)],
  ];
  if (before) filters.push(['created_at', 'lte', before]);
  const rows = await db.dbSelect(TABLE, {
    select: 'id, entity_type, entity_id, action, field, old_value, new_value, username, user_id, user_role, metadata, created_at',
    filters,
    order: { col: 'created_at', asc: false },
    limit,
  });
  return rows;
}

module.exports = {
  recordChange,
  recordFieldDiffs,
  recordChangeBatch,
  getHistory,
  buildRow,
  // exposed for tests
  _internal: { userLabel, userId, userRole, stringify, ALLOWED_ACTIONS, ALLOWED_ENTITIES },
};
