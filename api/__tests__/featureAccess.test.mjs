// Regression tests for QA #138 / #139 — the frontend permission
// resolver that mirrors api/services/rolePermissions.canWriteTable.
//
// Run with: node --test api/__tests__/featureAccess.test.mjs
//
// Pure-function tests — no DB, no network. Imports the frontend ESM
// service via dynamic import so we exercise the same code the UI uses.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const svcPath = path.resolve(
  __dirname,
  '../../frontend/src/services/featureAccessService.js',
);
const svc = await import(pathToFileURL(svcPath).href);
const { normalizeLevel, getFeatureLevel, canEditFeature, canReadFeature } = svc;

// A representative matrix shaped like rolePermissions.loadRolePermissions
// returns: { roles: { [role]: { [feature]: 'edit'|'view'|'none' } } }.
const matrix = {
  roles: {
    admin:    { orders: 'edit', shipments: 'edit', items: 'edit' }, // override below proves matrix value is ignored for admin
    planner:  { orders: 'edit', shipments: 'view', items: 'none' },
    finance:  { invoices: 'edit', orders: 'view', shipments: 'view' },
    viewer:   { orders: 'view',   shipments: 'view', items: 'view' },
  },
};

test('normalizeLevel coerces unknown values to "none"', () => {
  assert.equal(normalizeLevel('edit'),    'edit');
  assert.equal(normalizeLevel('VIEW'),    'view');
  assert.equal(normalizeLevel('  none '), 'none');
  assert.equal(normalizeLevel('banana'),  'none');
  assert.equal(normalizeLevel(undefined), 'none');
  assert.equal(normalizeLevel(null),      'none');
  assert.equal(normalizeLevel(''),        'none');
});

test('admin role always returns edit, regardless of stored value', () => {
  // Even if matrix.roles.admin.orders were 'view' or 'none', admin is
  // privileged at resolution time. This mirrors the server-side ADMIN
  // override in rolePermissions.loadRolePermissions / canWriteTable.
  const stripped = {
    roles: {
      admin: { orders: 'none', shipments: 'view' },
    },
  };
  assert.equal(getFeatureLevel(stripped, 'admin', 'orders'),    'edit');
  assert.equal(getFeatureLevel(stripped, 'admin', 'shipments'), 'edit');
  // Even features the admin row never mentioned still resolve to edit.
  assert.equal(getFeatureLevel(stripped, 'admin', 'invoices'),  'edit');
});

test('non-admin role reads its row directly', () => {
  assert.equal(getFeatureLevel(matrix, 'planner', 'orders'),    'edit');
  assert.equal(getFeatureLevel(matrix, 'planner', 'shipments'), 'view');
  assert.equal(getFeatureLevel(matrix, 'planner', 'items'),     'none');
});

test('missing role / missing feature defaults to none (fail-closed)', () => {
  assert.equal(getFeatureLevel(matrix, 'unknown_role', 'orders'),     'none');
  assert.equal(getFeatureLevel(matrix, 'planner',      'unknown_key'), 'none');
  assert.equal(getFeatureLevel(undefined, 'planner', 'orders'),       'none');
  assert.equal(getFeatureLevel({}, 'planner', 'orders'),              'none');
  assert.equal(getFeatureLevel({ roles: {} }, 'planner', 'orders'),   'none');
});

test('case-insensitive role lookup', () => {
  // The hook lowercases activeRole before passing it; double-check the
  // service handles uppercase too in case a caller forgets.
  assert.equal(getFeatureLevel(matrix, 'PLANNER', 'orders'), 'edit');
  assert.equal(getFeatureLevel(matrix, 'Admin',   'items'),  'edit');
});

test('QA #138 — canEditFeature is true only for "edit"', () => {
  assert.equal(canEditFeature(matrix, 'planner', 'orders'),    true);
  assert.equal(canEditFeature(matrix, 'planner', 'shipments'), false); // view
  assert.equal(canEditFeature(matrix, 'planner', 'items'),     false); // none
  assert.equal(canEditFeature(matrix, 'admin',   'invoices'),  true);  // admin override
});

test('QA #139 — canReadFeature is true for edit OR view, false for none', () => {
  assert.equal(canReadFeature(matrix, 'planner', 'orders'),    true);  // edit
  assert.equal(canReadFeature(matrix, 'planner', 'shipments'), true);  // view
  assert.equal(canReadFeature(matrix, 'planner', 'items'),     false); // none
  assert.equal(canReadFeature(matrix, 'finance', 'invoices'),  true);
  assert.equal(canReadFeature(matrix, 'finance', 'unknown'),   false);
});

test('feature_key is required (no key → none)', () => {
  assert.equal(getFeatureLevel(matrix, 'planner', ''),        'none');
  assert.equal(getFeatureLevel(matrix, 'planner', undefined), 'none');
  assert.equal(getFeatureLevel(matrix, 'planner', null),      'none');
});
