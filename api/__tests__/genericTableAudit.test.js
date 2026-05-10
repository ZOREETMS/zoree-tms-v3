// Tests for api/services/genericTableAudit.js — REQ-02 Phase 4.
//
// We don't hit the DB. We monkey-patch changeHistory's writers so we
// can observe (a) which audit rows the helper would emit and (b) that
// the entity_type / entity_id / fields / metadata.via contract is
// preserved across create / patch / delete.
//
// Run with: node --test api/__tests__/genericTableAudit.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

const history = require('../services/changeHistory');
const audit   = require('../services/genericTableAudit');

// ── Test scaffolding: capture every write the helper attempts. ───────
function withRecorder(fn) {
  const calls = { recordChange: [], recordFieldDiffs: [] };

  const origRecordChange     = history.recordChange;
  const origRecordFieldDiffs = history.recordFieldDiffs;

  history.recordChange = async (input) => {
    calls.recordChange.push(input);
    // Mirror the real helper: build the row so any invalid entityType /
    // action surfaces as a synchronous throw, just like the DB CHECK
    // would catch it. This guards against lockstep drift between the
    // JS whitelist and migration 043.
    return history.buildRow(input);
  };
  history.recordFieldDiffs = async (input) => {
    calls.recordFieldDiffs.push(input);
    // Validate every field in the diff produces a buildable row, so
    // the test fails loudly if a table's `fields` list contains a
    // value that conflicts with ALLOWED_ACTIONS.
    if (input.before && input.after) {
      for (const k of input.fields || []) {
        if (input.before[k] !== input.after[k]) {
          history.buildRow({
            entityType: input.entityType,
            entityId:   input.entityId,
            action:     'edit',
            field:      k,
            before:     input.before[k],
            after:      input.after[k],
            user:       input.user,
          });
        }
      }
    }
    return [];
  };

  const restore = () => {
    history.recordChange     = origRecordChange;
    history.recordFieldDiffs = origRecordFieldDiffs;
  };

  return Promise.resolve()
    .then(() => fn(calls))
    .finally(restore);
}

// ── Static surface tests ─────────────────────────────────────────────

test('isAuditedTable: known master-data tables are audited', () => {
  for (const t of [
    'rates','carriers','lane_preferences','locations','drivers',
    'vehicles','equipment_types','dock_appointments','documents',
    'planning_parameters',
  ]) {
    assert.equal(audit.isAuditedTable(t), true, `${t} should be audited`);
  }
});

test('isAuditedTable: ignores tables outside the allow-list', () => {
  for (const t of ['orders','shipments','oms_orders','mw_requests','system_config','random_table',null,undefined,'']) {
    assert.equal(audit.isAuditedTable(t), false, `${t} should NOT be audited via the generic helper`);
  }
});

test('every audited table maps to an entity in changeHistory.ALLOWED_ENTITIES', () => {
  // Migration 043 broadens the DB CHECK constraint to include exactly
  // these entity types. The JS whitelist must stay in lockstep — if
  // someone adds a table here without updating the migration AND the
  // JS Set, this test fails.
  const allowed = history._internal.ALLOWED_ENTITIES;
  for (const [table, desc] of Object.entries(audit._internal.TABLE_TO_ENTITY)) {
    assert.equal(
      allowed.has(desc.entity), true,
      `Entity '${desc.entity}' (table '${table}') must be in changeHistory.ALLOWED_ENTITIES`,
    );
  }
});

test('every audited table declares at least one diffable field', () => {
  for (const [table, desc] of Object.entries(audit._internal.TABLE_TO_ENTITY)) {
    assert.equal(
      Array.isArray(desc.fields) && desc.fields.length > 0, true,
      `Table '${table}' must declare a non-empty fields array`,
    );
  }
});

// ── recordCreate ─────────────────────────────────────────────────────

test('recordCreate emits a create row with table → entity mapping', async () => {
  await withRecorder(async (calls) => {
    await audit.recordCreate({
      table: 'rates',
      row:   { id: 'RATE-1', lane: 'AVRT-HOU-DAL', base_cost: 1200 },
      user:  { email: 'pricing@example.com' },
    });
    assert.equal(calls.recordChange.length, 1);
    const c = calls.recordChange[0];
    assert.equal(c.entityType, 'rate');
    assert.equal(c.entityId,   'RATE-1');
    assert.equal(c.action,     'create');
    assert.equal(c.field,      null);
    assert.equal(c.metadata.via,   'db-post');
    assert.equal(c.metadata.table, 'rates');
  });
});

test('recordCreate is a no-op for un-audited tables', async () => {
  await withRecorder(async (calls) => {
    await audit.recordCreate({
      table: 'oms_orders',
      row:   { id: 1 },
      user:  { email: 'p@e.com' },
    });
    assert.equal(calls.recordChange.length, 0);
  });
});

test('recordCreate is a no-op when the row has no id', async () => {
  await withRecorder(async (calls) => {
    await audit.recordCreate({ table: 'rates', row: { lane: 'X' }, user: null });
    assert.equal(calls.recordChange.length, 0);
  });
});

// ── recordPatch ──────────────────────────────────────────────────────

test('recordPatch produces a recordFieldDiffs call with the audited field allow-list', async () => {
  await withRecorder(async (calls) => {
    await audit.recordPatch({
      table:  'lane_preferences',
      before: { id: 'LP-1', preferred_carrier: 'AAA', priority: 1 },
      after:  { id: 'LP-1', preferred_carrier: 'BBB', priority: 1, updated_at: '2026-05-10' },
      user:   { email: 'planner@example.com' },
    });
    assert.equal(calls.recordFieldDiffs.length, 1);
    const d = calls.recordFieldDiffs[0];
    assert.equal(d.entityType, 'lane_preference');
    assert.equal(d.entityId,   'LP-1');
    // fields list must be the table descriptor — never a user-supplied
    // body — so columns like updated_at can't sneak into the audit log.
    assert.deepEqual(
      d.fields,
      audit._internal.TABLE_TO_ENTITY.lane_preferences.fields,
    );
    assert.equal(d.metadata.via,   'db-patch');
    assert.equal(d.metadata.table, 'lane_preferences');
  });
});

test('recordPatch is a no-op when before is missing', async () => {
  await withRecorder(async (calls) => {
    await audit.recordPatch({
      table: 'rates', before: null, after: { id: 'X' }, user: null,
    });
    assert.equal(calls.recordFieldDiffs.length, 0);
  });
});

test('recordPatch resolves entity id from after, falling back to before', async () => {
  await withRecorder(async (calls) => {
    await audit.recordPatch({
      table:  'drivers',
      before: { id: 'D-1', name: 'Old' },
      after:  { name: 'New' }, // missing id (won't happen in prod, but be safe)
      user:   null,
    });
    assert.equal(calls.recordFieldDiffs[0].entityId, 'D-1');
  });
});

// ── recordDelete ─────────────────────────────────────────────────────

test('recordDelete emits a delete row carrying a compact field snapshot', async () => {
  await withRecorder(async (calls) => {
    await audit.recordDelete({
      table:  'vehicles',
      id:     'V-9',
      before: {
        id: 'V-9',
        unit_number: '101',
        vin: '1HGBH41JXMN109186',
        // Internal/system column should be stripped from the snapshot
        created_at: '2026-01-01',
      },
      user:   { email: 'fleet@example.com' },
    });
    assert.equal(calls.recordChange.length, 1);
    const c = calls.recordChange[0];
    assert.equal(c.entityType, 'vehicle');
    assert.equal(c.entityId,   'V-9');
    assert.equal(c.action,     'delete');
    assert.equal(c.metadata.via,   'db-delete');
    assert.equal(c.metadata.table, 'vehicles');
    assert.equal(c.metadata.snapshot.unit_number, '101');
    assert.equal(c.metadata.snapshot.vin,         '1HGBH41JXMN109186');
    assert.equal(c.metadata.snapshot.created_at,  undefined,
      'created_at is not in the audited fields list — snapshot must drop it');
  });
});

test('recordDelete records the event even without a before-snapshot', async () => {
  await withRecorder(async (calls) => {
    await audit.recordDelete({ table: 'documents', id: 'DOC-1', user: null });
    assert.equal(calls.recordChange.length, 1);
    assert.equal(calls.recordChange[0].metadata.snapshot, null);
  });
});

test('recordDelete is a no-op for un-audited tables', async () => {
  await withRecorder(async (calls) => {
    await audit.recordDelete({ table: 'mw_requests', id: 1, user: null });
    assert.equal(calls.recordChange.length, 0);
  });
});

// ── Failure-isolation contract ───────────────────────────────────────

test('audit failures never throw to the caller (mutation must commit)', async () => {
  const orig = history.recordChange;
  history.recordChange = async () => { throw new Error('simulated DB outage'); };
  try {
    await audit.recordCreate({ table: 'rates', row: { id: 'R-1' }, user: null });
    await audit.recordDelete({ table: 'rates', id: 'R-1', user: null });
    // If we got here, the helper swallowed the error — exactly the
    // contract REQ-02 calls for. Assert the test reached this line.
    assert.ok(true);
  } finally {
    history.recordChange = orig;
  }
});

test('recordPatch swallows recordFieldDiffs errors', async () => {
  const orig = history.recordFieldDiffs;
  history.recordFieldDiffs = async () => { throw new Error('boom'); };
  try {
    await audit.recordPatch({
      table:  'rates',
      before: { id: 'R-1', base_cost: 100 },
      after:  { id: 'R-1', base_cost: 200 },
      user:   null,
    });
    assert.ok(true);
  } finally {
    history.recordFieldDiffs = orig;
  }
});
