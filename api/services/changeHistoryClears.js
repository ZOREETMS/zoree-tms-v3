// ═══════════════════════════════════════════════════════════════════
// Change History Clears Service — TMS bug #1.
//
// Records when a planner clears the visible history for an order or
// shipment, and looks up the latest "cleared_at" timestamp so the
// changeHistory.getHistory() reader can filter out rows older than
// that point.
//
// We do NOT delete change_history rows — REQ-02 audit semantics require
// the underlying ledger to be permanent. This service writes a separate
// marker row to `change_history_clears` (introduced in migration
// 20260503_change_history_clears.sql).
//
// Public API:
//   recordClear({ entityType, entityId, user, metadata? })
//   getLatestClearAt(entityType, entityId)     // ISO string | null
// ═══════════════════════════════════════════════════════════════════

const db = require('./supabase');

const TABLE = 'change_history_clears';

const ALLOWED_ENTITIES = new Set(['order', 'shipment', 'rate', 'carrier', 'invoice']);

function ensureEntity(t) {
  if (!ALLOWED_ENTITIES.has(t)) throw new Error(`Invalid entityType '${t}'`);
}

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

/**
 * Record a "history cleared" marker for an entity.
 * Writes are best-effort — a failure here must NOT block the user-visible
 * Clear History action, but the API layer can decide to surface it.
 */
async function recordClear({ entityType, entityId, user, metadata = null }) {
  ensureEntity(entityType);
  if (!entityId) throw new Error('entityId is required');

  const row = {
    entity_type:   entityType,
    entity_id:     String(entityId),
    cleared_at:    new Date().toISOString(),
    cleared_by:    userLabel(user),
    cleared_by_id: userId(user),
    metadata:      (metadata && typeof metadata === 'object') ? metadata : {},
  };

  const client = db.getClient();
  const { data, error } = await client.from(TABLE).insert(row).select();
  if (error) throw new Error(error.message);
  return Array.isArray(data) && data.length ? data[0] : null;
}

/**
 * Latest cleared_at ISO string for the given entity, or null if it has
 * never been cleared. Read-only; safe to call on every getHistory().
 */
async function getLatestClearAt(entityType, entityId) {
  ensureEntity(entityType);
  if (!entityId) return null;
  try {
    const rows = await db.dbSelect(TABLE, {
      select:  'cleared_at',
      filters: [
        ['entity_type', 'eq', entityType],
        ['entity_id',   'eq', String(entityId)],
      ],
      order: { col: 'cleared_at', asc: false },
      limit: 1,
    });
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return rows[0].cleared_at || null;
  } catch (err) {
    // The clears table is best-effort — if the read fails (table missing,
    // network blip), fall through and return null so getHistory() still
    // returns the full audit, never less.
    console.error('[changeHistoryClears] getLatestClearAt failed:', err.message);
    return null;
  }
}

module.exports = {
  recordClear,
  getLatestClearAt,
  // Exposed for tests.
  _internal: { userLabel, userId, ALLOWED_ENTITIES },
};
