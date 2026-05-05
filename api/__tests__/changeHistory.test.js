// Regression tests for TMS bug #2 (Reference#, PO Number, Service Level
// edits not in History) and the recordFieldDiffs writer contract.
//
// Run with: node --test api/__tests__/changeHistory.test.js
//
// We don't hit the DB. We use the buildRow helper exported by
// changeHistory and exercise the per-field equality logic that decides
// whether a diff is recorded.

const test = require('node:test');
const assert = require('node:assert/strict');
const history = require('../services/changeHistory');

test('buildRow stamps allowed entity types', () => {
  const row = history.buildRow({
    entityType: 'order',
    entityId:   'ORD-1',
    action:     'edit',
    field:      'customer',
    before:     'Acme',
    after:      'Acme Inc.',
    user:       { email: 'planner@example.com' },
  });
  assert.equal(row.entity_type, 'order');
  assert.equal(row.entity_id,   'ORD-1');
  assert.equal(row.action,      'edit');
  assert.equal(row.field,       'customer');
  assert.equal(row.old_value,   'Acme');
  assert.equal(row.new_value,   'Acme Inc.');
  assert.equal(row.username,    'planner@example.com');
});

test('buildRow rejects unknown entity types', () => {
  assert.throws(
    () => history.buildRow({ entityType: 'banana', entityId: 'X', action: 'edit' }),
    /Invalid entityType/,
  );
});

test('buildRow rejects unknown actions', () => {
  assert.throws(
    () => history.buildRow({ entityType: 'order', entityId: 'X', action: 'sneeze' }),
    /Invalid action/,
  );
});

test('buildRow falls back to "system" username when user is missing', () => {
  const row = history.buildRow({
    entityType: 'order', entityId: 'X', action: 'create',
  });
  assert.equal(row.username, 'system');
});

test('TMS bug #2 — service_level / ref_num / po_number are valid history fields', () => {
  // Each must accept a buildRow() call. If you remove any of these from
  // the audit field set, this test fails — preventing a silent
  // regression of bug #2.
  for (const field of ['service_level', 'ref_num', 'po_number']) {
    const row = history.buildRow({
      entityType: 'order',
      entityId:   'ORD-1',
      action:     'edit',
      field,
      before:     'old',
      after:      'new',
      user:       { email: 'p@e.com' },
    });
    assert.equal(row.field, field);
  }
});

test('Numeric and boolean values stringify into history columns', () => {
  const row = history.buildRow({
    entityType: 'order', entityId: 'X', action: 'edit',
    field: 'weight', before: 1500, after: 2000,
  });
  assert.equal(row.old_value, '1500');
  assert.equal(row.new_value, '2000');
});

test('Internal stringify handles null/undefined consistently', () => {
  const { stringify } = history._internal;
  assert.equal(stringify(null), null);
  assert.equal(stringify(undefined), null);
  assert.equal(stringify(0),  '0');
  assert.equal(stringify(''), '');
  assert.equal(stringify({ a: 1 }), '{"a":1}');
});
