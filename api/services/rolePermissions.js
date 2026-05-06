// ════════════════════════════════════════════════════════════════════
// rolePermissions service — tri-state (edit | view | none) access matrix
// for the User Roles screen.
//
// Storage:
//   access_features              — catalog of modules (orders, shipments, …)
//   access_roles                 — admin / planner / finance / viewer + custom
//   role_feature_permissions     — (role_key, feature_key) → access_level
//
// Notes:
//   - dbSelect / dbUpsert here use the PostgREST query-string flavour
//     defined inline in api/server.js (NOT the object flavour in
//     api/services/supabase.js). Don't change the call shape without
//     updating server.js too.
//   - The legacy `enabled` boolean column is mirrored from access_level
//     for one release so older readers (canWriteTable callers in
//     server.js) keep working until everything is on access_level.
// ════════════════════════════════════════════════════════════════════

const ACCESS_LEVELS = ['edit', 'view', 'none'];
const SYSTEM_ROLE_KEYS = new Set(['admin', 'planner', 'finance', 'viewer']);
const ADMIN_ROLE_KEY = 'admin';
const SUPABASE_SYSTEM_ROLES = new Set(['authenticated', 'anon', 'anonymous', 'service_role']);

// Module → table mapping for write enforcement (canWriteTable).
// Mirrors frontend/src/components/Layout.jsx navStructure.
// Tables not represented here are admin-gated by default.
const MODULE_TO_TABLES = {
  // Overview
  home:               [],
  dashboard:          [],
  // Planning
  items:              ['items'],
  locations:          ['locations'],
  equipments:         ['equipment_types', 'vehicles'],
  shipments:          ['shipments'],
  orders:             ['orders', 'order_lines'],
  route_optimizer:    ['route_templates'],
  bulk_plan:          [],
  multi_stop_routes:  ['route_templates'],
  planning_params:    ['planning_parameters'],
  // Execution
  live_tracking:      ['shipment_events'],
  carriers:           ['carriers'],
  carrier_portal:     [],
  dock_scheduling:    ['dock_appointments', 'dock_schedules', 'crossdock_hubs', 'warehouse_dock_config', 'dock_loading_durations'],
  fleet_management:   ['vehicles', 'drivers'],
  compliance:         [],
  // Finance
  invoices:           ['invoices'],
  rate_management:    ['rates'],
  lane_preferences:   ['lane_preferences'],
  carrier_bids:       [],
  freight_audit:      [],
  // Documents
  documents:          ['documents'],
  customer_portal:    [],
  // Integration
  messaging:          ['tms_messages'],
  // Insights
  network_modeling:   [],
  analytics:          [],
  reports:            [],
  alerts:             [],
  db_explorer:        [],
  // System
  user_management:    [],
  user_roles:         ['access_roles', 'access_features', 'role_feature_permissions'],
  settings:           ['system_config', 'tenant_config'],
};

// Reverse map: a single table can belong to multiple modules
// (e.g. 'vehicles' is touched by both equipments and fleet_management,
// 'route_templates' by both route_optimizer and multi_stop_routes).
// Store all owning features so canWriteTable can pick the most permissive.
const TABLE_TO_FEATURES = Object.entries(MODULE_TO_TABLES).reduce((acc, [feature, tables]) => {
  tables.forEach((t) => {
    if (!acc[t]) acc[t] = [];
    acc[t].push(feature);
  });
  return acc;
}, {});

// Default access matrix used when seeding a brand-new role.
const DEFAULT_NEW_ROLE_ACCESS = {
  orders: 'view', shipments: 'view', invoices: 'view',
  items: 'view',  locations: 'view', equipments: 'view',
};

// Legacy feature keys kept for back-compat with code that still calls
// canWriteTable using the old service surface.
const LEGACY_FEATURES = ['orders.plan', 'shipments.edit'];
const LEGACY_TO_NEW = { 'orders.plan': 'orders', 'shipments.edit': 'shipments' };

function normalizeAccessLevel(value) {
  const v = String(value || '').trim().toLowerCase();
  return ACCESS_LEVELS.includes(v) ? v : 'none';
}

function normalizeRoleKey(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidRoleKey(roleKey) {
  return /^[a-z][a-z0-9_]*$/.test(roleKey);
}

function createRolePermissionService({ dbSelect, dbUpsert, dbDelete }) {
  const DEFAULT_TENANT_ID = 'zoree-default';

  function getUserRole(user) {
    if (!user) return 'anon';
    const candidates = [
      user?.activeRole,
      user?.user_metadata?.role,
      user?.user_metadata?.user_role,
      user?.raw_user_meta_data?.role,
      user?.raw_user_meta_data?.user_role,
      user?.app_metadata?.role,
      user?.app_metadata?.user_role,
      user?.role,
    ]
      .map((r) => String(r || '').trim().toLowerCase())
      .filter(Boolean);

    const explicitRole = candidates.find((role) => !SUPABASE_SYSTEM_ROLES.has(role));
    if (explicitRole) return explicitRole;

    return 'admin';
  }

  function getTenantId(user, fallbackTenantId = DEFAULT_TENANT_ID) {
    return (
      (user && user.tenantId) ||
      (user && user.user_metadata && (user.user_metadata.tenantId || user.user_metadata.tenant_id)) ||
      fallbackTenantId
    );
  }

  // ── Internal loaders ────────────────────────────────────────────────
  async function loadFeatures(tenantId) {
    try {
      const rows = await dbSelect(
        'access_features',
        `select=feature_key,label,description,module,sort_order`
          + `&tenant_id=eq.${encodeURIComponent(tenantId)}`
          + `&order=sort_order.asc&limit=200`,
        null,
      );
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }

  async function loadRoles(tenantId) {
    try {
      const rows = await dbSelect(
        'access_roles',
        `select=role_key,display_name,description,is_system,is_active`
          + `&tenant_id=eq.${encodeURIComponent(tenantId)}`
          + `&order=role_key.asc&limit=200`,
        null,
      );
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }

  async function loadPermissionRows(tenantId) {
    try {
      const rows = await dbSelect(
        'role_feature_permissions',
        `select=role_key,feature_key,access_level,enabled`
          + `&tenant_id=eq.${encodeURIComponent(tenantId)}&limit=2000`,
        null,
      );
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }

  // ── Public: load full matrix shaped for the UI ──────────────────────
  async function loadRolePermissions(tenantId = DEFAULT_TENANT_ID) {
    const [features, roles, permissionRows] = await Promise.all([
      loadFeatures(tenantId),
      loadRoles(tenantId),
      loadPermissionRows(tenantId),
    ]);

    const featureKeys = features.map((f) => f.feature_key);
    const rolesMap = {};

    roles.forEach((role) => {
      rolesMap[role.role_key] = Object.fromEntries(featureKeys.map((f) => [f, 'none']));
    });

    permissionRows.forEach((row) => {
      const roleKey = normalizeRoleKey(row.role_key);
      const featureKey = String(row.feature_key || '').trim();
      if (!rolesMap[roleKey]) {
        rolesMap[roleKey] = Object.fromEntries(featureKeys.map((f) => [f, 'none']));
      }
      // Prefer access_level; fall back to legacy enabled.
      let level = normalizeAccessLevel(row.access_level);
      if (!row.access_level && row.enabled) level = 'edit';
      rolesMap[roleKey][featureKey] = level;
    });

    // Admin is always full edit, regardless of stored values.
    if (rolesMap[ADMIN_ROLE_KEY]) {
      featureKeys.forEach((f) => { rolesMap[ADMIN_ROLE_KEY][f] = 'edit'; });
    }

    return { features, featureKeys, roleMetadata: roles, roles: rolesMap };
  }

  // ── Public: persist a role's full access map ────────────────────────
  async function saveRolePermissions(roleKey, accessByFeature, tenantId = DEFAULT_TENANT_ID) {
    const normalizedRole = normalizeRoleKey(roleKey);
    if (!normalizedRole) throw new Error('Role is required');
    if (!isValidRoleKey(normalizedRole)) throw new Error('Invalid role key');
    if (normalizedRole === ADMIN_ROLE_KEY) {
      throw new Error('Admin role permissions are locked');
    }

    const catalogFeatures = await loadFeatures(tenantId);
    if (catalogFeatures.length === 0) {
      throw new Error('No access_features configured for tenant');
    }

    // Ensure the role row exists (idempotent upsert; preserve display name on update).
    await dbUpsert('access_roles', {
      id:           `role:${tenantId}:${normalizedRole}`,
      tenant_id:    tenantId,
      role_key:     normalizedRole,
      display_name: deriveDisplayName(normalizedRole),
      is_system:    SYSTEM_ROLE_KEYS.has(normalizedRole),
      is_active:    true,
      updated_at:   new Date().toISOString(),
    }, null);

    for (const feature of catalogFeatures) {
      const level = normalizeAccessLevel(accessByFeature[feature.feature_key]);
      await dbUpsert('role_feature_permissions', {
        id:           `perm:${tenantId}:${normalizedRole}:${feature.feature_key}`,
        tenant_id:    tenantId,
        role_key:     normalizedRole,
        feature_key:  feature.feature_key,
        access_level: level,
        enabled:      level === 'edit',          // legacy mirror
        updated_at:   new Date().toISOString(),
      }, null);
    }

    return loadRolePermissions(tenantId);
  }

  // ── Public: create a brand-new role with a default access map ───────
  async function createRole({ roleKey, displayName, description, defaultLevel = 'view' }, tenantId = DEFAULT_TENANT_ID) {
    const normalizedRole = normalizeRoleKey(roleKey);
    if (!normalizedRole) throw new Error('Role key is required');
    if (!isValidRoleKey(normalizedRole)) {
      throw new Error('Role key must be lowercase letters, digits or underscores and start with a letter');
    }
    if (normalizedRole === ADMIN_ROLE_KEY) {
      throw new Error('admin is reserved');
    }

    const existing = await loadRoles(tenantId);
    if (existing.some((r) => r.role_key === normalizedRole)) {
      throw new Error(`Role '${normalizedRole}' already exists`);
    }

    const safeLevel = normalizeAccessLevel(defaultLevel);
    const features = await loadFeatures(tenantId);

    await dbUpsert('access_roles', {
      id:           `role:${tenantId}:${normalizedRole}`,
      tenant_id:    tenantId,
      role_key:     normalizedRole,
      display_name: displayName ? String(displayName).trim() : deriveDisplayName(normalizedRole),
      description:  description ? String(description).trim() : null,
      is_system:    false,
      is_active:    true,
      updated_at:   new Date().toISOString(),
    }, null);

    for (const feature of features) {
      const seedLevel = (DEFAULT_NEW_ROLE_ACCESS[feature.feature_key] || safeLevel);
      await dbUpsert('role_feature_permissions', {
        id:           `perm:${tenantId}:${normalizedRole}:${feature.feature_key}`,
        tenant_id:    tenantId,
        role_key:     normalizedRole,
        feature_key:  feature.feature_key,
        access_level: seedLevel,
        enabled:      seedLevel === 'edit',
        updated_at:   new Date().toISOString(),
      }, null);
    }

    return loadRolePermissions(tenantId);
  }

  // ── Public: delete a non-system role ────────────────────────────────
  async function deleteRole(roleKey, tenantId = DEFAULT_TENANT_ID) {
    const normalizedRole = normalizeRoleKey(roleKey);
    if (!normalizedRole) throw new Error('Role key is required');
    if (normalizedRole === ADMIN_ROLE_KEY || SYSTEM_ROLE_KEYS.has(normalizedRole)) {
      throw new Error(`Role '${normalizedRole}' is a system role and cannot be deleted`);
    }
    if (typeof dbDelete !== 'function') {
      throw new Error('dbDelete handler not wired into rolePermissions service');
    }

    const features = await loadFeatures(tenantId);
    for (const feature of features) {
      try {
        await dbDelete('role_feature_permissions', `perm:${tenantId}:${normalizedRole}:${feature.feature_key}`, null);
      } catch (_) { /* tolerate already-missing rows */ }
    }
    await dbDelete('access_roles', `role:${tenantId}:${normalizedRole}`, null);

    return loadRolePermissions(tenantId);
  }

  // ── Public: write enforcement for /api/db/:table writes ─────────────
  // A table can belong to multiple modules; allow the write if ANY of
  // the owning modules grants 'edit' to the user's role.
  async function canWriteTable(user, table, _method, tenantId = DEFAULT_TENANT_ID) {
    const role = getUserRole(user);
    if (role === ADMIN_ROLE_KEY) return true;

    const owningFeatures = TABLE_TO_FEATURES[table] || [];
    if (owningFeatures.length === 0) return false;

    const matrix = await loadRolePermissions(tenantId);
    const roleAccess = matrix.roles[role];
    if (!roleAccess) return false;
    return owningFeatures.some((featureKey) => roleAccess[featureKey] === 'edit');
  }

  return {
    ACCESS_LEVELS,
    SYSTEM_ROLE_KEYS,
    ADMIN_ROLE_KEY,
    ROLE_FEATURES: LEGACY_FEATURES,        // legacy export, used by routes/roles.js fallback
    LEGACY_TO_NEW,
    MODULE_TO_TABLES,
    getTenantId,
    getUserRole,
    loadRolePermissions,
    saveRolePermissions,
    createRole,
    deleteRole,
    canWriteTable,
    isValidRoleKey,
    normalizeAccessLevel,
  };
}

function deriveDisplayName(roleKey) {
  if (roleKey === 'finance') return 'Finance user';
  if (roleKey === 'admin')   return 'Admin';
  return roleKey.charAt(0).toUpperCase() + roleKey.slice(1);
}

module.exports = { createRolePermissionService };
