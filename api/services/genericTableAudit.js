// ═══════════════════════════════════════════════════════════════════
// Generic Table Audit — REQ-02 Phase 4.
//
// The dedicated /api/orders/:id and /api/shipments/:id routes already
// fire change_history through orderMutations.js + shipmentMutations.js.
// The generic /api/db/:table writers historically only special-cased
// shipments (shipService.recordRawPatchAudit). This module closes that
// gap for the remaining master-data tables — without growing server.js
// inline logic (CLAUDE_RULES §6 + §9): every route handler delegates
// here.
//
// Design notes
// ────────────
// • Entity whitelist is keyed by table name. Tables not in the map are
//   silent no-ops. That keeps the helper safe to call from the catch-all
//   /api/db/:table route — including for tables we don't want to audit
//   (oms_*, mw_*, system_config, …) — without throwing.
// • before/after capture is the caller's responsibility (it has the
//   pre-mutation row in scope). This module only diffs and writes.
// • Audit failures NEVER throw. Mirrors changeHistory's own error
//   contract: a failed audit row is logged but does not roll back the
//   user's mutation.
// • Action selection follows the same vocabulary changeHistory uses:
//   create | edit | delete. The 'status' / 'plan' / 'tender' actions
//   are domain-specific to orders/shipments and are not used here.
// ═══════════════════════════════════════════════════════════════════

const history = require('./changeHistory');

// Map: physical table name → (entity type, ID column, audited fields).
//
// `fields` is an explicit allow-list of columns we want to diff and
// surface as audit rows. Internal/system columns (created_at, updated_at,
// tenant_id, sync flags, …) are deliberately excluded so the audit log
// stays meaningful for an end user reviewing it. When in doubt, prefer
// listing fewer columns rather than more — the rule docs (REQ-02) call
// for a "compliance trail of user-meaningful edits", not a full row log.
const TABLE_TO_ENTITY = Object.freeze({
  // Already-allowed entities — these tables have never been audited via
  // the generic route, so the wiring (not the entity name) is what's
  // new.
  rates: {
    entity:  'rate',
    idCol:   'id',
    fields:  ['lane','origin','dest','origin_zip','dest_zip','equipment',
              'mode','match_type','base_cost','fuel_surcharge','transit_days',
              'service_level','carrier','effective_date','expiration_date',
              'min_charge','max_weight','rate_per_mile','rate_per_lb','accessorials'],
  },
  carriers: {
    entity:  'carrier',
    idCol:   'id',
    fields:  ['name','scac','dot','mc','phone','email','contact','status',
              'service_area','equipment_types','cost_per_mile','rating'],
  },

  // New entity types — gated by migration 043.
  lane_preferences: {
    entity:  'lane_preference',
    idCol:   'id',
    fields:  ['lane','origin','dest','preferred_carrier','excluded_carrier',
              'mode','priority','service_level','notes'],
  },
  locations: {
    entity:  'location',
    idCol:   'id',
    fields:  ['name','address','city','state','zip','country','type',
              'contact','phone','email','dock_count','operating_hours',
              'lat','lng','timezone'],
  },
  drivers: {
    entity:  'driver',
    idCol:   'id',
    fields:  ['name','license','license_state','license_expiry',
              'phone','email','status','carrier','equipment_type',
              'home_terminal','hos_remaining','medical_cert_expiry'],
  },
  vehicles: {
    entity:  'vehicle',
    idCol:   'id',
    fields:  ['unit_number','vin','plate','plate_state','equipment_type',
              'make','model','year','status','carrier','capacity_lbs',
              'capacity_pallets','last_inspection','next_inspection'],
  },
  equipment_types: {
    entity:  'equipment',
    idCol:   'id',
    fields:  ['code','name','category','length_ft','max_weight_lbs',
              'max_pallets','temp_controlled','description'],
  },
  dock_appointments: {
    entity:  'dock_appointment',
    idCol:   'id',
    fields:  ['date','start','end','dock_door','status','shipment_id',
              'carrier','order_ids','notes','priority'],
  },
  documents: {
    entity:  'document',
    idCol:   'id',
    fields:  ['type','title','order_id','shipment_id','status',
              'incoterms','notes','file_url'],
  },
  planning_parameters: {
    entity:  'planning_param',
    idCol:   'id',
    fields:  ['key','value','category','description'],
  },
});

/**
 * @returns true iff `tableName` is one we audit via this helper.
 *          Tables not in the map are silent no-ops by design.
 */
function isAuditedTable(tableName) {
  return Boolean(tableName && TABLE_TO_ENTITY[tableName]);
}

/**
 * Resolve the audited entity descriptor for a table, or null.
 */
function descriptorFor(tableName) {
  return TABLE_TO_ENTITY[tableName] || null;
}

/**
 * Pull the entity ID from a DB row using the table's idCol. Stringified
 * because change_history.entity_id is TEXT.
 */
function entityIdOf(row, desc) {
  if (!row) return null;
  const v = row[desc.idCol];
  if (v === null || v === undefined) return null;
  return String(v);
}

/**
 * Record a 'create' audit row for a generic /api/db POST.
 *
 * @param {object} args
 * @param {string} args.table        DB table name (e.g. 'rates').
 * @param {object} args.row          The newly-inserted row (server's response).
 * @param {object} [args.user]       Authenticated user (verifyToken result).
 * @returns {Promise<void>}          Best-effort. Never throws.
 */
async function recordCreate({ table, row, user }) {
  if (!isAuditedTable(table) || !row) return;
  const desc = descriptorFor(table);
  const id = entityIdOf(row, desc);
  if (!id) return;
  try {
    await history.recordChange({
      entityType: desc.entity,
      entityId:   id,
      action:     'create',
      field:      null,
      before:     null,
      after:      null,
      user:       user || null,
      metadata:   { via: 'db-post', table },
    });
  } catch (err) {
    console.error(`[genericTableAudit] create-audit failed for ${table}:`, err.message);
  }
}

/**
 * Record per-field 'edit' audit rows for a generic /api/db PATCH.
 *
 * Diffing is delegated to changeHistory.recordFieldDiffs which already
 * handles the whitespace/case-insensitive equality contract used by
 * the rest of the audit pipeline (REQ-02).
 *
 * @param {object} args
 * @param {string} args.table        DB table name.
 * @param {object} args.before       Pre-mutation row (caller selects this).
 * @param {object} args.after        Post-mutation row (caller has it from dbUpdate).
 * @param {object} [args.user]       Authenticated user.
 * @param {string} [args.via]        Optional metadata.via tag (default 'db-patch').
 * @returns {Promise<void>}          Best-effort. Never throws.
 */
async function recordPatch({ table, before, after, user, via = 'db-patch' }) {
  if (!isAuditedTable(table) || !before || !after) return;
  const desc = descriptorFor(table);
  const id = entityIdOf(after, desc) || entityIdOf(before, desc);
  if (!id) return;
  try {
    await history.recordFieldDiffs({
      entityType: desc.entity,
      entityId:   id,
      before,
      after,
      user:       user || null,
      // recordFieldDiffs accepts an array form: each entry is the field
      // name and also the human-friendly label (no remapping for now —
      // historyService FIELD_LABELS handles presentation if/when these
      // entities get a UI surface).
      fields:     desc.fields,
      metadata:   { via, table },
    });
  } catch (err) {
    console.error(`[genericTableAudit] patch-audit failed for ${table}:`, err.message);
  }
}

/**
 * Record a 'delete' audit row for a generic /api/db DELETE.
 *
 * @param {object} args
 * @param {string} args.table        DB table name.
 * @param {string|number} args.id    Entity ID (caller has it from req.params).
 * @param {object} [args.before]     Optional pre-delete row snapshot. If
 *                                   provided, included as metadata so a
 *                                   future "undo" UI can offer restoration.
 * @param {object} [args.user]       Authenticated user.
 * @returns {Promise<void>}          Best-effort. Never throws.
 */
async function recordDelete({ table, id, before, user }) {
  if (!isAuditedTable(table) || !id) return;
  const desc = descriptorFor(table);
  try {
    await history.recordChange({
      entityType: desc.entity,
      entityId:   String(id),
      action:     'delete',
      field:      null,
      before:     null,
      after:      null,
      user:       user || null,
      // We capture a compact snapshot of audited fields only — not the
      // whole row — so we don't accidentally persist sensitive columns.
      metadata: {
        via:   'db-delete',
        table,
        snapshot: before ? pickFields(before, desc.fields) : null,
      },
    });
  } catch (err) {
    console.error(`[genericTableAudit] delete-audit failed for ${table}:`, err.message);
  }
}

/** Internal: shallow pick of audited fields, dropping undefined. */
function pickFields(obj, fields) {
  if (!obj) return null;
  const out = {};
  for (const k of fields) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

module.exports = {
  isAuditedTable,
  descriptorFor,
  recordCreate,
  recordPatch,
  recordDelete,
  // Exposed for tests only.
  _internal: { TABLE_TO_ENTITY, pickFields, entityIdOf },
};
