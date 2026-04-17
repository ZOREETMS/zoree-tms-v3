const ROLE_FEATURES = ['orders.plan', 'shipments.edit'];
const SUPABASE_SYSTEM_ROLES = new Set(['authenticated', 'anon', 'anonymous', 'service_role']);

const TABLE_ACTION_TO_FEATURE = {
  orders: {
    POST: 'orders.plan',
    PATCH: 'orders.plan',
    DELETE: 'orders.plan',
  },
  shipments: {
    POST: 'shipments.edit',
    PATCH: 'shipments.edit',
    DELETE: 'shipments.edit',
  },
};

function createRolePermissionService({ dbSelect, dbUpsert }) {
  const DEFAULT_TENANT_ID = 'zoree-default';

  function getUserRole(user) {
    if (!user) return 'anon';
    const candidates = [
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

  function parseRows(data) {
    return Array.isArray(data) ? data : [];
  }

  async function loadFeatures(tenantId = DEFAULT_TENANT_ID) {
    try {
      const rows = await dbSelect(
        'access_features',
        `select=feature_key,label,description,module&tenant_id=eq.${encodeURIComponent(tenantId)}&order=feature_key.asc&limit=200`,
        null
      );
      return parseRows(rows);
    } catch {
      return [];
    }
  }

  async function loadRoles(tenantId = DEFAULT_TENANT_ID) {
    try {
      const rows = await dbSelect(
        'access_roles',
        `select=role_key,display_name,is_system&tenant_id=eq.${encodeURIComponent(tenantId)}&order=role_key.asc&limit=200`,
        null
      );
      return parseRows(rows);
    } catch {
      return [];
    }
  }

  async function loadPermissionRows(tenantId = DEFAULT_TENANT_ID) {
    try {
      const rows = await dbSelect(
        'role_feature_permissions',
        `select=role_key,feature_key,enabled&tenant_id=eq.${encodeURIComponent(tenantId)}&limit=1000`,
        null
      );
      return parseRows(rows);
    } catch {
      return [];
    }
  }

  async function loadRolePermissions(tenantId = DEFAULT_TENANT_ID) {
    const [features, roles, permissionRows] = await Promise.all([
      loadFeatures(tenantId),
      loadRoles(tenantId),
      loadPermissionRows(tenantId),
    ]);

    const featureKeys = features.map((f) => f.feature_key);
    const roleMap = {};

    roles.forEach((role) => {
      roleMap[role.role_key] = Object.fromEntries(featureKeys.map((f) => [f, false]));
    });
    permissionRows.forEach((row) => {
      if (!roleMap[row.role_key]) {
        roleMap[row.role_key] = Object.fromEntries(featureKeys.map((f) => [f, false]));
      }
      roleMap[row.role_key][row.feature_key] = !!row.enabled;
    });

    return {
      features,
      featureKeys,
      roleMetadata: roles,
      roles: roleMap,
    };
  }

  async function saveRolePermissions(roleKey, permissions, tenantId = DEFAULT_TENANT_ID) {
    const normalizedRole = String(roleKey || '').trim().toLowerCase();
    if (!normalizedRole) throw new Error('Role is required');

    await dbUpsert(
      'access_roles',
      {
        id: `role:${tenantId}:${normalizedRole}`,
        tenant_id: tenantId,
        role_key: normalizedRole,
        display_name: normalizedRole.charAt(0).toUpperCase() + normalizedRole.slice(1),
        is_system: false,
        updated_at: new Date().toISOString(),
      },
      null
    );

    const catalogFeatures = await loadFeatures(tenantId);
    const featureKeys = catalogFeatures.length
      ? catalogFeatures.map((f) => f.feature_key)
      : ROLE_FEATURES;

    for (const featureKey of featureKeys) {
      await dbUpsert(
        'role_feature_permissions',
        {
          id: `perm:${tenantId}:${normalizedRole}:${featureKey}`,
          tenant_id: tenantId,
          role_key: normalizedRole,
          feature_key: featureKey,
          enabled: !!permissions[featureKey],
          updated_at: new Date().toISOString(),
        },
        null
      );
    }

    return loadRolePermissions(tenantId);
  }

  async function canWriteTable(user, table, method, tenantId = DEFAULT_TENANT_ID) {
    const role = getUserRole(user);
    if (role === 'admin') return true;
    const feature = TABLE_ACTION_TO_FEATURE[table] && TABLE_ACTION_TO_FEATURE[table][method];
    if (!feature) return false;
    const permissions = await loadRolePermissions(tenantId);
    return !!(permissions.roles[role] && permissions.roles[role][feature]);
  }

  return {
    ROLE_FEATURES,
    getTenantId,
    getUserRole,
    loadRolePermissions,
    saveRolePermissions,
    canWriteTable,
  };
}

module.exports = { createRolePermissionService };
