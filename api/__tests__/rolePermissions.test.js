// QA #146 — saveRolePermissions used to issue ONE PostgREST round-trip
// per feature in the catalog (~30 round-trips per role on a Save click).
// PostgREST accepts a JSON-array body for upserts, so we now batch the
// per-feature rows into a single dbUpsert call.
//
// These tests stub dbSelect/dbUpsert/dbDelete and assert call counts and
// payload shapes — no DB access required.
//
// Run with: node --test api/__tests__/rolePermissions.test.js

const test   = require('node:test');
const assert = require('node:assert/strict');
const { createRolePermissionService } = require('../services/rolePermissions');

function makeStubs(initialFeatures = []) {
  const calls = { select: [], upsert: [], delete: [] };
  const stubs = {
    dbSelect: async (table, query) => {
      calls.select.push({ table, query });
      if (table === 'access_features') return initialFeatures;
      // Return empty rows for access_roles + role_feature_permissions reads.
      return [];
    },
    dbUpsert: async (table, data) => {
      calls.upsert.push({ table, data, isArray: Array.isArray(data) });
      return Array.isArray(data) ? data[0] : data;
    },
    dbDelete: async (table, id) => {
      calls.delete.push({ table, id });
      return { deleted: true, id };
    },
  };
  return { stubs, calls };
}

function makeFeatures(n) {
  return Array.from({ length: n }, (_, i) => ({
    feature_key: `feat_${i}`,
    label:       `Feature ${i}`,
    module:      'Planning',
    sort_order:  i,
  }));
}

// ── saveRolePermissions ────────────────────────────────────────────

test('QA #146 — saveRolePermissions issues ONE batch upsert for all permissions', async () => {
  const features = makeFeatures(30);
  const { stubs, calls } = makeStubs(features);
  const svc = createRolePermissionService(stubs);

  const access = {};
  features.forEach((f, i) => { access[f.feature_key] = i % 3 === 0 ? 'edit' : 'view'; });

  await svc.saveRolePermissions('planner', access, 'tenant-x');

  // We expect exactly ONE upsert into role_feature_permissions, regardless
  // of feature count — that's the whole point of the perf fix. Plus ONE
  // upsert into access_roles (the role row itself).
  const permUpserts = calls.upsert.filter((c) => c.table === 'role_feature_permissions');
  const roleUpserts = calls.upsert.filter((c) => c.table === 'access_roles');

  assert.equal(permUpserts.length, 1, `expected 1 batch upsert, got ${permUpserts.length}`);
  assert.equal(roleUpserts.length, 1);

  // The batch payload must be an array carrying one row per feature.
  assert.equal(permUpserts[0].isArray, true, 'batch payload must be a JSON array');
  assert.equal(permUpserts[0].data.length, 30);
});

test('QA #146 — every batched row carries the correct (role_key, feature_key, access_level)', async () => {
  const features = [
    { feature_key: 'orders',    label: 'Orders',    module: 'Planning', sort_order: 1 },
    { feature_key: 'shipments', label: 'Shipments', module: 'Planning', sort_order: 2 },
    { feature_key: 'invoices',  label: 'Invoices',  module: 'Finance',  sort_order: 3 },
  ];
  const { stubs, calls } = makeStubs(features);
  const svc = createRolePermissionService(stubs);

  await svc.saveRolePermissions('finance', {
    orders:    'view',
    shipments: 'none',
    invoices:  'edit',
  }, 'tenant-x');

  const batch = calls.upsert.find((c) => c.table === 'role_feature_permissions').data;
  const byFeature = Object.fromEntries(batch.map((r) => [r.feature_key, r]));
  assert.equal(byFeature.orders.access_level,    'view');
  assert.equal(byFeature.shipments.access_level, 'none');
  assert.equal(byFeature.invoices.access_level,  'edit');
  // Legacy boolean column mirrors access_level === 'edit'.
  assert.equal(byFeature.orders.enabled,    false);
  assert.equal(byFeature.invoices.enabled,  true);
  assert.equal(byFeature.shipments.enabled, false);
  // Every row carries the role + tenant.
  for (const row of batch) {
    assert.equal(row.role_key,  'finance');
    assert.equal(row.tenant_id, 'tenant-x');
    assert.equal(row.id, `perm:tenant-x:finance:${row.feature_key}`);
  }
});

test('QA #146 — saveRolePermissions defaults missing features to "none"', async () => {
  const features = makeFeatures(3);
  const { stubs, calls } = makeStubs(features);
  const svc = createRolePermissionService(stubs);

  // Caller passed only feat_0 — the other two must default to "none"
  // (matrix completeness requirement).
  await svc.saveRolePermissions('viewer', { feat_0: 'edit' }, 'tenant-x');

  const batch = calls.upsert.find((c) => c.table === 'role_feature_permissions').data;
  assert.equal(batch.length, 3);
  const map = Object.fromEntries(batch.map((r) => [r.feature_key, r.access_level]));
  assert.equal(map.feat_0, 'edit');
  assert.equal(map.feat_1, 'none');
  assert.equal(map.feat_2, 'none');
});

test('QA #146 — saveRolePermissions rejects admin role', async () => {
  const { stubs } = makeStubs(makeFeatures(2));
  const svc = createRolePermissionService(stubs);
  await assert.rejects(
    svc.saveRolePermissions('admin', { feat_0: 'edit' }, 'tenant-x'),
    /locked/i,
  );
});

test('QA #146 — saveRolePermissions throws when no features are configured', async () => {
  const { stubs } = makeStubs([]);
  const svc = createRolePermissionService(stubs);
  await assert.rejects(
    svc.saveRolePermissions('planner', {}, 'tenant-x'),
    /No access_features/,
  );
});

// ── createRole batches its seed permissions the same way ────────────

test('QA #146 — createRole batches seed permissions in one upsert', async () => {
  const features = makeFeatures(10);
  const { stubs, calls } = makeStubs(features);
  const svc = createRolePermissionService(stubs);

  await svc.createRole({
    roleKey:      'auditor',
    displayName:  'Auditor',
    defaultLevel: 'view',
  }, 'tenant-x');

  const permUpserts = calls.upsert.filter((c) => c.table === 'role_feature_permissions');
  assert.equal(permUpserts.length, 1, 'createRole must batch permissions in one call');
  assert.equal(permUpserts[0].isArray, true);
  assert.equal(permUpserts[0].data.length, 10);
  // Default level applies (with the orders/shipments/invoices etc.
  // overrides from DEFAULT_NEW_ROLE_ACCESS not present in our synthetic
  // feature keys, so all rows take the requested defaultLevel).
  for (const row of permUpserts[0].data) {
    assert.equal(row.access_level, 'view');
    assert.equal(row.role_key,    'auditor');
  }
});

// ── canWriteTable stays correct after the batch refactor ───────────

test('canWriteTable returns false for view-only role on a guarded table', async () => {
  // Synthesise a matrix where 'planner' has only 'view' on dock_scheduling.
  const features = [{ feature_key: 'dock_scheduling', module: 'Execution', sort_order: 1 }];
  const calls = { upsert: [] };
  const stubs = {
    dbSelect: async (table) => {
      if (table === 'access_features') return features;
      if (table === 'access_roles') {
        return [{ role_key: 'planner', is_system: true, is_active: true }];
      }
      if (table === 'role_feature_permissions') {
        return [{ role_key: 'planner', feature_key: 'dock_scheduling', access_level: 'view', enabled: false }];
      }
      return [];
    },
    dbUpsert: async (table, data) => {
      calls.upsert.push({ table, data });
      return Array.isArray(data) ? data[0] : data;
    },
    dbDelete: async () => ({ deleted: true }),
  };
  const svc = createRolePermissionService(stubs);

  const allowed = await svc.canWriteTable(
    { activeRole: 'planner' },
    'dock_appointments',
    'PATCH',
    'tenant-x',
  );
  assert.equal(allowed, false);
});

test('canWriteTable returns true for admin regardless of stored level', async () => {
  const stubs = {
    dbSelect: async () => [],
    dbUpsert: async (_t, d) => d,
    dbDelete: async () => ({ deleted: true }),
  };
  const svc = createRolePermissionService(stubs);
  const allowed = await svc.canWriteTable(
    { activeRole: 'admin' },
    'orders',
    'POST',
    'tenant-x',
  );
  assert.equal(allowed, true);
});
