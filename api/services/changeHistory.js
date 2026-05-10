const db = require('./supabase');
const clears = require('./changeHistoryClears');

const TABLE = 'change_history';

// Migration 043 broadens the DB CHECK constraint to cover master-data
// tables written via the generic /api/db/:table routes (Phase-4 audit
// fix from the 2026-05-09 web↔mobile parity audit). The JS whitelist
// must stay in lockstep — buildRow() validates against this set before
// the row reaches the DB, so a missing entry here surfaces as a clean
// error instead of a CHECK constraint violation at insert time.
const ALLOWED_ENTITIES = new Set([
  'order', 'shipment', 'rate', 'carrier', 'invoice',
  'lane_preference', 'location', 'driver', 'vehicle',
  'equipment', 'dock_appointment', 'document', 'planning_param',
]);
const ALLOWED_ACTIONS  = new Set([
  'create', 'edit', 'delete', 'plan', 'unassign', 'tender', 'untender', 'status',
  'invoice',
]);

function userLabel(user) {
  if (!user) return 'system';
  if (typeof user === 'string') return user;
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

function valuesEqualForDiff(a, b) {
  const sa = stringify(a);
  const sb = stringify(b);
  if (sa === sb) return true;
  if (sa === null || sb === null) return false;
  const norm = (s) => s.replace(/\s+/g, ' ').trim().toUpperCase();
  return norm(sa) === norm(sb);
}

function ensureEntity(t)  { if (!ALLOWED_ENTITIES.has(t)) throw new Error(`Invalid entityType '${t}'`); }
function ensureAction(a)  { if (!ALLOWED_ACTIONS.has(a)) throw new Error(`Invalid action '${a}'`); }

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

async function recordChange(input) {
  const row = buildRow(input);
  try {
    return await db.dbUpsert(TABLE, row, 'id');
  } catch (err) {
    console.error('[changeHistory] recordChange failed:', err.message);
    return null;
  }
}

async function recordFieldDiffs({ entityType, entityId, before, after, user, fields, metadata = null, tenantId = null }) {
  if (!before || !after) return [];
  const keys = Array.isArray(fields) ? fields : Object.keys(fields || {});
  const labelFor = (k) => (Array.isArray(fields) ? k : (fields[k] || k));
  const rows = [];
  for (const key of keys) {
    const b = before[key];
    const a = after[key];
    if (valuesEqualForDiff(b, a)) continue;
    rows.push(buildRow({
      entityType, entityId, action: 'edit',
      field: labelFor(key), before: b, after: a,
      user, metadata, tenantId,
    }));
  }
  if (!rows.length) return [];
  return recordChangeBatch(rows);
}

async function recordChangeBatch(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
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
  // TMS bug #1: filter rows older than the latest Clear History marker.
  const clearedAt = await clears.getLatestClearAt(entityType, entityId);
  const filters = [
    ['entity_type', 'eq', entityType],
    ['entity_id',   'eq', String(entityId)],
  ];
  if (clearedAt) filters.push(['created_at', 'gt', clearedAt]);
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
  _internal: { userLabel, userId, userRole, stringify, ALLOWED_ACTIONS, ALLOWED_ENTITIES },
};
